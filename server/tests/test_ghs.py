"""server/ghs.py on recorded PUG View answers: decision 2's choice and bar A.4's strictness
(docs/plans/v2-safety-snapshot.md). Each negative test changes one field of a recording in
memory; nothing here is typed chemistry."""

import copy
import json

import pytest

import ghs
import record_ghs as rec
from pubchem import Unavailable


def recording(name: str) -> dict:
    return json.loads(rec.recording_path(name).read_text(encoding="utf-8"))["body"]


ETHANOL = recording("ethanol")  # EU harmonised first, then ECHA, NITE-CMC, HCIS, HSDB
GLUCOSE = recording("glucose")  # ECHA's "Not Classified"


def items(body: dict) -> list[dict]:
    """Every Information item, walked here rather than with ghs.py."""

    def walk(sections):
        for section in sections:
            yield from section.get("Information", [])
            yield from walk(section.get("Section", []))

    return list(walk(body["Record"]["Section"]))


def source_of(body: dict, number: int) -> str:
    return next(
        r["SourceName"] for r in body["Record"]["Reference"] if r["ReferenceNumber"] == number
    )


def first_of(body: dict, source: str) -> int:
    return next(
        i["ReferenceNumber"] for i in items(body) if source_of(body, i["ReferenceNumber"]) == source
    )


def item(body: dict, number: int, name: str) -> dict:
    return next(i for i in items(body) if i["ReferenceNumber"] == number and i["Name"] == name)


def parts(info: dict) -> list[dict]:
    return info["Value"]["StringWithMarkup"]


def section(body: dict) -> dict:
    def find(sections):
        for s in sections:
            if s.get("TOCHeading") == ghs.HEADING:
                return s
            found = find(s.get("Section", []))
            if found:
                return found
        return None

    return find(body["Record"]["Section"])


def changed(body: dict, source: str, name: str, change) -> dict:
    """A copy of `body` with `change` applied to the item `name` of the first entry from
    `source`."""
    out = copy.deepcopy(body)
    change(item(out, first_of(out, source), name))
    return out


def without(body: dict, keep) -> dict:
    """A copy of `body` keeping only the GHS items for which keep(item) is true."""
    out = copy.deepcopy(body)
    found = section(out)
    found["Information"] = [i for i in found["Information"] if keep(out, i)]
    return out


def set_url(info, url):
    parts(info)[0]["Markup"][0]["URL"] = url


def pictogram_url(info):
    return parts(info)[0]["Markup"][0]["URL"]


BROKEN_CHOSEN = {
    "pictogram number out of range": (
        ghs.PICTOGRAMS,
        lambda i: set_url(i, pictogram_url(i).rsplit("/", 1)[0] + "/GHS10.svg"),
    ),
    "pictogram from another site": (
        ghs.PICTOGRAMS,
        lambda i: set_url(i, pictogram_url(i).replace("pubchem.ncbi.nlm.nih.gov", "example.org")),
    ),
    "pictogram without a name": (
        ghs.PICTOGRAMS,
        lambda i: parts(i)[0]["Markup"][0].update(Extra=""),
    ),
    "pictogram markup that isn't an icon": (
        ghs.PICTOGRAMS,
        lambda i: parts(i)[0]["Markup"][0].update(Type="Color"),
    ),
    "pictogram item with text": (
        ghs.PICTOGRAMS,
        lambda i: parts(i)[0].update(String="text"),
    ),
    "pictogram item with no markup": (
        ghs.PICTOGRAMS,
        lambda i: parts(i)[0].update(Markup=[]),
    ),
    "signal word not Danger or Warning": (
        ghs.SIGNAL,
        lambda i: parts(i)[0].update(String="Caution"),
    ),
    "two signal words": (
        ghs.SIGNAL,
        lambda i: parts(i).append(copy.deepcopy(parts(i)[0])),
    ),
    "statement without its colon": (
        ghs.STATEMENTS,
        lambda i: parts(i)[0].update(String=parts(i)[0]["String"].replace(": ", " ", 1)),
    ),
    "statement with a trailing space": (
        ghs.STATEMENTS,
        lambda i: parts(i)[0].update(String=parts(i)[0]["String"] + " "),
    ),
    "statement with a doubled space": (
        ghs.STATEMENTS,
        lambda i: parts(i)[0].update(String=parts(i)[0]["String"].replace(" ", "  ", 1)),
    ),
    "statement that isn't text": (
        ghs.STATEMENTS,
        lambda i: parts(i)[0].update(String=None),
    ),
    "no statements in the item": (
        ghs.STATEMENTS,
        lambda i: parts(i).clear(),
    ),
    "an item PubChem didn't have before": (
        ghs.SIGNAL,
        lambda i: i.update(Name="Hazard Classes and Categories"),
    ),
    "a value of another kind": (
        ghs.STATEMENTS,
        lambda i: i["Value"].update(Number=[1]),
    ),
}


