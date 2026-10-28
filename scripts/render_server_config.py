"""Render docs/server-setup.md: the Apache and systemd config a person applies on osbornelab.

    python scripts/render_server_config.py           # rewrite docs/server-setup.md
    python scripts/render_server_config.py --check   # exit 1 if it is out of date

Everything comes from app.config.json (name, URL path, host, ports), web/csp.json (the
Content-Security-Policy header) and the conda env this runs in (uvicorn's path), so a
rename or a policy change is: edit the source, re-render, re-apply. Agents never edit /etc.
"""

from __future__ import annotations

import argparse
import getpass
import json
import sys
from dataclasses import dataclass
from pathlib import Path

from lib.appconfig import ROOT, AppConfig, load

DOC = ROOT / "docs" / "server-setup.md"
CSP_FILE = ROOT / "web" / "csp.json"
CSP_WORKERS_FILE = ROOT / "web" / "csp-workers.json"
VHOST = "/etc/apache2/sites-enabled/osbornelab.conf"
# The vhost's access log (its CustomLog line); scripts/check_live.py reads it.
ACCESS_LOG = "/var/log/apache2/osbornelab_access.log"
CAMPUS = "10.0.0.0/8"
# Production is public like /chemtutor, so CHEM-311 students can use it at home (Jeff,
# 2026-10-25; it was campus and VPN only from 2026-10-23). True restricts it to campus and
# VPN again: re-render, then re-apply the production block.
PRODUCTION_CAMPUS_ONLY = False
IMMUTABLE = "public, max-age=31536000, immutable"


def serialise(directives: dict[str, list[str]]) -> str:
    """Same serialisation as web/config/csp.ts: 'name values; name values'."""
    return "; ".join(f"{name} {' '.join(values)}" for name, values in directives.items())


def csp_policy(path: Path = CSP_FILE) -> str:
    return serialise(json.loads(path.read_text(encoding="utf-8")))


def worker_policies(page: Path = CSP_FILE, workers: Path = CSP_WORKERS_FILE) -> dict[str, str]:
    """Each worker that gets more than the page (path under the app -> its policy): the
    page's policy with the worker's extra sources appended, as workerCspPolicy() does."""
    directives = json.loads(page.read_text(encoding="utf-8"))
    extras = json.loads(workers.read_text(encoding="utf-8"))
    return {
        path: serialise({name: values + more.get(name, []) for name, values in directives.items()})
        for path, more in extras.items()
    }


def env_prefix(name: str) -> Path:
    """The project env's prefix, from the interpreter running this (an env of the same conda)."""
    prefix = Path(sys.prefix)
    base = prefix.parent.parent if prefix.parent.name == "envs" else prefix
    return base / "envs" / name


@dataclass(frozen=True)
class Target:
    config: AppConfig
    name: str  # staging | production
    home: Path
    user: str

    @property
    def root(self) -> Path:
        return self.config.deploy_root(self.home) / self.name

    @property
    def web(self) -> Path:
        return self.root / "web"

    @property
    def server(self) -> Path:
        return self.root / "server"

    @property
    def path(self) -> str:
        return self.config.url_path(self.name)

    @property
    def port(self) -> int:
        return self.config.port(self.name)

    @property
    def unit(self) -> str:
        return self.config.unit(self.name)

    @property
    def marker(self) -> str:
        return f"{self.config.name}-{self.name}"


def worker_sections(t: Target, workers: dict[str, str]) -> list[str]:
    """One <Files> section per worker with its own policy. Apache applies <Files> after the
    <Directory> sections, so its `Header set` replaces the page's policy for that file."""
    lines = []
    for path, policy in sorted(workers.items()):
        folder, _, name = path.rpartition("/")
        lines += [
            f"# {path} gets the page's policy plus what web/csp-workers.json adds: RDKit.js",
            "# builds its bindings with `new Function`. The page itself never gets it.",
            f"<Directory {t.web}/{folder}>" if folder else f"<Directory {t.web}>",
            f'    <Files "{name}">',
            f'        Header set Content-Security-Policy "{policy}"',
            "    </Files>",
            "</Directory>",
        ]
    return lines


def count_log_skip(config: AppConfig) -> str:
    """The environment variable that keeps count requests out of the access log."""
    return f"{config.name.replace('-', '_')}_count"


