"""Generate the stereoisomer enumerator's expected answers with server-side RDKit.

    python server/scripts/gen_stereoisomers_expected.py

Reads tests/fixtures/stereoisomer_compounds.csv (SMILES from PubChem) and writes:
  tests/fixtures/stereoisomers/<slug>.mol    each test drawing, as gen_reference_expected
                                             draws it (2D, chiral flag by its rule)
  tests/fixtures/stereoisomers_expected.json what the enumerator must answer for each

This is the reference the browser's enumerator (web/src/chem/stereoisomers.ts, RDKit.js)
is tested against. Python RDKit's FindPotentialStereo finds the stereo elements of the
drawing with its stereo taken off, so that an element whose stereogenicity depends on others
the drawing defines is still varied (pentane-2,3,4-triol drawn (2R,4R) still has C3). Every
setting of those elements is written into the molecule here, and two settings are the same
stereoisomer when their InChIs, taken without coordinates, are equal: canonical SMILES keeps
some apart that are the same (the SMILES-unique count is kept too, and the tests list the
compounds where the two differ, with the reason). RDKit's own EnumerateStereoisomers
(unique=False) must give the same stereoisomers wherever it gives every setting: it doesn't
for cyclooctatetraene, where it gives the settings with an even number of trans bonds twice
each and none with an odd number (measured, RDKit 2026.09.1), so tests list those compounds
too (docs/plans/v2-stereoisomers.md).

The counts and verdicts a chemist expects are in tests/fixtures/stereoisomers_judged.json,
written by judgement, never generated; tests/test_stereoisomer_fixtures.py compares this
output with it, and regenerates it to compare bytes.
"""

from __future__ import annotations

import itertools
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
# A double bond stereogenic only through the centres beside it: =CH-CH3 put on the CH2 of
# pentane-2,4-diol (3-ethylidenepentane-2,4-diol; not in PubChem).
ETHYLIDENE = ("3-ethylidenepentane-2,4-diol", "2,4-pentanediol")
# Drawings wedged the way students draw, not the way RDKit would: a wedge and a hash at each
# centre with its H drawn, and single wedges on other bonds than RDKit's choice.
TEXTBOOK = (
    ("L-threonine, wedge and hash with H drawn", "L-threonine"),
    ("(R)-2-butanol, wedge and hash with H drawn", "(R)-2-butanol"),
)
OTHER_WEDGES = ("L-threonine, wedges on other bonds", "L-threonine")
# A meso form drawn as the setting the smallest-signature rule would not pick, so the panel
# must draw the stereoisomer the student drew as they drew it, not as its other setting.
MESO = ("2,3-dibromobutane, the meso form", "2,3-dibromobutane")
# A biaryl axis wedged as textbooks draw it, beside a centre: RDKit reads atropisomer stereo
# from the wedge, which no stereoisomer may carry over.
AXIS_WEDGED = ("joined: 1,1'-bi-2-naphthol + (R)-2-butanol, axis wedged", JOINED[1])
# Every H drawn, as Ketcher's explicit-H button does: =CH2 then has two neighbours at its end,
# and glucose makes a crowded picture for the labels.
ALL_H = (
    ("limonene, all H drawn", "limonene"),
    ("aldehydo-D-glucose, all H drawn", "aldehydo-D-glucose"),
)
# A centre drawn beside a double bond drawn (E), and beside one drawn crossed, so pictures
# keep the drawing's layout exactly where their double bond is as drawn.
PENTENOL = "(3E)-3-penten-2-ol"
CENTRE_AND_DOUBLE = (f"{PENTENOL}, centre drawn", PENTENOL)
CENTRE_AND_CROSSED = ("3-penten-2-ol, centre drawn, double bond crossed", PENTENOL)
# Cholesterol with =CH2 for its OH, no stereo drawn and every H drawn: that double bond can
# never be stereogenic (two H at one end, two different ring sides at the other), so the
# browser must not search it against every setting of the centres around it.
METHYLENE = ("cholesterol with =CH2 for its OH, no stereo, every H drawn", "cholesterol")
# A double bond stereogenic only through the centres beside it, drawn with one of them and
# the double bond fixed: what it matches must come from its drawn geometry, since its E/Z
# label turns with the centre left open.
PARTLY_DRAWN = (
    ("3-ethylidenepentane-2,4-diol, one centre and the double bond drawn", ETHYLIDENE[0]),
    (
        "2,6-dimethylcyclohexanone oxime, one methyl and the OH drawn",
        "2,6-dimethylcyclohexanone oxime",
    ),
)
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


