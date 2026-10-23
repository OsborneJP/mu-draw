"""scripts/lib/tree.sh: check.sh's "the check left the tree as it found it" guard."""

import os
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def git(*args: str, cwd: Path) -> None:
    env = {k: v for k, v in os.environ.items() if not k.startswith("GIT_")}
    env.update(GIT_CONFIG_GLOBAL="/dev/null", GIT_CONFIG_NOSYSTEM="1")
    env.update(GIT_AUTHOR_NAME="t", GIT_AUTHOR_EMAIL="t@x", GIT_COMMITTER_NAME="t")
    env.update(GIT_COMMITTER_EMAIL="t@x")
    subprocess.run(["git", *args], cwd=cwd, env=env, check=True, capture_output=True)


def fingerprint(repo: Path) -> str:
    result = subprocess.run(
        ["bash", "-c", f"set -euo pipefail; source {ROOT}/scripts/lib/tree.sh; tree_fingerprint"],
        env={"PATH": "/usr/bin:/bin", "ROOT": str(repo), "GIT_CONFIG_GLOBAL": "/dev/null"},
        capture_output=True,
        text=True,
        check=True,
    )
    return result.stdout.strip()


def test_rewrites_are_seen_even_in_files_already_modified(tmp_path: Path):
    (tmp_path / "fixture.json").write_text("committed\n")
    git("init", "-q", cwd=tmp_path)
    git("add", ".", cwd=tmp_path)
    git("commit", "-q", "-m", "init", cwd=tmp_path)
    (tmp_path / "fixture.json").write_text("my uncommitted edit\n")
    before = fingerprint(tmp_path)
    assert fingerprint(tmp_path) == before  # stable
    (tmp_path / "fixture.json").write_text("rewritten by a test\n")
    assert fingerprint(tmp_path) != before


def test_untracked_files_count_by_content_and_ignored_files_dont(tmp_path: Path):
    (tmp_path / ".gitignore").write_text("build/\n")
    git("init", "-q", cwd=tmp_path)
    git("add", ".", cwd=tmp_path)
    git("commit", "-q", "-m", "init", cwd=tmp_path)
    (tmp_path / "new.txt").write_text("a\n")
    before = fingerprint(tmp_path)
    (tmp_path / "build").mkdir()
    (tmp_path / "build" / "out.js").write_text("ignored\n")
    assert fingerprint(tmp_path) == before
    (tmp_path / "new.txt").write_text("b\n")
    assert fingerprint(tmp_path) != before
