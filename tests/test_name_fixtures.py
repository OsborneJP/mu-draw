"""Get name's acceptance checks, from recorded PubChem answers (spec "5. Get name": 20 common
compounds named correctly, 3 invented structures get the not-found message).

"Correctly" is checked against a second, independent PubChem lookup: the structure search
must return the record that PubChem's name lookup gave for the typed name
(reference_compounds.csv), with the same title.
"""

import csv
import json

import pytest

import fetch_reference_smiles as fetch
import record_pubchem_names as rec
from pubchem import COMPOUND_PAGE, NAME_URL

COMPOUNDS = rec.test_compounds()
RECORDINGS = rec.load_recordings(COMPOUNDS)
EXPECTED = json.loads(rec.EXPECTED_FILE.read_text(encoding="utf-8"))
INVENTED = {c["name"] for c in EXPECTED["invented"]}
with fetch.CSV_FILE.open(encoding="utf-8") as f:
    BY_NAME = {row["typed_name"]: row for row in csv.DictReader(f)}
RESPONSES = json.loads(rec.RESPONSES_FILE.read_text(encoding="utf-8"))["responses"]


def test_at_least_twenty_named_and_three_invented():
    assert len(BY_NAME) >= 20
    assert len(INVENTED) == 3
    assert {c["name"] for c in COMPOUNDS} == set(BY_NAME) | INVENTED


def test_one_recording_per_test_compound():
    wanted = {rec.recording_path(c["name"]).name for c in COMPOUNDS}
    assert {p.name for p in rec.RECORDINGS.glob("smiles-*.json")} == wanted


@pytest.mark.parametrize("compound, recording", list(zip(COMPOUNDS, RECORDINGS, strict=True)))
def test_recordings_are_what_the_server_sends(compound, recording):
    assert recording["request"] == {
        "method": "POST",
        "url": NAME_URL,
        "form": {"smiles": compound["canonical_smiles"]},
    }
    assert recording["status"] == 200


def test_pubchem_has_no_record_of_the_invented_structures():
    for compound, recording in zip(COMPOUNDS, RECORDINGS, strict=True):
        if compound["name"] in INVENTED:
            assert recording["body"] == {"PropertyTable": {"Properties": [{"CID": 0}]}}


def test_responses_rebuild_from_recordings():
    assert rec.build_responses(COMPOUNDS, RECORDINGS) == rec.RESPONSES_FILE.read_text("utf-8")


@pytest.mark.parametrize("name", sorted(BY_NAME))
def test_known_compounds_are_named_correctly(name):
    response, row = RESPONSES[name], BY_NAME[name]
    assert response["found"] is True
    assert response["cid"] == int(row["pubchem_cid"])
    assert response["title"] == row["pubchem_title"]
    assert isinstance(response["iupac"], str) and response["iupac"]
    assert response["url"] == COMPOUND_PAGE.format(cid=response["cid"])


@pytest.mark.parametrize("name", sorted(INVENTED))
def test_invented_structures_are_not_found(name):
    assert RESPONSES[name] == {
        "found": False,
        "iupac": None,
        "title": None,
        "cid": None,
        "url": None,
        "undefined_stereo": RESPONSES[name]["undefined_stereo"],
    }


def test_r_and_s_2_butanol_get_different_names():
    r, s = RESPONSES["(R)-2-butanol"], RESPONSES["(S)-2-butanol"]
    assert r["iupac"] != s["iupac"]
    assert r["title"] != s["title"]
    assert r["cid"] != s["cid"]
