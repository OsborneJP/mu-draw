"""Generate the tautomer and resonance panels' expected answers with server-side RDKit.

    python server/scripts/gen_tautomers_resonance_expected.py

Reads tests/fixtures/tautomer_compounds.csv and resonance_compounds.csv (SMILES from PubChem)
and the first single structures of RDKit's bundled NCI set, and writes:
  tests/fixtures/forms/<slug>.mol         each test drawing, as gen_reference_expected draws it
  tests/fixtures/tautomers_expected.json  what the tautomer panel must list for each drawing
  tests/fixtures/resonance_expected.json  what the resonance panel must list for each drawing
  tests/fixtures/forms_nci_expected.json  both answers for the NCI sample, from its SMILES

This is the reference the browser's ports (web/src/chem/tautomers.ts, resonance.ts; RDKit.js
has neither) are tested against, with the settings Jeff approved
(docs/plans/v2-tautomers-resonance.md):
  - tautomers: rdMolStandardize.TautomerEnumerator with its defaults, stopped at 33
    tautomers (up to 32 are drawn); its order is its own (by canonical SMILES);
  - resonance: Chem.ResonanceMolSupplier with ALLOW_CHARGE_SEPARATION and KEKULE_ALL, run
    only where no conjugated group has more than 60 bonds; its structures in its order.
A tautomer is the drawing's own when every atom has the same H and charge and every bond
the same type; a resonance structure is the drawing as drawn when every bond has the drawn
order (one drawn aromatic takes 1 or 2) and every atom the drawn charge. What differs from
the drawing is listed too: the panel highlights it.

Structures PubChem has no record of, or a wrong one, are made here by RDKit from a parent
(GENERATED), so nobody types them. The counts and verdicts a chemist expects are in
tests/fixtures/tautomers_judged.json and resonance_judged.json, written by judgement, never
generated; tests/test_tautomers_resonance_fixtures.py compares them with this output, and
regenerates it to compare bytes.
"""

from __future__ import annotations

import json
from pathlib import Path

import rdkit
from rdkit import Chem, RDConfig
from rdkit.Chem.MolStandardize import rdMolStandardize

from gen_reference_expected import (
    FIXTURES,
    SETTINGS,
    configure,
    has_specified_tetrahedral,
    molfile,
    read_rows,
    slug,
    with_2d_coords,
)

TABLES_FILE = FIXTURES.parents[1] / "web" / "src" / "chem" / "rdkitTables.json"
TAUTOMER_CSV = FIXTURES / "tautomer_compounds.csv"
RESONANCE_CSV = FIXTURES / "resonance_compounds.csv"
TAUTOMERS_FILE = "tautomers_expected.json"
RESONANCE_FILE = "resonance_expected.json"
NCI_FILE = "forms_nci_expected.json"
DIR = "forms"
NCI_SOURCE = Path(RDConfig.RDDataDir) / "NCI" / "first_5K.smi"
NCI_SAMPLE = 300
# Lines of the NCI set beyond the sample, each the first molecule there that needs one of
# RDKit's rarer tautomer transforms (tests/test_rdkit_tables.py, WITNESSES).
NCI_WITNESSES = (302, 2645, 3205)

# docs/plans/v2-tautomers-resonance.md, decision 7.
LIMITS = {"drawn": 32, "group_bonds": 60, "max_structs": 1000, "max_transforms": 1000}
# Decision 2.
RESONANCE_FLAGS = ("ALLOW_CHARGE_SEPARATION", "KEKULE_ALL")
FLAGS = 0
for _name in RESONANCE_FLAGS:
    FLAGS |= int(getattr(Chem.ResonanceFlags, _name))