def stripped(mol: Chem.Mol) -> Chem.Mol:
    """The drawing with no stereo and no coordinates, so nothing it defines hides an element
    that depends on it, and no geometry is read from the layout."""
    copy = bare(mol)
    for atom in copy.GetAtoms():
        atom.SetChiralTag(Chem.ChiralType.CHI_UNSPECIFIED)
    for bond in copy.GetBonds():
        bond.SetStereo(Chem.BondStereo.STEREONONE)
        bond.SetBondDir(Chem.BondDir.NONE)
    return copy


def potential(mol: Chem.Mol) -> list:
    """The potential stereo elements of the stereo-free drawing; Python's FindPotentialStereo
    also flags cumulated double bonds, which the browser can't vary, so those are left out."""
    found = Chem.FindPotentialStereo(stripped(mol), cleanIt=True, flagPossible=True)
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


Defined = tuple[dict[int, object], dict[int, bool]]


def defined_by(drawing: Chem.Mol, elements: list) -> Defined:
    """What the drawing sets of the elements varied: each centre's chiral tag, and for each
    double bond it fixes, whether the first other neighbours at its two ends are drawn on the
    same side (read from the 2D layout, not from E/Z: a label can turn with a centre the
    drawing leaves open). Nothing else counts: a wedged biaryl axis (RDKit reads atropisomer
    stereo from it) is not varied, and neither does the browser count it."""
    tags = {
        e.centeredOn: drawing.GetAtomWithIdx(e.centeredOn).GetChiralTag()
        for e in elements
        if e.type == Chem.StereoType.Atom_Tetrahedral
        and drawing.GetAtomWithIdx(e.centeredOn).GetChiralTag() in TETRAHEDRAL
    }
    open_ = (Chem.BondStereo.STEREONONE, Chem.BondStereo.STEREOANY)
    sides = {
        e.centeredOn: same_side_drawn(drawing, e.centeredOn)
        for e in elements
        if e.type == Chem.StereoType.Bond_Double
        and drawing.GetBondWithIdx(e.centeredOn).GetStereo() not in open_
    }
    return tags, sides


def same_side_drawn(mol: Chem.Mol, index: int) -> bool:
    """Whether the layout draws double bond `index` with the first other neighbour of each end
    on the same side."""
    bond = mol.GetBondWithIdx(index)
    a, b = bond.GetBeginAtomIdx(), bond.GetEndAtomIdx()
    at = mol.GetConformer().GetAtomPosition

    def side(i: int) -> float:
        p, q, r = at(a), at(b), at(i)
        cross = (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x)
        return (cross > 0) - (cross < 0)

    return side(other_neighbour(mol, a, b)) == side(other_neighbour(mol, b, a))


def same_side_set(mol: Chem.Mol, index: int) -> bool:
    """Whether a setting (settings()) puts the first other neighbours of double bond `index`
    on the same side: cis to its stereo atoms, which are those neighbours."""
    bond = mol.GetBondWithIdx(index)
    a, b = bond.GetBeginAtomIdx(), bond.GetEndAtomIdx()
    if list(bond.GetStereoAtoms()) != [other_neighbour(mol, a, b), other_neighbour(mol, b, a)]:
        raise ValueError(f"bond {index} is not set relative to its first other neighbours")
    return bond.GetStereo() == Chem.BondStereo.STEREOCIS


def matches_drawing(defined: Defined, mol: Chem.Mol) -> bool:
    """Every element the drawing sets is set the same way in mol."""
    tags, sides = defined
    if any(mol.GetAtomWithIdx(atom).GetChiralTag() != tag for atom, tag in tags.items()):
        return False
    return all(same_side_set(mol, index) == same for index, same in sides.items())


def is_racemic(drawing: Chem.Mol) -> bool:
    """Chiral flag 0 with a defined centre: Ketcher reads it as an AND (racemic) group."""
    flag = drawing.GetIntProp("_MolFileChiralFlag") if drawing.HasProp("_MolFileChiralFlag") else 0
    return flag == 0 and any(a.GetChiralTag() in TETRAHEDRAL for a in drawing.GetAtoms())


def bridged(mol: Chem.Mol) -> bool:
    """Two rings sharing three or more atoms (fused rings share two)."""
    rings = [set(r) for r in mol.GetRingInfo().AtomRings()]
    return any(len(a & b) >= 3 for i, a in enumerate(rings) for b in rings[i + 1 :])


# An axis RDKit can't judge: an allene (C=C=C; not S(=O)=O, azides or ketenes), or one
# between two aromatic rings with a substituent beside it on each (X-a:a-a:a-Y, the middle
# bond outside any ring). The browser matches the same SMARTS.
AXES = [Chem.MolFromSmarts("C=C=C"), Chem.MolFromSmarts("[!#1]!@a:a!@a:a!@[!#1]")]


