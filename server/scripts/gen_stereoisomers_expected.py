"""Generate the stereoisomer enumerator's expected answers with server-side RDKit.

    python server/scripts/gen_stereoisomers_expected.py

Reads tests/fixtures/stereoisomer_compounds.csv (SMILES from PubChem) and writes:
  tests/fixtures/stereoisomers/<slug>.mol    each test drawing, as gen_reference_expected
                                             draws it (2D, chiral flag by its rule)
  tests/fixtures/stereoisomers_expected.json what the enumerator must answer for each

This is the reference the browser's enumerator (web/src/chem/stereoisomers.ts, RDKit.js)
is tested against: Python RDKit's own EnumerateStereoisomers, varying every potential stereo
element (onlyUnassigned=False). Its unique=True compares SMILES, which an RDKit SMILES round
trip can turn into a different stereoisomer, so it runs with unique=False and two
stereoisomers are the same when their InChIs, taken without coordinates, are equal
(docs/plans/v2-stereoisomers.md). The SMILES-unique count is kept too: the tests list the
compounds where the two differ, with the reason.

The counts and verdicts a chemist expects are in tests/fixtures/stereoisomers_judged.json,
written by judgement, never generated; tests/test_stereoisomer_fixtures.py compares this
output with it, and regenerates it to compare bytes.
"""

from __future__ import annotations

import json

import rdkit
from rdkit import Chem
from rdkit.Chem import AllChem, rdCIPLabeler
from rdkit.Chem.EnumerateStereoisomers import EnumerateStereoisomers, StereoEnumerationOptions

from gen_reference_expected import FIXTURES, SETTINGS, configure, join, molfile, read_rows, slug

CSV_FILE = FIXTURES / "stereoisomer_compounds.csv"
EXPECTED_FILE = "stereoisomers_expected.json"
DIR = "stereoisomers"

# docs/plans/v2-stereoisomers.md, decision 7: enumerate up to this many stereo elements,
# and draw up to this many stereoisomers.
LIMITS = {"elements": 8, "drawn": 32}
# Generated variants, so nobody types a structure: (name, made from, how).
UNDEFINED_CENTRE = ("L-threonine, one centre undefined", "L-threonine")
RACEMIC = ("(R)-2-butanol, racemic", "(R)-2-butanol")
# An axis RDKit can't see beside a stereocentre it can, so the panel has a list to note it on.
JOINED = (("2,3-pentadiene", "(R)-2-butanol"), ("1,1'-bi-2-naphthol", "(R)-2-butanol"))
# 3D embedding, only to record which listed stereoisomers of a bridged compound can exist.
EMBED_SEED = 0xF00D
EMBED_ATTEMPTS = 5

TETRAHEDRAL = (Chem.ChiralType.CHI_TETRAHEDRAL_CW, Chem.ChiralType.CHI_TETRAHEDRAL_CCW)
MIRROR = {TETRAHEDRAL[0]: TETRAHEDRAL[1], TETRAHEDRAL[1]: TETRAHEDRAL[0]}


def bare(mol: Chem.Mol) -> Chem.Mol:
    """A copy without coordinates: InChI then reads E/Z from the bonds, not the drawing."""
    copy = Chem.Mol(mol)
    copy.RemoveAllConformers()
    return copy


def inchi(mol: Chem.Mol) -> str:
    return Chem.MolToInchi(bare(mol))


def cumulated(bond: Chem.Bond) -> bool:
    """A double bond in an allene-like chain: RDKit.js lists none of these as stereo."""
    return bond.GetBondType() == Chem.BondType.DOUBLE and any(
        other.GetIdx() != bond.GetIdx() and other.GetBondType() == Chem.BondType.DOUBLE
        for atom in (bond.GetBeginAtom(), bond.GetEndAtom())
        for other in atom.GetBonds()
    )


