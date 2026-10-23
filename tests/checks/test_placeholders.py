from pathlib import Path

from checks.placeholders import find
from conftest import SAMPLE
from lib.appconfig import parse

CONFIG = parse(SAMPLE)


def test_clean_repo_passes(repo: Path):
    (repo / "main.py").write_text("BASE = config.base('staging')\n")
    assert find(repo, CONFIG) == []


def test_each_literal_in_tracked_file_fails(repo: Path):
    for i, literal in enumerate(CONFIG.placeholder_literals()):
        (repo / f"f{i}.ts").write_text(f"const x = '{literal}'\n")
    problems = find(repo, CONFIG)
    assert len(problems) == 3
    assert problems[0].startswith("f0.ts:1:")


def test_ignored_markdown_and_config_are_exempt(repo: Path):
    (repo / ".gitignore").write_text("out/\n")
    (repo / "out").mkdir()
    (repo / "out" / "build.js").write_text("'/zp/'\n")
    (repo / "README.md").write_text("Served at /zp/.\n")
    assert find(repo, CONFIG) == []


def test_binary_files_are_skipped(repo: Path):
    (repo / "icon.png").write_bytes(b"\x89PNG\xff\xfe zz-app")
    assert find(repo, CONFIG) == []
