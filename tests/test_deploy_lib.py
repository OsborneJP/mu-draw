"""scripts/lib/deploy.sh and scripts/deploy.sh: every decision deploy makes, and that the
deploy modes actually call those decisions (run with stubbed builds, checks and network).

Everything runs in temp git repos and a temp HOME, with git's global config ignored.
"""

import os
import subprocess
import sys
from datetime import UTC, datetime
from pathlib import Path

import pytest

from lib.appconfig import load

ROOT = Path(__file__).resolve().parents[1]
LIB = ROOT / "scripts" / "lib" / "deploy.sh"
DEPLOY = ROOT / "scripts" / "deploy.sh"
ENV_BIN = str(Path(sys.executable).parent)
NAME = load().name


def hermetic_env(**extra: str) -> dict[str, str]:
    env = {k: v for k, v in os.environ.items() if not k.startswith("GIT_")}
    env.update(
        GIT_CONFIG_GLOBAL="/dev/null",
        GIT_CONFIG_NOSYSTEM="1",
        GIT_AUTHOR_NAME="t",
        GIT_AUTHOR_EMAIL="t@example.invalid",
        GIT_COMMITTER_NAME="t",
        GIT_COMMITTER_EMAIL="t@example.invalid",
    )
    env.update(extra)
    return env


def git(*args: str, cwd: Path) -> str:
    result = subprocess.run(
        ["git", *args], cwd=cwd, env=hermetic_env(), check=True, capture_output=True, text=True
    )
    return result.stdout.strip()


def run_bash(script: str, path: str = "/usr/bin:/bin", **env: str) -> subprocess.CompletedProcess:
    full_env = {
        "PATH": path,
        "HOME": "/home/u",
        "GIT_CONFIG_GLOBAL": "/dev/null",
        "GIT_CONFIG_NOSYSTEM": "1",
        **env,
    }
    return subprocess.run(["bash", "-c", script], env=full_env, capture_output=True, text=True)


def bash(script: str, path: str = "/usr/bin:/bin", **env: str) -> subprocess.CompletedProcess:
    """Run with the deploy library sourced (ROOT defaults to this repo)."""
    env.setdefault("ROOT", str(ROOT))
    return run_bash(f"set -euo pipefail; source {LIB}; {script}", path=path, **env)


@pytest.fixture
def repo(tmp_path: Path) -> Path:
    """A temp repo with importable server code and a stub check.sh, committed and clean."""
    root = tmp_path / "repo"
    (root / "server").mkdir(parents=True)
    (root / "scripts").mkdir()
    (root / "server" / "main.py").write_text("VALUE = 1\n")
    (root / "scripts" / "check.sh").write_text("#!/bin/sh\necho CHECK\n")
    (root / "scripts" / "check.sh").chmod(0o755)
    git("init", "-q", cwd=root)
    git("add", ".", cwd=root)
    git("commit", "-q", "-m", "first", cwd=root)
    return root


def commit(repo: Path, message: str, files: dict[str, str] | None = None) -> str:
    for rel, text in (files or {}).items():
        path = repo / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text)
    git("add", "-A", cwd=repo)
    git("commit", "-q", "--allow-empty", "-m", message, cwd=repo)
    return git("rev-parse", "HEAD", cwd=repo)


def deploy_sh(script: str, repo: Path, home: Path, stubs: str = "") -> subprocess.CompletedProcess:
    """Source the real deploy.sh, point it at a temp repo and HOME, stub, then run."""
    base_stubs = "use_env(){ echo ENV; }; npm_ci_if_stale(){ :; }; require_chromium(){ :; };"
    return run_bash(
        f"set -euo pipefail; source {DEPLOY}; ROOT={repo}; {base_stubs} {stubs} {script}",
        path=f"{ENV_BIN}:/usr/bin:/bin",
        HOME=str(home),
    )


def target(home: Path, name: str) -> Path:
    return home / "srv" / NAME / name


# --- publishing order and target safety -------------------------------------------------


