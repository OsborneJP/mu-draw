"""PubChem's GHS hazard classifications (PUG View, heading "GHS Classification"), read for the
safety snapshot (docs/plans/v2-safety-snapshot.md).

PubChem lists one classification per source entry: a run of `Information` items that share a
`ReferenceNumber`, in its own order (the EU harmonised entry first, then ECHA's notified ones by
company reports, then NITE-CMC, HCIS, HSDB). The snapshot shows one of them, never a merge
(decision 2): the first EU harmonised entry, else the first ECHA entry, else the first.

Only the chosen entry is read in full, and strictly: anything unexpected in it means the answer
is unavailable, so a partial hazard list is never shown. Every value is PubChem's own text;
nothing here adds or rewords a hazard. Precautionary statements are left out (decision 8).
"""

from __future__ import annotations

import re
from dataclasses import asdict, dataclass

from pubchem import Unavailable

HEADING = "GHS Classification"
EU = "Regulation (EC) No 1272/2008 of the European Parliament and of the Council"
ECHA = "European Chemicals Agency (ECHA)"
PICTOGRAMS = "Pictogram(s)"
SIGNAL = "Signal"
STATEMENTS = "GHS Hazard Statements"
PRECAUTIONS = "Precautionary Statement Codes"
NOTE = "Note"
SUMMARY = "ECHA C&L Notifications Summary"
ITEMS = frozenset({PICTOGRAMS, SIGNAL, STATEMENTS, PRECAUTIONS, NOTE, SUMMARY})
SIGNAL_WORDS = frozenset({"Danger", "Warning"})
NOT_CLASSIFIED = "Not Classified"
PICTOGRAM_URL = re.compile(r"https://pubchem\.ncbi\.nlm\.nih\.gov/images/ghs/(GHS0[1-9])\.svg")
_CODE = r"(?:EU)?H\d{3}[A-Za-z]*"
# "H225: words [class]", "H319 (37.7%): …", "H373 **: …", "H301+H311 (100%): …". A full match
# means the parts, joined back (Statement.text), are PubChem's string exactly.
STATEMENT = re.compile(
    rf"(?P<code>{_CODE}(?:\+{_CODE})*)"
    r"(?: (?P<annex_note>\*{1,3}))?"
    r"(?: \((?P<share>[^()]+%)\))?"
    r": (?P<words>[^\[\]\s](?:[^\[\]]*[^\[\]\s])?)"
    r"(?: \[(?P<hazard_class>[^\[\]]+)\])?"
)
# An Annex VI index number. PubChem's source ID may carry a "[n]" suffix, which isn't part of it.
INDEX_NO = re.compile(r"(\d{3}-\d{3}-\d{2}-\d)(?:\[\d+\])?")


@dataclass(frozen=True)
class Statement:
    code: str
    annex_note: str | None  # CLP Annex VI's * notes
    share: str | None  # ECHA: the share of notifications with this code, "37.7%"
    words: str
    hazard_class: str | None

    @property
    def text(self) -> str:
        """PubChem's string, put back together."""
        note = f" {self.annex_note}" if self.annex_note else ""
        share = f" ({self.share})" if self.share else ""
        hazard_class = f" [{self.hazard_class}]" if self.hazard_class else ""
        return f"{self.code}{note}{share}: {self.words}{hazard_class}"


@dataclass(frozen=True)
class Pictogram:
    code: str  # GHS01 to GHS09
    name: str  # PubChem's name for it, "Flammable"


@dataclass(frozen=True)
class Classification:
    source: str  # "eu", "echa" or "other"
    source_name: str
    entry: str | None
    source_url: str | None
    index_no: str | None  # the EU entry's Annex VI index number
    not_classified: bool
    signal: str | None
    pictograms: tuple[Pictogram, ...]
    statements: tuple[Statement, ...]
    notes: tuple[str, ...]
    summary: tuple[str, ...]

    def as_json(self) -> dict[str, object]:
        return asdict(self)


@dataclass(frozen=True)
class Others:
    count: int
    sources: tuple[str, ...]

    def as_json(self) -> dict[str, object]:
        return {"count": self.count, "sources": list(self.sources)}


@dataclass(frozen=True)
class Snapshot:
    classification: Classification | None  # None: PubChem lists no GHS classification
    others: Others


NONE = Snapshot(None, Others(0, ()))


def _unexpected(what: str) -> Unavailable:
    return Unavailable(f"unexpected GHS data: {what}")


def _list(value: object, what: str) -> list:
    if not isinstance(value, list):
        raise _unexpected(what)
    return value


def _find_section(sections: list) -> dict | None:
    for section in sections:
        if not isinstance(section, dict):
            raise _unexpected("section")
        if section.get("TOCHeading") == HEADING:
            return section
        found = _find_section(_list(section.get("Section", []), "section"))
        if found is not None:
            return found
    return None


def _is_number(value: object) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


@dataclass(frozen=True)
class _Entry:
    reference: dict
    items: dict[str, list[dict]]  # item name: its strings with markup, in order