# Made by RDKit from a parent in the resonance set: (name, parent, change, SMARTS whose first
# atom is changed). "deprotonate": one H off, charge -1; "hydride off": one H off, charge +1.
GENERATED = (
    ("acetone enolate", "acetone", "deprotonate", "[CH3]C=O"),
    ("allyl anion", "propene", "deprotonate", "[CH3]C=C"),
    ("allyl cation", "propene", "hydride off", "[CH3]C=C"),
    ("benzyl cation", "toluene", "hydride off", "[CH3]c"),
    # Benzene's arenium ion: cyclohexa-1,3-diene with a hydride off the CH2 beside the diene.
    ("benzenium (arenium ion)", "1,3-cyclohexadiene", "hydride off", "[CH2;R]C=C"),
)
# Parents only there to make GENERATED: not test drawings themselves.
PARENTS_ONLY = ("propene", "toluene", "1,3-cyclohexadiene", "pyridine", "copper")
# Drawings written with Molfile aromatic bonds, as Ketcher's aromatic bond tool draws them:
# (name, the test drawing it is, its set).
DRAWN_AROMATIC = (
    ("phenol, drawn with aromatic bonds", "phenol", "tautomers"),
    ("benzene, drawn with aromatic bonds", "benzene", "resonance"),
    ("phenolate, drawn with aromatic bonds", "phenolate", "resonance"),
)
# A ligand bound to a metal by a dative bond, as Ketcher's dative bond draws it:
# (name, ligand, metal, SMARTS whose first atom bonds to the metal).
BOUND = (("pyridine bound to copper", "pyridine", "copper", "n"),)
# Resonance test drawings drawn as one of RDKit's own resonance structures of a parent under
# wider settings, so that the panel's settings leave the drawing out (bar B.3's "not among
# them"): (name, parent, the flag added). The first charged structure RDKit lists.
DRAWN_AS_RESONANCE = (
    ("methyl vinyl ketone, drawn charge-separated", "methyl vinyl ketone", "UNCONSTRAINED_CATIONS"),
)
# Tautomer test drawings drawn as one of RDKit's own tautomers of a parent, where PubChem has
# none: (name, parent, the transform it is drawn for). The first tautomer RDKit lists whose
# Kekulé form that transform matches (its SMARTS from rdkitTables.json).
DRAWN_AS_TAUTOMER = (
    (
        "thiourea dioxide, drawn as RDKit's tautomer with C=S",
        "thiourea dioxide",
        "formamidinesulfinic acid f",
    ),
)


def changed(parent: Chem.Mol, change: str, smarts: str) -> Chem.Mol:
    atom_index = parent.GetSubstructMatch(Chem.MolFromSmarts(smarts))[0]
    mol = Chem.RWMol(parent)
    atom = mol.GetAtomWithIdx(atom_index)
    hydrogens = atom.GetTotalNumHs()
    atom.SetNoImplicit(True)
    atom.SetNumExplicitHs(hydrogens - 1)
    atom.SetFormalCharge(atom.GetFormalCharge() + (-1 if change == "deprotonate" else 1))
    Chem.SanitizeMol(mol)
    return Chem.MolFromSmiles(Chem.MolToSmiles(mol))


def drawn_as_tautomer(parent: Chem.Mol, transform: str) -> Chem.Mol:
    tables = json.loads(TABLES_FILE.read_text(encoding="utf-8"))["tautomer_transforms"]
    query = Chem.MolFromSmarts(next(t["smarts"] for t in tables if t["name"] == transform))
    for tautomer in tautomer_enumerator().Enumerate(parent).tautomers:
        kekule = Chem.RWMol(tautomer)
        Chem.Kekulize(kekule, False)
        if kekule.HasSubstructMatch(query):
            return Chem.MolFromSmiles(Chem.MolToSmiles(tautomer))
    raise ValueError(f"no tautomer of the parent matches {transform}")


def bound(ligand: Chem.Mol, metal: Chem.Mol, smarts: str) -> Chem.Mol:
    joined = Chem.RWMol(Chem.CombineMols(ligand, metal))
    atom = ligand.GetSubstructMatch(Chem.MolFromSmarts(smarts))[0]
    joined.AddBond(atom, ligand.GetNumAtoms(), Chem.BondType.DATIVE)
    mol = joined.GetMol()
    Chem.SanitizeMol(mol)
    return Chem.MolFromSmiles(Chem.MolToSmiles(mol))


