# Server setup (osbornelab)

Rendered by `scripts/render_server_config.py` from `app.config.json` and `web/csp.json`.
Don't edit this file by hand: change the sources and re-render
(`python scripts/render_server_config.py`); check.sh fails if it is out of date.

Agents never change Apache or systemd. A person applies the steps below with sudo.

| Target | URL | Static files | API service |
| --- | --- | --- | --- |
| staging | `https://osbornelab.manchester.edu/draw-staging/` | `/home/webadmin/srv/mu-draw/staging/web` | `mu-draw-api-staging` on 127.0.0.1:8051 |
| production | `https://osbornelab.manchester.edu/draw/` | `/home/webadmin/srv/mu-draw/production/web` | `mu-draw-api` on 127.0.0.1:8050 |

`scripts/deploy.sh` copies builds into `/home/webadmin/srv/mu-draw` without sudo. Apache
serves the static files directly; a uvicorn service per target runs the naming API from the
deployed copy, using the project's conda env (`/home/webadmin/anaconda3/envs/mu-draw`). The services
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
BAK=/etc/apache2/sites-enabled/osbornelab.conf.bak.$(date +%Y%m%d_%H%M%S)
sudo cp -p /etc/apache2/sites-enabled/osbornelab.conf "$BAK"
```

### Step 3. Add the staging block to the vhost

Edit `/etc/apache2/sites-enabled/osbornelab.conf`. Inside `<VirtualHost *:443>`, paste this block after the line
`# timetable3 END` and before `# 5. ENVIPATH DATABASE` (the envipath block must stay last).

```apache
# mu-draw-staging BEGIN (rendered by scripts/render_server_config.py; do not hand-edit)
# Staging: static app at /draw-staging/, naming API proxied to uvicorn on 8051.
# ProxyPass is matched before Alias, so /api/ never reaches the static files.
# retry=0: after a restart, the next request tries uvicorn again at once.
ProxyPass /draw-staging/api/ http://127.0.0.1:8051/api/ retry=0
ProxyPassReverse /draw-staging/api/ http://127.0.0.1:8051/api/
Alias /draw-staging /home/webadmin/srv/mu-draw/staging/web
<Directory /home/webadmin/srv/mu-draw/staging/web>
    Options -Indexes
    AllowOverride None
    Require all granted
    # index.html, sw.js, the manifest and the RDKit wasm: always revalidate, so a new
    # build is seen on the next launch.
    Header set Cache-Control "no-cache"
    Header set Content-Security-Policy "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'self'; form-action 'none'"
    Header set X-Content-Type-Options "nosniff"
</Directory>
# Hashed build files never change; cache them for a year.
<Directory /home/webadmin/srv/mu-draw/staging/web/assets>
    Header set Cache-Control "public, max-age=31536000, immutable"
</Directory>
# Staging is for campus and VPN only (covers the static files and the API).
<LocationMatch "^/draw-staging(/|$)">
    Require ip 10.0.0.0/8
    ErrorDocument 403 "This test version opens only on the campus network or VPN."
</LocationMatch>
# mu-draw-staging END
```

### Step 4. Test and reload Apache

```bash
sudo apache2ctl configtest && sudo systemctl reload apache2
```

If configtest fails, nothing was reloaded, but the broken file is still in place and the
next Apache start would fail for every app on this vhost. Put the backup back:

```bash
sudo cp -p "$BAK" /etc/apache2/sites-enabled/osbornelab.conf
```

### Step 5. Install and start the staging API service

```bash
sudo tee /etc/systemd/system/mu-draw-api-staging.service > /dev/null <<'UNIT'
[Unit]
Description=Naming API (staging), served by Apache at /draw-staging/api/
After=network.target
StartLimitIntervalSec=600
StartLimitBurst=5

[Service]
Type=simple
User=webadmin
Group=webadmin
# Runs the deployed copy, never the working tree.
WorkingDirectory=/home/webadmin/srv/mu-draw/staging/server
Environment=PYTHONDONTWRITEBYTECODE=1
# Loopback only; Apache is the front door. No access log: no per-student records.
ExecStart=/home/webadmin/anaconda3/envs/mu-draw/bin/uvicorn main:app --host 127.0.0.1 --port 8051 --workers 1 --no-access-log
Restart=on-failure
RestartSec=3
TimeoutStopSec=20
NoNewPrivileges=yes
PrivateTmp=yes
ProtectSystem=full
ProtectHome=read-only
MemoryMax=512M

[Install]
WantedBy=multi-user.target
UNIT
sudo systemctl daemon-reload
sudo systemctl enable --now mu-draw-api-staging
systemctl status mu-draw-api-staging --no-pager
```

### Step 6. Check it end to end

