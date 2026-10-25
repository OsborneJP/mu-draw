"""The drawing templates (docs/plans/v2-templates.md, bar A) are generated, never typed, and
are what they claim to be.

web/src/editor/templates.json and tests/fixtures/templates_expected.json must equal what
server/scripts/gen_templates.py makes now from the PubChem recordings and the pinned RDKit.
"""

import json

import numpy as np
import pytest
from rdkit import Chem
from rdkit.Geometry import Point3D

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


NEWMANS = {"newman-staggered": 60.0, "newman-eclipsed": 20.0}


def directions(lines: list[dict]) -> list[float]:
    """Each line's direction, in degrees from its end nearer the centre."""
    angles = []
    for line in lines:
        near, far = sorted((np.array(p) for p in line["points"]), key=np.linalg.norm)
        angles.append(float(np.degrees(np.arctan2(*(far - near)[::-1])) % 360))
    return angles


def test_newmans_are_pictures_with_six_labelled_positions(made):
    for name in NEWMANS:
        drawing = made[name].drawing
        assert made[name].source is None
        assert (drawing.atoms, drawing.bonds) == ([], [])
        assert sorted(s["mode"] for s in drawing.shapes) == ["ellipse"] + ["line"] * 6
        assert [t["text"] for t in drawing.texts] == ["H"] * 6


def test_a_newman_is_held_by_its_centre(made):
    # Ketcher's paste tool holds a drawing without atoms by its first shape's first point
    # (an ellipse's is a corner), so the first shape is a front bond from the centre.
    for name in NEWMANS:
        first = made[name].drawing.shapes[0]
        assert first["mode"] == "line"
        assert first["points"][0] == pytest.approx((0, 0)), name


def test_newman_front_bonds_meet_at_the_centre_and_back_bonds_start_on_the_circle(made):
    for name, offset in NEWMANS.items():
        drawing = made[name].drawing
        (circle,) = (s for s in drawing.shapes if s["mode"] == "ellipse")
        (a, b) = (np.array(p) for p in circle["points"])
        centre, radius = (a + b) / 2, (b - a)[0] / 2
        assert (b - a)[0] == pytest.approx((b - a)[1])  # a circle
        lines = [s for s in drawing.shapes if s["mode"] == "line"]
        starts = [min(np.linalg.norm(np.array(p) - centre) for p in s["points"]) for s in lines]
        front = [s for s, r in zip(lines, starts, strict=True) if r == pytest.approx(0, abs=1e-6)]
        back = [s for s, r in zip(lines, starts, strict=True) if r == pytest.approx(radius)]
        assert len(front) == len(back) == 3, name
        front_angles, back_angles = sorted(directions(front)), sorted(directions(back))
        assert np.diff(front_angles) == pytest.approx([120, 120]), name
        assert np.diff(back_angles) == pytest.approx([120, 120]), name
        turned = sorted((f + offset) % 360 for f in front_angles)
        assert back_angles == pytest.approx(turned), name


def test_newman_labels_sit_beyond_the_bond_ends(made):
    for name in NEWMANS:
        drawing = made[name].drawing
        lines = [s for s in drawing.shapes if s["mode"] == "line"]
        ends = [max((np.array(p) for p in s["points"]), key=np.linalg.norm) for s in lines]
        for end, label in zip(ends, drawing.texts, strict=True):
            at = np.array(label["xy"])
            assert angle(at, end) < 1e-6 and np.linalg.norm(at) > np.linalg.norm(end), name


FISCHER_SKELETONS = {"fischer-1": 1, "fischer-2": 2, "fischer-4": 4}


def test_fischer_glucose_is_pubchem_aldehydo_d_glucose_with_its_stereo(made):
    template = made["fischer-d-glucose"]
    assert template.source == "aldehydo-D-glucose"
    assert Chem.MolToInchiKey(template.drawing.mol()) == pubchem_inchikey("aldehydo-D-glucose")


def test_fischer_horizontal_bonds_are_wedges_and_vertical_bonds_are_plain(made):
    for name in [*FISCHER_SKELETONS, "fischer-d-glucose"]:
        drawing = made[name].drawing
        points = xy(drawing)
        crosses = 0
        for bond in drawing.bonds:
            i, j = bond["atoms"]
            d = points[j] - points[i]
            if bond["wedge"]:
                assert d[1] == pytest.approx(0), name  # horizontal
                crosses += 1
            elif abs(d[0]) < 1e-9:
                assert not bond["wedge"]
        assert crosses == 2 * FISCHER_SKELETONS.get(name, 4), name


def test_fischer_glucose_without_its_wedges_has_no_stereo(made):
    # The wedges carry the stereo: plain crosses would leave every centre undefined.
    drawing = made["fischer-d-glucose"].drawing
    plain = gen.Drawing(drawing.atoms, [b | {"wedge": False} for b in drawing.bonds])
    mol = plain.mol()
    assert Chem.FindMolChiralCenters(mol, includeUnassigned=True, useLegacyImplementation=False)
    assert not Chem.FindMolChiralCenters(mol, useLegacyImplementation=False)


def test_fischer_skeletons_have_a_cross_per_stereocentre(made):
    for name, centres in FISCHER_SKELETONS.items():
        template = made[name]
        assert template.source is None
        assert len(template.drawing.atoms) == 3 * centres + 2, name


