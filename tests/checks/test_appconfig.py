from pathlib import Path

import pytest

from conftest import SAMPLE
from lib.appconfig import ConfigError, load, parse


def test_derived_values():
    config = parse(SAMPLE)
    assert config.base("production") == "/zp/"
    assert config.base("staging") == "/zp-staging/"
    assert config.unit("production") == "zz-app-api"
    assert config.unit("staging") == "zz-app-api-staging"
    assert config.port("staging") == 9101
    assert config.deploy_root(Path("/h")) == Path("/h/srv/zz-app")
    assert config.placeholder_literals() == ("zz-app", "/zp/", "zp-staging")


@pytest.mark.parametrize(
    "change",
    [
        {"name": "Has Space"},
        {"name": ""},
        {"path": "../etc"},
        {"path": ""},
        {"ports": {"production": 80, "staging": 9101, "dev": 9102}},
        {"ports": {"production": 9100, "staging": 9100, "dev": 9102}},
        {"ports": {"production": True, "staging": 9101, "dev": 9102}},
        {"ports": {"production": 9100, "staging": 9101}},
    ],
)
def test_rejects_bad_config(change):
    with pytest.raises(ConfigError):
        parse({**SAMPLE, **change})


def test_rejects_unknown_target():
    with pytest.raises(ConfigError):
        parse(SAMPLE).base("prod")


def test_real_config_loads():
    config = load()
    assert config.base("staging") == f"/{config.path}-staging/"
