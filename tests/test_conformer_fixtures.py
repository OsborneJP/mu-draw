"""The 3D view's fixtures (docs/plans/v2-3d-view.md, bar A.3 and A.4): reproducible, made from
what the server really sends PubChem, and in line with a chemist's judgement.

conformer_responses.json, conformers_expected.json and the drawings must equal what
server/scripts/record_conformers.py builds now from the recordings, and what they say must
agree with conformers_judged.json, which was written by reading each structure, not generated.
"""

import json

import pytest

import record_conformers as rc
from pubchem import CONFORMER_URL

COMPOUNDS = rc.test_compounds()
JUDGED = json.loads((rc.FIXTURES / "conformers_judged.json").read_text(encoding="utf-8"))
EXPECTED = json.loads((rc.FIXTURES / rc.EXPECTED_FILE).read_text(encoding="utf-8"))["compounds"]
# Where RDKit's count of undefined stereo differs from a chemist's, so the note shows where
# nothing can vary. Any other difference from the judged notes fails.
REVIEWED_NOTES = {
    "adamantane": "RDKit counts the cage's four bridgeheads as undefined stereocentres, as the"
    " properties panel and Get name do (chem.undefined_stereo)",
}


@pytest.fixture(scope="module")
def generated() -> dict[str, str]:
    return rc.generate(COMPOUNDS, rc.load_recordings(COMPOUNDS))


def test_the_fixtures_are_what_the_generator_makes(generated):
    for path, text in generated.items():
        assert (rc.FIXTURES / path).read_text(encoding="utf-8") == text, path
    drawings = {p.relative_to(rc.FIXTURES).as_posix() for p in (rc.FIXTURES / rc.DIR).glob("*")}
    assert drawings == {p for p in generated if p.startswith(f"{rc.DIR}/")}


def test_one_recording_per_compound_the_server_asks_pubchem_about():
    wanted = {rc.recording_path(c["name"]).name for c in COMPOUNDS if rc.asks_pubchem(c)}
    assert {p.name for p in rc.RECORDINGS.glob("conformer-*.json")} == wanted
    assert len(wanted) == len(COMPOUNDS) - 1  # sodium acetate is two structures


@pytest.mark.parametrize(
    "compound, recording",
    list(
        zip(
            [c for c in COMPOUNDS if rc.asks_pubchem(c)], rc.load_recordings(COMPOUNDS), strict=True
        )
    ),
    ids=lambda v: v["name"] if "name" in v else "",
)
def test_recordings_are_what_the_server_sends(compound, recording):
    assert recording["request"] == {
        "method": "POST",
        "url": CONFORMER_URL,
        "form": {"smiles": rc.canonical(compound)},
    }
    assert recording["status"] in (200, 404, 501)


def answer(entry: dict) -> str:
    if entry["status"] != 200:
        return entry["error"]
    return entry["source"] if entry["found"] else entry["reason"]


def test_every_test_compound_is_judged():
    assert [c["name"] for c in COMPOUNDS] == list(JUDGED["compounds"])
    assert [e["name"] for e in EXPECTED] == list(JUDGED["compounds"])


@pytest.mark.parametrize("entry", EXPECTED, ids=lambda e: e["name"])
def test_the_answers_are_the_judged_ones(entry):
    judged = JUDGED["compounds"][entry["name"]]
    assert answer(entry) == judged["answer"]
    if judged["note"] is None or entry["name"] in REVIEWED_NOTES:
        return
    assert (entry["undefined_stereo"] > 0) == judged["note"]


def test_the_reviewed_notes_still_differ():
    for name in REVIEWED_NOTES:
        (entry,) = (e for e in EXPECTED if e["name"] == name)
        assert (entry["undefined_stereo"] > 0) != JUDGED["compounds"][name]["note"]


@pytest.mark.parametrize("entry", [e for e in EXPECTED if e.get("found")], ids=lambda e: e["name"])
def test_each_model_keeps_the_drawings_stereo(entry):
    """Bar A.4, independently of threed.keeps_stereo: CIP labels (rdCIPLabeler), by canonical
    rank, from the model's coordinates include the drawing's at every element it defines."""
    drawing, model = entry["drawing_labels"], entry["model_labels"]
    for kind in ("atoms", "bonds"):
        for rank, labels in drawing[kind].items():
            found = list(model[kind].get(rank, []))
            for label in labels:
                assert label in found, (kind, rank, labels, found)
                found.remove(label)


def test_the_stereo_check_has_something_to_check():
    defined = [
        e
        for e in EXPECTED
        if e.get("found") and (e["drawing_labels"]["atoms"] or e["drawing_labels"]["bonds"])
    ]
    assert {e["source"] for e in defined} == {"pubchem", "rdkit"}
    assert any(e["drawing_labels"]["bonds"] for e in defined)
