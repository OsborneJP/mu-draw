"""The drawing templates (docs/plans/v2-templates.md, bar A) are generated, never typed, and
are what they claim to be.

web/src/editor/templates.json and tests/fixtures/templates_expected.json must equal what
server/scripts/gen_templates.py makes now from the PubChem recordings and the pinned RDKit.
"""

import json

import numpy as np
import pytest
from rdkit import Chem

import gen_templates as gen
from test_reference_fixtures import locked_version

CHAIRS = ("chair", "chair-flipped")


@pytest.fixture(scope="module")
def generated() -> dict:
    return gen.generate()


@pytest.fixture(scope="module")
def made() -> dict[str, gen.Template]:
    gen.ref.configure()
    return {t.id: t for t in gen.templates(gen.read_smiles())}


def pubchem_inchikey(typed_name: str) -> str:
    return Chem.MolToInchiKey(Chem.MolFromSmiles(gen.read_smiles()[typed_name]))


def angle(u: np.ndarray, v: np.ndarray) -> float:
    """Degrees between two lines (direction ignored)."""
    cos = abs(u @ v) / (np.linalg.norm(u) * np.linalg.norm(v))
    return float(np.degrees(np.arccos(min(1.0, cos))))


def xy(drawing: gen.Drawing) -> np.ndarray:
    return np.array([a["xy"] for a in drawing.atoms])


def ring_and_hydrogens(drawing: gen.Drawing) -> tuple[list[int], dict[int, list[int]]]:
    mol = drawing.mol()
    (ring,) = (list(r) for r in mol.GetRingInfo().AtomRings())
    hydrogens = {
        c: [n.GetIdx() for n in mol.GetAtomWithIdx(c).GetNeighbors() if n.GetSymbol() == "H"]
        for c in ring
    }
    return ring, hydrogens


def test_generated_files_match_committed(generated):
    for path, text in generated.items():
        assert path.read_text(encoding="utf-8") == text, path.name


def test_generated_by_the_pinned_rdkit(generated):
    for text in generated.values():
        assert json.loads(text)["rdkit_version"] == locked_version("rdkit")


def test_ids_are_unique_and_every_template_is_checked(generated):
    menu = json.loads(generated[gen.TEMPLATES_FILE])["templates"]
    checks = json.loads(generated[gen.EXPECTED_FILE])["templates"]
    ids = [t["id"] for t in menu]
    assert len(set(ids)) == len(ids)
    assert [c["id"] for c in checks] == ids


def test_chairs_are_pubchem_cyclohexane(made):
    for name in CHAIRS:
        assert made[name].source == "cyclohexane"
        assert Chem.MolToInchiKey(made[name].drawing.mol()) == pubchem_inchikey("cyclohexane")


def test_chair_axial_bonds_are_vertical_and_alternate(made):
    for name in CHAIRS:
        drawing = made[name].drawing
        points = xy(drawing)
        ring, hydrogens = ring_and_hydrogens(drawing)
        sides = []
        for carbon in ring:
            bonds = [points[h] - points[carbon] for h in hydrogens[carbon]]
            axial = min(bonds, key=lambda b: angle(b, np.array([0.0, 1.0])))
            assert angle(axial, np.array([0.0, 1.0])) < 1, name
            sides.append(np.sign(axial[1]))
        assert all(sides[k] == -sides[k - 1] for k in range(6)), name


def test_chair_equatorial_bonds_are_parallel_to_the_ring_bonds_one_removed(made):
    for name in CHAIRS:
        drawing = made[name].drawing
        points = xy(drawing)
        ring, hydrogens = ring_and_hydrogens(drawing)
        for k, carbon in enumerate(ring):
            bonds = [points[h] - points[carbon] for h in hydrogens[carbon]]
            equatorial = max(bonds, key=lambda b: angle(b, np.array([0.0, 1.0])))
            for a, b in ((k + 1, k + 2), (k - 1, k - 2)):
                ring_bond = points[ring[b % 6]] - points[ring[a % 6]]
                assert angle(equatorial, ring_bond) < 5, name


def test_the_textbook_directions_are_close_to_rdkits_real_chair():
    # The chair's hydrogens are drawn in the textbook directions (gen.chair_hydrogens);
    # RDKit's real chair must be within a few degrees of them.
    gen.ref.configure()
    mol = Chem.AddHs(Chem.MolFromSmiles(gen.read_smiles()["cyclohexane"]))
    (ring,) = (list(r) for r in mol.GetRingInfo().AtomRings())
    pos = gen.lowest_energy_conformer(mol)
    directions = gen.chair_hydrogens(mol, pos, ring)
    assert len(directions) == 12
    for hydrogen, direction in directions.items():
        (carbon,) = (n.GetIdx() for n in mol.GetAtomWithIdx(hydrogen).GetNeighbors())
        real = pos[hydrogen] - pos[carbon]
        assert real @ direction > 0
        assert angle(real, direction) < 5


def test_the_flipped_chair_is_the_mirror_image(made):
    chair, flipped = xy(made["chair"].drawing), xy(made["chair-flipped"].drawing)
    assert np.allclose(flipped, chair * [-1, 1])

    def left_tip_lower(points: np.ndarray, ring: list[int]) -> bool:
        left, right = (ring[int(f(points[ring, 0]))] for f in (np.argmin, np.argmax))
        return points[left, 1] < points[right, 1]

    ring, _ = ring_and_hydrogens(made["chair"].drawing)
    assert left_tip_lower(chair, ring)
    assert not left_tip_lower(flipped, ring)