def make_dist(root: Path) -> Path:
    dist = root / "dist"
    for rel in [
        "index.html",
        "sw.js",
        "manifest.webmanifest",
        "workbox-1a2b.js",
        "assets/index-x.js",
        "icons/icon-192.png",
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
    for early in [
        "assets/index-x.js",
        "icons/icon-192.png",
        "workbox-1a2b.js",
        "rdkit/RDKit_minimal.wasm",
    ]:
        assert order[early] < order["manifest.webmanifest"], early
    assert order["manifest.webmanifest"] < order["index.html"] < order["sw.js"]
    assert order["sw.js"] < order["deleting assets/old-chunk.js"]
    assert not (dest / "assets" / "old-chunk.js").exists()
    assert (dest / "sw.js").read_text() == "sw.js"


@pytest.mark.parametrize(
    ("name", "deploy_root", "ok"),
    [
        ("staging", "/home/u/srv/zz-app", True),
        ("production", "/home/u/srv/zz-app", True),
        ("prod", "/home/u/srv/zz-app", False),
        ("staging", "/home/u/srv", False),
        ("staging", "/", False),
    ],
)
def test_target_dir_refuses_anything_but_home_srv_name(name, deploy_root, ok):
    result = bash(f"target_dir {name}", APP_NAME="zz-app", DEPLOY_ROOT=deploy_root)
    assert (result.returncode == 0) is ok, result.stderr
    if ok:
        assert result.stdout.strip() == f"/home/u/srv/zz-app/{name}"


def test_check_dist_needs_entry_files_and_no_maps(tmp_path: Path):
    dist = make_dist(tmp_path)
    assert bash(f"check_dist {dist}").returncode == 0
    (dist / "assets" / "index-x.js.map").write_text("{}")
    assert bash(f"check_dist {dist}").returncode == 1
    (dist / "assets" / "index-x.js.map").unlink()
    (dist / "sw.js").unlink()
    assert bash(f"check_dist {dist}").returncode == 1


# --- what is deployed: commits, trees, server code -----------------------------------


def test_require_clean_tree(repo: Path):
    assert bash("require_clean_tree", ROOT=str(repo)).returncode == 0
    (repo / "stray.txt").write_text("x")
    result = bash("require_clean_tree", ROOT=str(repo))
    assert result.returncode == 1
    assert "stray.txt" in result.stderr


def test_require_unchanged(repo: Path):
    start = git("rev-parse", "HEAD", cwd=repo)
    assert bash(f"require_unchanged {start}", ROOT=str(repo)).returncode == 0
    commit(repo, "meanwhile")
    result = bash(f"require_unchanged {start}", ROOT=str(repo))
    assert result.returncode == 1
    assert "HEAD moved" in result.stderr


def test_ship_server_ships_the_given_commit_without_tests(repo: Path, tmp_path: Path):
    first = git("rev-parse", "HEAD", cwd=repo)
    commit(repo, "second", {"server/main.py": "VALUE = 2\n", "server/tests/test_x.py": ""})
    dest = tmp_path / "deployed"
    result = bash(f"ship_server {dest} {first}", path=f"{ENV_BIN}:/usr/bin:/bin", ROOT=str(repo))
    assert result.returncode == 0, result.stderr
    assert (dest / "main.py").read_text() == "VALUE = 1\n"
    commit(repo, "third")
    result = bash(f"ship_server {dest} HEAD", path=f"{ENV_BIN}:/usr/bin:/bin", ROOT=str(repo))
    assert result.returncode == 0, result.stderr
    assert (dest / "main.py").read_text() == "VALUE = 2\n"
    assert not (dest / "tests").exists()


def test_ship_server_leaves_the_deployed_copy_if_the_code_doesnt_import(repo: Path, tmp_path: Path):
    commit(repo, "broken", {"server/main.py": "import does_not_exist\n"})
    dest = tmp_path / "deployed"
    dest.mkdir()
    (dest / "main.py").write_text("# the running version\n")
    result = bash(f"ship_server {dest} HEAD", path=f"{ENV_BIN}:/usr/bin:/bin", ROOT=str(repo))
    assert result.returncode == 1
    assert (dest / "main.py").read_text() == "# the running version\n"


def test_server_changed(repo: Path):
    first = git("rev-parse", "HEAD", cwd=repo)
    docs_only = commit(repo, "docs", {"README.md": "hello\n"})
    server = commit(repo, "server", {"server/main.py": "VALUE = 3\n"})
    assert bash(f"server_changed '' {first}", ROOT=str(repo)).returncode == 0  # first deploy
    assert bash(f"server_changed {first} {docs_only}", ROOT=str(repo)).returncode == 1
    assert bash(f"server_changed {first} {server}", ROOT=str(repo)).returncode == 0
    assert bash(f"server_changed {docs_only} {server}", ROOT=str(repo)).returncode == 0


# --- markers, gates, restarts, probe ---------------------------------------------------


def test_live_checks_only_vouch_for_the_deployed_commit(repo: Path, tmp_path: Path):
    deployed = git("rev-parse", "HEAD", cwd=repo)
    dir_ = tmp_path / "target"
    dir_.mkdir()
    check = f"require_deployed_head {dir_}"
    assert bash(check, ROOT=str(repo)).returncode == 1  # nothing deployed
    (dir_ / "DEPLOYED_COMMIT").write_text(deployed + "\n")
    assert bash(check, ROOT=str(repo)).returncode == 0
    commit(repo, "newer")
    result = bash(check, ROOT=str(repo))
    assert result.returncode == 1
    assert "Check out the deployed commit" in result.stderr


@pytest.mark.parametrize(
    ("verified", "commit_", "ok"),
    [(None, "abc", False), ("abc", "def", False), ("abc", "abc", True), ("abc", "", False)],
)
def test_production_gate_needs_the_commit_staging_verified(tmp_path, verified, commit_, ok):
    if verified is not None:
        (tmp_path / "VERIFIED_COMMIT").write_text(verified + "\n")
    result = bash(f"staging_verified {tmp_path} '{commit_}'")
    assert (result.returncode == 0) is ok


def test_mark_verified_only_for_the_commit_still_deployed(tmp_path: Path):
    (tmp_path / "DEPLOYED_COMMIT").write_text("abc\n")
    (tmp_path / "SERVER_DEPLOYED_AT").write_text("1\n")
    assert bash(f"mark_verified {tmp_path} def").returncode == 1
    assert not (tmp_path / "VERIFIED_COMMIT").exists()
    assert bash(f"mark_verified {tmp_path} abc").returncode == 0
    assert (tmp_path / "VERIFIED_COMMIT").read_text() == "abc\n"
    assert not (tmp_path / "SERVER_DEPLOYED_AT").exists()
    assert bash(f"clear_verified {tmp_path}").returncode == 0
    assert not (tmp_path / "VERIFIED_COMMIT").exists()


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


@pytest.mark.parametrize(
    ("code", "body", "advice"),
    [
        ("200", '{"ok": true}', None),
        ("200", "<html>welcome</html>", 'not {"ok": true}'),
        ("404", "", "apply docs/server-setup.md"),
        ("403", "", "inside 10.0.0.0/8"),
        ("503", "", "systemctl status u1"),
        ("000", "", "probe failed"),
    ],
)
def test_probe_advice(code, body, advice):
    result = bash(f"probe_advice {code} '{body}' u1 staging")
    if advice is None:
        assert result.returncode == 0 and result.stdout == ""
    else:
        assert result.returncode == 1
        assert advice in result.stdout
        assert "--smoke-only staging" in result.stdout


# --- deploy.sh's modes call the decisions ----------------------------------------------


def test_production_refuses_a_commit_staging_did_not_verify(repo: Path, tmp_path: Path):
    home = tmp_path / "home"
    stubs = (
        "build_and_verify(){ echo BUILD; }; publish(){ echo PUBLISH; }; verify(){ echo VERIFY; };"
    )
    result = deploy_sh("deploy_production", repo, home, stubs)
    assert result.returncode == 1
    assert "Refusing" in result.stderr
    assert "BUILD" not in result.stdout and "PUBLISH" not in result.stdout
    staging = target(home, "staging")
    staging.mkdir(parents=True)
    (staging / "VERIFIED_COMMIT").write_text("0" * 40 + "\n")
    assert deploy_sh("deploy_production", repo, home, stubs).returncode == 1


def test_production_builds_publishes_and_verifies_the_verified_commit(repo: Path, tmp_path: Path):
    home = tmp_path / "home"
    head = git("rev-parse", "HEAD", cwd=repo)
    staging = target(home, "staging")
    staging.mkdir(parents=True)
    (staging / "VERIFIED_COMMIT").write_text(head + "\n")
    stubs = (
        'build_and_verify(){ echo "BUILD $*"; }; publish(){ echo "PUBLISH $*"; };'
        ' verify(){ echo "VERIFY $*"; };'
    )
    result = deploy_sh("deploy_production", repo, home, stubs)
    assert result.returncode == 0, result.stderr
    steps = [
        line
        for line in result.stdout.splitlines()
        if line.split()[0] in {"BUILD", "PUBLISH", "VERIFY"}
    ]
    assert steps == [
        f"BUILD {load().base('production')} dist-production",
        f"PUBLISH production {head}",
        "VERIFY production",
    ]


def test_publish_refuses_when_head_moved_during_the_build(repo: Path, tmp_path: Path):
    home = tmp_path / "home"
    head = git("rev-parse", "HEAD", cwd=repo)
    commit(repo, "landed during the build")
    result = deploy_sh(f"publish production {head}", repo, home)
    assert result.returncode == 1
    assert "HEAD moved" in result.stderr
    assert not target(home, "production").exists()


def test_publish_refuses_a_dirty_tree(repo: Path, tmp_path: Path):
    home = tmp_path / "home"
    head = git("rev-parse", "HEAD", cwd=repo)
    (repo / "stray.txt").write_text("x")
    result = deploy_sh(f"publish staging {head}", repo, home)
    assert result.returncode == 1
    assert not target(home, "staging").exists()


def test_staging_publishes_only_after_check_passes(repo: Path, tmp_path: Path):
    home = tmp_path / "home"
    head = git("rev-parse", "HEAD", cwd=repo)
    stubs = 'publish(){ echo "PUBLISH $*"; }; verify(){ echo "VERIFY $*"; };'
    result = deploy_sh("deploy_staging", repo, home, stubs)
    assert result.returncode == 0, result.stderr
    lines = result.stdout.splitlines()
    assert (
        lines.index("CHECK")
        < lines.index(f"PUBLISH staging {head}")
        < lines.index("VERIFY staging")
    )
    commit(repo, "failing check", {"scripts/check.sh": "#!/bin/sh\necho CHECK; exit 1\n"})
    result = deploy_sh("deploy_staging", repo, home, stubs)
    assert result.returncode == 1
    assert "PUBLISH" not in result.stdout


def test_smoke_only_checks_the_deployed_commit_before_anything_else(repo: Path, tmp_path: Path):
    home = tmp_path / "home"
    staging = target(home, "staging")
    staging.mkdir(parents=True)
    (staging / "DEPLOYED_COMMIT").write_text("0" * 40 + "\n")
    stubs = 'verify(){ echo "VERIFY $*"; };'
    result = deploy_sh("smoke_only staging", repo, home, stubs)
    assert result.returncode == 1
    assert "ENV" not in result.stdout and "VERIFY" not in result.stdout
    (staging / "DEPLOYED_COMMIT").write_text(git("rev-parse", "HEAD", cwd=repo) + "\n")
    result = deploy_sh("smoke_only staging", repo, home, stubs)
    assert result.returncode == 0, result.stderr
    assert result.stdout.splitlines()[-2:] == ["ENV", "VERIFY staging"]


CURL_OK = (
    'curl(){ local out=""; while (($#)); do [[ $1 == -o ]] && { out=$2; shift; }; shift; done;'
    ' echo \'{"ok": true}\' > "$out"; printf 200; };'
)


def deployed_staging(repo: Path, home: Path) -> Path:
    staging = target(home, "staging")
    staging.mkdir(parents=True)
    (staging / "DEPLOYED_COMMIT").write_text(git("rev-parse", "HEAD", cwd=repo) + "\n")
    return staging


def test_verify_marks_verified_only_after_every_live_check(repo: Path, tmp_path: Path):
    home = tmp_path / "home"
    staging = deployed_staging(repo, home)
    passing = CURL_OK + " python(){ echo LIVE; }; web(){ echo SMOKE; };"
    result = deploy_sh("verify staging", repo, home, passing)
    assert result.returncode == 0, result.stderr
    assert (staging / "VERIFIED_COMMIT").read_text() == (staging / "DEPLOYED_COMMIT").read_text()

    for failing in [
        CURL_OK + " python(){ echo LIVE; }; web(){ return 1; };",  # smoke tests fail
        CURL_OK + " python(){ return 1; }; web(){ echo SMOKE; };",  # headers wrong
        "curl(){ printf 404; }; python(){ echo LIVE; }; web(){ echo SMOKE; };",  # no Apache
    ]:
        (staging / "VERIFIED_COMMIT").unlink(missing_ok=True)
        result = deploy_sh("verify staging", repo, home, failing)
        assert result.returncode != 0
        assert not (staging / "VERIFIED_COMMIT").exists()


def test_verify_refuses_another_commit_before_any_live_check(repo: Path, tmp_path: Path):
    home = tmp_path / "home"
    staging = target(home, "staging")
    staging.mkdir(parents=True)
    (staging / "DEPLOYED_COMMIT").write_text("0" * 40 + "\n")
    stubs = "curl(){ echo CURL; printf 200; }; python(){ echo LIVE; }; web(){ echo SMOKE; };"
    result = deploy_sh("verify staging", repo, home, stubs)
    assert result.returncode == 1
    assert "Check out the deployed commit" in result.stderr
    assert not {"CURL", "LIVE", "SMOKE"} & set(result.stdout.split())


def test_verify_does_not_vouch_for_a_redeploy_during_the_checks(repo: Path, tmp_path: Path):
    home = tmp_path / "home"
    staging = deployed_staging(repo, home)
    sneaky = (
        CURL_OK + f" python(){{ echo LIVE; }}; web(){{ echo other > {staging}/DEPLOYED_COMMIT; }};"
    )
    result = deploy_sh("verify staging", repo, home, sneaky)
    assert result.returncode == 1
    assert not (staging / "VERIFIED_COMMIT").exists()


def test_production_needs_the_flag(tmp_path: Path):
    # "production" without the dashes is not a target: usage, and nothing is created.
    result = subprocess.run(
        [str(DEPLOY), "production"],
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
    result = run_bash(
        f"set -euo pipefail; source {ROOT}/scripts/lib/config.sh; echo survived",
        path=f"{bin_dir}:/usr/bin:/bin",
        HOME=str(tmp_path),
    )
    assert result.returncode != 0
    assert "survived" not in result.stdout
