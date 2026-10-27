"""Anonymous weekly usage counts (docs/plans/v2-usage-counts.md).

Each browser sends, once a week, a summary of the week before: on how many days the app was
open, whether as the installed app, whether it was that browser's first week, and which
tools were used. This module only adds those to weekly totals, one number per week per item,
in its own SQLite file (`usage.sqlite` in $STATE_DIRECTORY, apart from the name cache). It
keeps no address, no time, no request body, and nothing that tells one browser from another.
Nor the order summaries came in: a page keeps its rows in the order they were written, and a
freed row's bytes stay behind, so after each write freed bytes are zeroed (secure_delete) and
the file is rebuilt in key order (VACUUM). The same totals make the same file, byte for byte.

Tool names are append-only (server/usage_events.json, a copy of the web app's list): one is
never reused or removed, so an older copy of the app is still counted. A name this list
doesn't know is ignored.
"""

from __future__ import annotations

import datetime as dt
import json
import logging
import re
import sqlite3
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path

log = logging.getLogger("usage")
USAGE_FILE = "usage.sqlite"
EVENTS_FILE = Path(__file__).with_name("usage_events.json")
SCHEMA = """CREATE TABLE IF NOT EXISTS counts (
    week TEXT NOT NULL,
    item TEXT NOT NULL,
    count INTEGER NOT NULL,
    PRIMARY KEY (week, item)
) WITHOUT ROWID"""
WEEK = re.compile(r"^(\d{4})-W(\d{2})$")
# A summary is for a week that has ended, sent at the next opening while online; it waits at
# most two weeks in the browser. Devices east or west of the server can be a day apart.
WEEKS_BACK = 3
WEEKS_AHEAD = 1
# The browser keeps at most two ended weeks; one more allows for a week boundary in transit.
MAX_WEEKS = 3


def tool_names(path: Path = EVENTS_FILE) -> frozenset[str]:
    return frozenset(json.loads(path.read_text(encoding="utf-8"))["tools"])


def week_monday(week: str) -> dt.date | None:
    """The Monday of an ISO week written `YYYY-Www`, or None if there is no such week."""
    match = WEEK.match(week)
    if not match:
        return None
    try:
        return dt.date.fromisocalendar(int(match[1]), int(match[2]), 1)
    except ValueError:
        return None


def week_in_window(week: str, today: dt.date) -> bool:
    monday = week_monday(week)
    if monday is None:
        return False
    this_monday = today - dt.timedelta(days=today.weekday())
    return (
        this_monday - dt.timedelta(weeks=WEEKS_BACK)
        <= monday
        <= this_monday + dt.timedelta(weeks=WEEKS_AHEAD)
    )


@dataclass(frozen=True)
class Summary:
    week: str
    days: int
    installed: bool
    first: bool
    tools: tuple[str, ...]


def items(summary: Summary, known: frozenset[str]) -> dict[str, int]:
    """What one browser's week adds to the totals."""
    added = {"browsers": 1, "browser-days": summary.days}
    if summary.installed:
        added["installed"] = 1
    if summary.first:
        added["new"] = 1
    for tool in set(summary.tools) & known:
        added[f"tool:{tool}"] = 1
    return added


class UsageCounts:
    def __init__(self, path: Path):
        self._db = sqlite3.connect(path, check_same_thread=False, isolation_level=None)
        self._db.execute("PRAGMA secure_delete = ON")
        self._db.execute(SCHEMA)

    def add(self, summaries: Iterable[Summary], known: frozenset[str]) -> None:
        """Adds every summary's items, all or none."""
        with self._db:
            self._db.execute("BEGIN")
            for summary in summaries:
                for item, count in items(summary, known).items():
                    self._db.execute(
                        "INSERT INTO counts VALUES (?, ?, ?)"
                        " ON CONFLICT (week, item) DO UPDATE SET count = count + excluded.count",
                        (summary.week, item, count),
                    )
        try:
            self._compact()
        except sqlite3.Error:
            # The totals are stored; failing now would have the browser send them again. The
            # next write compacts the file.
            log.warning("usage totals not compacted")

    def _compact(self) -> None:
        self._db.execute("VACUUM")  # rows in key order: no trace of the order they came in

    def totals(self) -> dict[str, dict[str, int]]:
        """Week, then item, then its total."""
        found: dict[str, dict[str, int]] = {}
        for week, item, count in self._db.execute("SELECT week, item, count FROM counts"):
            found.setdefault(week, {})[item] = count
        return found

    def close(self) -> None:
        self._db.close()
