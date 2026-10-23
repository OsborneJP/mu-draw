"""Names, paths and ports derived from app.config.json.

app.config.json holds the placeholders (repo name and URL path). Everything
else that depends on them is derived here, so a rename touches one file.
Standard library only: config.sh runs this before the conda env is on PATH.

    python3 -I scripts/lib/appconfig.py --shell     # KEY=value lines for eval
    python3 -I scripts/lib/appconfig.py --get NAME  # one value
"""

from __future__ import annotations

import argparse
import json
import re
import shlex
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CONFIG_FILE = "app.config.json"
TARGETS = ("staging", "production")
_SLUG = re.compile(r"^[a-z][a-z0-9-]*$")


class ConfigError(ValueError):
    pass


@dataclass(frozen=True)
class AppConfig:
    name: str
    path: str
    ports: dict[str, int]

    @property
    def staging_path(self) -> str:
        return f"{self.path}-staging"

    def url_path(self, target: str) -> str:
        _check_target(target)
        return self.path if target == "production" else self.staging_path

    def base(self, target: str) -> str:
        return f"/{self.url_path(target)}/"

    def unit(self, target: str) -> str:
        _check_target(target)
        return f"{self.name}-api" if target == "production" else f"{self.name}-api-staging"

    def port(self, target: str) -> int:
        _check_target(target)
        return self.ports[target]

    def deploy_root(self, home: Path) -> Path:
        return home / "srv" / self.name

    def placeholder_literals(self) -> tuple[str, ...]:
        """Strings that must appear only in app.config.json and Markdown."""
        return (self.name, f"/{self.path}/", self.staging_path)

    def shell_vars(self, home: Path) -> dict[str, str]:
        return {
            "APP_NAME": self.name,
            "APP_PATH": self.path,
            "STAGING_PATH": self.staging_path,
            "BASE_PRODUCTION": self.base("production"),
            "BASE_STAGING": self.base("staging"),
            "ENV_NAME": self.name,
            "DEPLOY_ROOT": str(self.deploy_root(home)),
            "PORT_PRODUCTION": str(self.port("production")),
            "PORT_STAGING": str(self.port("staging")),
            "PORT_DEV": str(self.ports["dev"]),
            "UNIT_PRODUCTION": self.unit("production"),
            "UNIT_STAGING": self.unit("staging"),
        }


def _check_target(target: str) -> None:
    if target not in TARGETS:
        raise ConfigError(f"unknown target {target!r}; expected one of {TARGETS}")


def parse(data: object) -> AppConfig:
    if not isinstance(data, dict):
        raise ConfigError("config must be a JSON object")
    name, path, ports = data.get("name"), data.get("path"), data.get("ports")
    for key, value in (("name", name), ("path", path)):
        if not isinstance(value, str) or not _SLUG.match(value):
            raise ConfigError(f"{key} must match {_SLUG.pattern}, got {value!r}")
    if not isinstance(ports, dict):
        raise ConfigError("ports must be an object")
    for key in ("production", "staging", "dev"):
        port = ports.get(key)
        if not isinstance(port, int) or isinstance(port, bool) or not 1024 <= port <= 65535:
            raise ConfigError(f"ports.{key} must be an integer in 1024-65535, got {port!r}")
    if len({ports["production"], ports["staging"], ports["dev"]}) != 3:
        raise ConfigError("ports must be distinct")
    return AppConfig(name=name, path=path, ports=dict(ports))


def load(root: Path = ROOT) -> AppConfig:
    return parse(json.loads((root / CONFIG_FILE).read_text(encoding="utf-8")))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--shell", action="store_true", help="print KEY=value lines")
    group.add_argument("--get", metavar="KEY", help="print one shell variable")
    args = parser.parse_args(argv)
    values = load().shell_vars(Path.home())
    if args.shell:
        for key, value in values.items():
            print(f"{key}={shlex.quote(value)}")
        return 0
    if args.get not in values:
        parser.error(f"unknown key {args.get}; known: {', '.join(values)}")
    print(values[args.get])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
