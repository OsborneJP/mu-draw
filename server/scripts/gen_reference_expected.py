"""Generate expected chemistry for the reference compounds with server-side RDKit.

    python server/scripts/gen_reference_expected.py

Reads tests/fixtures/reference_compounds.csv (SMILES from PubChem) and writes:
  tests/fixtures/reference_expected.json   descriptors, formula, InChIKey, stereo
  tests/fixtures/molfiles/<slug>.mol       2D Molfiles for the editor tests
and, from tests/fixtures/functional_group_compounds.csv (the highlighter's test set),
tests/fixtures/nmr_compounds.csv (the ¹³C NMR preview's), proton_nmr_compounds.csv (the ¹H
preview's) and proton_rule_compounds.csv (drawings for its diastereotopic rule):
  tests/fixtures/functional_groups/<slug>.mol, nmr/, proton_nmr/ and proton_rules/<slug>.mol,
  each folder with a compounds.json listing them and each compound's symmetry classes
  (CanonicalRankAtoms without tie-breaking: what the NMR previews' signals must group) of
  its carbons and of its atoms carrying H, its number of H, and its CH2 groups whose two H
  can differ (diastereotopic, by the ¹H preview's rule: docs/plans/v2-proton-nmr.md)
Only structures: the groups each one should show are a person's judgement
(functional_groups_expected.json), never generated; so are NMR signal counts.

It also invents structures for Get name's not-found check: two reference compounds joined
by one C-C bond (INVENTED), so RDKit makes them and nobody types them. They are listed
under "invented", apart from "compounds"; the recorded PubChem answers show PubChem has
no record of them.

Everything else is raw RDKit output: no rounding and no choices about which values the
app shows. The descriptor set is rdMolDescriptors.Properties, the same code RDKit.js
get_descriptors() calls, so web and server can be compared like for like. Output is
deterministic; tests/test_reference_fixtures.py regenerates it and compares bytes.

The one exception is each compound's "panel": the text the properties panel must show,
made here from the raw values by the rules Jeff decided (docs/SPEC.md, "2. Properties
panel + Lipinski card"). The app applies the same rules in TypeScript; the browser tests
compare its text with this, so the two implementations check each other.

No CDXML: RDKit's ChemDraw writer emits BondLength="", which Ketcher 3.18 (Indigo 1.46)
can't load (BUILD-LEARNINGS.md). The editor tests use CDXML saved by Ketcher instead.
"""

from __future__ import annotations

import csv
import json
import re
from collections import Counter
from pathlib import Path

import rdkit
from rdkit import Chem, RDLogger
from rdkit.Chem import rdDepictor, rdMolDescriptors

ROOT = Path(__file__).resolve().parents[2]
FIXTURES = ROOT / "tests" / "fixtures"
CSV_FILE = FIXTURES / "reference_compounds.csv"
EXPECTED_FILE = "reference_expected.json"
FG_CSV_FILE = FIXTURES / "functional_group_compounds.csv"
FG_DIR = "functional_groups"
NMR_CSV_FILE = FIXTURES / "nmr_compounds.csv"
NMR_DIR = "nmr"
PROTON_CSV_FILE = FIXTURES / "proton_nmr_compounds.csv"
PROTON_DIR = "proton_nmr"
PROTON_RULE_CSV_FILE = FIXTURES / "proton_rule_compounds.csv"
PROTON_RULE_DIR = "proton_rules"

# Pairs of reference compounds (typed names) to join; see join().
INVENTED = (
    ("cholesterol", "caffeine"),
    ("nicotine", "ibuprofen"),
    ("aspirin", "(E)-cinnamic acid"),
)

SETTINGS = {
    "legacy_stereo_perception": False,
    "prefer_coordgen": False,
    "compute2d_canon_orient": True,
    # PubChem SMILES give absolute configuration. RDKit writes chiral flag 0 by default,
    # which Ketcher reads as an AND (relative) stereo group.
    "molfile_chiral_flag": "1 when any tetrahedral centre is specified, else 0",
}

