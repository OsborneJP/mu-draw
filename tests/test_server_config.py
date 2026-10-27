"""docs/server-setup.md is rendered from the config and says what the invariants need."""

import re
from pathlib import Path

import pytest

import main
import render_server_config as rsc
from conftest_sample import SAMPLE_CONFIG
from lib.appconfig import parse

UVICORN = Path("/opt/conda/envs/zz-app/bin/uvicorn")
POLICY = "default-src 'self'; connect-src 'self'"


def target(name: str) -> rsc.Target:
    return rsc.Target(parse(SAMPLE_CONFIG), name, Path("/home/u"), "u")


def test_doc_is_up_to_date():
    assert rsc.DOC.read_text(encoding="utf-8") == rsc.current(), (
        "run: python scripts/render_server_config.py"
    )


def test_csp_header_uses_the_same_policy_as_the_build():
    # web/config/csp.ts serialises csp.json the same way; verify-dist checks the meta tag.
    policy = rsc.csp_policy()
    assert policy.startswith("default-src 'self'; ")
    assert f'Header set Content-Security-Policy "{policy}"' in rsc.current()


@pytest.mark.parametrize("name", ["staging", "production"])
def test_units_bind_loopback_without_access_log(name):
    unit = rsc.systemd_unit(target(name), UVICORN)
    exec_start = next(line for line in unit.splitlines() if line.startswith("ExecStart="))
    assert "--host 127.0.0.1" in exec_start
    assert "--no-access-log" in exec_start
    assert "--reload" not in exec_start
    assert not re.search(r"--log-level\s+(debug|trace)", exec_start)
    assert "WorkingDirectory=/home/u/srv/zz-app/" in unit


@pytest.mark.parametrize("name", ["staging", "production"])
def test_units_give_the_name_cache_a_private_state_directory(name):
    # server/main.py reads $STATE_DIRECTORY, which systemd sets from StateDirectory=.
    t = target(name)
    lines = rsc.systemd_unit(t, UVICORN).splitlines()
    assert f"StateDirectory={t.unit}" in lines
    assert "StateDirectoryMode=0700" in lines


@pytest.mark.parametrize("name", ["staging", "production"])
def test_apache_block_routes_api_and_caches_correctly(name):
    t = target(name)
    block = rsc.apache_block(t, POLICY)
    p = t.path
    assert f"ProxyPass /{p}/api/ http://127.0.0.1:{t.port}/api/ retry=0" in block
    assert f"Alias /{p} /home/u/srv/zz-app/{name}/web" in block
    assert 'Header set Cache-Control "no-cache"' in block
    assert f'Header set Cache-Control "{rsc.IMMUTABLE}"' in block
    # "always" would add a second Cache-Control header instead of replacing it.
    assert "Header always" not in block


CAMPUS_SECTION = re.compile(
    r'^<LocationMatch "\^/[^"]+">\n'
    r"\s+Require ip 10\.0\.0\.0/8\n"
    r'\s+ErrorDocument 403 "[^"]+"\n'
    r"</LocationMatch>$",
    re.MULTILINE,
)


def active(block: str) -> list[str]:
    return [line for line in block.splitlines() if not line.lstrip().startswith("#")]


def test_staging_is_campus_only_and_production_public():
    assert not rsc.PRODUCTION_CAMPUS_ONLY
    assert CAMPUS_SECTION.search(rsc.apache_block(target("staging"), POLICY))
    production = rsc.apache_block(target("production"), POLICY)
    assert not any("Require ip" in line for line in active(production))


def test_campus_only_production_is_restricted(monkeypatch):
    monkeypatch.setattr(rsc, "PRODUCTION_CAMPUS_ONLY", True)
    assert CAMPUS_SECTION.search(rsc.apache_block(target("production"), POLICY))


def test_public_production_campus_option_is_a_valid_section_once_uncommented():
    # Apache needs the opening and closing tags on their own lines.
    production = rsc.apache_block(target("production"), POLICY)
    uncommented = "\n".join(re.sub(r"^# ?", "", line) for line in production.splitlines())
    assert CAMPUS_SECTION.search(uncommented)


def test_rdkit_worker_gets_its_own_policy_and_only_it():
    # web/csp-workers.json: the page's policy plus 'unsafe-eval' for the RDKit worker.
    page = rsc.csp_policy()
    workers = rsc.worker_policies()
    assert workers == {
        "rdkit/worker.js": page.replace(
            "script-src 'self' 'wasm-unsafe-eval'",
            "script-src 'self' 'wasm-unsafe-eval' 'unsafe-eval'",
        )
    }
    doc = rsc.current()
    for name in ("staging", "production"):
        t = target(name)
        section = (
            f"<Directory {t.web}/rdkit>\n"
            '    <Files "worker.js">\n'
            f'        Header set Content-Security-Policy "{workers["rdkit/worker.js"]}"\n'
            "    </Files>\n"
            "</Directory>"
        )
        assert section in rsc.apache_block(t, page, workers), name
    assert doc.count("'unsafe-eval'") == 2  # once per target, in the worker's section only
    assert f'Header set Content-Security-Policy "{page}"' in doc


@pytest.mark.parametrize("name", ["staging", "production"])
def test_count_requests_are_kept_out_of_the_access_log_and_capped(name):
    # docs/plans/v2-usage-counts.md: the block marks count requests; the vhost's CustomLog
    # line (section (c) of the doc) skips what is marked.
    t = target(name)
    block = rsc.apache_block(t, POLICY).splitlines()
    skip = rsc.count_log_skip(t.config)
    assert re.fullmatch(r"[a-z][a-z0-9_]*_count", skip)
    assert f'SetEnvIf Request_URI "^/{t.path}/api/count$" {skip}' in block
    start = block.index(f'<Location "/{t.path}/api/count">')
    assert block[start + 1 : start + 3] == ["    LimitRequestBody 2048", "</Location>"]
    assert rsc.COUNT_BODY_LIMIT == main.MAX_COUNT_BODY


def test_the_doc_says_how_to_keep_counts_out_of_the_access_log():
    doc = rsc.current()
    skip = rsc.count_log_skip(rsc.load())
    assert f"combined env=!{skip}`" in doc
    assert "## (c) Anonymous usage counts: apply before deploying them" in doc


@pytest.mark.parametrize("name", ["staging", "production"])
def test_marked_count_requests_tell_the_api_they_are_kept_out_of_the_log(name):
    # The API takes a count only with this header (server/main.py UNLOGGED).
    t = target(name)
    skip = rsc.count_log_skip(t.config)
    assert f'RequestHeader set X-Unlogged-Count "1" env={skip}' in rsc.apache_block(t, POLICY)
    assert main.UNLOGGED == "x-unlogged-count"
