"""Name to structure's acceptance checks (spec "6. Name to structure"), from the real OPSIN
(the pinned jar) and recorded PubChem answers: 20 systematic and 10 common names draw the
right structures, and the round trip finds PubChem's name for each.

"Right" is checked against an independent source: PubChem's record for the typed name (its
name lookup, recorded for every name, whichever source the server used).
"""

import json

import pytest
from rdkit import Chem

import build_practice_lists as practice
import record_name_lookups as rec
import record_pubchem_names as structure_names
from pubchem import NAME_URL, STRUCTURE_URL

NAMES = rec.read_names()
KIND = dict((name, kind) for kind, name in NAMES)
RESPONSES = json.loads(rec.RESPONSES_FILE.read_text(encoding="utf-8"))["responses"]


def recording(path):
    return json.loads(path.read_text(encoding="utf-8"))


def inchikey(smiles: str) -> str:
    return Chem.MolToInchiKey(Chem.MolFromSmiles(smiles))


def pubchems_record(name: str) -> dict | None:
    by_name = recording(rec.byname_path(name))
    if by_name["status"] == 404:
        return None
    return by_name["body"]["PropertyTable"]["Properties"][0]


def test_at_least_twenty_systematic_and_ten_common_names():
    kinds = [kind for kind, _ in NAMES]
    assert kinds.count("systematic") >= 20
    assert kinds.count("common") >= 10
    assert len(set(KIND)) == len(NAMES)


def test_one_name_lookup_and_one_round_trip_recorded_per_name():
    recorded = {p.name for p in rec.RECORDINGS.glob("byname-*.json")}
    recorded |= {p.name for p in rec.RECORDINGS.glob("roundtrip-*.json")}
    wanted = {rec.byname_path(n).name for n in KIND} | {rec.roundtrip_path(n).name for n in KIND}
    # Practice mode's names share the name lookups (server/scripts/build_practice_lists.py).
    wanted |= {rec.byname_path(n).name for n in practice.every_name()}
    assert recorded == wanted


@pytest.mark.parametrize("name", list(KIND))
def test_recordings_are_what_the_server_sends(name):
    by_name = recording(rec.byname_path(name))
    assert by_name["request"] == {"method": "POST", "url": STRUCTURE_URL, "form": {"name": name}}
    assert by_name["status"] in (200, 404)
    if by_name["status"] == 404:
        assert by_name["body"]["Fault"]["Code"] == "PUGREST.NotFound"
    round_trip = recording(rec.roundtrip_path(name))
    drawn = RESPONSES[name]["structure"]["smiles"]
    assert round_trip["request"] == {"method": "POST", "url": NAME_URL, "form": {"smiles": drawn}}
    assert round_trip["status"] == 200


def test_responses_rebuild_from_recordings_with_the_real_opsin():
    built = rec.build_responses(NAMES, rec.all_recordings())
    assert built == rec.RESPONSES_FILE.read_text(encoding="utf-8")


@pytest.mark.parametrize("name", list(KIND))
def test_every_name_draws_pubchems_structure_for_it(name):
    answer = RESPONSES[name]
    assert answer["structure"]["found"] is True
    assert answer["inchikey"] == inchikey(answer["structure"]["smiles"])
    record = pubchems_record(name)
    if record is None:
        # PubChem doesn't know this spelling; it must know the structure (the round trip).
        assert KIND[name] == "systematic"
        assert answer["roundtrip"]["found"] is True
    else:
        assert answer["inchikey"] == inchikey(record["SMILES"])


@pytest.mark.parametrize("name", [n for n, kind in KIND.items() if kind == "systematic"])
def test_opsin_draws_every_systematic_name(name):
    assert RESPONSES[name]["structure"]["source"] == "OPSIN"


def test_some_common_names_need_pubchem():
    sources = {RESPONSES[n]["structure"]["source"] for n, kind in KIND.items() if kind == "common"}
    assert "PubChem" in sources


@pytest.mark.parametrize("name", list(KIND))
def test_the_round_trip_names_every_drawn_structure(name):
    round_trip = RESPONSES[name]["roundtrip"]
    assert round_trip["found"] is True
    assert isinstance(round_trip["iupac"], str) and round_trip["iupac"]


def test_r_and_s_butan_2_ol_draw_and_name_differently():
    r, s = RESPONSES["(R)-butan-2-ol"], RESPONSES["(S)-butan-2-ol"]
    assert r["inchikey"] != s["inchikey"]
    assert r["roundtrip"]["iupac"] != s["roundtrip"]["iupac"]


def test_the_server_answers_the_spec_shape():
    for name in KIND:
        assert set(RESPONSES[name]["structure"]) == {
            "found",
            "smiles",
            "molfile",
            "source",
            "message",
            "title",
            "cid",
            "matches",
            "stereo_from_pubchem",
        }
    assert structure_names.RESPONSES_FILE != rec.RESPONSES_FILE
