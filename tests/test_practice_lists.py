"""Practice mode's lists (docs/plans/v2-practice-mode.md, bar A): the files the app ships and
the tests' fixtures rebuild from the recordings with the real OPSIN, every key is RDKit's for
the shipped answer, and a name that can't be a fair question is refused.
"""

import json

import pytest
from rdkit import Chem

import build_practice_lists as build
import record_name_lookups as lookups
from pubchem import STRUCTURE_URL

APP = json.loads(build.APP_FILE.read_text(encoding="utf-8"))
TEST = json.loads(build.TEST_LISTS_FILE.read_text(encoding="utf-8"))
RESPONSES = json.loads(lookups.RESPONSES_FILE.read_text(encoding="utf-8"))["responses"]
ITEMS = [item for data in (APP, TEST) for lst in data["lists"] for item in lst["names"]]


def test_app_lists_rebuild_from_the_recordings():
    built = build.build_lists(build.app_names_files(), lookups.all_recordings())
    assert built == build.APP_FILE.read_text(encoding="utf-8")


def test_test_list_rebuilds_from_the_recordings():
    built = build.build_lists([build.read_names(build.TEST_NAMES_FILE)], lookups.all_recordings())
    assert built == build.TEST_LISTS_FILE.read_text(encoding="utf-8")


def test_hint_cases_rebuild_with_the_real_opsin():
    assert build.build_cases() == build.CASES_FILE.read_text(encoding="utf-8")


def test_the_provisional_chem_311_list():
    (only,) = APP["lists"]
    assert only["id"] == "chem-311"
    assert only["title"] == "CHEM-311 (provisional)"
    systematic = [n for kind, n in lookups.read_names() if kind == "systematic"]
    wanted = [n for n in systematic if n != "4-methyl-3-pentanol"]
    assert [i["name"] for i in only["names"]] == wanted


@pytest.mark.parametrize("name", build.every_name())
def test_each_name_has_the_lookup_the_server_makes_recorded(name):
    recording = json.loads(lookups.byname_path(name).read_text(encoding="utf-8"))
    assert recording["request"] == {"method": "POST", "url": STRUCTURE_URL, "form": {"name": name}}
    assert recording["status"] in (200, 404)


@pytest.mark.parametrize("item", ITEMS, ids=[i["name"] for i in ITEMS])
def test_keys_formula_and_components_are_rdkits_for_the_shipped_answer(item):
    mol = Chem.MolFromMolBlock(item["molfile"])
    key = Chem.MolToInchiKey(mol)
    if item["stereo"] == "checked":
        assert key == item["keys"][0]
        assert item["keys"][1:] in ([], [Chem.MolToInchiKey(build.mirror_image(mol))])
    else:
        # Drawn as laid out: only the skeleton and the protonation letter count.
        assert len(item["keys"]) == 1
        assert (key[:14], key[-1]) == (item["keys"][0][:14], item["keys"][0][-1])
    assert item["formula"] == build.formula_of(Chem.MolToInchi(mol))
    assert item["components"] == build.components(item["formula"])
    # Every answer is one Indigo can make a key for: no crossed ("either") double bond.
    assert not [b for b in mol.GetBonds() if b.GetStereo() == Chem.BondStereo.STEREOANY]


def test_the_test_list_covers_each_stereo_rule():
    items = {i["name"]: i for i in TEST["lists"][0]["names"]}
    assert {i["stereo"] for i in items.values()} == {"checked", "unchecked", "none"}
    assert len(items["trans-1,2-dimethylcyclohexane"]["keys"]) == 2
    assert len(items["(R)-butan-2-ol"]["keys"]) == 1
    assert items["pent-2-ene"]["stereo"] == "unchecked"
    for case in json.loads(build.CASES_FILE.read_text(encoding="utf-8"))["cases"]:
        assert case["asked"] in items