def bound_molfile(mol: Chem.Mol, name: str) -> str:
    """As molfile(), with each dative bond written as a single bond, as Ketcher's single bond
    tool draws it: RDKit's sanitizing makes it dative again when it reads the file."""
    drawn = Chem.RWMol(with_2d_coords(mol, name))
    Chem.Kekulize(drawn, clearAromaticFlags=True)
    for bond in drawn.GetBonds():
        if bond.GetBondType() == Chem.BondType.DATIVE:
            bond.SetBondType(Chem.BondType.SINGLE)
    return Chem.MolToMolBlock(drawn, kekulize=False)


def aromatic_molfile(mol: Chem.Mol, name: str) -> str:
    """As molfile(), with aromatic bonds written as such (Molfile bond type 4)."""
    drawn = with_2d_coords(mol, name)
    drawn.SetIntProp("_MolFileChiralFlag", int(has_specified_tetrahedral(mol)))
    return Chem.MolToMolBlock(drawn, kekulize=False)


def drawn_as_resonance(parent: Chem.Mol, flag: str) -> Chem.Mol:
    wider = FLAGS | int(getattr(Chem.ResonanceFlags, flag))
    for structure in Chem.ResonanceMolSupplier(parent, wider):
        if any(a.GetFormalCharge() for a in structure.GetAtoms()):
            return Chem.MolFromSmiles(Chem.MolToSmiles(structure))
    raise ValueError(f"no charged resonance structure of the parent with {flag}")


def tautomer_enumerator() -> rdMolStandardize.TautomerEnumerator:
    enumerator = rdMolStandardize.TautomerEnumerator()
    enumerator.SetMaxTautomers(LIMITS["drawn"] + 1)
    return enumerator


def bond_types(mol: Chem.Mol) -> list[str]:
    return [str(b.GetBondType()) for b in mol.GetBonds()]


def drawing_smiles(mol: Chem.Mol, result) -> str:
    """The drawing's SMILES with its stereo cleared where RDKit clears every tautomer's
    (TautomerEnumerator::setTautomerStereoAndIsoHs): no stereo at a modified atom; at a
    modified bond, "any" if it is a double bond not between two ring atoms, else none."""
    m = Chem.RWMol(mol)
    for i in result.modifiedAtoms:
        m.GetAtomWithIdx(i).SetChiralTag(Chem.ChiralType.CHI_UNSPECIFIED)
    rings = m.GetRingInfo()
    for i in result.modifiedBonds:
        bond = m.GetBondWithIdx(i)
        in_ring = rings.NumAtomRings(bond.GetBeginAtomIdx()) and rings.NumAtomRings(
            bond.GetEndAtomIdx()
        )
        double = bond.GetBondType() == Chem.BondType.DOUBLE and not in_ring
        bond.SetStereo(Chem.BondStereo.STEREOANY if double else Chem.BondStereo.STEREONONE)
    Chem.AssignStereochemistry(m, cleanIt=True, force=True)
    return Chem.MolToSmiles(m)


def kekule_forms(mol: Chem.Mol) -> list[list[int]]:
    """RDKit's Kekulé forms of a molecule: its resonance structures with KEKULE_ALL alone that
    change only aromatic bonds and no charge; RDKit's own Kekulé form where there are none, or
    where a conjugated group is too large to run."""
    aromatic = [b.GetIsAromatic() for b in mol.GetBonds()]
    charges = [a.GetFormalCharge() for a in mol.GetAtoms()]
    kekule = Chem.RWMol(mol)
    Chem.Kekulize(kekule, clearAromaticFlags=True)
    own = [int(b.GetBondTypeAsDouble()) for b in kekule.GetBonds()]
    if conjugated_groups(mol)[1] <= LIMITS["group_bonds"]:
        forms = []
        flags = int(Chem.ResonanceFlags.KEKULE_ALL)
        for s in Chem.ResonanceMolSupplier(mol, flags, LIMITS["max_structs"]):
            bonds = [int(b.GetBondTypeAsDouble()) for b in s.GetBonds()]
            same_charges = [a.GetFormalCharge() for a in s.GetAtoms()] == charges
            if same_charges and all(aromatic[i] or bonds[i] == own[i] for i in range(len(bonds))):
                forms.append(bonds)
        if forms:
            return forms
    return [own]


