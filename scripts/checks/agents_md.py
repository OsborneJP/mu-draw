"""AGENTS.md stays under 150 lines and CLAUDE.md stays a symlink to it."""

from __future__ import annotations

import os
import sys
from pathlib import Path

from lib.appconfig import ROOT

MAX_LINES = 149  # "under 150 lines"


def check(root: Path) -> list[str]:
    agents, claude = root / "AGENTS.md", root / "CLAUDE.md"
    problems = []
    if not agents.is_file() or agents.is_symlink():
        problems.append("AGENTS.md must be a regular file")
    else:
        lines = len(agents.read_text(encoding="utf-8").splitlines())
        if lines > MAX_LINES:
            problems.append(f"AGENTS.md has {lines} lines; keep it under 150")
    if not claude.is_symlink() or os.readlink(claude) != "AGENTS.md":
        problems.append("CLAUDE.md must be a symlink to AGENTS.md")
    return problems


def main(argv: list[str]) -> int:
    root = Path(argv[1]) if len(argv) > 1 else ROOT
    problems = check(root)
    for problem in problems:
        print(problem)
    return 1 if problems else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