def apache_block(t: Target, policy: str, workers: dict[str, str] | None = None) -> str:
    p = t.path
    lines = [
        f"# {t.marker} BEGIN (rendered by scripts/render_server_config.py; do not hand-edit)",
        f"# {t.name.capitalize()}: static app at /{p}/, naming API proxied to uvicorn on {t.port}.",
        "# ProxyPass is matched before Alias, so /api/ never reaches the static files.",
        "# retry=0: after a restart, the next request tries uvicorn again at once.",
        f"ProxyPass /{p}/api/ http://127.0.0.1:{t.port}/api/ retry=0",
        f"ProxyPassReverse /{p}/api/ http://127.0.0.1:{t.port}/api/",
        f"Alias /{p} {t.web}",
        f"<Directory {t.web}>",
        "    Options -Indexes",
        "    AllowOverride None",
        "    Require all granted",
        "    # index.html, sw.js, the manifest and the RDKit wasm: always revalidate, so a new",
        "    # build is seen on the next launch.",
        '    Header set Cache-Control "no-cache"',
        f'    Header set Content-Security-Policy "{policy}"',
        '    Header set X-Content-Type-Options "nosniff"',
        "</Directory>",
        "# Hashed build files never change; cache them for a year.",
        f"<Directory {t.web}/assets>",
        f'    Header set Cache-Control "{IMMUTABLE}"',
        "</Directory>",
        *worker_sections(t, workers or {}),
        "# Anonymous usage counts (docs/plans/v2-usage-counts.md): never in the access log",
        f"# (the vhost's CustomLog line ends env=!{count_log_skip(t.config)}).",
        "# The API takes a count only with the header, so none is stored until this is applied.",
        "# The API refuses bodies over 2 KB itself: LimitRequestBody skips proxied requests.",
        f'SetEnvIf Request_URI "^/{p}/api/count$" {count_log_skip(t.config)}',
        f'RequestHeader set X-Unlogged-Count "1" env={count_log_skip(t.config)}',
    ]
    if t.name == "staging":
        lines += [
            "# Staging is for campus and VPN only (covers the static files and the API).",
            f'<LocationMatch "^/{p}(/|$)">',
            f"    Require ip {CAMPUS}",
            '    ErrorDocument 403 "This test version opens only on the campus network or VPN."',
            "</LocationMatch>",
        ]
    elif PRODUCTION_CAMPUS_ONLY:
        lines += [
            "# Production is campus and VPN only, for now (covers the static files and the API).",
            f'<LocationMatch "^/{p}(/|$)">',
            f"    Require ip {CAMPUS}",
            '    ErrorDocument 403 "This app opens only on the campus network or VPN."',
            "</LocationMatch>",
        ]
    else:
        lines += [
            "# Production is public, like /chemtutor. For campus and VPN only, uncomment:",
            f'# <LocationMatch "^/{p}(/|$)">',
            f"#     Require ip {CAMPUS}",
            '#     ErrorDocument 403 "This app opens only on the campus network or VPN."',
            "# </LocationMatch>",
        ]
    lines.append(f"# {t.marker} END")
    return "\n".join(lines)


def systemd_unit(t: Target, uvicorn: Path) -> str:
    return "\n".join(
        [
            "[Unit]",
            f"Description=Naming API ({t.name}), served by Apache at /{t.path}/api/",
            "After=network.target",
            "StartLimitIntervalSec=600",
            "StartLimitBurst=5",
            "",
            "[Service]",
            "Type=simple",
            f"User={t.user}",
            f"Group={t.user}",
            "# Runs the deployed copy, never the working tree.",
            f"WorkingDirectory={t.server}",
            "Environment=PYTHONDONTWRITEBYTECODE=1",
            "# Get name's cache (SQLite, chemistry only): systemd makes /var/lib/<unit>, owned",
            "# by the user above, and passes it as $STATE_DIRECTORY. No start without it.",
            f"StateDirectory={t.unit}",
            "StateDirectoryMode=0700",
            "# Loopback only; Apache is the front door. No access log: no per-student records.",
            f"ExecStart={uvicorn} main:app --host 127.0.0.1 --port {t.port} "
            "--workers 1 --no-access-log",
            "Restart=on-failure",
            "RestartSec=3",
            "TimeoutStopSec=20",
            "NoNewPrivileges=yes",
            "PrivateTmp=yes",
            "ProtectSystem=full",
            "ProtectHome=read-only",
            "MemoryMax=512M",
            "",
            "[Install]",
            "WantedBy=multi-user.target",
        ]
    )