def closest(forms: list[list[int]], drawn: Chem.Mol) -> list[int]:
    """The Kekulé form with the fewest bonds unlike the drawing's as drawn (a bond drawn
    aromatic counts as like either order), the lowest list of orders among equals."""
    orders = [b.GetBondTypeAsDouble() for b in drawn.GetBonds()]
    aromatic = [b.GetBondType() == Chem.BondType.AROMATIC for b in drawn.GetBonds()]

    def unlike(form: list[int]) -> int:
        return sum(1 for i, o in enumerate(form) if not aromatic[i] and o != orders[i])

    return min(forms, key=lambda f: (unlike(f), f))


def tautomers(mol: Chem.Mol, text: str) -> dict:
    """What the tautomer panel lists for a drawing (RDKit's reading of it, and the Molfile).
    Each tautomer is drawn in its Kekulé form closest to the drawing, so the bonds that look
    different are the ones highlighted."""
    if len(Chem.GetMolFrags(mol)) > 1:
        return {"outcome": "several"}
    result = tautomer_enumerator().Enumerate(mol)
    status = str(result.status)
    if status != "Completed" or len(result.smiles) > LIMITS["drawn"]:
        return {"outcome": "too-many", "status": status}
    hydrogens = [a.GetTotalNumHs() for a in mol.GetAtoms()]
    charges = [a.GetFormalCharge() for a in mol.GetAtoms()]
    drawn = as_drawn(text)
    drawn_aromatic = [b.GetBondType() == Chem.BondType.AROMATIC for b in drawn.GetBonds()]
    own = drawing_smiles(mol, result)
    listed = []
    for smiles, tautomer in zip(result.smiles, result.tautomers, strict=True):
        # The drawing's own is shown as drawn: RDKit may keep it with an H elsewhere that
        # gives the same SMILES (histidine's acid H on its other O).
        tautomer = mol if smiles == own else tautomer
        kekule = closest(kekule_forms(tautomer), drawn)
        h = [a.GetTotalNumHs() for a in tautomer.GetAtoms()]
        c = [a.GetFormalCharge() for a in tautomer.GetAtoms()]
        atoms = [i for i in range(len(h)) if h[i] != hydrogens[i] or c[i] != charges[i]]
        # A bond drawn aromatic changes where the tautomer's is not aromatic; any other bond
        # where its order in the picture is not the drawn one.
        bonds = [
            i
            for i, b in enumerate(tautomer.GetBonds())
            if (
                not b.GetIsAromatic()
                if drawn_aromatic[i]
                else kekule[i] != drawn.GetBondWithIdx(i).GetBondTypeAsDouble()
            )
        ]
        listed.append(
            {
                "smiles": smiles,
                "drawing": smiles == own,
                "hydrogens": h,
                "kekule": kekule,
                "changed_atoms": atoms,
                "changed_bonds": bonds,
            }
        )
    if sum(t["drawing"] for t in listed) != 1:
        raise ValueError(f"{Chem.MolToSmiles(mol)}: not exactly one tautomer is the drawing's")
    defined_atom = (Chem.ChiralType.CHI_TETRAHEDRAL_CW, Chem.ChiralType.CHI_TETRAHEDRAL_CCW)
    defined_bond = (
        Chem.BondStereo.STEREOE,
        Chem.BondStereo.STEREOZ,
        Chem.BondStereo.STEREOCIS,
        Chem.BondStereo.STEREOTRANS,
    )
    atoms = (mol.GetAtomWithIdx(i).GetChiralTag() for i in result.modifiedAtoms)
    bonds = (mol.GetBondWithIdx(i).GetStereo() for i in result.modifiedBonds)
    dropped = any(t in defined_atom for t in atoms) or any(s in defined_bond for s in bonds)
    return {"outcome": "listed", "status": status, "stereo_dropped": dropped, "tautomers": listed}