def notes(mol: Chem.Mol, elements: list) -> list[str]:
    """What the panel must say beside the list (decisions 5 and 6)."""
    found = []
    if bridged(mol):
        found.append("bridged")
    ring_double = any(
        e.type == Chem.StereoType.Bond_Double and mol.GetBondWithIdx(e.centeredOn).IsInRing()
        for e in elements
    )
    if ring_double or any(mol.HasSubstructMatch(axis) for axis in AXES):
        found.append("axial-planar")
    return found


def other_neighbour(mol: Chem.Mol, end: int, not_: int) -> int:
    return next(n.GetIdx() for n in mol.GetAtomWithIdx(end).GetNeighbors() if n.GetIdx() != not_)


def settings(drawing: Chem.Mol, elements: list) -> list[Chem.Mol]:
    """The stereo-free drawing with every setting of its stereo elements written in: each
    centre CW or CCW, each double bond cis or trans to the first other neighbour at each end."""
    varied = {Chem.StereoType.Atom_Tetrahedral, Chem.StereoType.Bond_Double}
    kinds = {e.type for e in elements} - varied
    if kinds:
        raise ValueError(f"stereo elements the browser can't vary: {sorted(map(str, kinds))}")
    centres = sorted(e.centeredOn for e in elements if e.type == Chem.StereoType.Atom_Tetrahedral)
    doubles = sorted(e.centeredOn for e in elements if e.type == Chem.StereoType.Bond_Double)
    base = stripped(drawing)
    out = []
    for bits in itertools.product((0, 1), repeat=len(centres) + len(doubles)):
        mol = Chem.RWMol(base)
        for atom, bit in zip(centres, bits[: len(centres)], strict=True):
            mol.GetAtomWithIdx(atom).SetChiralTag(TETRAHEDRAL[bit])
        for index, bit in zip(doubles, bits[len(centres) :], strict=True):
            bond = mol.GetBondWithIdx(index)
            begin, end = bond.GetBeginAtomIdx(), bond.GetEndAtomIdx()
            bond.SetStereoAtoms(other_neighbour(mol, begin, end), other_neighbour(mol, end, begin))
            bond.SetStereo(Chem.BondStereo.STEREOCIS if bit else Chem.BondStereo.STEREOTRANS)
        out.append(mol.GetMol())
    return out


def enumerate_classes(drawing: Chem.Mol, elements: list) -> tuple[dict[str, list[Chem.Mol]], int]:
    """Every setting, grouped by coordinate-free InChI; and the SMILES-unique count."""
    classes: dict[str, list[Chem.Mol]] = {}
    smiles = set()
    for combination in settings(drawing, elements):
        classes.setdefault(inchi(combination), []).append(combination)
        # As EnumerateStereoisomers does before its SMILES: settings on atoms and bonds that
        # are not stereo in this combination are taken off.
        cleaned = Chem.Mol(combination)
        Chem.AssignStereochemistry(cleaned, cleanIt=True, force=True)
        smiles.add(Chem.MolToSmiles(cleaned))
    return classes, len(smiles)


