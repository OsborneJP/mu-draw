"""Generate the conformation and projection templates (docs/plans/v2-templates.md).

    python server/scripts/gen_templates.py

Reads tests/fixtures/template_compounds.csv (SMILES from PubChem) and writes:
  web/src/editor/templates.json            each template's group, name and drawing (KET),
                                           imported by the app's Templates menu
  tests/fixtures/templates_expected.json   what the app must make of each one (RDKit)

What is chemistry comes from PubChem and RDKit: which molecule each template is, and the
chair's bond directions (a real chair, projected). What is only a drawing convention is
computed here: the bond length, the chair's viewing angle, and a Newman projection, which
is a picture (lines, a circle and labels) rather than a molecule. Nothing is typed in.

Output is deterministic; tests/test_templates.py regenerates it and compares bytes.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import rdkit
from rdkit import Chem
from rdkit.Chem import AllChem, rdMolDescriptors
from rdkit.Geometry import Point3D

import gen_reference_expected as ref

ROOT = Path(__file__).resolve().parents[2]
CSV_FILE = ref.FIXTURES / "template_compounds.csv"
TEMPLATES_FILE = ROOT / "web" / "src" / "editor" / "templates.json"
EXPECTED_FILE = ref.FIXTURES / "templates_expected.json"
GENERATOR = "server/scripts/gen_templates.py"
DECIMALS = 4  # coordinates, in bond lengths
BOND_ORDERS = {1: Chem.BondType.SINGLE, 2: Chem.BondType.DOUBLE}

# The chair: RDKit's lowest-energy cyclohexane conformer, drawn the way textbooks draw it.
# Textbooks exaggerate the pucker, so the conformer is first stretched along its ring axis:
# the stretch is affine, so axial bonds stay parallel to the axis and equatorial bonds stay
# parallel to the ring bonds one removed. It is then seen from slightly above, turned about
# its axis. These three numbers made the ring's shape match Ketcher's own "Chair1"
# template best (within 5%; measured for the plan).
CHAIR = {
    "conformers": 20,
    "seed": 42,
    "stretch": 1.5,
    "elevation_deg": 18.0,
    "turn_deg": 9.0,
}

# A Newman projection looks down a C-C bond, so both carbons sit at one point and Ketcher
# can't hold it as one molecule: it is a picture the student labels. Front bonds meet at the
# centre; back bonds start on the circle. Angles anticlockwise from 3 o'clock; lengths in
# bond lengths. Eclipsed back bonds are drawn a little off the front ones, so they show.
NEWMAN = {
    "front_deg": [90.0, 210.0, 330.0],
    "staggered_offset_deg": 60.0,
    "eclipsed_offset_deg": 20.0,  # at 15° the labels of a pair overlap
    "circle_radius": 0.5,
    "bond_end": 1.0,
    "label_radius": 1.3,
    "label": "H",
}
# A one-letter label's box, in bond lengths, as Ketcher measures it at its default size.
LABEL_BOX = (0.235, 0.375)


@dataclass
class Drawing:
    """A template as Ketcher holds it: atoms and bonds, shapes and text (coordinates in bond
    lengths, y up)."""

    atoms: list[dict] = field(default_factory=list)  # {"label", "xy"}
    bonds: list[dict] = field(default_factory=list)  # {"atoms": (i, j), "order", "wedge"}
    shapes: list[dict] = field(default_factory=list)  # {"mode", "points": (xy, xy)}
    texts: list[dict] = field(default_factory=list)  # {"text", "xy": its centre}

    def atom(self, label: str, xy) -> int:
        self.atoms.append({"label": label, "xy": (float(xy[0]), float(xy[1]))})
        return len(self.atoms) - 1

    def bond(self, i: int, j: int, order: int = 1, wedge: bool = False) -> None:
        """A wedge's narrow end is at atom i."""
        self.bonds.append({"atoms": (i, j), "order": order, "wedge": wedge})

    def shape(self, mode: str, a, b) -> None:
        """Ketcher's line (from a to b) or ellipse (in the box with corners a and b)."""
        self.shapes.append({"mode": mode, "points": (tuple(map(float, a)), tuple(map(float, b)))})

    def text(self, text: str, xy) -> None:
        self.texts.append({"text": text, "xy": (float(xy[0]), float(xy[1]))})

    def ket(self) -> dict:
        atoms = [
            {"label": a["label"], "location": [rounded(a["xy"][0]), rounded(a["xy"][1]), 0.0]}
            for a in self.atoms
        ]
        bonds = []
        for b in self.bonds:
            bond = {"type": b["order"], "atoms": list(b["atoms"])}
            if b["wedge"]:
                bond["stereo"] = 1
            bonds.append(bond)
        nodes: list[dict] = [{"$ref": "mol0"}] if atoms else []
        for s in self.shapes:
            pos = [{"x": rounded(x), "y": rounded(y), "z": 0.0} for x, y in s["points"]]
            nodes.append({"type": "simpleObject", "data": {"mode": s["mode"], "pos": pos}})
        width, height = LABEL_BOX
        for label in self.texts:
            x, y = label["xy"]
            box = {"x": rounded(x - width / 2), "y": rounded(y + height / 2)}
            nodes.append(
                {
                    "type": "text",
                    "boundingBox": box | {"width": width, "height": height},
                    "paragraphs": [{"parts": [{"text": label["text"]}]}],
                }
            )
        ket: dict = {"root": {"nodes": nodes}}
        if atoms:
            ket["mol0"] = {"type": "molecule", "atoms": atoms, "bonds": bonds}
        return ket

    def mol(self) -> Chem.Mol:
        """What RDKit reads from the drawing, as the app's properties panel does from
        Ketcher's Molfile: the atoms where they are drawn, each wedge read at its narrow end."""
        editable = Chem.RWMol()
        for a in self.atoms:
            editable.AddAtom(Chem.Atom(a["label"]))
        for b in self.bonds:
            i, j = b["atoms"]
            editable.AddBond(i, j, BOND_ORDERS[b["order"]])
            if b["wedge"]:
                editable.GetBondBetweenAtoms(i, j).SetBondDir(Chem.BondDir.BEGINWEDGE)
        mol = editable.GetMol()
        conformer = Chem.Conformer(mol.GetNumAtoms())
        conformer.Set3D(False)
        for k, a in enumerate(self.atoms):
            conformer.SetAtomPosition(k, Point3D(rounded(a["xy"][0]), rounded(a["xy"][1]), 0.0))
        mol.AddConformer(conformer, assignId=True)
        Chem.SanitizeMol(mol)
        Chem.AssignChiralTypesFromBondDirs(mol)
        Chem.AssignStereochemistry(mol, cleanIt=True, force=True)
        return mol


