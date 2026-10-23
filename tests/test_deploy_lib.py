"""scripts/lib/deploy.sh: the publish order, the target guard and change detection."""

import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
LIB = ROOT / "scripts" / "lib" / "deploy.sh"


def bash(script: str, **env: str) -> subprocess.CompletedProcess:
    full_env = {"PATH": "/usr/bin:/bin", "HOME": "/home/u", "ROOT": str(ROOT), **env}
    return subprocess.run(
        ["bash", "-c", f"set -euo pipefail; source {LIB}; {script}"],
        env=full_env,
        capture_output=True,
        text=True,
    )


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


def test_server_changed():
    first = subprocess.run(
        ["git", "rev-list", "--max-parents=0", "HEAD"],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=True,
    ).stdout.strip()
    assert bash("server_changed ''").returncode == 0  # nothing deployed yet
    assert bash(f"server_changed {first}").returncode == 0  # server/ added since
    assert bash("server_changed HEAD").returncode == 1
