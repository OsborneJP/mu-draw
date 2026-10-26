"""SQLite cache of PubChem's answers, kept 30 days.

Chemistry only. `names` (Get name): a canonical SMILES and what PubChem said about it (CID
and names, or that it has no record). `structures` (Name to structure's fallback): a
lowercased name and PubChem's first record for it (CID, SMILES, title, how many records), or
that it has none. `hazards` (Safety): a CID and the safety snapshot read from PubChem's GHS
section (server/ghs.py), or that it lists none. `conformers` (the 3D view): a canonical
SMILES and the model shown for it (server/threed.py: PubChem's 3D record, RDKit's, or none,
and what PubChem said). Each with the time PubChem said it; nothing about who asked. Busy and
unavailable answers are never stored, so the next request asks PubChem again. OPSIN's
answers aren't cached: OPSIN runs here and answers in milliseconds.
"""

from __future__ import annotations

import json
import sqlite3
import time
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from ghs import Classification, Others, Pictogram, Snapshot, Statement
from pubchem import NameRecord, Record
from threed import Model

MAX_AGE_S = 30 * 24 * 60 * 60
COLUMNS = ("smiles", "cid", "iupac", "title", "stored_at")
STRUCTURE_COLUMNS = ("name", "cid", "smiles", "title", "matches", "stored_at")
HAZARD_COLUMNS = ("cid", "classification", "others", "stored_at")
CONFORMER_COLUMNS = ("smiles", "pubchem", "source", "cid", "molblock", "reason", "stored_at")
SCHEMA = (
    """CREATE TABLE IF NOT EXISTS names (
    smiles TEXT PRIMARY KEY,
    cid INTEGER,
    iupac TEXT,
    title TEXT,
    stored_at REAL NOT NULL
)""",
    """CREATE TABLE IF NOT EXISTS structures (
    name TEXT PRIMARY KEY,
    cid INTEGER,
    smiles TEXT,
    title TEXT,
    matches INTEGER,
    stored_at REAL NOT NULL
)""",
    """CREATE TABLE IF NOT EXISTS hazards (
    cid INTEGER PRIMARY KEY,
    classification TEXT,
    others TEXT NOT NULL,
    stored_at REAL NOT NULL
)""",
    """CREATE TABLE IF NOT EXISTS conformers (
    smiles TEXT PRIMARY KEY,
    pubchem TEXT NOT NULL,
    source TEXT,
    cid INTEGER,
    molblock TEXT,
    reason TEXT,
    stored_at REAL NOT NULL
)""",
)


@dataclass(frozen=True)
class Hit:
    record: Record | None  # None: PubChem has no record of this structure


@dataclass(frozen=True)
class StructureHit:
    record: NameRecord | None  # None: PubChem has no compound by this name


class NameCache:
    def __init__(self, path: Path, clock: Callable[[], float] = time.time):
        self._clock = clock
        self._db = sqlite3.connect(path, check_same_thread=False, isolation_level=None)
        for table in SCHEMA:
            self._db.execute(table)

    def get(self, smiles: str) -> Hit | None:
        row = self._db.execute(
            "SELECT cid, iupac, title FROM names WHERE smiles = ? AND stored_at > ?",
            (smiles, self._clock() - MAX_AGE_S),
        ).fetchone()
        if row is None:
            return None
        cid, iupac, title = row
        return Hit(None if cid is None else Record(cid=cid, iupac=iupac, title=title))

    def put(self, smiles: str, record: Record | None) -> None:
        now = self._clock()
        values = (None, None, None) if record is None else (record.cid, record.iupac, record.title)
        self._db.execute("DELETE FROM names WHERE stored_at <= ?", (now - MAX_AGE_S,))
        self._db.execute(
            "INSERT OR REPLACE INTO names VALUES (?, ?, ?, ?, ?)", (smiles, *values, now)
        )

    def get_structure(self, name: str) -> StructureHit | None:
        """`name` is the cache key: the name as typed, lowercased."""
        row = self._db.execute(
            "SELECT cid, smiles, title, matches FROM structures WHERE name = ? AND stored_at > ?",
            (name, self._clock() - MAX_AGE_S),
        ).fetchone()
        if row is None:
            return None
        cid, smiles, title, matches = row
        found = cid is not None
        return StructureHit(NameRecord(cid, smiles, title, matches) if found else None)

    def put_structure(self, name: str, record: NameRecord | None) -> None:
        now = self._clock()
        values = (
            (None, None, None, 0)
            if record is None
            else (record.cid, record.smiles, record.title, record.matches)
        )
        self._db.execute("DELETE FROM structures WHERE stored_at <= ?", (now - MAX_AGE_S,))
        self._db.execute(
            "INSERT OR REPLACE INTO structures VALUES (?, ?, ?, ?, ?, ?)", (name, *values, now)
        )

    def get_hazards(self, cid: int) -> Snapshot | None:
        row = self._db.execute(
            "SELECT classification, others FROM hazards WHERE cid = ? AND stored_at > ?",
            (cid, self._clock() - MAX_AGE_S),
        ).fetchone()
        if row is None:
            return None
        classification, others = row
        try:
            return Snapshot(
                None if classification is None else _classification(json.loads(classification)),
                _others(json.loads(others)),
            )
        except (ValueError, TypeError, KeyError):
            return None  # written by another version of the app: ask PubChem again

    def put_hazards(self, cid: int, snapshot: Snapshot) -> None:
        now = self._clock()
        found = snapshot.classification
        values = (
            None if found is None else json.dumps(found.as_json()),
            json.dumps(snapshot.others.as_json()),
        )
        self._db.execute("DELETE FROM hazards WHERE stored_at <= ?", (now - MAX_AGE_S,))
        self._db.execute("INSERT OR REPLACE INTO hazards VALUES (?, ?, ?, ?)", (cid, *values, now))

    def get_conformer(self, smiles: str) -> Model | None:
        row = self._db.execute(
            "SELECT pubchem, source, cid, molblock, reason FROM conformers"
            " WHERE smiles = ? AND stored_at > ?",
            (smiles, self._clock() - MAX_AGE_S),
        ).fetchone()
        return None if row is None else Model(*row)

    def put_conformer(self, smiles: str, model: Model) -> None:
        now = self._clock()
        values = (model.pubchem, model.source, model.cid, model.molblock, model.reason)
        self._db.execute("DELETE FROM conformers WHERE stored_at <= ?", (now - MAX_AGE_S,))
        self._db.execute(
            "INSERT OR REPLACE INTO conformers VALUES (?, ?, ?, ?, ?, ?, ?)", (smiles, *values, now)
        )

    def close(self) -> None:
        self._db.close()


def _classification(stored: dict) -> Classification:
    return Classification(
        **{
            **stored,
            "pictograms": tuple(Pictogram(**p) for p in stored["pictograms"]),
            "statements": tuple(Statement(**s) for s in stored["statements"]),
            "notes": tuple(stored["notes"]),
            "summary": tuple(stored["summary"]),
        }
    )


def _others(stored: dict) -> Others:
    return Others(stored["count"], tuple(stored["sources"]))