def potential(mol: Chem.Mol) -> list:
    """The potential stereo elements, as RDKit.js's get_stereo_tags lists them: Python's
    FindPotentialStereo also flags cumulated double bonds, which the browser can't vary."""
    found = Chem.FindPotentialStereo(Chem.Mol(mol), cleanIt=True, flagPossible=True)
    return [
        e
        for e in found
        if not (
            e.type == Chem.StereoType.Bond_Double and cumulated(mol.GetBondWithIdx(e.centeredOn))
        )
    ]


def without_cumulated_stereo(mol: Chem.Mol) -> Chem.Mol:
    """EnumerateStereoisomers also sets stereo on cumulated double bonds; take it off again,
    so InChI sees only the elements the browser varies."""
    copy = Chem.Mol(mol)
    for bond in copy.GetBonds():
        if cumulated(bond):
            bond.SetStereo(Chem.BondStereo.STEREONONE)
    return copy


def mirror(mol: Chem.Mol) -> Chem.Mol:
    copy = Chem.Mol(mol)
    for atom in copy.GetAtoms():
        if atom.GetChiralTag() in MIRROR:
            atom.SetChiralTag(MIRROR[atom.GetChiralTag()])
    return copy


def cip(mol: Chem.Mol) -> tuple[dict[str, str], dict[str, str]]:
    """CIP labels by Molfile atom index, and by bond as "a-b" (a < b)."""
    labelled = Chem.Mol(mol)
    rdCIPLabeler.AssignCIPLabels(labelled)
    atoms = {
        str(a.GetIdx()): a.GetProp("_CIPCode") for a in labelled.GetAtoms() if a.HasProp("_CIPCode")
    }
    bonds = {}
    for b in labelled.GetBonds():
        if b.HasProp("_CIPCode"):
            first, second = sorted((b.GetBeginAtomIdx(), b.GetEndAtomIdx()))
            bonds[f"{first}-{second}"] = b.GetProp("_CIPCode")
    return atoms, bonds


def signature(mol: Chem.Mol, elements: list) -> str:
    """Which of its combinations stands for a stereoisomer: the one with the smallest string
    of its settings, the centres in atom order (CW 0, CCW 1), then the double bonds in bond
    order (Z 1, else 0). The browser picks the same way (web/src/chem/stereoisomers.ts)."""
    centres = sorted(e.centeredOn for e in elements if e.type == Chem.StereoType.Atom_Tetrahedral)
    double = sorted(e.centeredOn for e in elements if e.type == Chem.StereoType.Bond_Double)
    _, bonds = cip(mol) if double else ({}, {})
    parts = [
        "1" if mol.GetAtomWithIdx(i).GetChiralTag() == TETRAHEDRAL[1] else "0" for i in centres
    ]
    for i in double:
        bond = mol.GetBondWithIdx(i)
        ends = sorted((bond.GetBeginAtomIdx(), bond.GetEndAtomIdx()))
        parts.append("1" if bonds.get(f"{ends[0]}-{ends[1]}") in ("Z", "z") else "0")
    return "".join(parts)


def matches_drawing(drawing: Chem.Mol, mol: Chem.Mol) -> bool:
    """Every stereo element the drawing defines is set the same way in mol."""
    for atom in drawing.GetAtoms():
        tag = atom.GetChiralTag()
        if tag in TETRAHEDRAL and mol.GetAtomWithIdx(atom.GetIdx()).GetChiralTag() != tag:
            return False
    _, drawn = cip(drawing)
    _, these = cip(mol)
    return all(these.get(bond) == label for bond, label in drawn.items())


def defines_stereo(drawing: Chem.Mol) -> bool:
    return any(a.GetChiralTag() in TETRAHEDRAL for a in drawing.GetAtoms()) or any(
        b.GetStereo() not in (Chem.BondStereo.STEREONONE, Chem.BondStereo.STEREOANY)
        for b in drawing.GetBonds()
    )


def is_racemic(drawing: Chem.Mol) -> bool:
    """Chiral flag 0 with a defined centre: Ketcher reads it as an AND (racemic) group."""
    flag = drawing.GetIntProp("_MolFileChiralFlag") if drawing.HasProp("_MolFileChiralFlag") else 0
    return flag == 0 and any(a.GetChiralTag() in TETRAHEDRAL for a in drawing.GetAtoms())


