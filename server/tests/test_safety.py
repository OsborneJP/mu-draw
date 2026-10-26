"""POST /api/safety (docs/plans/v2-safety-snapshot.md, bar A.5 to A.8), on recorded PubChem
answers and forced failures."""

import json
import logging
import uuid

import httpx
import pytest
from fastapi.testclient import TestClient
from rdkit import Chem

import record_ghs as ghs_rec
from cache import MAX_AGE_S
from pubchem import GHS_PARAMS, GHS_URL
from test_name import NOT_FOUND, app_with, overloaded_carbon

RESPONSES = json.loads(ghs_rec.RESPONSES_FILE.read_text(encoding="utf-8"))["responses"]


def by_name(name: str) -> dict[str, str]:
    return next(c for c in ghs_rec.test_compounds() if c["name"] == name)


def answers(name: str) -> list[tuple[int, object]]:
    """PubChem's recorded answers for a compound, in the order the server asks."""
    c = by_name(name)
    out = []
    for recording in ghs_rec.load_recordings([c]):
        out.append((recording["status"], recording["body"]))
    return out


def ask(client: TestClient, name: str):
    return client.post("/api/safety", json={"smiles": by_name(name)["smiles"]})


def test_a_classified_compound_takes_two_requests_and_the_ghs_one_holds_only_the_cid(
    tmp_path, fake_time
):
    c = by_name("ethanol")
    server, app = app_with(tmp_path, fake_time, answers("ethanol"))
    with TestClient(app) as client:
        response = ask(client, "ethanol")
    assert (response.status_code, response.json()) == (200, RESPONSES["ethanol"])
    cid = response.json()["cid"]
    assert server.urls[1] == str(httpx.URL(GHS_URL.format(cid=cid), params=GHS_PARAMS))
    assert [form for _, form in server.requests] == [{"smiles": c["canonical_smiles"]}, {}]
    for url in server.urls:
        assert c["smiles"] not in url and c["canonical_smiles"] not in url


def test_no_record_never_asks_for_ghs(tmp_path, fake_time):
    name = next(n for n in RESPONSES if n.startswith("invented"))
    server, app = app_with(tmp_path, fake_time, answers(name))
    with TestClient(app) as client:
        response = ask(client, name)
    assert response.json() == {
        "found": False,
        "cid": None,
        "title": None,
        "url": None,
        "classification": None,
        "others": {"count": 0, "sources": []},
    }
    assert len(server.requests) == 1


def test_no_ghs_section_is_found_with_no_classification(tmp_path, fake_time):
    _, app = app_with(tmp_path, fake_time, answers("aldehydo-D-glucose"))
    with TestClient(app) as client:
        body = ask(client, "aldehydo-D-glucose").json()
    assert body["found"] is True and body["cid"] > 0
    assert body["classification"] is None
    assert body["others"] == {"count": 0, "sources": []}


def test_another_404_is_unavailable(tmp_path, fake_time):
    name_answer = answers("ethanol")[0]
    other = (404, {"Fault": {"Code": "PUGVIEW.BadRequest", "Message": "x"}})
    _, app = app_with(tmp_path, fake_time, [name_answer, other])
    with TestClient(app) as client:
        response = ask(client, "ethanol")
    assert (response.status_code, response.json()) == (502, {"error": "unavailable"})


def test_an_invalid_structure_never_reaches_pubchem(tmp_path, fake_time, expected):
    server, app = app_with(tmp_path, fake_time, [(200, NOT_FOUND)])
    with TestClient(app) as client:
        for smiles in (overloaded_carbon(expected), "not a structure"):
            response = client.post("/api/safety", json={"smiles": smiles})
            assert (response.status_code, response.json()) == (400, {"error": "invalid_structure"})
    assert server.requests == []


@pytest.mark.parametrize("which", ["name", "ghs"])
def test_busy_twice_is_503_and_not_cached(tmp_path, fake_time, which):
    recorded = answers("ethanol")
    busy = [(429, {}), (503, {})]
    sequence = busy + recorded if which == "name" else [recorded[0], *busy, recorded[1]]
    server, app = app_with(tmp_path, fake_time, sequence)
    with TestClient(app) as client:
        first = ask(client, "ethanol")
        again = ask(client, "ethanol")
    assert (first.status_code, first.json()) == (503, {"error": "busy"})
    assert (again.status_code, again.json()) == (200, RESPONSES["ethanol"])
    assert len(server.requests) == 4


@pytest.mark.parametrize(
    "failure", [(500, {}), (200, {}), (200, "not json")], ids=["500", "no record", "not JSON"]
)
def test_other_ghs_failures_are_502_and_not_cached(tmp_path, fake_time, failure):
    recorded = answers("ethanol")
    server, app = app_with(tmp_path, fake_time, [recorded[0], failure, recorded[1]])
    with TestClient(app) as client:
        first = ask(client, "ethanol")
        again = ask(client, "ethanol")
    assert (first.status_code, first.json()) == (502, {"error": "unavailable"})
    assert again.json() == RESPONSES["ethanol"]
    assert len(server.requests) == 3  # the name was cached; the GHS section asked twice


@pytest.mark.parametrize("name", ["ethanol", "glucose", "aldehydo-D-glucose"])
def test_answers_are_kept_thirty_days_then_asked_again(tmp_path, fake_time, name):
    recorded = answers(name)
    server, app = app_with(tmp_path, fake_time, recorded + recorded)
    with TestClient(app) as client:
        first = ask(client, name).json()
        fake_time.now += MAX_AGE_S - 1
        assert ask(client, name).json() == first
        assert len(server.requests) == 2
        fake_time.now += 1
        assert ask(client, name).json() == first == RESPONSES[name]
    assert len(server.requests) == 4


def test_get_name_and_safety_share_the_structure_lookup(tmp_path, fake_time):
    recorded = answers("ethanol")
    server, app = app_with(tmp_path, fake_time, recorded)
    with TestClient(app) as client:
        named = client.post("/api/name", json={"smiles": by_name("ethanol")["smiles"]})
        safety = ask(client, "ethanol")
    assert named.json()["cid"] == safety.json()["cid"]
    assert [form for _, form in server.requests] == [
        {"smiles": by_name("ethanol")["canonical_smiles"]},
        {},
    ]  # Get name's lookup, then only the GHS section


def test_a_drawing_never_reaches_logs_or_urls(tmp_path, fake_time, caplog, capfd):
    # A real structure, marked with a random isotope so it can only come from this test.
    isotope = 100 + uuid.uuid4().int % 900
    mol = Chem.MolFromSmiles(by_name("ethanol")["smiles"])
    mol.GetAtomWithIdx(0).SetIsotope(isotope)
    sentinel = Chem.MolToSmiles(mol)
    caplog.set_level(logging.DEBUG)
    name_answer, ghs_answer = answers("ethanol")
    sequence = [(500, {}), (429, {}), (429, {}), name_answer, (500, {}), (200, {}), ghs_answer]
    server, app = app_with(tmp_path, fake_time, sequence)
    with TestClient(app) as client:
        statuses = [
            client.post("/api/safety", json={"smiles": sentinel}).status_code for _ in "abcde"
        ]
    assert statuses == [502, 503, 502, 502, 200]
    out, err = capfd.readouterr()
    for text in (caplog.text, out + err, "\n".join(server.urls)):
        assert sentinel not in text
        assert f"[{isotope}" not in text
    assert "PubChem safety lookup failed: HTTP 500" in caplog.text
    assert "PubChem safety lookup failed: unexpected GHS data: record" in caplog.text
