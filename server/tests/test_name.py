import logging
import os
import subprocess
import sys
import uuid
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from rdkit import Chem

import chem
import main
from fakes import FAKE_OPSIN, FakePubChem
from pubchem import COMPOUND_PAGE, RateLimit
from usage import USAGE_FILE

SERVER = Path(main.__file__).parent
NOT_FOUND = {"PropertyTable": {"Properties": [{"CID": 0}]}}


def compound(expected, name: str) -> dict:
    return next(c for c in expected["compounds"] if c["typed_name"] == name)


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


def recorded_answer(recordings, name):
    return recordings[name]["status"], recordings[name]["body"]


def overloaded_carbon(expected) -> str:
    """A reference compound with a five-bonded carbon (made by RDKit, not typed)."""
    rw = Chem.RWMol(Chem.MolFromSmiles(compound(expected, "ethanol")["smiles"]))
    carbon = next(a.GetIdx() for a in rw.GetAtoms() if a.GetSymbol() == "C")
    for _ in range(4):
        rw.AddBond(carbon, rw.AddAtom(Chem.Atom("C")), Chem.BondType.SINGLE)
    rw.UpdatePropertyCache(strict=False)
    return Chem.MolToSmiles(rw)


def test_a_named_compound(tmp_path, fake_time, expected, recordings):
    aspirin = compound(expected, "aspirin")
    body = recordings["aspirin"]["body"]["PropertyTable"]["Properties"][0]
    server, app = app_with(tmp_path, fake_time, [recorded_answer(recordings, "aspirin")])
    with TestClient(app) as client:
        response = client.post("/api/name", json={"smiles": aspirin["smiles"]})
    assert response.status_code == 200
    assert response.json() == {
        "found": True,
        "iupac": body["IUPACName"],
        "title": body["Title"],
        "cid": body["CID"],
        "url": COMPOUND_PAGE.format(cid=body["CID"]),
        "undefined_stereo": 0,
    }
    # PubChem is asked with RDKit's canonical SMILES, not the text the browser sent.
    assert server.requests == [(0.0, {"smiles": aspirin["canonical_smiles"]})]


def test_no_record(tmp_path, fake_time, expected):
    _, app = app_with(tmp_path, fake_time, [(200, NOT_FOUND)])
    with TestClient(app) as client:
        response = client.post("/api/name", json={"smiles": expected["invented"][0]["smiles"]})
    assert response.status_code == 200
    assert response.json()["found"] is False
    assert {response.json()[k] for k in ("iupac", "title", "cid", "url")} == {None}


def test_undefined_stereo_is_counted(tmp_path, fake_time, expected, recordings):
    _, app = app_with(tmp_path, fake_time, [recorded_answer(recordings, "ibuprofen")])
    with TestClient(app) as client:
        response = client.post(
            "/api/name", json={"smiles": compound(expected, "ibuprofen")["smiles"]}
        )
    assert response.json()["undefined_stereo"] == 1


def test_an_invalid_structure_never_reaches_pubchem(tmp_path, fake_time, expected):
    server, app = app_with(tmp_path, fake_time, [(200, NOT_FOUND)])
    with TestClient(app) as client:
        for smiles in (overloaded_carbon(expected), "not a structure"):
            response = client.post("/api/name", json={"smiles": smiles})
            assert response.status_code == 400
            assert response.json() == {"error": "invalid_structure"}
    assert server.requests == []


@pytest.mark.parametrize("smiles", ["", "x" * (main.MAX_SMILES + 1)], ids=["empty", "too long"])
def test_empty_or_oversized_bodies_are_refused(tmp_path, fake_time, smiles):
    server, app = app_with(tmp_path, fake_time, [(200, NOT_FOUND)])
    with TestClient(app) as client:
        assert client.post("/api/name", json={"smiles": smiles}).status_code == 422
    assert server.requests == []


def test_busy_twice_is_503_busy(tmp_path, fake_time, expected):
    server, app = app_with(tmp_path, fake_time, [(429, {}), (503, {}), (200, NOT_FOUND)])
    with TestClient(app) as client:
        response = client.post(
            "/api/name", json={"smiles": compound(expected, "aspirin")["smiles"]}
        )
    assert (response.status_code, response.json()) == (503, {"error": "busy"})
    assert len(server.requests) == 2


def test_other_failures_are_502_unavailable(tmp_path, fake_time, expected):
    _, app = app_with(tmp_path, fake_time, [(500, {})])
    with TestClient(app) as client:
        response = client.post(
            "/api/name", json={"smiles": compound(expected, "aspirin")["smiles"]}
        )
    assert (response.status_code, response.json()) == (502, {"error": "unavailable"})


def test_the_same_structure_is_asked_once(tmp_path, fake_time, expected, recordings):
    aspirin = compound(expected, "aspirin")
    server, app = app_with(tmp_path, fake_time, [recorded_answer(recordings, "aspirin")])
    with TestClient(app) as client:
        first = client.post("/api/name", json={"smiles": aspirin["smiles"]})
        again = client.post("/api/name", json={"smiles": aspirin["canonical_smiles"]})
    assert first.json() == again.json()
    assert len(server.requests) == 1