@pytest.mark.parametrize(
    "name, stated",
    [
        ("(R)-butan-2-ol", "absolute"),
        ("(2R,3S)-2-bromo-3-chlorobutane", "absolute"),
        ("(4aS)-x", "absolute"),
        ("L-alanine", "absolute"),
        ("N-acetyl-L-cysteine", "absolute"),
        ("(2E,4R)-x", "absolute"),
        ("(E)-pent-2-ene", "relative"),
        ("(2Z)-x", "relative"),
        ("cis-but-2-ene", "relative"),
        ("trans-1,2-dimethylcyclohexane", "relative"),
        ("rel-(1R,2S)-x", "relative"),
        ("(1R*,2S*)-x", "relative"),
        ("butan-2-ol", None),
        ("alanine", None),
        ("nicotine", None),
        ("S-methyl ethanethioate", None),
        ("N,N-dimethylacetamide", None),
    ],
)
def test_which_names_state_their_stereo(name, stated):
    assert build.stated_stereo(name) == stated


@pytest.mark.parametrize("formula, parts", [("C4H10O", 1), ("C2H6O.CH4", 2), ("2Na.C2H2O4", 3)])
def test_components_of_an_inchi_formula(formula, parts):
    assert build.components(formula) == parts


def answer(name: str, **changes) -> dict:
    """The server's recorded answer for a Name to structure test name, changed."""
    return {**RESPONSES[name]["structure"], **changes}


def test_refused_a_name_no_one_can_draw():
    with pytest.raises(build.Refused, match="neither OPSIN nor PubChem"):
        build.practice_item("x", {"found": False}, None)


def test_refused_a_name_pubchem_has_several_records_for():
    several = answer("caffeine", source="PubChem", matches=2)
    with pytest.raises(build.Refused, match="2 records"):
        build.practice_item("caffeine", several, None)


def test_refused_when_opsin_and_pubchem_disagree_on_the_skeleton():
    other = build.pubchem_record("3-methylbutanal")
    with pytest.raises(build.Refused, match="different compounds"):
        build.practice_item("(R)-butan-2-ol", answer("(R)-butan-2-ol"), other)


def test_refused_a_name_that_states_part_of_its_stereo():
    name = "(2R,3S)-2-bromo-3-chlorobutane"
    mol = Chem.MolFromSmiles(answer(name)["smiles"])
    centre = next(a for a in mol.GetAtoms() if a.GetChiralTag() != Chem.CHI_UNSPECIFIED)
    centre.SetChiralTag(Chem.CHI_UNSPECIFIED)
    partial = answer(name, smiles=Chem.MolToSmiles(mol))
    with pytest.raises(build.Refused, match="only part"):
        build.practice_item(name, partial, None)


def test_refused_a_stated_name_whose_stereo_came_from_pubchem():
    filled = answer("(R)-butan-2-ol", stereo_from_pubchem=True)
    with pytest.raises(build.Refused, match="only part"):
        build.practice_item("(R)-butan-2-ol", filled, None)


def test_a_name_without_descriptors_has_its_stereo_unchecked():
    # Name to structure takes nicotine's stereo from PubChem; the name itself states none.
    item = build.practice_item("nicotine", answer("nicotine"), build.pubchem_record("nicotine"))
    assert RESPONSES["nicotine"]["structure"]["stereo_from_pubchem"] is True
    assert item["stereo"] == "unchecked"


@pytest.mark.parametrize(
    "text, problem",
    [
        ("(R)-butan-2-ol\n", "first line must be"),
        ("title: x\n(R)-butan-2-ol\n(R)-butan-2-ol\n", "listed twice"),
        ("title: x\n# no names\n", "at least one name"),
    ],
)
def test_refused_a_bad_names_file(tmp_path, text, problem):
    path = tmp_path / "list.txt"
    path.write_text(text, encoding="utf-8")
    with pytest.raises(build.Refused, match=problem):
        build.read_names(path)