def rounded(value: float) -> float:
    return round(float(value), DECIMALS) + 0.0  # + 0.0: never -0.0


def read_smiles() -> dict[str, str]:
    return {row["typed_name"]: row["smiles"] for row in ref.read_rows(CSV_FILE)}


def lowest_energy_conformer(mol: Chem.Mol) -> np.ndarray:
    params = AllChem.ETKDGv3()
    params.randomSeed = CHAIR["seed"]
    ids = list(AllChem.EmbedMultipleConfs(mol, CHAIR["conformers"], params))
    energies = [energy for _, energy in AllChem.MMFFOptimizeMoleculeConfs(mol, maxIters=2000)]
    return mol.GetConformer(ids[int(np.argmin(energies))]).GetPositions()


def ring_axis(pos: np.ndarray, ring: list[int]) -> np.ndarray:
    """Unit normal of the ring's mean plane (pos centred on the ring)."""
    normal = sum(np.cross(pos[ring[i]], pos[ring[(i + 1) % len(ring)]]) for i in range(len(ring)))
    return normal / np.linalg.norm(normal)


def chair_hydrogens(mol: Chem.Mol, pos: np.ndarray, ring: list[int]) -> dict[int, np.ndarray]:
    """The textbook directions of a chair's C-H bonds, worked out from its ring: each axial
    bond along the ring axis, on its carbon's side of the ring's mean plane; each equatorial
    bond parallel to the two ring bonds one removed, pointing out of the ring. RDKit's real
    chair is a few degrees off them (tests/test_templates.py); textbooks draw them exactly."""
    centre = pos[ring].mean(axis=0)
    axis = ring_axis(pos - centre, ring)
    directions = {}
    for k, carbon in enumerate(ring):
        hydrogens = [n.GetIdx() for n in mol.GetAtomWithIdx(carbon).GetNeighbors()]
        hydrogens = [h for h in hydrogens if mol.GetAtomWithIdx(h).GetSymbol() == "H"]
        axial = max(hydrogens, key=lambda h: abs((pos[h] - pos[carbon]) @ axis))
        (equatorial,) = (h for h in hydrogens if h != axial)
        outward = pos[carbon] - centre
        directions[axial] = np.sign(outward @ axis) * axis
        removed = (pos[ring[(k + 2) % 6]] - pos[ring[(k + 1) % 6]]) + (
            pos[ring[k - 2]] - pos[ring[k - 1]]
        )
        removed /= np.linalg.norm(removed)
        directions[equatorial] = removed if removed @ outward > 0 else -removed
    return directions