def conjugated_groups(mol: Chem.Mol) -> tuple[list[int], int]:
    supplier = Chem.ResonanceMolSupplier(mol, FLAGS)
    groups = [supplier.GetBondConjGrpIdx(b.GetIdx()) for b in mol.GetBonds()]
    largest = max((groups.count(g) for g in set(groups) if g != -1), default=0)
    return [i for i, g in enumerate(groups) if g != -1], largest


def ranks(mol: Chem.Mol, supplier, structures: list[tuple[list[int], list[int]]]) -> list[str]:
    """RDKit's ranking of each structure, per conjugated group, worked out from the structure
    as ResonanceMolSupplier does (Resonance.cpp: CEMetrics, CEVect2's sort and degeneracy
    classes): the class's depth, then missing octet electrons, formal charges, charges weighted
    by electronegativity, distances between like and unlike charges, and the index sums that
    break ties. The browser's port must give the same; a test checks that RDKit's own order
    follows them. Structures of equal rank are ones RDKit's order leaves to its hash values."""
    tables = json.loads(TABLES_FILE.read_text(encoding="utf-8"))
    en = tables["electronegativity"]
    table = Chem.GetPeriodicTable()
    distance = Chem.GetDistanceMatrix(mol)
    groups = supplier.GetNumConjGrps()
    group_atoms = [
        [a.GetIdx() for a in mol.GetAtoms() if supplier.GetAtomConjGrpIdx(a.GetIdx()) == g]
        for g in range(groups)
    ]
    group_bonds = [
        [b.GetIdx() for b in mol.GetBonds() if supplier.GetBondConjGrpIdx(b.GetIdx()) == g]
        for g in range(groups)
    ]

    def sigma(atom: Chem.Atom) -> int:
        # AtomElectrons' constructor: the total degree, less each dative or zero-order bond.
        dative = int(Chem.BondType.DATIVEONE)
        return atom.GetTotalDegree() - sum(int(b.GetBondType()) >= dative for b in atom.GetBonds())

    def metrics(g: int, bonds: list[int], charges: list[int]) -> tuple:
        missing = absolute = weighted = same = opposite = sum_fc = 0
        for a in group_atoms[g]:
            atom = mol.GetAtomWithIdx(a)
            tv = sigma(atom) + sum(
                bonds[b.GetIdx()] - 1
                for b in atom.GetBonds()
                if supplier.GetBondConjGrpIdx(b.GetIdx()) == g
            )
            fc = charges[a]
            nb = table.GetNOuterElecs(atom.GetAtomicNum()) - fc - tv
            missing += 8 - (2 * tv + nb)
            absolute += abs(fc)
            z = atom.GetAtomicNum()
            weighted += fc * (en[z] if z < len(en) else 1000)
            sum_fc += a if fc else 0
        charged = [a for a in group_atoms[g] if charges[a]]
        for i, a in enumerate(charged):
            for c in charged[i + 1 :]:
                d = int(distance[a][c] + 0.1)
                if charges[a] * charges[c] > 0:
                    same += d
                else:
                    opposite += d
        sum_mb = sum(b for b in group_bonds[g] if bonds[b] > 1)
        return (missing, absolute, weighted, same, opposite, sum_fc, sum_mb)

    def order(m: tuple) -> tuple:
        missing, absolute, weighted, same, opposite, sum_fc, sum_mb = m
        return (missing, absolute, weighted, -same, -opposite, sum_fc, sum_mb)

    per_structure: list[list[str]] = [[] for _ in structures]
    for g in range(groups):
        own = [metrics(g, bonds, charges) for bonds, charges in structures]
        classes: list[tuple] = []
        for m in sorted(set(own), key=order):
            degeneracy = (m[1], m[3], m[4], m[0], m[2])
            if not classes or classes[-1] != degeneracy:
                classes.append(degeneracy)
        for k, m in enumerate(own):
            depth = classes.index((m[1], m[3], m[4], m[0], m[2]))
            per_structure[k].append(
                ",".join(map(str, (depth, m[0], m[1], m[2], m[3], m[4], m[5], m[6])))
            )
    return [";".join(r) for r in per_structure]


