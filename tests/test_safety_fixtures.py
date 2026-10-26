"""Safety's recorded PubChem answers and the server answers built from them
(docs/plans/v2-safety-snapshot.md, bar A.1 to A.3). The expected answers are read from the
raw recordings with a walk of their own here, not with server/ghs.py."""

import json

import httpx
import pytest

import ghs
import record_ghs as rec
from pubchem import COMPOUND_PAGE, GHS_PARAMS, GHS_URL

COMPOUNDS = rec.test_compounds()
RESPONSES = json.loads(rec.RESPONSES_FILE.read_text(encoding="utf-8"))["responses"]
WITH_RECORD = [c for c in COMPOUNDS if rec.cid(c) != 0]


def recording(c: dict[str, str]) -> dict:
    return json.loads(rec.recording_path(c["name"]).read_text(encoding="utf-8"))


def raw_entries(body: dict) -> list[tuple[dict, dict[str, list[dict]]]]:
    """(reference, {item name: StringWithMarkup parts}) per entry, in PubChem's order."""
    references = {r["ReferenceNumber"]: r for r in body["Record"]["Reference"]}
    order: dict[int, dict[str, list[dict]]] = {}

    def walk(sections):
        for section in sections:
            for info in section.get("Information", []):
                entry = order.setdefault(info["ReferenceNumber"], {})
                entry[info["Name"]] = info["Value"]["StringWithMarkup"]
            walk(section.get("Section", []))

    walk(body["Record"]["Section"])
    return [(references[number], found) for number, found in order.items()]


def expected_pick(entries) -> int:
    names = [reference["SourceName"] for reference, _ in entries]
    for source in (ghs.EU, ghs.ECHA):
        if source in names:
            return names.index(source)
    return 0


def test_one_ghs_recording_per_compound_with_a_record():
    wanted = {rec.recording_path(c["name"]).name for c in WITH_RECORD}
    assert {p.name for p in rec.RECORDINGS.glob("ghs-*.json")} == wanted
    assert len(WITH_RECORD) < len(COMPOUNDS)  # one has no PubChem record


@pytest.mark.parametrize("c", WITH_RECORD, ids=lambda c: c["name"])
def test_recordings_are_what_the_server_sends(c):
    r = recording(c)
    url = str(httpx.URL(GHS_URL.format(cid=rec.cid(c)), params=GHS_PARAMS))
    assert r["request"] == {"method": "GET", "url": url, "form": {}}
    assert r["status"] == 200 or (r["status"], r["body"]["Fault"]["Code"]) == (404, rec.NONE)


def test_responses_rebuild_from_recordings():
    built = rec.build_responses(COMPOUNDS, rec.load_recordings(COMPOUNDS))
    assert built == rec.RESPONSES_FILE.read_text(encoding="utf-8")


def test_every_outcome_has_a_test_compound():
    sources = {(r["classification"] or {}).get("source") for r in RESPONSES.values() if r["found"]}
    assert {"eu", "echa", None} <= sources
    assert any(not r["found"] for r in RESPONSES.values())
    classified = [r["classification"] for r in RESPONSES.values() if r["classification"]]
    assert any(c["not_classified"] for c in classified)
    assert any(r["others"]["count"] > 0 for r in RESPONSES.values())


@pytest.mark.parametrize("c", COMPOUNDS, ids=lambda c: c["name"])
def test_the_answer_names_the_record(c):
    r, cid = RESPONSES[c["name"]], rec.cid(c)
    if cid == 0:
        assert r["found"] is False and r["cid"] is None and r["classification"] is None
        return
    title = json.loads(rec.names.recording_path(c["name"]).read_text("utf-8"))["body"][
        "PropertyTable"
    ]["Properties"][0]["Title"]
    assert (r["found"], r["cid"], r["title"]) == (True, cid, title)
    assert r["url"] == COMPOUND_PAGE.format(cid=cid)


@pytest.mark.parametrize("c", WITH_RECORD, ids=lambda c: c["name"])
def test_the_chosen_classification_and_the_others(c):
    answer, body = RESPONSES[c["name"]], recording(c)["body"]
    if recording(c)["status"] == 404:
        assert answer["classification"] is None
        assert answer["others"] == {"count": 0, "sources": []}
        return
    entries = raw_entries(body)
    pick = expected_pick(entries)
    reference, parts = entries[pick]
    chosen = answer["classification"]
    kind = {ghs.EU: "eu", ghs.ECHA: "echa"}.get(reference["SourceName"], "other")
    assert chosen["source"] == kind
    assert chosen["source_name"] == reference["SourceName"]
    assert chosen["entry"] == reference.get("Name")
    assert chosen["source_url"] == reference.get("URL")
    # The Annex VI index number, without the "[2]" PubChem adds to tell entries apart.
    index_no = reference["SourceID"].split("[")[0] if kind == "eu" else None
    assert chosen["index_no"] == index_no
    others = [ref["SourceName"] for i, (ref, _) in enumerate(entries) if i != pick]
    assert answer["others"] == {"count": len(others), "sources": list(dict.fromkeys(others))}

    # Nothing lost or invented (bar A.3): PubChem's strings, joined back.
    def strings(name):
        return [p["String"] for p in parts.get(name, [])]

    statements = strings(ghs.STATEMENTS)
    joined = [ghs.Statement(**s).text for s in chosen["statements"]]
    if chosen["not_classified"]:
        assert statements[0] == ghs.NOT_CLASSIFIED and joined == []
        assert chosen["notes"] == strings(ghs.NOTE) + statements[1:]
    else:
        assert joined == statements
        assert chosen["notes"] == strings(ghs.NOTE)
    assert chosen["summary"] == strings(ghs.SUMMARY)
    assert chosen["signal"] == (strings(ghs.SIGNAL) or [None])[0]
    icons = [m for p in parts.get(ghs.PICTOGRAMS, []) for m in p.get("Markup", [])]
    assert chosen["pictograms"] == [
        {"code": m["URL"].rsplit("/", 1)[1].removesuffix(".svg"), "name": m["Extra"]} for m in icons
    ]


@pytest.mark.parametrize("c", WITH_RECORD, ids=lambda c: c["name"])
def test_every_recorded_classification_reads(c):
    # Not only the chosen ones: a re-recording that PubChem changed shows up here first.
    r = recording(c)
    if r["status"] == 200:
        for entry in ghs.entries(r["body"]):
            ghs.read(entry)
