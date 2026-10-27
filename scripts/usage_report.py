"""Print the anonymous weekly usage totals (docs/plans/v2-usage-counts.md), one row a week.

    python scripts/usage_report.py                    # production
    python scripts/usage_report.py --target staging
    python scripts/usage_report.py --db <path to usage.sqlite>

Reads the API service's totals (/var/lib/<unit>/usage.sqlite) without changing them. A week's
row keeps growing for up to three weeks after it ends: each browser sends its summary at its
first opening in a later week.
"""

from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from pathlib import Path

from lib.appconfig import load

EVENTS = Path(__file__).resolve().parents[1] / "server" / "usage_events.json"
USAGE_FILE = "usage.sqlite"  # server/usage.py's
COLUMNS = (
    ("browsers", "browsers"),
    ("browser-days", "browser-days"),
    ("installed", "installed"),
    ("new", "new"),
)
NOTE = "A week keeps growing for up to three weeks after it ends."


def read_totals(path: Path) -> dict[str, dict[str, int]]:
    db = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    try:
        found: dict[str, dict[str, int]] = {}
        for week, item, count in db.execute("SELECT week, item, count FROM counts"):
            found.setdefault(week, {})[item] = count
        return found
    finally:
        db.close()


def tools(path: Path = EVENTS) -> list[str]:
    return json.loads(path.read_text(encoding="utf-8"))["tools"]


def table(totals: dict[str, dict[str, int]], tool_names: list[str]) -> str:
    """Weeks down, totals across: the four browser totals, then one column per tool."""
    header = ["week", *(label for _, label in COLUMNS), *tool_names]
    rows = [
        [
            week,
            *(str(totals[week].get(item, 0)) for item, _ in COLUMNS),
            *(str(totals[week].get(f"tool:{tool}", 0)) for tool in tool_names),
        ]
        for week in sorted(totals)
    ]
    widths = [max(len(row[i]) for row in [header, *rows]) for i in range(len(header))]
    lines = [
        "  ".join(cell.rjust(width) for cell, width in zip(row, widths, strict=True))
        for row in [header, *rows]
    ]
    return "\n".join([*lines, "", NOTE]) if rows else f"No counts yet.\n\n{NOTE}"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--target", choices=["production", "staging"], default="production")
    parser.add_argument("--db", type=Path, help="a usage.sqlite file instead of the target's")
    args = parser.parse_args(argv)
    path = args.db or Path("/var/lib") / load().unit(args.target) / USAGE_FILE
    if not path.exists():
        print(f"No usage totals at {path} yet.", file=sys.stderr)
        return 1
    print(table(read_totals(path), tools()))
    return 0


if __name__ == "__main__":
    sys.exit(main())