def resonance_structures(mol: Chem.Mol) -> dict:
    """RDKit's structures as bond orders and charges by index, in its order (None beyond 32)."""
    conjugated, largest = conjugated_groups(mol)
    found = {"conjugated": conjugated, "largest_group": largest}
    if largest > LIMITS["group_bonds"]:
        return {**found, "outcome": "too-large"}
    supplier = Chem.ResonanceMolSupplier(mol, FLAGS, LIMITS["max_structs"])
    count = len(supplier)
    if count > LIMITS["drawn"]:
        return {**found, "outcome": "counted", "count": count}
    structures = [
        (
            [int(b.GetBondTypeAsDouble()) for b in s.GetBonds()],
            [a.GetFormalCharge() for a in s.GetAtoms()],
        )
        for s in supplier
    ]
    ranked = [(*s, r) for s, r in zip(structures, ranks(mol, supplier, structures), strict=True)]
    return {**found, "outcome": "listed", "count": count, "structures": ranked}


def as_drawn(text: str) -> Chem.Mol:
    """The drawing's own bond orders and charges: unsanitized, Hs drawn as atoms folded in."""
    return Chem.RemoveHs(Chem.MolFromMolBlock(text, sanitize=False, removeHs=False), sanitize=False)


def resonance(mol: Chem.Mol, text: str) -> dict:
    """What the resonance panel lists for a drawing (RDKit's reading of it, and the Molfile)."""
    if len(Chem.GetMolFrags(mol)) > 1:
        return {"outcome": "several"}
    found = resonance_structures(mol)
    if found["outcome"] != "listed":
        return found
    drawn = as_drawn(text)
    if [a.GetAtomicNum() for a in drawn.GetAtoms()] != [a.GetAtomicNum() for a in mol.GetAtoms()]:
        raise ValueError(f"{Chem.MolToSmiles(mol)}: the drawing as drawn has other atoms")
    listed = []
    for bonds, charges, rank in found["structures"]:
        changed_bonds = []
        for i, b in enumerate(drawn.GetBonds()):
            if b.GetBondType() == Chem.BondType.AROMATIC:
                if bonds[i] not in (1, 2):
                    changed_bonds.append(i)
            elif bonds[i] != int(b.GetBondTypeAsDouble()):
                changed_bonds.append(i)
        drawn_charges = [a.GetFormalCharge() for a in drawn.GetAtoms()]
        changed_atoms = [i for i, q in enumerate(drawn_charges) if charges[i] != q]
        listed.append(
            {
                "bonds": bonds,
                "charges": charges,
                "rank": rank,
                "drawing": not changed_atoms and not changed_bonds,
                "changed_atoms": changed_atoms,
                "changed_bonds": changed_bonds,
            }
        )
    return {**found, "structures": listed}


def drawings() -> tuple[list[dict], list[dict], dict[str, str]]:
    """Each test drawing's Molfile, and the names in each set, in CSV order."""
    files: dict[str, str] = {}
    tautomer_rows = read_rows(TAUTOMER_CSV)
    resonance_rows = read_rows(RESONANCE_CSV)
    by_name = {row["typed_name"]: Chem.MolFromSmiles(row["smiles"]) for row in tautomer_rows}
    by_name |= {row["typed_name"]: Chem.MolFromSmiles(row["smiles"]) for row in resonance_rows}
    sets = (
        [row["typed_name"] for row in tautomer_rows],
        [row["typed_name"] for row in resonance_rows if row["typed_name"] not in PARENTS_ONLY],
    )
    for name, parent, change, smarts in GENERATED:
        by_name[name] = changed(by_name[parent], change, smarts)
    for name, parent, transform in DRAWN_AS_TAUTOMER:
        by_name[name] = drawn_as_tautomer(by_name[parent], transform)
    for name, parent, flag in DRAWN_AS_RESONANCE:
        by_name[name] = drawn_as_resonance(by_name[parent], flag)
    for name, ligand, metal, smarts in BOUND:
        by_name[name] = bound(by_name[ligand], by_name[metal], smarts)
    for name, parent, _set in DRAWN_AROMATIC:
        by_name[name] = by_name[parent]
    aromatic = {name for name, _parent, _set in DRAWN_AROMATIC}
    bound_names = {b[0] for b in BOUND}
    tautomer_names = [
        *sets[0],
        *(d[0] for d in DRAWN_AS_TAUTOMER),
        *(d[0] for d in DRAWN_AROMATIC if d[2] == "tautomers"),
    ]
    resonance_names = [
        *sets[1],
        *(g[0] for g in GENERATED),
        *(d[0] for d in DRAWN_AS_RESONANCE),
        *(d[0] for d in DRAWN_AROMATIC if d[2] == "resonance"),
        *(b[0] for b in BOUND),
    ]
    entries = ([], [])
    for k, names in enumerate((tautomer_names, resonance_names)):
        for name in names:
            rel = f"{DIR}/{slug(name)}.mol"
            write = (
                aromatic_molfile
                if name in aromatic
                else bound_molfile
                if name in bound_names
                else molfile
            )
            files[rel] = write(by_name[name], name)
            entries[k].append({"name": name, "file": rel})
    return entries[0], entries[1], files


