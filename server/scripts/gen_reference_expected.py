"""Generate expected chemistry for the reference compounds with server-side RDKit.

    python server/scripts/gen_reference_expected.py

Reads tests/fixtures/reference_compounds.csv (SMILES from PubChem) and writes:
  tests/fixtures/reference_expected.json   descriptors, formula, InChIKey, stereo
  tests/fixtures/molfiles/<slug>.mol       2D Molfiles for the editor tests
  tests/fixtures/cdxml/<slug>.cdxml        ChemDraw XML for the editor tests

Everything is raw RDKit output: no rounding and no choices about which values the app
shows. The descriptor set is rdMolDescriptors.Properties, the same code RDKit.js
get_descriptors() calls, so web and server can be compared like for like. Output is
deterministic; tests/test_reference_fixtures.py regenerates it and compares bytes.
"""

from __future__ import annotations

import csv
import json
import re
from pathlib import Path

import rdkit
from rdkit import Chem, RDLogger
from rdkit.Chem import rdChemDraw, rdDepictor, rdMolDescriptors

ROOT = Path(__file__).resolve().parents[2]
FIXTURES = ROOT / "tests" / "fixtures"
CSV_FILE = FIXTURES / "reference_compounds.csv"
EXPECTED_FILE = "reference_expected.json"

SETTINGS = {
    "legacy_stereo_perception": False,
    "prefer_coordgen": False,
    "compute2d_canon_orient": True,
    # PubChem SMILES give absolute configuration. RDKit writes chiral flag 0 by default,
    # which Ketcher reads as an AND (relative) stereo group.
    "molfile_chiral_flag": "1 when any tetrahedral centre is specified, else 0",
}


def configure() -> None:
    RDLogger.DisableLog("rdApp.*")
    Chem.SetUseLegacyStereoPerception(SETTINGS["legacy_stereo_perception"])
    rdDepictor.SetPreferCoordGen(SETTINGS["prefer_coordgen"])


def slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def read_rows(path: Path = CSV_FILE) -> list[dict[str, str]]:
    with path.open(encoding="utf-8", newline="") as f:
        return list(csv.DictReader(f))


def stereo_elements(mol: Chem.Mol, flag_possible: bool) -> list[dict[str, object]]:
    found = Chem.FindPotentialStereo(Chem.Mol(mol), cleanIt=False, flagPossible=flag_possible)
    return [
        {"type": str(s.type), "specified": str(s.specified), "centered_on": s.centeredOn}
        for s in found
    ]


def has_specified_tetrahedral(mol: Chem.Mol) -> bool:
    return any(
        e["type"] == "Atom_Tetrahedral" and e["specified"] == "Specified"
        for e in stereo_elements(mol, flag_possible=False)
    )


def with_2d_coords(mol: Chem.Mol, name: str) -> Chem.Mol:
    drawn = Chem.Mol(mol)
    rdDepictor.Compute2DCoords(drawn, canonOrient=SETTINGS["compute2d_canon_orient"])
    drawn.SetProp("_Name", name)
    return drawn


def molfile(mol: Chem.Mol, name: str, chiral_flag: bool | None = None) -> str:
    """2D Molfile; chiral_flag=None applies the SETTINGS rule (tests override it)."""
    drawn = with_2d_coords(mol, name)
    if chiral_flag is None:
        chiral_flag = has_specified_tetrahedral(mol)
    drawn.SetIntProp("_MolFileChiralFlag", int(chiral_flag))
    return Chem.MolToMolBlock(drawn)


def cdxml(mol: Chem.Mol, name: str) -> str:
    return rdChemDraw.MolToChemDrawBlock(with_2d_coords(mol, name))


def compound(row: dict[str, str]) -> tuple[dict[str, object], dict[str, str]]:
    mol = Chem.MolFromSmiles(row["smiles"])
    if mol is None:
        raise ValueError(f"RDKit cannot parse the PubChem SMILES for {row['typed_name']!r}")
    name, key = row["typed_name"], slug(row["typed_name"])
    props = rdMolDescriptors.Properties()
    files = {
        f"molfiles/{key}.mol": molfile(mol, name),
        f"cdxml/{key}.cdxml": cdxml(mol, name),
    }
    entry = {
        "typed_name": name,
        "pubchem_cid": int(row["pubchem_cid"]),
        "smiles": row["smiles"],
        "formula": rdMolDescriptors.CalcMolFormula(mol),
        "inchikey": Chem.MolToInchiKey(mol),
        "properties": dict(
            zip(props.GetPropertyNames(), props.ComputeProperties(mol), strict=True)
        ),
        "stereo": {
            "strict": stereo_elements(mol, flag_possible=False),
            "possible": stereo_elements(mol, flag_possible=True),
        },
        "files": sorted(files),
    }
    return entry, files


def generate(rows: list[dict[str, str]]) -> dict[str, str]:
    """All generated files, keyed by path relative to tests/fixtures/."""
    configure()
    outputs: dict[str, str] = {}
    compounds = []
    for row in rows:
        entry, files = compound(row)
        compounds.append(entry)
        outputs.update(files)
    expected = {
        "generator": "server/scripts/gen_reference_expected.py",
        "rdkit_version": rdkit.__version__,
        "settings": SETTINGS,
        "compounds": compounds,
    }
    outputs[EXPECTED_FILE] = json.dumps(expected, indent=2, ensure_ascii=False) + "\n"
    return outputs


def main() -> int:
    for rel, text in generate(read_rows()).items():
        path = FIXTURES / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8", newline="\n")
        print(f"wrote tests/fixtures/{rel}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
