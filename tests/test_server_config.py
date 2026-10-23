"""docs/server-setup.md is rendered from the config and says what the invariants need."""

import re
from pathlib import Path

import pytest

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


def test_only_staging_is_restricted_to_campus():
    staging = rsc.apache_block(target("staging"), POLICY)
    production = rsc.apache_block(target("production"), POLICY)
    assert CAMPUS_SECTION.search(staging)
    active = [line for line in production.splitlines() if not line.lstrip().startswith("#")]
    assert not any("Require ip" in line for line in active)


def test_production_campus_option_is_a_valid_section_once_uncommented():
    # Apache needs the opening and closing tags on their own lines.
    production = rsc.apache_block(target("production"), POLICY)
    uncommented = "\n".join(re.sub(r"^# ?", "", line) for line in production.splitlines())
    assert CAMPUS_SECTION.search(uncommented)
