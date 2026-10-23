import os
from pathlib import Path

from checks.agents_md import check


def write_agents(root: Path, lines: int) -> None:
    (root / "AGENTS.md").write_text("line\n" * lines)


def test_short_file_with_symlink_passes(tmp_path: Path):
    write_agents(tmp_path, 149)
    os.symlink("AGENTS.md", tmp_path / "CLAUDE.md")
    assert check(tmp_path) == []


def test_150_lines_fails(tmp_path: Path):
    write_agents(tmp_path, 150)
    os.symlink("AGENTS.md", tmp_path / "CLAUDE.md")
    assert check(tmp_path) == ["AGENTS.md has 150 lines; keep it under 150"]


def test_copy_instead_of_symlink_fails(tmp_path: Path):
    write_agents(tmp_path, 10)
    (tmp_path / "CLAUDE.md").write_text("line\n")
    assert check(tmp_path) == ["CLAUDE.md must be a symlink to AGENTS.md"]


def test_missing_files_fail(tmp_path: Path):
    assert len(check(tmp_path)) == 2