def rdkit_enumerator_classes(drawing: Chem.Mol) -> set[str]:
    """The stereoisomers RDKit's own EnumerateStereoisomers gives, by coordinate-free InChI."""
    options = StereoEnumerationOptions(onlyUnassigned=False, unique=False)
    return {
        inchi(without_cumulated_stereo(found))
        for found in EnumerateStereoisomers(stripped(drawing), options=options)
    }


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
    defined, racemic = defined_by(drawing, elements), is_racemic(drawing)
    agreeing = {
        key: [m for m in members if matches_drawing(defined, m)] if any(defined) else []
        for key, members in classes.items()
    }
    # A stereoisomer the drawing matches is shown as drawn, from the combination that agrees
    # with it; any other by the smallest signature.
    reps = {
        key: min(agreeing[key] or members, key=lambda m: signature(m, elements))
        for key, members in classes.items()
    }
    mirrors = {key: inchi(mirror(rep)) for key, rep in reps.items()}
    matching = {key for key in classes if agreeing[key]}
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
    found = notes(drawing, elements)
    entry: dict[str, object] = {
        "name": name,
        "file": f"{DIR}/{slug(name)}.mol",
        "elements": len(elements),
    }
    if not elements:
        return {**entry, "outcome": "no-elements", "notes": found}
    if len(elements) > LIMITS["elements"]:
        return {**entry, "outcome": "too-many", "notes": found}
    result = listing(drawing, elements, found)
    if "stereoisomers" not in result:
        return {**entry, "outcome": "counted", "notes": found, **result}
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

    name, source = ETHYLIDENE
    out.append((name, molfile(with_ethylidene(by_name[source]), name)))

    for name, source in TEXTBOOK:
        out.append((name, restyled(by_name[source], name, textbook=True)))
    name, source = OTHER_WEDGES
    out.append((name, restyled(by_name[source], name, textbook=False)))

    name, source = MESO
    out.append((name, molfile(meso_drawn_late(by_name[source]), name)))

    name, (first, second) = AXIS_WEDGED
    out.append((name, axis_wedged(join(by_name[first], by_name[second]), name)))

    for name, source in ALL_H:
        out.append((name, molfile(Chem.AddHs(by_name[source]), name)))

    name, source = CENTRE_AND_DOUBLE
    out.append((name, molfile(set_as(by_name[source], "R", "E"), name)))
    name, source = CENTRE_AND_CROSSED
    crossed = Chem.Mol(set_as(by_name[source], "R", "E"))
    for bond in crossed.GetBonds():
        if bond.GetBondType() == Chem.BondType.DOUBLE:
            bond.SetStereo(Chem.BondStereo.STEREOANY)
    out.append((name, molfile(crossed, name)))

    name, source = METHYLENE
    out.append((name, molfile(Chem.AddHs(methylene_for_hydroxyl(by_name[source])), name)))

    made = {ETHYLIDENE[0]: with_ethylidene(by_name[ETHYLIDENE[1]])}
    for name, source in PARTLY_DRAWN:
        out.append((name, partly_drawn(made.get(source) or by_name[source], name)))
    return out


def methylene_for_hydroxyl(mol: Chem.Mol) -> Chem.Mol:
    """mol without stereo, its one OH made =CH2."""
    edit = Chem.RWMol(stripped(mol))
    (oxygen,) = [
        a.GetIdx() for a in edit.GetAtoms() if a.GetSymbol() == "O" and a.GetTotalNumHs() == 1
    ]
    edit.GetAtomWithIdx(oxygen).SetAtomicNum(6)
    (bond,) = edit.GetAtomWithIdx(oxygen).GetBonds()
    bond.SetBondType(Chem.BondType.DOUBLE)
    # The carbon it hangs from gives up its H (written explicitly by the SMILES, [C@H]).
    carbon = edit.GetAtomWithIdx(bond.GetOtherAtomIdx(oxygen))
    carbon.SetNumExplicitHs(0)
    carbon.SetNoImplicit(False)
    made = edit.GetMol()
    Chem.SanitizeMol(made)
    return made


def partly_drawn(mol: Chem.Mol, name: str) -> str:
    """mol with its two centres set apart (R and S, so its double bond is stereogenic), its
    double bond one way, and then the centre with the higher index left undefined."""
    elements = potential(mol)
    apart = [
        m for m in settings(mol, elements) if sorted(cip(m)[0].values()) == ["R", "S"] and cip(m)[1]
    ]
    drawn = Chem.Mol(min(apart, key=lambda m: signature(m, elements)))
    centres = sorted(e.centeredOn for e in elements if e.type == Chem.StereoType.Atom_Tetrahedral)
    drawn.GetAtomWithIdx(centres[-1]).SetChiralTag(Chem.ChiralType.CHI_UNSPECIFIED)
    text = molfile(drawn, name)
    back = Chem.MolFromMolBlock(text, removeHs=False)
    tags, sides = defined_by(back, potential(back))
    if len(tags) != 1 or len(sides) != 1:
        raise ValueError(f"{name}: the drawing should fix one centre and one double bond")
    return text


def set_as(mol: Chem.Mol, centres: str, double_bonds: str) -> Chem.Mol:
    """The setting of mol's stereo elements with every centre labelled `centres` and every
    double bond `double_bonds` (CIP)."""
    for setting in settings(mol, potential(mol)):
        atoms, bonds = cip(setting)
        if set(atoms.values()) == {centres} and set(bonds.values()) == {double_bonds}:
            return setting
    raise ValueError(f"no setting with centres {centres} and double bonds {double_bonds}")


