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


def locked_version(package: str) -> str:
    match = re.search(rf"/{package}-([0-9][0-9.]*)-[^/\s]*$", LOCK.read_text(), re.MULTILINE)
    assert match, f"{package} missing from {LOCK.name}"
    return match.group(1)


@pytest.fixture(scope="module")
def generated() -> dict[str, str]:
    return gen.generate(gen.read_rows())


def test_csv_rebuilds_from_recordings():
    assert fetch.build_csv(fetch.read_names()) == fetch.CSV_FILE.read_text(encoding="utf-8")


def test_one_recording_per_name():
    wanted = {fetch.recording_path(name).name for name in fetch.read_names()}
    assert {p.name for p in fetch.RECORDINGS.glob("name-*.json")} == wanted


def test_recordings_ask_for_current_property_names():
    for path in fetch.RECORDINGS.glob("name-*.json"):
        recording = json.loads(path.read_text(encoding="utf-8"))
        assert f"/property/{fetch.PROPERTIES}/JSON" in recording["request"]["url"], path.name
        assert recording["status"] == 200, path.name


def test_parse_rejects_more_than_one_record():
    two = [{"CID": 1, "SMILES": "a", "Title": "A"}, {"CID": 2, "SMILES": "b", "Title": "B"}]
    with pytest.raises(ValueError, match="2 records"):
        fetch.parse("ambiguous", {"body": {"PropertyTable": {"Properties": two}}})


def test_generated_files_match_committed(generated):
    for rel, text in generated.items():
        assert (gen.FIXTURES / rel).read_text(encoding="utf-8") == text, rel


def test_no_stale_generated_files(generated):
    on_disk = {
        p.relative_to(gen.FIXTURES).as_posix() for p in (gen.FIXTURES / "molfiles").iterdir()
    }
    assert on_disk == {rel for rel in generated if rel != gen.EXPECTED_FILE}


def test_expected_values_come_from_the_pinned_rdkit(generated):
    data = json.loads(generated[gen.EXPECTED_FILE])
    assert data["rdkit_version"] == locked_version("rdkit")
    assert data["settings"]["legacy_stereo_perception"] is False


def test_molfiles_carry_the_chiral_flag_for_specified_centres(generated):
    data = json.loads(generated[gen.EXPECTED_FILE])
    flagged = 0
    for compound in data["compounds"]:
        path = gen.FIXTURES / "molfiles" / f"{gen.slug(compound['typed_name'])}.mol"
        mol = Chem.MolFromMolFile(str(path))
        specified = any(
            e["type"] == "Atom_Tetrahedral" and e["specified"] == "Specified"
            for e in compound["stereo"]["strict"]
        )
        assert mol.GetIntProp("_MolFileChiralFlag") == int(specified), path.name
        flagged += specified
    assert flagged > 0


def test_rdkit_default_chiral_flag_would_be_caught():
    # The tripwire above only works if RDKit really writes 0 without the property.
    gen.configure()
    mols = (Chem.MolFromSmiles(row["smiles"]) for row in gen.read_rows())
    mol = next(m for m in mols if gen.has_specified_tetrahedral(m))
    reread = Chem.MolFromMolBlock(gen.molfile(mol, "probe", chiral_flag=False))
    assert reread.GetIntProp("_MolFileChiralFlag") == 0
