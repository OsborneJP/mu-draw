"""scripts/lib/deploy.sh and scripts/deploy.sh: every decision deploy makes."""

import subprocess
import sys
from datetime import UTC, datetime
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
LIB = ROOT / "scripts" / "lib" / "deploy.sh"
ENV_BIN = str(Path(sys.executable).parent)


def bash(script: str, path: str = "/usr/bin:/bin", **env: str) -> subprocess.CompletedProcess:
    full_env = {"PATH": path, "HOME": "/home/u", "ROOT": str(ROOT), **env}
    return subprocess.run(
        ["bash", "-c", f"set -euo pipefail; source {LIB}; {script}"],
        env=full_env,
        capture_output=True,
        text=True,
    )


def git(*args: str, cwd: Path) -> str:
    return subprocess.run(
        ["git", *args], cwd=cwd, check=True, capture_output=True, text=True
    ).stdout.strip()


def make_dist(root: Path) -> Path:
    dist = root / "dist"
    for rel in [
        "index.html",
        "sw.js",
        "manifest.webmanifest",
        "workbox-1a2b.js",
        "assets/index-x.js",
        "rdkit/RDKit_minimal.wasm",
    ]:
        (dist / rel).parent.mkdir(parents=True, exist_ok=True)
        (dist / rel).write_text(rel)
    return dist


def test_rsync_web_publishes_sw_last_then_deletes(tmp_path: Path):
    dist = make_dist(tmp_path)
    dest = tmp_path / "web"
    (dest / "assets").mkdir(parents=True)
    (dest / "assets" / "old-chunk.js").write_text("old")
    result = bash(f"rsync_web {dist} {dest}")
    assert result.returncode == 0, result.stderr
    log = result.stdout.splitlines()
    order = {name: log.index(name) for name in log}
    assert order["workbox-1a2b.js"] < order["manifest.webmanifest"]
    assert order["rdkit/RDKit_minimal.wasm"] < order["manifest.webmanifest"]
    assert order["manifest.webmanifest"] < order["index.html"] < order["sw.js"]
    assert order["sw.js"] < order["deleting assets/old-chunk.js"]
    assert not (dest / "assets" / "old-chunk.js").exists()
    assert (dest / "sw.js").read_text() == "sw.js"


@pytest.mark.parametrize(
    ("target", "deploy_root", "ok"),
    [
        ("staging", "/home/u/srv/zz-app", True),
        ("production", "/home/u/srv/zz-app", True),
        ("prod", "/home/u/srv/zz-app", False),
        ("staging", "/home/u/srv", False),
        ("staging", "/", False),
    ],
)
def test_target_dir_refuses_anything_but_home_srv_name(target, deploy_root, ok):
    result = bash(f"target_dir {target}", APP_NAME="zz-app", DEPLOY_ROOT=deploy_root)
    assert (result.returncode == 0) is ok, result.stderr
    if ok:
        assert result.stdout.strip() == f"/home/u/srv/zz-app/{target}"


def test_check_dist_needs_entry_files_and_no_maps(tmp_path: Path):
    dist = make_dist(tmp_path)
    assert bash(f"check_dist {dist}").returncode == 0
    (dist / "assets" / "index-x.js.map").write_text("{}")
    assert bash(f"check_dist {dist}").returncode == 1
    (dist / "assets" / "index-x.js.map").unlink()
    (dist / "sw.js").unlink()
    assert bash(f"check_dist {dist}").returncode == 1


def test_server_changed_compares_given_commits():
    first = git("rev-list", "--max-parents=0", "HEAD", cwd=ROOT)
    assert bash(f"server_changed {first} HEAD").returncode == 0
    assert bash("server_changed HEAD HEAD").returncode == 1


def test_require_clean_tree(tmp_path: Path):
    git("init", "-q", cwd=tmp_path)
    assert bash("require_clean_tree", ROOT=str(tmp_path)).returncode == 0
    (tmp_path / "stray.txt").write_text("x")
    result = bash("require_clean_tree", ROOT=str(tmp_path))
    assert result.returncode == 1
    assert "stray.txt" in result.stderr


@pytest.mark.parametrize(
    ("verified", "commit", "ok"),
    [(None, "abc", False), ("abc", "def", False), ("abc", "abc", True), ("abc", "", False)],
)
def test_production_gate_needs_the_commit_staging_verified(tmp_path, verified, commit, ok):
    if verified is not None:
        (tmp_path / "VERIFIED_COMMIT").write_text(verified + "\n")
    result = bash(f"staging_verified {tmp_path} '{commit}'")
    assert (result.returncode == 0) is ok


def test_live_checks_only_vouch_for_the_deployed_commit(tmp_path: Path):
    repo, target = tmp_path / "repo", tmp_path / "target"
    repo.mkdir()
    target.mkdir()
    git("init", "-q", cwd=repo)
    git(
        "-c",
        "user.name=t",
        "-c",
        "user.email=t@x",
        "commit",
        "-q",
        "--allow-empty",
        "-m",
        "a",
        cwd=repo,
    )
    deployed = git("rev-parse", "HEAD", cwd=repo)
    check = f"require_deployed_head {target}"
    assert bash(check, ROOT=str(repo)).returncode == 1  # nothing deployed
    (target / "DEPLOYED_COMMIT").write_text(deployed + "\n")
    assert bash(check, ROOT=str(repo)).returncode == 0
    git(
        "-c",
        "user.name=t",
        "-c",
        "user.email=t@x",
        "commit",
        "-q",
        "--allow-empty",
        "-m",
        "b",
        cwd=repo,
    )
    result = bash(check, ROOT=str(repo))
    assert result.returncode == 1
    assert "Check out the deployed commit" in result.stderr


