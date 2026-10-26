"""The tautomer and resonance panels' fixtures: reproducible, and as a chemist judged them.

tautomers_expected.json, resonance_expected.json, forms_nci_expected.json and the drawings
must equal what server-side RDKit produces now (server/scripts/gen_tautomers_resonance_expected.py),
and what they say must agree with tautomers_judged.json and resonance_judged.json, which were
written by reading each structure, not generated (docs/plans/v2-tautomers-resonance.md, A.2-A.3).
"""

import json

import gen_tautomers_resonance_expected as gen
import pytest
from rdkit import Chem

from test_reference_fixtures import locked_version

TAUTOMERS_JUDGED = gen.FIXTURES / "tautomers_judged.json"
RESONANCE_JUDGED = gen.FIXTURES / "resonance_judged.json"


@pytest.fixture(scope="module")
def generated() -> dict[str, str]:
    return gen.generate()


def compounds(generated, name: str) -> list[dict]:
    return json.loads(generated[name])["compounds"]


def tautomer_summary(c: dict) -> dict:
    found = {"outcome": c["outcome"]}
    if c["outcome"] == "listed":
        found["count"] = len(c["tautomers"])
        found["stereo_dropped"] = c["stereo_dropped"]
    return found


def resonance_summary(c: dict, drawing: Chem.Mol) -> dict:
    found = {"outcome": c["outcome"]}
    if c["outcome"] in ("listed", "counted"):
        found["count"] = c["count"]
    if c["outcome"] == "listed":
        found["drawing_listed"] = any(s["drawing"] for s in c["structures"])
        # Where a charge goes: each atom charged in any structure, as element and sign.
        sites = {(i, q > 0) for s in c["structures"] for i, q in enumerate(s["charges"]) if q}
        symbol = [a.GetSymbol() for a in drawing.GetAtoms()]
        found["charge_sites"] = sorted(f"{symbol[i]}{'+' if plus else '-'}" for i, plus in sites)
    return found


def disagreements(judged: list[dict], generated_compounds: list[dict], summary) -> list[str]:
    """summary(compound) gives what a judgement speaks to."""
    by_name = {c["name"]: c for c in generated_compounds}
    out = []
    for verdict in judged:
        if verdict["name"] not in by_name:
            out.append(f"{verdict['name']}: not generated")
            continue
        found = summary(by_name[verdict["name"]])
        for key, value in found.items():
            if key in verdict and verdict[key] != value:
                out.append(f"{verdict['name']}: {key} judged {verdict[key]}, generated {value}")
    judged_names = {v["name"] for v in judged}
    out += [f"{name}: not judged" for name in by_name if name not in judged_names]
    return out


def judged(path) -> list[dict]:
    return json.loads(path.read_text(encoding="utf-8"))["compounds"]


def test_generated_files_match_committed(generated):
    for rel, text in generated.items():
        assert (gen.FIXTURES / rel).read_text(encoding="utf-8") == text, rel


def test_no_stale_drawings(generated):
    on_disk = {f"{gen.DIR}/{p.name}" for p in (gen.FIXTURES / gen.DIR).iterdir()}
    assert on_disk == {rel for rel in generated if rel.startswith(f"{gen.DIR}/")}


def test_made_with_the_pinned_rdkit_and_the_approved_settings(generated):
    for name in (gen.TAUTOMERS_FILE, gen.RESONANCE_FILE, gen.NCI_FILE):
        data = json.loads(generated[name])
        assert data["rdkit_version"] == locked_version("rdkit")
        assert data["settings"] == {
            "legacy_stereo_perception": False,
            "resonance_flags": ["ALLOW_CHARGE_SEPARATION", "KEKULE_ALL"],
        }
        # Decision 7, as Jeff approved it; the browser's limits are checked the same way.
        assert data["limits"] == {
            "drawn": 32,
            "group_bonds": 60,
            "max_structs": 1000,
            "max_transforms": 1000,
        }


def test_tautomers_agree_with_the_judgement(generated):
    found = compounds(generated, gen.TAUTOMERS_FILE)
    assert disagreements(judged(TAUTOMERS_JUDGED), found, tautomer_summary) == []


def test_resonance_agrees_with_the_judgement(generated):
    found = compounds(generated, gen.RESONANCE_FILE)

    def summary(c: dict) -> dict:
        return resonance_summary(c, Chem.MolFromMolBlock(generated[c["file"]]))

    assert disagreements(judged(RESONANCE_JUDGED), found, summary) == []


def test_a_wrong_judgement_or_a_missing_compound_is_caught(generated):
    found = compounds(generated, gen.TAUTOMERS_FILE)
    verdicts = judged(TAUTOMERS_JUDGED)
    listed = next(i for i, v in enumerate(verdicts) if v.get("count"))
    wrong = [dict(v) for v in verdicts]
    wrong[listed] = {**wrong[listed], "count": wrong[listed]["count"] + 1}
    assert len(disagreements(wrong, found, tautomer_summary)) == 1
    missing = [f"{verdicts[-1]['name']}: not judged"]
    assert disagreements(verdicts[:-1], found, tautomer_summary) == missing


def test_each_listed_tautomer_set_holds_the_drawing_once(generated):
    for c in compounds(generated, gen.TAUTOMERS_FILE):
        if c["outcome"] == "listed":
            assert sum(t["drawing"] for t in c["tautomers"]) == 1, c["name"]
            smiles = [t["smiles"] for t in c["tautomers"]]
            assert smiles == sorted(smiles), c["name"]


def test_resonance_structures_keep_the_skeleton_and_the_charge(generated):
    """Only bond orders and charges change, and the total charge stays the drawing's."""
    for c in compounds(generated, gen.RESONANCE_FILE):
        if c["outcome"] != "listed":
            continue
        drawing = Chem.MolFromMolBlock(generated[c["file"]])
        total = Chem.GetFormalCharge(drawing)
        for s in c["structures"]:
            assert len(s["bonds"]) == drawing.GetNumBonds(), c["name"]
            assert sum(s["charges"]) == total, c["name"]


def test_generated_drawings_are_the_ions_named(generated):
    """Each structure made from a parent has one charge, on the atom the SMARTS names."""
    by_name = {c["name"]: c for c in compounds(generated, gen.RESONANCE_FILE)}
    for name, _parent, change, _smarts in gen.GENERATED:
        mol = Chem.MolFromMolBlock(generated[by_name[name]["file"]])
        charges = [a.GetFormalCharge() for a in mol.GetAtoms() if a.GetFormalCharge()]
        assert charges == [-1 if change == "deprotonate" else 1], name
