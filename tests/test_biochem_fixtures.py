"""The biochem tools' pKa table and peptide references (docs/plans/v2-biochem.md, bar A.1) are
generated, never typed: web/src/chem/biochemData.json and
tests/fixtures/biochem_peptides_expected.json must equal what
server/scripts/gen_biochem_expected.py makes now with the pinned Biopython.
"""

import json

import Bio
import pytest

import gen_biochem_expected as gen
from test_reference_fixtures import locked_version


@pytest.fixture(scope="module")
def generated() -> dict:
    return gen.generate()


def test_generated_files_match_committed(generated):
    for path, text in generated.items():
        assert path.read_text(encoding="utf-8") == text, path.name


def test_biopython_is_the_locked_release():
    assert Bio.__version__ == locked_version("biopython")


def test_every_residue_alone_first_and_last_is_tested():
    data = json.loads(gen.DATA_FILE.read_text(encoding="utf-8"))
    sequences = {p["sequence"] for p in gen.test_peptides(gen.read_inputs())}
    for residue in data["residues"]:
        assert {residue, f"{residue}G", f"G{residue}"} <= sequences, residue


def test_some_answers_lie_on_biopythons_bracket_and_some_inside():
    # Bar A.4 compares the app's pI with Biopython's only inside the bracket; both kinds of
    # peptide must be there, or one half of that test would check nothing.
    expected = json.loads(gen.EXPECTED_FILE.read_text(encoding="utf-8"))
    edges = [p["pIAtBracketEdge"] for p in expected["peptides"]]
    assert any(edges) and not all(edges)
