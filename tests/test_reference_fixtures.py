"""The reference fixtures are reproducible from their sources, byte for byte.

reference_compounds.csv must equal what the recorded PubChem responses produce, and every
generated file must equal what server-side RDKit produces now. A hand edit, a stale
regeneration or an RDKit upgrade fails here.
"""

import json
import re
from pathlib import Path

import pytest
from rdkit import Chem

import fetch_reference_smiles as fetch
import gen_reference_expected as gen

LOCK = Path(gen.ROOT) / "environment.lock.txt"
NMR_NOT_FROM_RDKIT = (
    "excerpt.sd",
    "reference_spectra.json",
    "expected.json",
    "outliers.json",
    "README.md",
)


def locked_version(package: str) -> str:
    match = re.search(rf"/{package}-([0-9][0-9.]*)-[^/\s]*$", LOCK.read_text(), re.MULTILINE)
    assert match, f"{package} missing from {LOCK.name}"
    return match.group(1)


@pytest.fixture(scope="module")
def generated() -> dict[str, str]:
    return gen.generate(gen.read_rows())


@pytest.mark.parametrize("names_file, csv_file", fetch.SETS, ids=lambda p: p.name)
def test_csv_rebuilds_from_recordings(names_file, csv_file):
    names = fetch.read_names(names_file)
    assert fetch.build_csv(names) == csv_file.read_text(encoding="utf-8")


def test_one_recording_per_name():
    wanted = {fetch.recording_path(name).name for name in fetch.all_names()}
    assert {p.name for p in fetch.RECORDINGS.glob("name-*.json")} == wanted
    # Every set is recorded; names they share (aspirin) are recorded once.
    assert len(fetch.SETS) == 6
    assert len(fetch.all_names()) < sum(len(fetch.read_names(n)) for n, _ in fetch.SETS)


def test_recordings_ask_for_current_property_names():
    for path in fetch.RECORDINGS.glob("name-*.json"):
        recording = json.loads(path.read_text(encoding="utf-8"))
        assert f"/property/{fetch.PROPERTIES}/JSON" in recording["request"]["url"], path.name
        assert recording["status"] == 200, path.name


def test_missing_mode_records_only_names_without_a_recording(tmp_path):
    names = ["first name", "second name"]
    fetch.recording_path(names[0], tmp_path).write_text("{}", encoding="utf-8")
    assert fetch.to_record(names, missing_only=True, directory=tmp_path) == names[1:]
    assert fetch.to_record(names, missing_only=False, directory=tmp_path) == names


def test_parse_rejects_more_than_one_record():
    two = [{"CID": 1, "SMILES": "a", "Title": "A"}, {"CID": 2, "SMILES": "b", "Title": "B"}]
    with pytest.raises(ValueError, match="2 records"):
        fetch.parse("ambiguous", {"body": {"PropertyTable": {"Properties": two}}})


def test_generated_files_match_committed(generated):
    for rel, text in generated.items():
        assert (gen.FIXTURES / rel).read_text(encoding="utf-8") == text, rel


def test_no_stale_generated_files(generated):
    on_disk = {
        p.relative_to(gen.FIXTURES).as_posix()
        for folder in ("molfiles", gen.FG_DIR, gen.NMR_DIR)
        for p in (gen.FIXTURES / folder).iterdir()
    }
    # tests/fixtures/nmr/ also holds what web/scripts/build-carbon-table.ts writes from
    # NMRShiftDB2, and the judgement files.
    others = {f"{gen.NMR_DIR}/{name}" for name in NMR_NOT_FROM_RDKIT}
    assert on_disk - others == {rel for rel in generated if rel != gen.EXPECTED_FILE}


def test_expected_values_come_from_the_pinned_rdkit(generated):
    data = json.loads(generated[gen.EXPECTED_FILE])
    assert data["rdkit_version"] == locked_version("rdkit")
    assert data["settings"]["legacy_stereo_perception"] is False


def test_molfiles_carry_the_chiral_flag_for_specified_centres(generated):
    data = json.loads(generated[gen.EXPECTED_FILE])
    flagged = 0
    for compound in data["compounds"] + data["invented"]:
        (rel,) = compound["files"]
        path = gen.FIXTURES / rel
        mol = Chem.MolFromMolFile(str(path))
        specified = any(
            e["type"] == "Atom_Tetrahedral" and e["specified"] == "Specified"
            for e in compound["stereo"]["strict"]
        )
        assert mol.GetIntProp("_MolFileChiralFlag") == int(specified), path.name
        flagged += specified
    assert flagged > 0


