"""docs/v1-hand-checks.md is rendered from the fixtures and the app's own messages."""

import copy
import json

import build_hand_checks as bhc
import pytest

REFERENCE = json.loads((bhc.FIXTURES / "reference_expected.json").read_text(encoding="utf-8"))
NAMES = json.loads((bhc.FIXTURES / "name_responses.json").read_text(encoding="utf-8"))
URL = "https://example.org/app/"


def test_sheet_is_up_to_date():
    assert bhc.DOC.read_text(encoding="utf-8") == bhc.current(), (
        "run: python scripts/build_hand_checks.py"
    )


def test_get_name_lists_the_20_compounds_get_names_tests_name_first():
    lines = (bhc.FIXTURES / "reference_names.txt").read_text(encoding="utf-8").splitlines()
    names = [line for line in lines if line and not line.startswith("#")]
    assert bhc.GET_NAME == tuple(names[:20])


def test_refuses_a_compound_the_fixtures_lack():
    reference = copy.deepcopy(REFERENCE)
    reference["compounds"] = [c for c in reference["compounds"] if c["typed_name"] != "aspirin"]
    with pytest.raises(ValueError, match="aspirin"):
        bhc.render(reference, NAMES, bhc.messages(), URL)


def test_refuses_an_invented_structure_pubchem_named():
    names = copy.deepcopy(NAMES)
    invented = REFERENCE["invented"][0]["name"]
    names["responses"][invented] = names["responses"]["aspirin"]
    with pytest.raises(ValueError, match="not found"):
        bhc.render(REFERENCE, names, bhc.messages(), URL)


def test_refuses_when_the_app_no_longer_has_a_message(tmp_path):
    source = tmp_path / "naming.ts"
    source.write_text("export const NAME_MESSAGES = {};\n", encoding="utf-8")
    with pytest.raises(ValueError):
        bhc.app_text(source, r"'not-found': '((?:[^'\\]|\\.)*)'")


def test_quotes_a_message_with_an_apostrophe_as_the_app_shows_it(tmp_path):
    source = tmp_path / "naming.ts"
    source.write_text("const OFFLINE = 'Can\\'t reach it';\n", encoding="utf-8")
    assert bhc.app_text(source, r"const OFFLINE = '((?:[^'\\]|\\.)*)'") == "Can't reach it"
