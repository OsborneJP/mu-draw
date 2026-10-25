"""The stereoisomer enumerator's fixtures: reproducible, and in line with a chemist's judgement.

stereoisomers_expected.json and the drawings must equal what server-side RDKit produces now
(server/scripts/gen_stereoisomers_expected.py), and what it says must agree with
stereoisomers_judged.json, which was written by reading each structure, not generated.
"""

import json

import gen_stereoisomers_expected as gen
import pytest
from rdkit import Chem
from test_reference_fixtures import locked_version

JUDGED = gen.FIXTURES / "stereoisomers_judged.json"
# Where InChI rightly merges what canonical SMILES keeps apart (bar A.4). Any other
# compound with fewer InChI classes than SMILES classes fails until it is reviewed here.
REVIEWED = {
    "myo-inositol": "RDKit's canonical SMILES leaves duplicates in a highly symmetric ring",
    "2,3,4-pentanetriol": "SMILES keeps a setting at C3 even where C3 is not a stereocentre",
}
COMPARED = ("outcome", "count", "pairs", "achiral", "meso", "matches", "notes", "exist")


@pytest.fixture(scope="module")
def generated() -> dict[str, str]:
    return gen.generate(gen.read_rows(gen.CSV_FILE))


@pytest.fixture(scope="module")
def compounds(generated) -> list[dict]:
    return json.loads(generated[gen.EXPECTED_FILE])["compounds"]


def summary(compound: dict) -> dict:
    """What the judgement file speaks to, read from one generated compound."""
    found = {"outcome": compound["outcome"], "notes": compound.get("notes", [])}
    if compound["outcome"] in ("listed", "counted"):
        found["count"] = compound["count"]
    if compound["outcome"] == "listed":
        kinds = [s["relation"]["kind"] for s in compound["stereoisomers"]]
        found["pairs"] = kinds.count("enantiomer") // 2
        found["achiral"] = kinds.count("achiral") + kinds.count("meso")
        found["meso"] = kinds.count("meso")
        found["matches"] = sum(1 for s in compound["stereoisomers"] if s["matches"])
    if "embeds_in_3d" in compound:
        found["exist"] = len(compound["embeds_in_3d"])
    return found


def disagreements(judged: list[dict], compounds: list[dict]) -> list[str]:
    by_name = {c["name"]: c for c in compounds}
    out = []
    for verdict in judged:
        if verdict["name"] not in by_name:
            out.append(f"{verdict['name']}: not generated")
            continue
        found = summary(by_name[verdict["name"]])
        for key in COMPARED:
            if key in verdict and key in found and verdict[key] != found[key]:
                out.append(
                    f"{verdict['name']}: {key} judged {verdict[key]}, generated {found[key]}"
                )
    out += [f"{name}: not judged" for name in by_name.keys() - {v["name"] for v in judged}]
    return out


def unexplained_merges(compounds: list[dict], reviewed: dict[str, str]) -> list[str]:
    return [
        c["name"]
        for c in compounds
        if c.get("smiles_unique") is not None
        and c["count"] < c["smiles_unique"]
        and c["name"] not in reviewed
    ]


def test_generated_files_match_committed(generated):
    for rel, text in generated.items():
        assert (gen.FIXTURES / rel).read_text(encoding="utf-8") == text, rel


def test_no_stale_drawings(generated):
    on_disk = {f"{gen.DIR}/{p.name}" for p in (gen.FIXTURES / gen.DIR).iterdir()}
    assert on_disk == {rel for rel in generated if rel != gen.EXPECTED_FILE}


def test_made_with_the_pinned_rdkit_and_its_settings(generated):
    data = json.loads(generated[gen.EXPECTED_FILE])
    assert data["rdkit_version"] == locked_version("rdkit")
    assert data["settings"]["legacy_stereo_perception"] is False
    assert data["limits"] == gen.LIMITS


def test_generated_answers_agree_with_the_judgement(compounds):
    judged = json.loads(JUDGED.read_text(encoding="utf-8"))["compounds"]
    assert disagreements(judged, compounds) == []


def test_a_wrong_judgement_or_a_missing_compound_is_caught(compounds):
    judged = json.loads(JUDGED.read_text(encoding="utf-8"))["compounds"]
    wrong = [dict(v) for v in judged]
    wrong[1] = {**wrong[1], "count": wrong[1]["count"] + 1}
    assert len(disagreements(wrong, compounds)) == 1
    assert disagreements(judged[:-1], compounds) == [f"{judged[-1]['name']}: not judged"]


def test_inchi_merges_beyond_smiles_only_where_reviewed(compounds):
    assert unexplained_merges(compounds, REVIEWED) == []
    assert set(REVIEWED) <= {c["name"] for c in compounds}


def test_an_unreviewed_merge_is_caught(compounds):
    assert set(unexplained_merges(compounds, {})) == set(REVIEWED)


def test_drawings_carry_the_chiral_flag_for_defined_centres(generated, compounds):
    for compound in compounds:
        mol = Chem.MolFromMolBlock(generated[compound["file"]])
        defined = any(a.GetChiralTag() in gen.TETRAHEDRAL for a in mol.GetAtoms())
        racemic = compound["name"] == gen.RACEMIC[0]
        assert mol.GetIntProp("_MolFileChiralFlag") == int(defined and not racemic), compound[
            "name"
        ]


def test_every_listed_stereoisomer_has_its_mirror_and_is_numbered_in_order(compounds):
    for compound in compounds:
        if compound["outcome"] != "listed":
            continue
        listed = compound["stereoisomers"]
        assert [s["number"] for s in listed] == list(range(1, len(listed) + 1))
        for s in listed:
            if s["relation"]["kind"] == "enantiomer":
                partner = listed[s["relation"]["of"] - 1]
                assert partner["relation"] == {"kind": "enantiomer", "of": s["number"]}
                assert abs(partner["number"] - s["number"]) == 1, "pairs sit side by side"

        # Pairs (or single achiral ones) holding a match to the drawing come first.
        def group(s: dict) -> int:
            return min(s["number"], s["relation"].get("of", s["number"]))

        matched = {group(s) for s in listed if s["matches"]}
        unmatched = {group(s) for s in listed} - matched
        assert not matched or not unmatched or max(matched) < min(unmatched), compound["name"]