def axis_wedged(mol: Chem.Mol, name: str) -> str:
    """mol's Molfile with a wedge from one atom of its biaryl axis onto that atom's own single
    ring bond, which RDKit must read as atropisomer stereo."""
    text = molfile(mol, name)
    drawn = Chem.MolFromMolBlock(text, removeHs=False)
    (match,) = drawn.GetSubstructMatches(Chem.MolFromSmarts("[!#1]!@a:a!@a:a!@[!#1]"))[:1]
    axis, other = match[2], match[3]
    # A single ring bond (of the Kekulé form): Ketcher wedges only single bonds.
    ring = next(
        b.GetIdx()
        for b in Chem.MolFromMolBlock(text, removeHs=False, sanitize=False)
        .GetAtomWithIdx(axis)
        .GetBonds()
        if b.GetOtherAtomIdx(axis) != other and b.GetBondType() == Chem.BondType.SINGLE
    )
    lines, start, _ = bond_lines(text)
    bond = drawn.GetBondWithIdx(ring)
    write_bond(lines, start + ring, axis, bond.GetOtherAtomIdx(axis), 1)
    wedged = "\n".join(lines)
    atrop = (Chem.BondStereo.STEREOATROPCW, Chem.BondStereo.STEREOATROPCCW)
    if not any(b.GetStereo() in atrop for b in Chem.MolFromMolBlock(wedged).GetBonds()):
        raise ValueError(f"{name}: RDKit read no atropisomer stereo from the wedge")
    return wedged


def meso_drawn_late(mol: Chem.Mol) -> Chem.Mol:
    """The meso form of mol, as its setting with the larger signature."""
    elements = potential(mol)
    classes, _ = enumerate_classes(mol, elements)
    (members,) = [m for key, m in classes.items() if inchi(mirror(m[0])) == key and len(m) == 2]
    return max(members, key=lambda m: signature(m, elements))


def with_ethylidene(mol: Chem.Mol) -> Chem.Mol:
    """=CH-CH3 on the carbon between the two carbons that carry an O."""

    def carries_o(atom: Chem.Atom) -> bool:
        return any(n.GetSymbol() == "O" for n in atom.GetNeighbors())

    (middle,) = [
        a.GetIdx()
        for a in mol.GetAtoms()
        if a.GetSymbol() == "C"
        and len([n for n in a.GetNeighbors() if n.GetSymbol() == "C" and carries_o(n)]) == 2
    ]
    edit = Chem.RWMol(mol)
    first = edit.AddAtom(Chem.Atom(6))
    second = edit.AddAtom(Chem.Atom(6))
    edit.AddBond(middle, first, Chem.BondType.DOUBLE)
    edit.AddBond(first, second, Chem.BondType.SINGLE)
    made = edit.GetMol()
    Chem.SanitizeMol(made)
    return made


def bond_lines(text: str) -> tuple[list[str], int, int]:
    lines = text.split("\n")
    atoms, bonds = int(lines[3][0:3]), int(lines[3][3:6])
    return lines, 4 + atoms, bonds


def write_bond(lines: list[str], line: int, first: int, second: int, stereo: int) -> None:
    old = lines[line]
    lines[line] = f"{first + 1:>3}{second + 1:>3}{old[6:9]}{stereo:>3}{old[12:]}"


def restyled(mol: Chem.Mol, name: str, textbook: bool) -> str:
    """mol's Molfile wedged as a student might: at each centre, a wedge on a bond to a heavy
    atom and a hash on its drawn H (textbook), or one wedge on the heavy bond with the highest
    index (other bonds than RDKit's). Wedge or hash is chosen so it reads back as mol."""
    centres = [a.GetIdx() for a in mol.GetAtoms() if a.GetChiralTag() in TETRAHEDRAL]
    drawn = Chem.AddHs(mol, onlyOnAtoms=centres) if textbook else Chem.Mol(mol)
    text = molfile(drawn, name)
    want, _ = cip(mol)
    lines, start, count = bond_lines(text)
    table = []
    for i in range(count):
        line = lines[start + i]
        table.append((int(line[0:3]) - 1, int(line[3:6]) - 1))
    for i, (a, b) in enumerate(table):
        write_bond(lines, start + i, a, b, 0)
    symbols = [a.GetSymbol() for a in drawn.GetAtoms()]
    for centre in centres:
        at = [(i, b if a == centre else a) for i, (a, b) in enumerate(table) if centre in (a, b)]
        heavy = [x for x in at if symbols[x[1]] != "H"]
        hydrogen = [x for x in at if symbols[x[1]] == "H"]
        marks = [(heavy[0], 1), (hydrogen[0], 6)] if textbook else [(heavy[-1], 1)]
        for flip in (False, True):
            for (index, other), stereo in marks:
                write_bond(lines, start + index, centre, other, (7 - stereo) if flip else stereo)
            back, _ = cip(Chem.MolFromMolBlock("\n".join(lines), removeHs=False))
            if back.get(str(centre)) == want[str(centre)]:
                break
        else:
            raise ValueError(f"{name}: no wedging reads back as drawn at atom {centre}")
    return "\n".join(lines)


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