Headers, health, and the offline smoke test against the live site. Run it from the commit
step 1 deployed, with a clean tree: the live checks only vouch for the deployed commit.
Staging accepts campus addresses only, so this host must reach its own name from a 10.x
address (`curl -so /dev/null -w '%{remote_ip}\n' https://osbornelab.manchester.edu/` shows where it goes; a
403 from the checks means it doesn't).

```bash
scripts/deploy.sh --smoke-only staging
```

## (b) Production: apply when promoting

Only after staging has passed (`scripts/deploy.sh --production` refuses otherwise). Decide
first whether production is public (as rendered, like /chemtutor) or campus-only.

1. Run `scripts/deploy.sh --production`. The first run stops at the health probe, as above.
2. Back up the vhost as in step 2, then paste this block next to the staging block.
3. Run `sudo apache2ctl configtest && sudo systemctl reload apache2` (restore `$BAK` if
   configtest fails, as in step 4).
4. Install and start the production API service (below).
5. Run `scripts/deploy.sh --smoke-only production`.

```apache
# mu-draw-production BEGIN (rendered by scripts/render_server_config.py; do not hand-edit)
# Production: static app at /draw/, naming API proxied to uvicorn on 8050.
# ProxyPass is matched before Alias, so /api/ never reaches the static files.
# retry=0: after a restart, the next request tries uvicorn again at once.
ProxyPass /draw/api/ http://127.0.0.1:8050/api/ retry=0
ProxyPassReverse /draw/api/ http://127.0.0.1:8050/api/
Alias /draw /home/webadmin/srv/mu-draw/production/web
<Directory /home/webadmin/srv/mu-draw/production/web>
    Options -Indexes
    AllowOverride None
    Require all granted
    # index.html, sw.js, the manifest and the RDKit wasm: always revalidate, so a new
    # build is seen on the next launch.
    Header set Cache-Control "no-cache"
    Header set Content-Security-Policy "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'self'; form-action 'none'"
    Header set X-Content-Type-Options "nosniff"
</Directory>
# Hashed build files never change; cache them for a year.
<Directory /home/webadmin/srv/mu-draw/production/web/assets>
    Header set Cache-Control "public, max-age=31536000, immutable"
</Directory>
# Production is public, like /chemtutor. For campus and VPN only, uncomment:
# <LocationMatch "^/draw(/|$)">
#     Require ip 10.0.0.0/8
#     ErrorDocument 403 "This app opens only on the campus network or VPN."
# </LocationMatch>
# mu-draw-production END
```

```bash
sudo tee /etc/systemd/system/mu-draw-api.service > /dev/null <<'UNIT'
[Unit]
Description=Naming API (production), served by Apache at /draw/api/
After=network.target
StartLimitIntervalSec=600
StartLimitBurst=5

[Service]
Type=simple
User=webadmin
Group=webadmin
# Runs the deployed copy, never the working tree.
WorkingDirectory=/home/webadmin/srv/mu-draw/production/server
Environment=PYTHONDONTWRITEBYTECODE=1
# Loopback only; Apache is the front door. No access log: no per-student records.
ExecStart=/home/webadmin/anaconda3/envs/mu-draw/bin/uvicorn main:app --host 127.0.0.1 --port 8050 --workers 1 --no-access-log
Restart=on-failure
RestartSec=3
TimeoutStopSec=20
NoNewPrivileges=yes
PrivateTmp=yes
ProtectSystem=full
ProtectHome=read-only
MemoryMax=512M

[Install]
WantedBy=multi-user.target
UNIT
sudo systemctl daemon-reload
sudo systemctl enable --now mu-draw-api
systemctl status mu-draw-api --no-pager
```

## (c) Later

- **Restarting after server changes.** deploy.sh can't restart services (no sudo). When
  `server/` or `environment.yml` changed it prints the command, for example
  `sudo systemctl restart mu-draw-api-staging`, and verifies only after the restart.
- **OPSIN (name to structure).** Needs Java, which isn't installed. Options: the system
  package `openjdk-21-jre-headless` (apt, applied by a person), OpenJDK from conda-forge
  inside the project env, or the EBI web service first. Undecided.
- **Rolling back.** Redeploy the last good commit through the normal path, so the files,
  server code and markers stay consistent: `git checkout <commit>`,
  `scripts/deploy.sh staging`, then `scripts/deploy.sh --production`.
- **Lookup cache.** The SQLite cache will live in `<target>/data`, outside the deployed
  code (deploys replace `server/`). Its unit will then need `ReadWritePaths=` for it.
- **Renaming the app.** Edit `app.config.json`, re-render this file, create the new conda
  env (`conda env create -n <new name> -f environment.yml`), redeploy to the new folders,
  apply the new Apache blocks and units, then remove the old ones.
