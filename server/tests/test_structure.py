"""POST /api/structure (Name to structure): OPSIN first, then PubChem's name lookup.

OPSIN is server/tests/fake_opsin.py here (its answers chosen by the name); the real OPSIN
runs in tests/test_name_to_structure_fixtures.py and test_opsin.py.
"""

import logging
import uuid

import pytest
from fastapi.testclient import TestClient
from rdkit import Chem
from rdkit.Chem import rdDepictor

import chem
import gen_reference_expected as gen
import main
from fakes import FAKE_OPSIN, FakePubChem
from pubchem import STRUCTURE_URL, RateLimit

NOT_FOUND = {"Fault": {"Code": "PUGREST.NotFound", "Message": "No CID found"}}


def compound(expected, name: str) -> dict:
    return next(c for c in expected["compounds"] if c["typed_name"] == name)


def found(cid: int, smiles: str, title: str, more: int = 0) -> dict:
    rows = [{"CID": cid, "SMILES": smiles, "Title": title}]
    rows += [{"CID": cid + i + 1, "SMILES": smiles, "Title": "other"} for i in range(more)]
    return {"PropertyTable": {"Properties": rows}}


def app_with(tmp_path, fake_time, answers):
    server = FakePubChem(fake_time, answers)
    app = main.create_app(
        state_dir=tmp_path,
        transport=server.transport,
        limit=RateLimit(clock=fake_time.clock, sleep=fake_time.sleep),
        sleep=fake_time.sleep,
        clock=fake_time.clock,
        opsin_command=FAKE_OPSIN,
    )
    return server, app


def post(client, name: str):
    return client.post("/api/structure", json={"name": name})


def test_opsin_draws_a_name_it_parses_and_pubchem_is_not_asked(tmp_path, fake_time, expected):
    butanol = compound(expected, "(R)-2-butanol")
    server, app = app_with(tmp_path, fake_time, [(200, NOT_FOUND)])
    with TestClient(app) as client:
        answer = post(client, f"ok:{butanol['smiles']}").json()
    assert server.requests == []
    assert answer["found"] is True
    assert (answer["source"], answer["message"]) == ("OPSIN", None)
    assert answer["smiles"] == butanol["canonical_smiles"]
    assert (answer["title"], answer["cid"], answer["matches"]) == (None, None, 0)
    drawn = Chem.MolFromMolBlock(answer["molfile"])
    assert Chem.MolToSmiles(drawn) == butanol["canonical_smiles"]
    assert drawn.GetIntProp("_MolFileChiralFlag") == 1  # Ketcher reads 0 as an AND group


def test_an_opsin_warning_comes_with_its_structure(tmp_path, fake_time, expected):
    smiles = compound(expected, "ethanol")["smiles"]
    _, app = app_with(tmp_path, fake_time, [(200, NOT_FOUND)])
    with TestClient(app) as client:
        answer = post(client, f"warn:{smiles}").json()
    assert (answer["found"], answer["source"], answer["message"]) == (True, "OPSIN", "fake warning")


def test_pubchem_draws_what_opsin_cannot_and_opsins_message_stays(tmp_path, fake_time, expected):
    aspirin = compound(expected, "aspirin")
    reply = found(aspirin["pubchem_cid"], aspirin["smiles"], "Aspirin title", more=2)
    server, app = app_with(tmp_path, fake_time, [(200, reply)])
    with TestClient(app) as client:
        answer = post(client, "fail:a trade name").json()
    assert server.requests == [(0.0, {"name": "fail:a trade name"})]
    assert answer["found"] is True
    assert answer["source"] == "PubChem"
    assert answer["message"] == "fake failure: a trade name"
    assert (answer["title"], answer["cid"], answer["matches"]) == (
        "Aspirin title",
        aspirin["pubchem_cid"],
        3,
    )
    assert answer["smiles"] == aspirin["canonical_smiles"]


def test_the_name_is_posted_to_pubchems_name_lookup(tmp_path, fake_time):
    seen = []
    server, app = app_with(tmp_path, fake_time, [(200, NOT_FOUND)])

    def handler(request):
        seen.append((request.method, str(request.url)))
        return server._handle(request)

    server.transport.handler = handler
    with TestClient(app) as client:
        post(client, "fail:x")
    assert seen == [("POST", STRUCTURE_URL)]


def test_no_compound_by_that_name(tmp_path, fake_time):
    _, app = app_with(tmp_path, fake_time, [(404, NOT_FOUND)])
    with TestClient(app) as client:
        answer = post(client, "fail:nothing").json()
    assert answer == {
        "found": False,
        "smiles": None,
        "molfile": None,
        "source": None,
        "message": "fake failure: nothing",
        "title": None,
        "cid": None,
        "matches": 0,
        "stereo_from_pubchem": False,
    }


def test_opsin_not_answering_goes_straight_to_pubchem(tmp_path, fake_time):
    server, app = app_with(tmp_path, fake_time, [(404, NOT_FOUND)])
    with TestClient(app) as client:
        answer = post(client, "die").json()  # the stand-in exits; it's restarted next time
    assert server.requests == [(0.0, {"name": "die"})]
    assert (answer["found"], answer["message"]) == (False, None)


