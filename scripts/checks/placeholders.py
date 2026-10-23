"""Fail if the placeholder name or URL path is written out anywhere but
app.config.json and Markdown, so a rename only touches the config."""

from __future__ import annotations

import sys
from pathlib import Path

from checks.files import read_text, repo_files
from lib.appconfig import CONFIG_FILE, ROOT, AppConfig, load

EXEMPT_SUFFIXES = {".md"}


def find(root: Path, config: AppConfig) -> list[str]:
    literals = config.placeholder_literals()
    problems = []
    for path in repo_files(root):
        rel = path.relative_to(root).as_posix()
        if rel == CONFIG_FILE or path.suffix in EXEMPT_SUFFIXES:
            continue
        text = read_text(path)
        if text is None:
            continue
        for lineno, line in enumerate(text.splitlines(), start=1):
            for literal in literals:
                if literal in line:
                    problems.append(f"{rel}:{lineno}: {literal!r} (read it from {CONFIG_FILE})")
    return problems


def main(argv: list[str]) -> int:
    root = Path(argv[1]) if len(argv) > 1 else ROOT
    problems = find(root, load(root))
    for problem in problems:
        print(problem)
    return 1 if problems else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
