"""SQLite cache of PubChem's structure-to-name answers, kept 30 days.

Chemistry only: a canonical SMILES and what PubChem said about it (CID and names, or that
it has no record), with the time PubChem said it. Nothing about who asked. Busy and
unavailable answers are never stored, so the next request asks PubChem again.
"""

from __future__ import annotations

import sqlite3
import time
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from pubchem import Record

MAX_AGE_S = 30 * 24 * 60 * 60
COLUMNS = ("smiles", "cid", "iupac", "title", "stored_at")
SCHEMA = """CREATE TABLE IF NOT EXISTS names (
    smiles TEXT PRIMARY KEY,
    cid INTEGER,
    iupac TEXT,
    title TEXT,
    stored_at REAL NOT NULL
)"""


@dataclass(frozen=True)
class Hit:
    record: Record | None  # None: PubChem has no record of this structure


class NameCache:
    def __init__(self, path: Path, clock: Callable[[], float] = time.time):
        self._clock = clock
        self._db = sqlite3.connect(path, check_same_thread=False, isolation_level=None)
        self._db.execute(SCHEMA)

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

    def close(self) -> None:
        self._db.close()