def test_no_record_is_cached_too(tmp_path, fake_time, expected):
    smiles = expected["invented"][0]["smiles"]
    server, app = app_with(tmp_path, fake_time, [(200, NOT_FOUND)])
    with TestClient(app) as client:
        assert client.post("/api/name", json={"smiles": smiles}).json()["found"] is False
        assert client.post("/api/name", json={"smiles": smiles}).json()["found"] is False
    assert len(server.requests) == 1


@pytest.mark.parametrize("failure", [[(429, {}), (429, {})], [(500, {})]])
def test_busy_and_unavailable_are_not_cached(tmp_path, fake_time, expected, recordings, failure):
    smiles = compound(expected, "aspirin")["smiles"]
    answers = failure + [recorded_answer(recordings, "aspirin")]
    server, app = app_with(tmp_path, fake_time, answers)
    with TestClient(app) as client:
        assert client.post("/api/name", json={"smiles": smiles}).status_code >= 500
        assert client.post("/api/name", json={"smiles": smiles}).json()["found"] is True
    assert len(server.requests) == len(failure) + 1


def test_a_cache_hit_still_counts_the_drawings_own_stereo(tmp_path, fake_time, expected):
    # The cache holds PubChem's answer; undefined stereo is about the SMILES sent each time.
    smiles = compound(expected, "ibuprofen")["smiles"]
    _, app = app_with(tmp_path, fake_time, [(200, NOT_FOUND)])
    with TestClient(app) as client:
        client.post("/api/name", json={"smiles": smiles})
        assert client.post("/api/name", json={"smiles": smiles}).json()["undefined_stereo"] == 1


def test_the_service_needs_a_state_directory(monkeypatch):
    monkeypatch.delenv("STATE_DIRECTORY", raising=False)
    with (
        pytest.raises(RuntimeError, match="STATE_DIRECTORY is not set"),
        TestClient(main.create_app()),
    ):
        pass


def test_the_cache_and_the_usage_totals_live_in_the_state_directory(monkeypatch, tmp_path):
    monkeypatch.setenv("STATE_DIRECTORY", str(tmp_path))
    with TestClient(main.create_app()):
        pass
    assert sorted(p.name for p in tmp_path.iterdir()) == sorted([main.CACHE_FILE, USAGE_FILE])


def test_importing_main_needs_no_state_directory():
    # deploy.sh's ship_server runs `python -c 'import main'` in the shipped folder.
    env = {k: v for k, v in os.environ.items() if k != "STATE_DIRECTORY"}
    result = subprocess.run(
        [sys.executable, "-c", "import main"], cwd=SERVER, env=env, capture_output=True
    )
    assert result.returncode == 0, result.stderr.decode()


def test_a_drawing_never_reaches_logs(tmp_path, fake_time, expected, recordings, caplog, capfd):
    # A real structure, marked with a random isotope so it can only come from this test.
    isotope = 100 + uuid.uuid4().int % 900
    mol = Chem.MolFromSmiles(compound(expected, "aspirin")["smiles"])
    mol.GetAtomWithIdx(0).SetIsotope(isotope)
    sentinel = Chem.MolToSmiles(mol)
    caplog.set_level(logging.DEBUG)
    answers = [(500, {}), (429, {}), (429, {}), (200, NOT_FOUND)]
    _, app = app_with(tmp_path, fake_time, answers)
    with TestClient(app) as client:
        statuses = [client.post("/api/name", json={"smiles": sentinel}).status_code for _ in "abc"]
    assert statuses == [502, 503, 200]  # unavailable, busy (two tries), no record
    out, err = capfd.readouterr()
    for text in (caplog.text, out + err):
        assert sentinel not in text
        assert f"[{isotope}" not in text
    assert "PubChem lookup failed: HTTP 500" in caplog.text


def test_httpx_logs_warnings_only():
    # httpx logs request URLs at INFO; Name to structure's PubChem fallback puts names in them.
    assert logging.getLogger("httpx").level == logging.WARNING


def test_rdkit_settings_match_the_fixture_generator():
    import gen_reference_expected as gen

    assert chem.LEGACY_STEREO_PERCEPTION is gen.SETTINGS["legacy_stereo_perception"]
    Chem.SetUseLegacyStereoPerception(not chem.LEGACY_STEREO_PERCEPTION)
    chem.configure()
    assert Chem.GetUseLegacyStereoPerception() is chem.LEGACY_STEREO_PERCEPTION


def test_canonical_smiles_and_stereo_match_the_fixtures(expected):
    for c in expected["compounds"] + expected["invented"]:
        mol = chem.parse(c["smiles"])
        undefined = [e for e in c["stereo"]["possible"] if e["specified"] == "Unspecified"]
        assert chem.canonical(mol) == c["canonical_smiles"], c["smiles"]
        assert chem.undefined_stereo(mol) == len(undefined), c["smiles"]