def entries(body: object) -> list[_Entry]:
    """Every classification in a PUG View answer, in PubChem's order. Only what choosing needs
    is checked here (each entry's reference and source name). PubChem answers 404 for a
    compound with no GHS section, so a 200 without one, or with an empty one, is unexpected:
    it is never shown as "PubChem lists none"."""
    if not isinstance(body, dict) or not isinstance(body.get("Record"), dict):
        raise _unexpected("record")
    record = body["Record"]
    section = _find_section(_list(record.get("Section", []), "section"))
    if section is None:
        raise _unexpected("no GHS section")
    references = {}
    for reference in _list(record.get("Reference", []), "references"):
        if not isinstance(reference, dict) or not isinstance(reference.get("SourceName"), str):
            raise _unexpected("reference")
        if not _is_number(reference.get("ReferenceNumber")):
            raise _unexpected("reference number")
        references[reference["ReferenceNumber"]] = reference
    grouped: dict[int, dict[str, list[dict]]] = {}
    for item in _list(section.get("Information", []), "information"):
        if not isinstance(item, dict) or not isinstance(item.get("Name"), str):
            raise _unexpected("information")
        number = item.get("ReferenceNumber")
        if not _is_number(number) or number not in references:
            raise _unexpected("information without its reference")
        grouped.setdefault(number, {}).setdefault(item["Name"], []).append(item.get("Value"))
    if not grouped:
        raise _unexpected("empty GHS section")
    return [_Entry(references[number], items) for number, items in grouped.items()]


def _strings(values: list, what: str) -> list[dict]:
    """The `StringWithMarkup` parts of one item, each with a `String`."""
    if len(values) != 1 or not isinstance(values[0], dict):
        raise _unexpected(what)
    if set(values[0]) != {"StringWithMarkup"}:
        raise _unexpected(what)
    parts = _list(values[0]["StringWithMarkup"], what)
    texts = all(isinstance(p, dict) and isinstance(p.get("String"), str) for p in parts)
    if not parts or not texts:
        raise _unexpected(what)
    return parts


def _texts(entry: _Entry, name: str) -> list[str]:
    if name not in entry.items:
        return []
    return [part["String"] for part in _strings(entry.items[name], name)]


def _pictograms(entry: _Entry) -> tuple[Pictogram, ...]:
    if PICTOGRAMS not in entry.items:
        return ()
    found = []
    for part in _strings(entry.items[PICTOGRAMS], PICTOGRAMS):
        if part["String"].strip():
            raise _unexpected("pictogram text")
        for markup in _list(part.get("Markup"), "pictogram markup"):
            if not isinstance(markup, dict) or markup.get("Type") != "Icon":
                raise _unexpected("pictogram markup")
            url, name = markup.get("URL"), markup.get("Extra")
            match = PICTOGRAM_URL.fullmatch(url) if isinstance(url, str) else None
            if match is None or not isinstance(name, str) or not name.strip():
                raise _unexpected("pictogram")
            found.append(Pictogram(match[1], name))
    if not found:
        raise _unexpected("no pictogram")
    return tuple(found)


def _statement(text: str) -> Statement:
    match = STATEMENT.fullmatch(text)
    if match is None:
        raise _unexpected("hazard statement")
    return Statement(**match.groupdict())


def _optional(reference: dict, key: str) -> str | None:
    value = reference.get(key)
    if value is not None and not isinstance(value, str):
        raise _unexpected(f"reference {key}")
    return value


def _index_no(source_id: str | None) -> str | None:
    match = INDEX_NO.fullmatch(source_id) if source_id else None
    return match[1] if match else None


def read(entry: _Entry) -> Classification:
    """One entry in full, strictly."""
    unknown = set(entry.items) - ITEMS
    if unknown:
        raise _unexpected("item")
    signals = _texts(entry, SIGNAL)
    if len(signals) > 1 or not set(signals) <= SIGNAL_WORDS:
        raise _unexpected("signal word")
    texts = _texts(entry, STATEMENTS)
    if not texts:
        raise _unexpected("no hazard statements")
    pictograms = _pictograms(entry)
    not_classified = texts[0] == NOT_CLASSIFIED
    if not_classified:
        if signals or pictograms:
            raise _unexpected("not classified, with a signal word or pictogram")
        if any(re.match(_CODE, t) for t in texts[1:]):  # a hazard code, in any form
            raise _unexpected("not classified, with a hazard statement")
        statements, notes = (), tuple(_texts(entry, NOTE) + texts[1:])
    else:
        statements, notes = tuple(_statement(t) for t in texts), tuple(_texts(entry, NOTE))
    _texts(entry, PRECAUTIONS)  # checked, not shown
    reference = entry.reference
    source_name = reference["SourceName"]
    source = {EU: "eu", ECHA: "echa"}.get(source_name, "other")
    return Classification(
        source=source,
        source_name=source_name,
        entry=_optional(reference, "Name"),
        source_url=_optional(reference, "URL"),
        index_no=_index_no(_optional(reference, "SourceID")) if source == "eu" else None,
        not_classified=not_classified,
        signal=signals[0] if signals else None,
        pictograms=pictograms,
        statements=statements,
        notes=notes,
        summary=tuple(_texts(entry, SUMMARY)),
    )


def chosen(found: list[_Entry]) -> int:
    """Which entry the snapshot shows (decision 2)."""
    for source in (EU, ECHA):
        for index, entry in enumerate(found):
            if entry.reference["SourceName"] == source:
                return index
    return 0


def snapshot(body: object) -> Snapshot:
    """The snapshot for a PUG View answer (200) for the GHS section."""
    found = entries(body)
    pick = chosen(found)
    rest = [entry.reference["SourceName"] for i, entry in enumerate(found) if i != pick]
    return Snapshot(read(found[pick]), Others(len(rest), tuple(dict.fromkeys(rest))))