def unit_install(t: Target, uvicorn: Path) -> str:
    return "\n".join(
        [
            "```bash",
            f"sudo tee /etc/systemd/system/{t.unit}.service > /dev/null <<'UNIT'",
            systemd_unit(t, uvicorn),
            "UNIT",
            "sudo systemctl daemon-reload",
            f"sudo systemctl enable --now {t.unit}",
            f"systemctl status {t.unit} --no-pager",
            "```",
        ]
    )


def render(
    config: AppConfig, home: Path, user: str, uvicorn: Path, policy: str, workers: dict[str, str]
) -> str:
    staging = Target(config, "staging", home, user)
    production = Target(config, "production", home, user)
    host = config.host
    access = (
        "It opens on the campus network and VPN only, for now (set `PRODUCTION_CAMPUS_ONLY`\n"
        "in scripts/render_server_config.py to change that), so the live checks, like\n"
        "staging's, need this host to reach its own name from a 10.x address."
        if PRODUCTION_CAMPUS_ONLY
        else "It is public, like /chemtutor (Jeff, 2026-10-25, for CHEM-311 students at home);\n"
        "set `PRODUCTION_CAMPUS_ONLY` in scripts/render_server_config.py to restrict it to\n"
        "campus and VPN again."
    )
    rows = "\n".join(
        f"| {t.name} | `https://{host}/{t.path}/` | `{t.web}` | `{t.unit}` on 127.0.0.1:{t.port} |"
        for t in (staging, production)
    )
    return f"""# Server setup (osbornelab)

Rendered by `scripts/render_server_config.py` from `app.config.json`, `web/csp.json` and
`web/csp-workers.json`.
Don't edit this file by hand: change the sources and re-render
(`python scripts/render_server_config.py`); check.sh fails if it is out of date.

Agents never change Apache or systemd. A person applies the steps below with sudo.

| Target | URL | Static files | API service |
| --- | --- | --- | --- |
{rows}

`scripts/deploy.sh` copies builds into `{config.deploy_root(home)}` without sudo. Apache
serves the static files directly; a uvicorn service per target runs the naming API from the
deployed copy, using the project's conda env (`{uvicorn.parent.parent}`). The services
send nothing to logs about requests (`--no-access-log`).

## (a) First staging deploy: apply now

### Step 1. Copy the build into place (no sudo)

The first run stops at the health probe because Apache doesn't know the path yet; that is
expected.

```bash
scripts/deploy.sh staging
```

### Step 2. Back up the live vhost

It is a regular file in sites-enabled; the copy in sites-available is stale and not loaded.
Keep this shell open: step 4 uses `$BAK`.

```bash
BAK={VHOST}.bak.$(date +%Y%m%d_%H%M%S)
sudo cp -p {VHOST} "$BAK"
```

### Step 3. Add the staging block to the vhost

Edit `{VHOST}`. Inside `<VirtualHost *:443>`, paste this block after the line
`# timetable3 END` and before `# 5. ENVIPATH DATABASE` (the envipath block must stay last).

```apache
{apache_block(staging, policy, workers)}
```

### Step 4. Test and reload Apache

```bash
sudo apache2ctl configtest && sudo systemctl reload apache2
```

If configtest fails, nothing was reloaded, but the broken file is still in place and the
next Apache start would fail for every app on this vhost. Put the backup back:

```bash
sudo cp -p "$BAK" {VHOST}
```

### Step 5. Install and start the staging API service

{unit_install(staging, uvicorn)}

### Step 6. Check it end to end

Headers, health, and the offline smoke test against the live site. Run it from the commit
step 1 deployed, with a clean tree: the live checks only vouch for the deployed commit.
Staging accepts campus addresses only, so this host must reach its own name from a 10.x
address (`curl -so /dev/null -w '%{{remote_ip}}\\n' https://{host}/` shows where it goes; a
403 from the checks means it doesn't).

```bash
scripts/deploy.sh --smoke-only staging
```

## (b) Production: apply when promoting

Only after staging has passed (`scripts/deploy.sh --production` refuses otherwise).
{access}

1. Run `scripts/deploy.sh --production`. The first run stops at the health probe, as above.
2. Back up the vhost as in step 2, then paste this block next to the staging block.
3. Run `sudo apache2ctl configtest && sudo systemctl reload apache2` (restore `$BAK` if
   configtest fails, as in step 4).
4. Install and start the production API service (below).
5. Run `scripts/deploy.sh --smoke-only production`.

```apache
{apache_block(production, policy, workers)}
```

{unit_install(production, uvicorn)}

## (c) Anonymous usage counts: apply before deploying them

The counts (docs/plans/v2-usage-counts.md) promise that a count request is never in Apache's
access log. (The API refuses a body over 2 KB itself; Apache 2.4's `LimitRequestBody` doesn't
apply to proxied requests, so the blocks don't set it.) The API takes a count only when
Apache has marked it as kept out of the log (the `X-Unlogged-Count` header the blocks set), so
until this is applied it stores nothing, and the live checks fail. Apply it before deploying
the counts.

1. Back up the vhost as in (a) step 2.
2. Replace the staging and the production blocks (from their `BEGIN` line to their `END`
   line) with the blocks in (a) step 3 and in (b). Each now ends with the count settings.
3. In `{VHOST}`, inside `<VirtualHost *:443>`, add ` env=!{count_log_skip(config)}` to the end
   of the `CustomLog` line, so it reads like
   `CustomLog ${{APACHE_LOG_DIR}}/{Path(ACCESS_LOG).name} combined env=!{count_log_skip(config)}`.
   It applies only to requests the blocks mark; everything else is logged as before.
4. Run `sudo apache2ctl configtest && sudo systemctl reload apache2` (restore `$BAK` if
   configtest fails, as in (a) step 4).
5. Deploy as usual: `scripts/deploy.sh staging`. The API code changed, so it stops and prints
   `sudo systemctl restart {staging.unit}`; run that, then `scripts/deploy.sh --smoke-only
   staging`. Production the same way when promoting. The live checks send a deliberately
   wrong count and an oversized one, which count nothing; each gets the API's own refusal,
   the wrong one only through a marked request (steps 1 and 2), and the checks then read
   `{ACCESS_LOG}` to see that neither was logged (step 3).

## (d) Later

- **Restarting after server changes.** deploy.sh can't restart services (no sudo). When
  the code the service runs changed (`server/`, but not its tests or fixture scripts,
  which aren't deployed) or `environment.yml` did, it prints the command, for example
  `sudo systemctl restart {staging.unit}`, and verifies only after the restart.
- **Changing an installed unit.** When a unit above changes (Get name added
  `StateDirectory=`), run its install block again, then restart it (`enable --now` doesn't
  restart a running service): `sudo systemctl restart {staging.unit}`. Apply the production
  unit before promoting server code that needs it.
- **OPSIN (name to structure).** Java is OpenJDK 21 from the project env (environment.yml),
  so nothing is installed system-wide. Each API service starts one OPSIN process itself
  (server/opsin.py, about 150 MB at rest, 240 MB under a flood), inside the unit's memory
  limit. Changing the env needs a restart of both services, like a server change.
- **Rolling back.** Redeploy the last good commit through the normal path, so the files,
  server code and markers stay consistent: `git checkout <commit>`,
  `scripts/deploy.sh staging`, then `scripts/deploy.sh --production`.
- **Name cache.** Get name keeps PubChem's answers for 30 days in
  `/var/lib/<unit>/name-cache.sqlite` (outside the deployed code, which deploys replace).
  Chemistry only: canonical SMILES, CID, names, time looked up. Deleting it is harmless.
- **Usage totals.** `/var/lib/<unit>/usage.sqlite` holds the anonymous weekly totals: week,
  item and count, nothing else. `python scripts/usage_report.py` prints them (add
  `--target staging` for staging's). Deleting the file deletes the totals; there is nothing
  per student to delete.
- **Renaming the app.** Edit `app.config.json`, re-render this file, create the new conda
  env (`conda env create -n <new name> -f environment.yml`), redeploy to the new folders,
  apply the new Apache blocks and units, then remove the old ones.
"""


def current() -> str:
    config = load()
    uvicorn = env_prefix(config.name) / "bin" / "uvicorn"
    return render(config, Path.home(), getpass.getuser(), uvicorn, csp_policy(), worker_policies())


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="fail if the doc is out of date")
    args = parser.parse_args(argv)
    text = current()
    if args.check:
        if DOC.read_text(encoding="utf-8") != text:
            print(f"{DOC.relative_to(ROOT)} is out of date; run scripts/render_server_config.py")
            return 1
        return 0
    DOC.write_text(text, encoding="utf-8")
    print(f"wrote {DOC.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