def chair(smiles: str, flipped: bool) -> Drawing:
    """Cyclohexane with all 12 hydrogens, 6 axial and 6 equatorial. Flipped: the other chair
    (the mirror image of the drawing), the left tip up instead of down."""
    mol = Chem.AddHs(Chem.MolFromSmiles(smiles))
    (ring,) = (list(r) for r in mol.GetRingInfo().AtomRings())
    pos = lowest_energy_conformer(mol)
    pos = pos - pos[ring].mean(axis=0)
    axis = ring_axis(pos, ring)
    stretched = pos + (CHAIR["stretch"] - 1) * np.outer(pos @ axis, axis)
    # Each C-H in its textbook direction, as long as the ring's mean C-C: the bond length.
    cc = np.mean([np.linalg.norm(stretched[ring[i]] - stretched[ring[i - 1]]) for i in range(6)])
    for hydrogen, direction in chair_hydrogens(mol, stretched, ring).items():
        (carbon,) = (n.GetIdx() for n in mol.GetAtomWithIdx(hydrogen).GetNeighbors())
        stretched[hydrogen] = stretched[carbon] + direction * cc
    # The drawing's x: across the ring (atom 0 to atom 3) in its mean plane, turned about the
    # axis; seen from slightly above, so the axis is the drawing's y, give or take the tilt.
    across = pos[ring[0]] - pos[ring[3]]
    across -= (across @ axis) * axis
    across /= np.linalg.norm(across)
    turn, elevation = np.radians(CHAIR["turn_deg"]), np.radians(CHAIR["elevation_deg"])
    x = np.cos(turn) * across + np.sin(turn) * np.cross(across, axis)
    view = np.cos(elevation) * np.cross(x, axis) + np.sin(elevation) * axis
    y = np.cross(view, x)
    xy = np.c_[stretched @ x, stretched @ y] / cc
    # Textbook orientation: the ring's left tip lower than its right; flipped, higher.
    left, right = ring[int(np.argmin(xy[ring, 0]))], ring[int(np.argmax(xy[ring, 0]))]
    if (xy[left, 1] > xy[right, 1]) != flipped:
        xy[:, 0] *= -1
    drawing = Drawing()
    for atom in mol.GetAtoms():
        drawing.atom(atom.GetSymbol(), xy[atom.GetIdx()])
    for bond in mol.GetBonds():
        drawing.bond(bond.GetBeginAtomIdx(), bond.GetEndAtomIdx())
    return drawing


def newman(offset_deg: float) -> Drawing:
    """Six positions, each labelled "H" for the student to change: three front bonds from
    the centre, and three back bonds from the circle, `offset_deg` round from the front.
    The first shape is a front bond: Ketcher's paste tool holds a drawing without atoms by
    its first shape's first point, which for a front bond is the centre (for the circle it
    would be a corner of its box)."""
    drawing = Drawing()
    radius, end = NEWMAN["circle_radius"], NEWMAN["bond_end"]
    for front in NEWMAN["front_deg"]:
        for angle, start in ((front, 0.0), (front + offset_deg, radius)):
            direction = np.array([np.cos(np.radians(angle)), np.sin(np.radians(angle))])
            drawing.shape("line", direction * start, direction * end)
            drawing.text(NEWMAN["label"], direction * NEWMAN["label_radius"])
    drawing.shape("ellipse", (-radius, -radius), (radius, radius))
    return drawing


@dataclass
class Template:
    id: str
    group: str
    name: str
    drawing: Drawing
    source: str | None  # the PubChem compound it is, by typed name; None for a picture


def templates(smiles: dict[str, str]) -> list[Template]:
    return [
        Template(
            "chair",
            "Chair",
            "Cyclohexane chair",
            chair(smiles["cyclohexane"], False),
            "cyclohexane",
        ),
        Template(
            "chair-flipped",
            "Chair",
            "Cyclohexane chair, ring-flipped",
            chair(smiles["cyclohexane"], True),
            "cyclohexane",
        ),
        Template(
            "newman-staggered",
            "Newman",
            "Newman, staggered",
            newman(NEWMAN["staggered_offset_deg"]),
            None,
        ),
        Template(
            "newman-eclipsed",
            "Newman",
            "Newman, eclipsed",
            newman(NEWMAN["eclipsed_offset_deg"]),
            None,
        ),
    ]


def expected(template: Template) -> dict:
    """What the app must make of the template once it is on the canvas."""
    drawing = template.drawing
    entry: dict = {
        "id": template.id,
        "source": template.source,
        "atoms": len(drawing.atoms),
        "bonds": len(drawing.bonds),
        "shapes": len(drawing.shapes),
        "texts": len(drawing.texts),
    }
    if drawing.atoms:
        mol = Chem.RemoveHs(drawing.mol())
        props = rdMolDescriptors.Properties()
        values = dict(zip(props.GetPropertyNames(), props.ComputeProperties(mol), strict=True))
        possible = ref.stereo_elements(mol, flag_possible=True)
        entry |= {
            "canonical_smiles": Chem.MolToSmiles(mol),
            "inchikey": Chem.MolToInchiKey(mol),
            "panel": ref.panel(mol, values, possible),
        }
    return entry


def dumped(data: dict) -> str:
    return json.dumps(data, indent=2, ensure_ascii=False) + "\n"


def generate() -> dict[Path, str]:
    """Both generated files, by path."""
    ref.configure()
    made = templates(read_smiles())
    menu = {
        "generator": GENERATOR,
        "rdkit_version": rdkit.__version__,
        "chair": CHAIR,
        "newman": NEWMAN,
        "templates": [
            {"id": t.id, "group": t.group, "name": t.name, "ket": t.drawing.ket()} for t in made
        ],
    }
    checks = {
        "generator": GENERATOR,
        "rdkit_version": rdkit.__version__,
        "templates": [expected(t) for t in made],
    }
    return {TEMPLATES_FILE: dumped(menu), EXPECTED_FILE: dumped(checks)}


def main() -> int:
    for path, text in generate().items():
        path.write_text(text, encoding="utf-8")
        print(f"wrote {path.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
