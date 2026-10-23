# Build learnings

Surprises, workarounds and measured facts, newest at the bottom of each section.
Record why, not just what: the next person (or agent) should not have to rediscover it.

## Environment (osbornelab, 2026-10-23)

- System Node is 18.19.1 (too old for Vite 8, Vitest 5 and Ketcher 3.18). Node 24.22.1
  comes from conda-forge inside the project env; the system Node is untouched.
- The env's `npm` runs whichever `node` is first on PATH (its shebang is
  `/usr/bin/env node`), so with only `$ENV/bin/npm` it ran under Node 18. check.sh and
  deploy.sh put `$ENV/bin` first on PATH (scripts/lib/config.sh).
- The host's `.condarc` lists only Anaconda's defaults channels; environment.yml uses
  `conda-forge` + `nodefaults`. The lock (environment.lock.txt) has 0 packages from defaults.
- The base env has rdkit 2026.03.2, whose `chi2v`/`chi2n` descriptors return the chi3
  values (fixed in 2026.09.1). Never generate fixtures from base.
- conda-forge `fastapi` is now the `fastapi[standard]` metapackage (OpenTelemetry SDK, OTLP
  exporter, fastapi-cli). We use `fastapi-core`. FastAPI 0.161 also has native telemetry
  that defaults to on (`logs` records validation failures with messages); server/main.py
  turns every part off.
- Env size 965 MB. Disk free went from 14 GB to 13 GB.
- pytest's default temp root `/tmp/pytest-of-webadmin` is shared with other projects and
  held 438 MB of leftovers; pruning it made every run take ~33 s for 25 trivial tests.
  The root conftest.py gives each checkout its own `--basetemp` (0.1 s).
- pytest-socket with `--disable-socket` alone breaks TestClient (asyncio needs an AF_UNIX
  socketpair); `--allow-unix-socket` fixes it. It also blocks `getaddrinfo`, so a test
  can't leak a hostname through DNS either.

## Known going in (from planning research; confirm when hit)

- Ketcher 3.18 production builds under Vite are not CI-tested upstream (Ketcher builds
  with webpack); our Playwright smoke is the proof that ours works.
- ketcher-react and ketcher-standalone depend on `ketcher-core: "*"`, so ketcher-core is
  pinned directly. ketcher-core 3.18.0 imports Node's `events` without declaring it.
- Playwright's default `chromium-headless-shell` answers `Page.getInstallabilityErrors`
  with a stub that always returns `[]`; default contexts are incognito (`in-incognito`).
- workbox-build fails the build for glob-matched files over the size limit, but silently
  skips files that `globPatterns` doesn't match.