# The properties panel's display rules (docs/SPEC.md, decided by Jeff on Oct 24, 2026).
DECIMALS = {"amw": 2, "exactmw": 4, "CrippenClogP": 2, "tpsa": 1}
# Lipinski's rule of 5, judged on the value as displayed so the card never contradicts it.
LIPINSKI_LIMITS = {
    "mw": ("amw", 500),
    "logp": ("CrippenClogP", 5),
    "hbd": ("lipinskiHBD", 5),
    "hba": ("lipinskiHBA", 10),
}
# Degree of unsaturation only for neutral molecules made of these elements; else "—".
HALOGENS = {"F", "Cl", "Br", "I"}
DOU_ELEMENTS = {"C", "H", "N", "O", "S"} | HALOGENS
NO_VALUE = "—"


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


def join_atom(mol: Chem.Mol) -> int:
    """The carbon with the lowest canonical rank that carries an implicit H."""
    ranks = list(Chem.CanonicalRankAtoms(mol))
    candidates = [
        a.GetIdx()
        for a in mol.GetAtoms()
        if a.GetSymbol() == "C" and a.GetNumExplicitHs() == 0 and a.GetTotalNumHs() > 0
    ]
    return min(candidates, key=lambda i: ranks[i])


def join(first: Chem.Mol, second: Chem.Mol) -> Chem.Mol:
    """first and second joined by one single bond, each giving up one H at join_atom()."""
    a, b = join_atom(first), join_atom(second)
    combined = Chem.RWMol(Chem.CombineMols(first, second))
    combined.AddBond(a, first.GetNumAtoms() + b, Chem.BondType.SINGLE)
    joined = combined.GetMol()
    Chem.SanitizeMol(joined)
    return Chem.MolFromSmiles(Chem.MolToSmiles(joined))


def invented(rows: list[dict[str, str]]) -> tuple[list[dict[str, object]], dict[str, str]]:
    by_name = {row["typed_name"]: Chem.MolFromSmiles(row["smiles"]) for row in rows}
    entries, files = [], {}
    for first, second in INVENTED:
        mol = join(by_name[first], by_name[second])
        name, key = f"invented: {first} + {second}", slug(f"invented {first} {second}")
        files[f"molfiles/{key}.mol"] = molfile(mol, name)
        entries.append(
            {
                "name": name,
                "made_from": [first, second],
                "smiles": Chem.MolToSmiles(mol),
                "canonical_smiles": Chem.MolToSmiles(mol),
                "formula": rdMolDescriptors.CalcMolFormula(mol),
                "inchikey": Chem.MolToInchiKey(mol),
                "stereo": {
                    "strict": stereo_elements(mol, flag_possible=False),
                    "possible": stereo_elements(mol, flag_possible=True),
                },
                "files": [f"molfiles/{key}.mol"],
            }
        )
    return entries, files


def shown(value: float, decimals: int) -> str:
    """Rounded for display; a value that rounds to zero has no sign (ethanol's logP)."""
    text = f"{value:.{decimals}f}"
    return text.removeprefix("-") if float(text) == 0 else text