def nci_sample() -> list[tuple[int, str]]:
    """(line, SMILES): the first single structures, then the witnesses."""
    lines = NCI_SOURCE.read_text(encoding="utf-8").splitlines()
    sample = []
    for number, line in enumerate(lines):
        smiles = line.split()[0]
        mol = Chem.MolFromSmiles(smiles)
        if mol is not None and len(Chem.GetMolFrags(mol)) == 1:
            sample.append((number, smiles))
        if len(sample) == NCI_SAMPLE:
            break
    return sample + [(number, lines[number].split()[0]) for number in NCI_WITNESSES]


def header() -> dict:
    return {
        "generator": "server/scripts/gen_tautomers_resonance_expected.py",
        "rdkit_version": rdkit.__version__,
        "settings": {
            "legacy_stereo_perception": SETTINGS["legacy_stereo_perception"],
            "resonance_flags": list(RESONANCE_FLAGS),
        },
        "limits": LIMITS,
    }


def generate() -> dict[str, str]:
    configure()
    tautomer_entries, resonance_entries, files = drawings()
    outputs = dict(files)
    read = {rel: Chem.MolFromMolBlock(text) for rel, text in files.items()}
    tautomer_compounds = [
        {**e, **tautomers(read[e["file"]], files[e["file"]])} for e in tautomer_entries
    ]
    resonance_compounds = [
        {**e, **resonance(read[e["file"]], files[e["file"]])} for e in resonance_entries
    ]
    outputs[TAUTOMERS_FILE] = json.dumps({**header(), "compounds": tautomer_compounds}, indent=1)
    outputs[RESONANCE_FILE] = json.dumps({**header(), "compounds": resonance_compounds}, indent=1)
    molecules = []
    for line, smiles in nci_sample():
        mol = Chem.MolFromSmiles(smiles)
        result = tautomer_enumerator().Enumerate(mol)
        found = resonance_structures(mol)
        molecules.append(
            {
                "line": line,
                "smiles": smiles,
                "tautomers": {"status": str(result.status), "smiles": list(result.smiles)},
                "resonance": found,
            }
        )
    outputs[NCI_FILE] = json.dumps(
        {**header(), "source": "RDKit's Data/NCI/first_5K.smi", "molecules": molecules},
        separators=(",", ":"),
    )
    return {rel: text + "\n" for rel, text in outputs.items()}


def main() -> int:
    outputs = generate()
    (FIXTURES / DIR).mkdir(exist_ok=True)
    for stale in (FIXTURES / DIR).glob("*.mol"):
        if f"{DIR}/{stale.name}" not in outputs:
            stale.unlink()
    for rel, text in outputs.items():
        (FIXTURES / rel).write_text(text, encoding="utf-8")
    print(f"wrote {len(outputs)} files under {FIXTURES.relative_to(FIXTURES.parents[1])}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