def test_verified_mark_lifecycle(tmp_path: Path):
    (tmp_path / "DEPLOYED_COMMIT").write_text("abc\n")
    (tmp_path / "VERIFIED_COMMIT").write_text("old\n")
    (tmp_path / "SERVER_DEPLOYED_AT").write_text("1\n")
    assert bash(f"clear_verified {tmp_path}").returncode == 0
    assert not (tmp_path / "VERIFIED_COMMIT").exists()
    assert bash(f"mark_verified {tmp_path}").returncode == 0
    assert (tmp_path / "VERIFIED_COMMIT").read_text() == "abc\n"
    assert not (tmp_path / "SERVER_DEPLOYED_AT").exists()


def test_snapshot_keeps_only_a_verified_production_build(tmp_path: Path):
    (tmp_path / "web").mkdir()
    (tmp_path / "web" / "index.html").write_text("good")
    (tmp_path / "DEPLOYED_COMMIT").write_text("good\n")
    (tmp_path / "VERIFIED_COMMIT").write_text("good\n")
    assert bash(f"snapshot_web {tmp_path}").returncode == 0
    assert (tmp_path / "web.prev" / "index.html").read_text() == "good"
    assert (tmp_path / "WEB_PREV_COMMIT").read_text() == "good\n"
    # A later build that never passed the live checks must not replace the snapshot.
    (tmp_path / "web" / "index.html").write_text("bad")
    (tmp_path / "DEPLOYED_COMMIT").write_text("bad\n")
    (tmp_path / "VERIFIED_COMMIT").unlink()
    assert bash(f"snapshot_web {tmp_path}").returncode == 0
    assert (tmp_path / "web.prev" / "index.html").read_text() == "good"


def stub_systemctl(tmp_path: Path, started: str, state: str) -> str:
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir(exist_ok=True)
    stub = bin_dir / "systemctl"
    stub.write_text(
        f'#!/bin/bash\ncase "$1" in show) echo "{started}" ;; is-active) echo "{state}" ;; esac\n'
    )
    stub.chmod(0o755)
    return f"{bin_dir}:/usr/bin:/bin"


def stamp(epoch: int) -> str:
    return datetime.fromtimestamp(epoch, UTC).strftime("%a %Y-%m-%d %H:%M:%S UTC")


@pytest.mark.parametrize(
    ("started", "state", "pending"),
    [
        (stamp(2_000_000_100), "active", False),  # restarted after the deploy
        (stamp(1_999_999_900), "active", True),  # still the process from before
        ("n/a", "inactive", True),  # not running
        (stamp(2_000_000_100), "failed", True),  # restarted, then crashed
    ],
)
def test_restart_pending(tmp_path, started, state, pending):
    (tmp_path / "SERVER_DEPLOYED_AT").write_text("2000000000\n")
    path = stub_systemctl(tmp_path, started, state)
    result = bash(f"restart_pending {tmp_path} some-unit", path=path)
    assert (result.returncode == 0) is pending


def test_no_restart_pending_without_a_server_change(tmp_path: Path):
    path = stub_systemctl(tmp_path, "n/a", "inactive")
    assert bash(f"restart_pending {tmp_path} some-unit", path=path).returncode == 1


def test_ship_server_ships_the_commit_without_tests(tmp_path: Path):
    dest = tmp_path / "server"
    result = bash(f"ship_server {dest} HEAD", path=f"{ENV_BIN}:/usr/bin:/bin")
    assert result.returncode == 0, result.stderr
    assert (dest / "main.py").is_file()
    assert not (dest / "tests").exists()


def test_ship_server_leaves_the_deployed_copy_if_the_code_doesnt_import(tmp_path: Path):
    dest = tmp_path / "server"
    dest.mkdir()
    (dest / "main.py").write_text("# the running version\n")
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    (bin_dir / "python").write_text("#!/bin/sh\nexit 1\n")
    (bin_dir / "python").chmod(0o755)
    result = bash(f"ship_server {dest} HEAD", path=f"{bin_dir}:/usr/bin:/bin")
    assert result.returncode == 1
    assert (dest / "main.py").read_text() == "# the running version\n"


def test_production_needs_the_flag(tmp_path: Path):
    # "production" without the dashes is not a target: usage, and nothing is created.
    result = subprocess.run(
        [str(ROOT / "scripts" / "deploy.sh"), "production"],
        env={"PATH": "/usr/bin:/bin", "HOME": str(tmp_path)},
        capture_output=True,
        text=True,
    )
    assert result.returncode == 2
    assert not (tmp_path / "srv").exists()


def test_config_errors_stop_the_scripts(tmp_path: Path):
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    (bin_dir / "python3").write_text("#!/bin/sh\necho 'bad config' >&2\nexit 1\n")
    (bin_dir / "python3").chmod(0o755)
    result = subprocess.run(
        ["bash", "-c", f"set -euo pipefail; source {ROOT}/scripts/lib/config.sh; echo survived"],
        env={"PATH": f"{bin_dir}:/usr/bin:/bin", "HOME": str(tmp_path)},
        capture_output=True,
        text=True,
    )
    assert result.returncode != 0
    assert "survived" not in result.stdout


def test_server_changed():
    first = git("rev-list", "--max-parents=0", "HEAD", cwd=ROOT)
    assert bash("server_changed ''").returncode == 0  # nothing deployed yet
    assert bash(f"server_changed {first}").returncode == 0  # server/ added since
    assert bash("server_changed HEAD").returncode == 1