def degree_of_unsaturation(mol: Chem.Mol) -> str:
    """C - H/2 - X/2 + N/2 + 1 from the formula, for neutral C/H/N/O/S/halogen molecules."""
    counts: Counter[str] = Counter()
    for atom in mol.GetAtoms():
        counts[atom.GetSymbol()] += 1
        counts["H"] += atom.GetTotalNumHs()
    charge = sum(atom.GetFormalCharge() for atom in mol.GetAtoms())
    radicals = sum(atom.GetNumRadicalElectrons() for atom in mol.GetAtoms())
    if charge or radicals or not set(counts) <= DOU_ELEMENTS:
        return NO_VALUE
    halogens = sum(counts[x] for x in HALOGENS)
    doubled = 2 * counts["C"] - counts["H"] - halogens + counts["N"] + 2
    if doubled % 2:
        return NO_VALUE
    return str(doubled // 2)


def panel(mol: Chem.Mol, props: dict[str, float], possible: list[dict[str, object]]) -> dict:
    """What the properties panel shows for this compound, as text."""
    numbers = {name: shown(props[name], places) for name, places in DECIMALS.items()}
    counts = {
        name: str(int(props[name])) for name in ("lipinskiHBD", "lipinskiHBA", "NumRotatableBonds")
    }
    as_shown = {
        **{k: float(v) for k, v in numbers.items()},
        **{k: float(v) for k, v in counts.items()},
    }
    elements = len(possible)
    return {
        "formula": rdMolDescriptors.CalcMolFormula(mol),
        "fragments": str(len(Chem.GetMolFrags(mol))),
        "average_mw": numbers["amw"],
        "exact_mass": numbers["exactmw"],
        "degree_of_unsaturation": degree_of_unsaturation(mol),
        "hbd": counts["lipinskiHBD"],
        "hba": counts["lipinskiHBA"],
        "rotatable_bonds": counts["NumRotatableBonds"],
        "tpsa": numbers["tpsa"],
        "logp": numbers["CrippenClogP"],
        "lipinski": {
            rule: as_shown[name] <= limit for rule, (name, limit) in LIPINSKI_LIMITS.items()
        },
        "stereo": {
            "centres": str(sum(str(e["type"]).startswith("Atom_") for e in possible)),
            "double_bonds": str(sum(str(e["type"]).startswith("Bond_") for e in possible)),
            "undefined": str(sum(e["specified"] == "Unspecified" for e in possible)),
            "max_stereoisomers": str(2**elements),
        },
    }


def compound(row: dict[str, str]) -> tuple[dict[str, object], dict[str, str]]:
    mol = Chem.MolFromSmiles(row["smiles"])
    if mol is None:
        raise ValueError(f"RDKit cannot parse the PubChem SMILES for {row['typed_name']!r}")
    name, key = row["typed_name"], slug(row["typed_name"])
    props = rdMolDescriptors.Properties()
    values = dict(zip(props.GetPropertyNames(), props.ComputeProperties(mol), strict=True))
    possible = stereo_elements(mol, flag_possible=True)
    files = {f"molfiles/{key}.mol": molfile(mol, name)}
    entry = {
        "typed_name": name,
        "pubchem_cid": int(row["pubchem_cid"]),
        "smiles": row["smiles"],
        # RDKit's canonical isomeric SMILES: Get name's cache key and what it sends PubChem.
        "canonical_smiles": Chem.MolToSmiles(mol),
        "formula": rdMolDescriptors.CalcMolFormula(mol),
        "inchikey": Chem.MolToInchiKey(mol),
        "properties": values,
        "stereo": {
            "strict": stereo_elements(mol, flag_possible=False),
            "possible": possible,
        },
        "panel": panel(mol, values, possible),
        "files": sorted(files),
    }
    return entry, files


def carbon_classes(mol: Chem.Mol) -> list[list[int]]:
    """Topologically equivalent carbons (canonical ranks without tie-breaking or chirality),
    each class sorted, the classes by their first atom."""
    ranks = Chem.CanonicalRankAtoms(mol, breakTies=False, includeChirality=False)
    classes: dict[int, list[int]] = {}
    for atom in mol.GetAtoms():
        if atom.GetAtomicNum() == 6:
            classes.setdefault(ranks[atom.GetIdx()], []).append(atom.GetIdx())
    return sorted(classes.values())


def hydrogen_classes(mol: Chem.Mol) -> list[list[int]]:
    """Topologically equivalent atoms carrying H, as carbon_classes groups carbons."""
    ranks = Chem.CanonicalRankAtoms(mol, breakTies=False, includeChirality=False)
    classes: dict[int, list[int]] = {}
    for atom in mol.GetAtoms():
        if atom.GetTotalNumHs() > 0:
            classes.setdefault(ranks[atom.GetIdx()], []).append(atom.GetIdx())
    return sorted(classes.values())


def diastereotopic(mol: Chem.Mol) -> list[int]:
    """CH2 groups whose two H can differ, by the ¹H preview's rule (its browser version is
    web/src/chem/protonNmr.ts): an sp3 CH2 that becomes a possible stereocentre when one of
    its H is deuterium, in a molecule that then has another possible stereocentre
    (FindPotentialStereo; a double bond alone keeps the two H mirror images); an =CH2 whose
    double bond's other end carries two different groups (by symmetry rank), or one group
    and an H."""
    ranks = list(Chem.CanonicalRankAtoms(mol, breakTies=False, includeChirality=False))
    with_hs = Chem.AddHs(mol)
    found = []
    for atom in mol.GetAtoms():
        i = atom.GetIdx()
        if atom.GetAtomicNum() != 6 or atom.GetTotalNumHs() != 2 or atom.GetIsAromatic():
            continue
        doubles = [b for b in atom.GetBonds() if b.GetBondType() == Chem.BondType.DOUBLE]
        if doubles:
            other = doubles[0].GetOtherAtom(atom)
            sides = [n.GetIdx() for n in other.GetNeighbors() if n.GetIdx() != i]
            one_and_h = len(sides) == 1 and other.GetTotalNumHs() == 1
            if one_and_h or (len(sides) == 2 and ranks[sides[0]] != ranks[sides[1]]):
                found.append(i)
            continue
        if any(b.GetBondType() != Chem.BondType.SINGLE for b in atom.GetBonds()):
            continue
        hydrogens = with_hs.GetAtomWithIdx(i).GetNeighbors()
        h = next(n.GetIdx() for n in hydrogens if n.GetAtomicNum() == 1)
        labelled = Chem.RWMol(with_hs)
        labelled.GetAtomWithIdx(h).SetIsotope(2)
        Chem.SanitizeMol(labelled)
        infos = Chem.FindPotentialStereo(labelled, cleanIt=True, flagPossible=True)
        # Any atom-centred element (tetrahedral, or five-coordinate P), as RDKit.js's stereo
        # tags list them; never a bond.
        centres = [x.centeredOn for x in infos if str(x.type).startswith("Atom_")]
        if i in centres and len(centres) > 1:
            found.append(i)
    return found


def compound_set(rows: list[dict[str, str]], folder: str) -> dict[str, str]:
    """A test set: one Molfile per compound in `folder`, and an index of them."""
    outputs: dict[str, str] = {}
    compounds = []
    for row in rows:
        mol = Chem.MolFromSmiles(row["smiles"])
        if mol is None:
            raise ValueError(f"RDKit cannot parse the PubChem SMILES for {row['typed_name']!r}")
        name = row["typed_name"]
        rel = f"{folder}/{slug(name)}.mol"
        outputs[rel] = molfile(mol, name)
        compounds.append(
            {
                "typed_name": name,
                "pubchem_cid": int(row["pubchem_cid"]),
                "pubchem_title": row["pubchem_title"],
                "canonical_smiles": Chem.MolToSmiles(mol),
                "inchikey": Chem.MolToInchiKey(mol),
                "heavy_atoms": mol.GetNumHeavyAtoms(),
                "carbon_classes": carbon_classes(mol),
                "hydrogen_classes": hydrogen_classes(mol),
                "hydrogen_count": sum(a.GetTotalNumHs() for a in mol.GetAtoms()),
                "diastereotopic": diastereotopic(mol),
                "file": rel,
            }
        )
    index = {
        "generator": "server/scripts/gen_reference_expected.py",
        "rdkit_version": rdkit.__version__,
        "settings": SETTINGS,
        "compounds": compounds,
    }
    outputs[f"{folder}/compounds.json"] = json.dumps(index, indent=2, ensure_ascii=False) + "\n"
    return outputs


def generate(rows: list[dict[str, str]]) -> dict[str, str]:
    """All generated files, keyed by path relative to tests/fixtures/."""
    configure()
    outputs: dict[str, str] = {}
    compounds = []
    for row in rows:
        entry, files = compound(row)
        compounds.append(entry)
        outputs.update(files)
    made_up, files = invented(rows)
    outputs.update(files)
    expected = {
        "generator": "server/scripts/gen_reference_expected.py",
        "rdkit_version": rdkit.__version__,
        "settings": SETTINGS,
        "compounds": compounds,
        "invented": made_up,
    }
    outputs[EXPECTED_FILE] = json.dumps(expected, indent=2, ensure_ascii=False) + "\n"
    outputs.update(compound_set(read_rows(FG_CSV_FILE), FG_DIR))
    outputs.update(compound_set(read_rows(NMR_CSV_FILE), NMR_DIR))
    outputs.update(compound_set(read_rows(PROTON_CSV_FILE), PROTON_DIR))
    outputs.update(compound_set(read_rows(PROTON_RULE_CSV_FILE), PROTON_RULE_DIR))
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