def test_rdkit_default_chiral_flag_would_be_caught():
    # The tripwire above only works if RDKit writes 0 when nobody sets the property.
    gen.configure()
    mols = (Chem.MolFromSmiles(row["smiles"]) for row in gen.read_rows())
    mol = next(m for m in mols if gen.has_specified_tetrahedral(m))
    drawn = gen.with_2d_coords(mol, "probe")
    assert not drawn.HasProp("_MolFileChiralFlag")
    reread = Chem.MolFromMolBlock(Chem.MolToMolBlock(drawn))
    assert reread.GetIntProp("_MolFileChiralFlag") == 0


def test_invented_structures_join_two_reference_compounds(generated):
    data = json.loads(generated[gen.EXPECTED_FILE])
    by_name = {c["typed_name"]: c for c in data["compounds"]}
    known = {c["inchikey"] for c in data["compounds"]}
    assert len(data["invented"]) == len(gen.INVENTED) == 3
    for entry, pair in zip(data["invented"], gen.INVENTED, strict=True):
        assert entry["made_from"] == list(pair)
        assert entry["inchikey"] not in known
        parts = [Chem.MolFromSmiles(by_name[name]["smiles"]) for name in pair]
        joined = Chem.MolFromSmiles(entry["smiles"])
        assert joined.GetNumHeavyAtoms() == sum(m.GetNumHeavyAtoms() for m in parts)
        assert len(Chem.GetMolFrags(joined)) == 1
        assert entry["canonical_smiles"] == Chem.MolToSmiles(joined)


def test_degree_of_unsaturation_equals_rings_plus_pi_bonds(generated):
    # The panel's formula rule checked against the structure itself. Sulfur is left out:
    # the formula counts S like O, so DMSO's S=O is not a degree of unsaturation.
    data = json.loads(generated[gen.EXPECTED_FILE])
    checked = 0
    for compound in data["compounds"]:
        shown = compound["panel"]["degree_of_unsaturation"]
        mol = Chem.MolFromSmiles(compound["smiles"])
        if shown == gen.NO_VALUE or any(a.GetSymbol() == "S" for a in mol.GetAtoms()):
            continue
        Chem.Kekulize(mol, clearAromaticFlags=True)
        rings = mol.GetNumBonds() - mol.GetNumAtoms() + len(Chem.GetMolFrags(mol))
        pi_bonds = sum(int(b.GetBondTypeAsDouble()) - 1 for b in mol.GetBonds())
        assert int(shown) == rings + pi_bonds, compound["typed_name"]
        checked += 1
    assert checked >= 20


def test_degree_of_unsaturation_has_no_value_for_ions_and_other_elements(generated):
    data = json.loads(generated[gen.EXPECTED_FILE])
    reasons = set()
    for compound in data["compounds"]:
        mol = Chem.MolFromSmiles(compound["smiles"])
        charged = Chem.GetFormalCharge(mol) != 0
        other = {a.GetSymbol() for a in mol.GetAtoms()} - gen.DOU_ELEMENTS
        no_value = compound["panel"]["degree_of_unsaturation"] == gen.NO_VALUE
        assert no_value == (charged or bool(other)), compound["typed_name"]
        reasons |= {"charge"} if charged else set()
        reasons |= {"element"} if other else set()
    assert reasons == {"charge", "element"}  # the fixtures cover both rules


def test_shown_values_never_read_minus_zero():
    assert gen.shown(-0.0014, 2) == "0.00"
    assert gen.shown(-0.005, 2) == "-0.01"
    assert gen.shown(0.0, 1) == "0.0"


def test_panel_covers_the_cases_the_spec_names(generated):
    # Several fragments, a Lipinski failure, an undefined stereocentre and a stereogenic
    # double bond each appear at least once, so the browser tests exercise them.
    panels = [c["panel"] for c in json.loads(generated[gen.EXPECTED_FILE])["compounds"]]
    assert any(p["fragments"] != "1" for p in panels)
    assert any(not all(p["lipinski"].values()) for p in panels)
    assert any(p["stereo"]["undefined"] != "0" for p in panels)
    assert any(p["stereo"]["double_bonds"] != "0" for p in panels)


def test_degree_of_unsaturation_has_no_value_for_radicals():
    # No PubChem fixture is a radical, so make one from ethanol: its methyl becomes a
    # carbene (one H, two radical electrons), whose formula alone would give a whole number.
    gen.configure()
    smiles = next(r["smiles"] for r in gen.read_rows() if r["typed_name"] == "ethanol")
    assert gen.degree_of_unsaturation(Chem.MolFromSmiles(smiles)) != gen.NO_VALUE
    mol = Chem.RWMol(Chem.MolFromSmiles(smiles))
    methyl = next(a for a in mol.GetAtoms() if a.GetSymbol() == "C" and a.GetTotalNumHs() == 3)
    methyl.SetNoImplicit(True)
    methyl.SetNumExplicitHs(1)
    methyl.SetNumRadicalElectrons(2)
    Chem.SanitizeMol(mol)
    assert gen.degree_of_unsaturation(mol) == gen.NO_VALUE