def test_a_relabelled_fischer_skeleton_is_read_the_fischer_way(made):
    # Four different groups on the one-centre cross give a defined stereocentre because the
    # horizontal bonds are wedges; with plain bonds it would be undefined.
    drawing = made["fischer-1"].drawing
    ends = [i for i, a in enumerate(drawing.atoms) if i != 1]  # atom 1 is the centre
    labelled = [dict(a) for a in drawing.atoms]
    for end, label in zip(ends, ("F", "Cl", "Br", "I"), strict=True):
        labelled[end]["label"] = label
    wedged = gen.Drawing(labelled, drawing.bonds)
    plain = gen.Drawing(labelled, [b | {"wedge": False} for b in drawing.bonds])
    assert len(Chem.FindMolChiralCenters(wedged.mol(), useLegacyImplementation=False)) == 1
    assert not Chem.FindMolChiralCenters(plain.mol(), useLegacyImplementation=False)


HAWORTH_SUGARS = {
    "haworth-alpha-d-glucopyranose": "alpha-D-glucopyranose",
    "haworth-beta-d-glucopyranose": "beta-D-glucopyranose",
}


def rebuilt_in_3d(drawing: gen.Drawing) -> str:
    """A Haworth projection read as a model: the ring flat, each ring atom's height on the
    page as its depth (higher is further back), and each group straight up or down from its
    ring atom, splayed a little outward as real ones are. RDKit's stereo from that model, as
    canonical SMILES."""
    mol = drawing.mol()
    (ring,) = (list(r) for r in mol.GetRingInfo().AtomRings())
    anchor = {i: i for i in ring}  # each atom's ring atom
    frontier = list(ring)
    while frontier:
        reached = []
        for i in frontier:
            for n in mol.GetAtomWithIdx(i).GetNeighbors():
                if n.GetIdx() not in anchor:
                    anchor[n.GetIdx()] = anchor[i]
                    reached.append(n.GetIdx())
        frontier = reached
    points = xy(drawing)
    flat = {i: np.array([points[i][0], 0.0, -2 * points[i][1]]) for i in ring}
    middle = np.mean(list(flat.values()), axis=0)
    conformer = Chem.Conformer(mol.GetNumAtoms())
    conformer.Set3D(True)
    for i in range(mol.GetNumAtoms()):
        a = anchor[i]
        outward = (flat[a] - middle) / np.linalg.norm(flat[a] - middle)
        at = flat[a]
        if i != a:
            at = at + np.array([0.0, points[i][1] - points[a][1], 0.0]) + 0.3 * outward
        conformer.SetAtomPosition(i, Point3D(*map(float, at)))
    mol.RemoveAllConformers()
    mol.AddConformer(conformer, assignId=True)
    Chem.AssignStereochemistryFrom3D(mol)
    return Chem.MolToSmiles(Chem.RemoveHs(mol))


def pubchem_smiles(typed_name: str) -> str:
    return Chem.MolToSmiles(Chem.MolFromSmiles(gen.read_smiles()[typed_name]))


def test_haworth_sugars_rebuilt_in_3d_are_pubchems_anomers(made):
    for name, source in HAWORTH_SUGARS.items():
        assert made[name].source == source
        assert rebuilt_in_3d(made[name].drawing) == pubchem_smiles(source), name


def test_the_3d_rebuild_tells_the_anomers_apart(made):
    # Negative control: each anomer's drawing is not the other's.
    alpha, beta = HAWORTH_SUGARS
    assert rebuilt_in_3d(made[alpha].drawing) != pubchem_smiles(HAWORTH_SUGARS[beta])
    assert rebuilt_in_3d(made[beta].drawing) != pubchem_smiles(HAWORTH_SUGARS[alpha])


def test_haworths_have_plain_bonds_and_read_with_every_centre_undefined(made):
    for name in [*HAWORTH_SUGARS, "haworth-pyranose", "haworth-furanose"]:
        drawing = made[name].drawing
        assert not any(b["wedge"] for b in drawing.bonds), name
        mol = drawing.mol()
        assert not Chem.FindMolChiralCenters(mol, useLegacyImplementation=False), name
    for name, source in HAWORTH_SUGARS.items():
        mol = Chem.RemoveHs(made[name].drawing.mol())
        expected = Chem.MolFromSmiles(gen.read_smiles()[source])
        Chem.RemoveStereochemistry(expected)
        assert Chem.MolToSmiles(mol) == Chem.MolToSmiles(expected), name


def test_haworth_groups_are_straight_up_or_down_from_the_ring(made):
    for name in [*HAWORTH_SUGARS, "haworth-pyranose", "haworth-furanose"]:
        drawing = made[name].drawing
        points = xy(drawing)
        mol = drawing.mol()
        (ring,) = (list(r) for r in mol.GetRingInfo().AtomRings())
        for atom in ring:
            for n in mol.GetAtomWithIdx(atom).GetNeighbors():
                if n.GetIdx() in ring:
                    continue
                d = points[n.GetIdx()] - points[atom]
                assert d[0] == pytest.approx(0) and abs(d[1]) > 0, name


def test_haworth_bonds_keep_clear_of_other_atoms(made):
    # On a regular flattened hexagon a front carbon's bond pointing up ran through the label
    # of the back carbon's group pointing down; the perspective ring keeps them apart.
    for name in [*HAWORTH_SUGARS, "haworth-pyranose", "haworth-furanose"]:
        drawing = made[name].drawing
        points = xy(drawing)
        for bond in drawing.bonds:
            i, j = bond["atoms"]
            a, b = points[i], points[j]
            for k, p in enumerate(points):
                if k in (i, j):
                    continue
                t = np.clip((p - a) @ (b - a) / ((b - a) @ (b - a)), 0, 1)
                assert np.linalg.norm(p - (a + t * (b - a))) >= 0.2, (name, k, i, j)
