from pathlib import Path

import pytest

from checks.chem_literals import find

# Built by concatenation so this test file does not trip the check itself.
MOLFILE_MARKER = "V" + "2000"
CDXML_MARKER = "<" + "CDXML"
INCHI_MARKER = "InChI" + "=1S/"
INCHIKEY_LIKE = "A" * 14 + "-" + "B" * 10 + "-N"


@pytest.mark.parametrize("literal", [MOLFILE_MARKER, CDXML_MARKER, INCHI_MARKER, INCHIKEY_LIKE])
def test_literal_in_source_fails(repo: Path, literal: str):
    (repo / "test_x.py").write_text(f"EXPECTED = '{literal}'\n")
    assert len(find(repo)) == 1


def test_fixture_dir_and_non_source_are_exempt(repo: Path):
    fixtures = repo / "tests" / "fixtures"
    fixtures.mkdir(parents=True)
    (fixtures / "gen.py").write_text(f"'{MOLFILE_MARKER}'\n")
    (repo / "notes.txt").write_text(f"{CDXML_MARKER}\n")
    assert find(repo) == []


def test_ok_tag_needs_a_reason(repo: Path):
    (repo / "a.ts").write_text(f"'{MOLFILE_MARKER}' // chem-literal-ok: format sniffing\n")
    (repo / "b.ts").write_text(f"'{MOLFILE_MARKER}' // chem-literal-ok:\n")
    problems = find(repo)
    assert len(problems) == 1
    assert problems[0].startswith("b.ts:1:")
