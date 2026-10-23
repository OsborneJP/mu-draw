"""The set of files the static checks look at: what git would track.

Using git (tracked plus untracked-but-not-ignored) instead of walking the tree
means .gitignore decides what is scanned, so build output, logs and caches
never cause false failures.
"""

from __future__ import annotations

import subprocess
from pathlib import Path


def repo_files(root: Path) -> list[Path]:
    out = subprocess.run(
        ["git", "ls-files", "-z", "--cached", "--others", "--exclude-standard"],
        cwd=root,
        check=True,
        capture_output=True,
    ).stdout
    paths = sorted({p for p in out.decode("utf-8").split("\0") if p})
    return [root / p for p in paths if (root / p).is_file()]


def read_text(path: Path) -> str | None:
    """File contents, or None for binary files."""
    try:
        return path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        return None