@pytest.mark.parametrize(
    ("answers", "status", "error"),
    [
        ([(429, {}), (503, {})], 503, "busy"),
        ([(500, {})], 502, "unavailable"),
        ([(404, {"Fault": {"Code": "PUGREST.BadRequest"}})], 502, "unavailable"),
        ([(200, {"PropertyTable": {"Properties": []}})], 502, "unavailable"),
    ],
)
def test_pubchem_trouble(tmp_path, fake_time, answers, status, error):
    _, app = app_with(tmp_path, fake_time, answers + [(200, NOT_FOUND)])
    with TestClient(app) as client:
        response = post(client, "fail:x")
    assert (response.status_code, response.json()) == (status, {"error": error})


def test_pubchem_is_asked_once_per_name_whatever_its_case(tmp_path, fake_time, expected):
    aspirin = compound(expected, "aspirin")
    reply = found(aspirin["pubchem_cid"], aspirin["smiles"], "t")
    server, app = app_with(tmp_path, fake_time, [(200, reply)])
    with TestClient(app) as client:
        first = post(client, "fail:Some Name").json()
        again = post(client, "fail:some name").json()
    assert len(server.requests) == 1
    assert first["smiles"] == again["smiles"] == aspirin["canonical_smiles"]


def test_no_compound_is_cached_too_but_busy_is_not(tmp_path, fake_time):
    server, app = app_with(tmp_path, fake_time, [(429, {}), (429, {}), (404, NOT_FOUND)])
    with TestClient(app) as client:
        assert post(client, "fail:x").status_code == 503
        assert post(client, "fail:x").json()["found"] is False
        assert post(client, "fail:x").json()["found"] is False
    assert len(server.requests) == 3  # two busy tries, then one answer, then the cache


@pytest.mark.parametrize(
    "name",
    ["", "   ", "x" * (main.MAX_NAME + 1), "two\nlines", "a\ttab", "nul\x00"],
    ids=["empty", "spaces", "too long", "newline", "tab", "nul"],
)
def test_names_that_are_not_one_short_line_are_refused(tmp_path, fake_time, name):
    server, app = app_with(tmp_path, fake_time, [(404, NOT_FOUND)])
    with TestClient(app) as client:
        assert post(client, name).status_code == 422
    assert server.requests == []


def test_a_typed_name_never_reaches_logs(tmp_path, fake_time, caplog, capfd):
    sentinel = f"SENTINEL{uuid.uuid4().hex}"
    caplog.set_level(logging.DEBUG)
    _, app = app_with(tmp_path, fake_time, [(500, {}), (404, NOT_FOUND)])
    with TestClient(app) as client:
        statuses = [post(client, f"fail:{sentinel}").status_code for _ in "ab"]
    assert statuses == [502, 200]
    out, err = capfd.readouterr()
    assert sentinel not in caplog.text
    assert sentinel not in out + err
    assert "PubChem lookup failed: HTTP 500" in caplog.text


def test_the_molfile_is_drawn_as_the_fixtures_are(expected):
    gen.configure()
    for c in expected["compounds"] + expected["invented"]:
        mol = Chem.MolFromSmiles(c["smiles"])
        assert chem.molfile(mol) == gen.molfile(mol, ""), c["smiles"]


def test_rdkit_drawing_settings_match_the_fixture_generator():
    assert chem.PREFER_COORDGEN is gen.SETTINGS["prefer_coordgen"]
    rdDepictor.SetPreferCoordGen(not chem.PREFER_COORDGEN)
    chem.configure()
    assert rdDepictor.GetPreferCoordGen() is chem.PREFER_COORDGEN


def without_stereo(smiles: str) -> str:
    """The same compound with every stereo element left undefined (made by RDKit)."""
    mol = Chem.MolFromSmiles(smiles)
    Chem.RemoveStereochemistry(mol)
    return Chem.MolToSmiles(mol)


def test_pubchems_stereo_replaces_opsins_undefined_stereo(tmp_path, fake_time, expected):
    # Like "nicotine": OPSIN's trivial name has no stereo; PubChem's record has it.
    butanol = compound(expected, "(R)-2-butanol")
    reply = found(butanol["pubchem_cid"], butanol["smiles"], "t")
    server, app = app_with(tmp_path, fake_time, [(200, reply)])
    name = f"ok:{without_stereo(butanol['smiles'])}"
    with TestClient(app) as client:
        answer = post(client, name).json()
    assert server.requests == [(0.0, {"name": name})]
    assert (answer["source"], answer["stereo_from_pubchem"]) == ("PubChem", True)
    assert answer["smiles"] == butanol["canonical_smiles"]
    assert answer["cid"] == butanol["pubchem_cid"]


@pytest.mark.parametrize(
    "reply",
    ["another compound", "also undefined", "no record", "busy", "unavailable"],
)
def test_opsins_structure_stays_unless_pubchem_has_the_same_with_stereo(
    tmp_path, fake_time, expected, reply
):
    butanol = compound(expected, "(R)-2-butanol")
    undefined = without_stereo(butanol["smiles"])
    answers = {
        "another compound": [(200, found(1, compound(expected, "ethanol")["smiles"], "t"))],
        "also undefined": [(200, found(1, undefined, "t"))],
        "no record": [(404, NOT_FOUND)],
        "busy": [(429, {}), (429, {})],
        "unavailable": [(500, {})],
    }[reply]
    _, app = app_with(tmp_path, fake_time, answers + [(200, NOT_FOUND)])
    with TestClient(app) as client:
        response = post(client, f"ok:{undefined}")
    answer = response.json()
    assert response.status_code == 200
    assert (answer["source"], answer["stereo_from_pubchem"]) == ("OPSIN", False)
    assert answer["smiles"] == Chem.MolToSmiles(Chem.MolFromSmiles(undefined))