def bridged(mol: Chem.Mol) -> bool:
    """Two rings sharing three or more atoms (fused rings share two)."""
    rings = [set(r) for r in mol.GetRingInfo().AtomRings()]
    return any(len(a & b) >= 3 for i, a in enumerate(rings) for b in rings[i + 1 :])


# An axis between two aromatic rings with a substituent beside it on each: X-a:a-a:a-Y, the
# bond in the middle outside any ring. The browser matches the same SMARTS.
BIARYL_AXIS = Chem.MolFromSmarts("[!#1]!@a:a!@a:a!@[!#1]")


def biaryl_axis(mol: Chem.Mol) -> bool:
    return mol.HasSubstructMatch(BIARYL_AXIS)


def notes(mol: Chem.Mol, elements: list) -> list[str]:
    """What the panel must say beside the list (decisions 5 and 6)."""
    found = []
    if bridged(mol):
        found.append("bridged")
    allene = any(cumulated(b) for b in mol.GetBonds())
    ring_double = any(
        e.type == Chem.StereoType.Bond_Double and mol.GetBondWithIdx(e.centeredOn).IsInRing()
        for e in elements
    )
    if allene or ring_double or biaryl_axis(mol):
        found.append("axial-planar")
    return found


def enumerate_classes(drawing: Chem.Mol, elements: list) -> tuple[dict[str, list[Chem.Mol]], int]:
    """Every combination, grouped by coordinate-free InChI; and the SMILES-unique count."""
    options = StereoEnumerationOptions(onlyUnassigned=False, unique=False)
    classes: dict[str, list[Chem.Mol]] = {}
    smiles = set()
    for found in EnumerateStereoisomers(Chem.Mol(drawing), options=options):
        combination = without_cumulated_stereo(found)
        classes.setdefault(inchi(combination), []).append(combination)
        smiles.add(Chem.MolToSmiles(bare(combination)))
    return classes, len(smiles)


def embedded(drawing: Chem.Mol, elements: list) -> list[str]:
    """The InChIKeys of the listed stereoisomers RDKit can build in 3D (bridged compounds
    only): one seeded ETKDG attempt run per stereoisomer, capped. RDKit's own tryEmbedding
    gives the same sets but took 75 s on cocaine (measured), too slow for every check."""
    classes, _ = enumerate_classes(drawing, elements)
    keys = []
    for key, members in classes.items():
        with_hs = Chem.AddHs(bare(members[0]))
        params = AllChem.ETKDGv3()
        params.randomSeed = EMBED_SEED
        params.maxIterations = EMBED_ATTEMPTS
        if AllChem.EmbedMolecule(with_hs, params) == 0:
            keys.append(Chem.InchiToInchiKey(key))
    return sorted(keys)