@pytest.mark.parametrize("name, change", BROKEN_CHOSEN.values(), ids=list(BROKEN_CHOSEN))
def test_anything_unexpected_in_the_chosen_entry_is_unavailable(name, change):
    ghs.snapshot(ETHANOL)  # the recording itself reads
    with pytest.raises(Unavailable):
        ghs.snapshot(changed(ETHANOL, ghs.EU, name, change))


@pytest.mark.parametrize("name, change", BROKEN_CHOSEN.values(), ids=list(BROKEN_CHOSEN))
def test_the_same_change_to_an_entry_not_chosen_changes_nothing(name, change):
    sources = [r["SourceName"] for r in ETHANOL["Record"]["Reference"]]
    nite = next(s for s in sources if "NITE" in s)
    assert ghs.snapshot(changed(ETHANOL, nite, name, change)) == ghs.snapshot(ETHANOL)


def test_the_chosen_entry_needs_its_statements():
    eu = first_of(ETHANOL, ghs.EU)
    body = without(
        ETHANOL, lambda _, i: not (i["ReferenceNumber"] == eu and i["Name"] == ghs.STATEMENTS)
    )
    with pytest.raises(Unavailable):
        ghs.snapshot(body)


def test_not_classified_with_a_pictogram_or_signal_is_unavailable():
    echa = first_of(GLUCOSE, ghs.ECHA)
    for name in (ghs.PICTOGRAMS, ghs.SIGNAL):
        body = copy.deepcopy(GLUCOSE)
        borrowed = copy.deepcopy(item(ETHANOL, first_of(ETHANOL, ghs.EU), name))
        borrowed["ReferenceNumber"] = echa
        section(body)["Information"].append(borrowed)
        with pytest.raises(Unavailable):
            ghs.snapshot(body)


def test_an_item_without_its_reference_is_unavailable():
    body = copy.deepcopy(ETHANOL)
    section(body)["Information"][-1]["ReferenceNumber"] = (
        max(r["ReferenceNumber"] for r in body["Record"]["Reference"]) + 1
    )
    with pytest.raises(Unavailable):
        ghs.snapshot(body)


@pytest.mark.parametrize("key", ["Name", "URL", "SourceID"])
def test_a_reference_field_that_isnt_text_is_unavailable(key):
    body = copy.deepcopy(ETHANOL)
    eu = first_of(body, ghs.EU)
    next(r for r in body["Record"]["Reference"] if r["ReferenceNumber"] == eu)[key] = 1
    with pytest.raises(Unavailable):
        ghs.snapshot(body)


def test_a_200_without_a_ghs_section_or_with_an_empty_one_is_unavailable():
    # PubChem answers 404 for a compound with no GHS section (bar A.5), so these never read as
    # "PubChem lists none".
    renamed = copy.deepcopy(ETHANOL)
    section(renamed)["TOCHeading"] = "Something else"
    empty = without(ETHANOL, lambda *_: False)
    for body in (renamed, empty, {}, {"Record": []}, []):
        with pytest.raises(Unavailable):
            ghs.snapshot(body)


def test_the_eu_entry_wins_wherever_pubchem_lists_it():
    eu = first_of(ETHANOL, ghs.EU)
    body = copy.deepcopy(ETHANOL)
    info = section(body)["Information"]
    info.sort(key=lambda i: i["ReferenceNumber"] == eu)  # the EU items last
    assert ghs.snapshot(body).classification == ghs.snapshot(ETHANOL).classification


def test_without_an_eu_entry_echas_first_wins_and_without_either_the_first_listed():
    no_eu = without(ETHANOL, lambda b, i: source_of(b, i["ReferenceNumber"]) != ghs.EU)
    chosen = ghs.snapshot(no_eu).classification
    assert chosen.source == "echa"
    assert [s.text for s in chosen.statements] == [
        p["String"] for p in parts(item(no_eu, first_of(no_eu, ghs.ECHA), ghs.STATEMENTS))
    ]
    neither = without(no_eu, lambda b, i: source_of(b, i["ReferenceNumber"]) != ghs.ECHA)
    first = items(neither)[0]["ReferenceNumber"]
    chosen = ghs.snapshot(neither).classification
    assert chosen.source == "other"
    assert chosen.source_name == source_of(neither, first)
    assert [s.text for s in chosen.statements] == [
        p["String"] for p in parts(item(neither, first, ghs.STATEMENTS))
    ]