def listing(drawing: Chem.Mol, elements: list, notes_: list[str]) -> dict[str, object]:
    classes, smiles_unique = enumerate_classes(drawing, elements)
    if len(classes) > LIMITS["drawn"]:
        return {"count": len(classes), "smiles_unique": smiles_unique}
    defined, racemic = defines_stereo(drawing), is_racemic(drawing)
    reps = {
        key: min(members, key=lambda m: signature(m, elements)) for key, members in classes.items()
    }
    mirrors = {key: inchi(mirror(rep)) for key, rep in reps.items()}
    matching = {
        key
        for key, members in classes.items()
        if defined and any(matches_drawing(drawing, m) for m in members)
    }
    if racemic:
        matching |= {mirrors[key] for key in matching}
    judged = "axial-planar" not in notes_
    chiral = {key for key in classes if mirrors[key] != key}
    inchikey = {key: Chem.InchiToInchiKey(key) for key in classes}

    # Each chiral stereoisomer beside its mirror image; the drawing's first.
    groups, seen = [], set()
    for key in sorted(classes, key=lambda k: inchikey[k]):
        if key in seen:
            continue
        group = (
            [key]
            if key not in chiral
            else sorted({key, mirrors[key]}, key=lambda k: (k not in matching, inchikey[k]))
        )
        seen.update(group)
        groups.append(group)
    groups.sort(key=lambda g: (not any(k in matching for k in g), min(inchikey[k] for k in g)))
    order = [key for group in groups for key in group]
    number = {key: i + 1 for i, key in enumerate(order)}

    entries = []
    for key in order:
        rep = reps[key]
        atoms, bonds = cip(rep)
        if key in chiral:
            relation: dict[str, object] = {"kind": "enantiomer", "of": number[mirrors[key]]}
        elif not judged:
            relation = {"kind": "unjudged"}
        else:
            relation = {"kind": "meso" if chiral else "achiral"}
        with_drawing = None
        if not racemic:
            with_drawing = Chem.MolToInchiKey(Chem.CombineMols(bare(drawing), bare(rep)))
        entries.append(
            {
                "number": number[key],
                "inchikey": inchikey[key],
                "labels": {"atoms": atoms, "bonds": bonds},
                "relation": relation,
                "matches": key in matching,
                "with_drawing_inchikey": with_drawing,
            }
        )
    return {"stereoisomers": entries, "count": len(order), "smiles_unique": smiles_unique}


def expected_for(name: str, drawing: Chem.Mol) -> dict[str, object]:
    elements = potential(drawing)
    entry: dict[str, object] = {
        "name": name,
        "file": f"{DIR}/{slug(name)}.mol",
        "elements": len(elements),
    }
    if not elements:
        return {**entry, "outcome": "no-elements"}
    if len(elements) > LIMITS["elements"]:
        return {**entry, "outcome": "too-many"}
    found = notes(drawing, elements)
    result = listing(drawing, elements, found)
    if "stereoisomers" not in result:
        return {**entry, "outcome": "counted", "count": result["count"], "notes": found}
    entry.update({"outcome": "listed", "notes": found, **result})
    if "bridged" in found:
        entry["embeds_in_3d"] = embedded(drawing, elements)
    return entry


def drawings(rows: list[dict[str, str]]) -> list[tuple[str, str]]:
    """(name, Molfile) for every test drawing: the compounds, then the generated variants."""
    by_name = {row["typed_name"]: Chem.MolFromSmiles(row["smiles"]) for row in rows}
    out = [(name, molfile(mol, name)) for name, mol in by_name.items()]

    name, source = UNDEFINED_CENTRE
    undefined = Chem.Mol(by_name[source])
    centre = min(a.GetIdx() for a in undefined.GetAtoms() if a.GetChiralTag() in TETRAHEDRAL)
    undefined.GetAtomWithIdx(centre).SetChiralTag(Chem.ChiralType.CHI_UNSPECIFIED)
    out.append((name, molfile(undefined, name)))

    name, source = RACEMIC
    out.append((name, molfile(by_name[source], name, chiral_flag=False)))

    for first, second in JOINED:
        name = f"joined: {first} + {second}"
        out.append((name, molfile(join(by_name[first], by_name[second]), name)))
    return out


def generate(rows: list[dict[str, str]]) -> dict[str, str]:
    """All generated files, keyed by path relative to tests/fixtures/."""
    configure()
    outputs: dict[str, str] = {}
    compounds = []
    for name, text in drawings(rows):
        outputs[f"{DIR}/{slug(name)}.mol"] = text
        compounds.append(expected_for(name, Chem.MolFromMolBlock(text, removeHs=False)))
    expected = {
        "generator": "server/scripts/gen_stereoisomers_expected.py",
        "rdkit_version": rdkit.__version__,
        "settings": SETTINGS,
        "limits": LIMITS,
        "compounds": compounds,
    }
    outputs[EXPECTED_FILE] = json.dumps(expected, indent=2, ensure_ascii=False) + "\n"
    return outputs


def main() -> int:
    for rel, text in generate(read_rows(CSV_FILE)).items():
        path = FIXTURES / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8", newline="\n")
        print(f"wrote tests/fixtures/{rel}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
