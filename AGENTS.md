# AGENTS.md: handoff notes for Claude Code, Cursor and people

`CLAUDE.md` is a symlink to this file. Keep this file under 150 lines; check.sh enforces both.

## Purpose
A free, installable structure editor (PWA) that replaces ChemSketch Freeware for Manchester
chemistry students. Ketcher (drawing, Indigo wasm) and RDKit.js (properties) run in the
browser; a small FastAPI service on osbornelab does the two naming lookups. Spec: docs/SPEC.md.

## Invariants (never break these; each line names what enforces it)
"/draw/" means the configured base (`path` in app.config.json); staging is "/draw-staging/".
1. The browser makes no requests except to /draw/api/* and its own static files.
   Enforced by: CSP from web/csp.json (meta tag + Apache header), the Playwright request
   allowlist (smoke test 2b), Ketcher Help/About hidden, relative `<link rel=icon>`.
2. No accounts, student identifiers, analytics, or logging of request bodies.
   Enforced by: server/tests/test_privacy.py (a sentinel body never reaches logs), uvicorn
   `--no-access-log`, FastAPI telemetry off. Accounts and analytics: review only.
3. Chemistry values come only from RDKit, Ketcher/Indigo, OPSIN, or PubChem: never from an
   LLM and never hand-typed into code or tests.
   Enforced by: generated fixtures with drift tests (tests/fixtures/), and
   scripts/checks/chem_literals.py (no Molfile/CDXML/InChI text in source). SMILES and
   numeric literals in source: review only.
4. Everything except the naming endpoints works offline.
   Enforced by: the precache guard (web/scripts/check-precache.mjs), offline smoke test 3.
5. ketcher-react, ketcher-standalone, and @rdkit/rdkit are pinned to exact versions.
   Enforced by: the pin test (also covers ketcher-core, which Ketcher declares as "*").
6. Build only what's in "Version 1 features" and the NMR proof of concept. Nothing from
   "After v1" or "Later version".
   Enforced by: review; Ketcher's 3D viewer, macromolecules mode and structure-from-image
   are hidden (one constant in web/src/editor/, with a test).

## Commands
`<env>` is the conda env name: `python3 -I scripts/lib/appconfig.py --get ENV_NAME`.
- Setup once: `conda env create -n <env> -f environment.yml`, then
  `cd web && npm ci && npx playwright install --no-shell chromium`.
- Check (before every commit and deploy): `scripts/check.sh`. Ends with `CHECK PASSED`;
  the full log is in `.check.log`. Run it as its own command; read its exit status.
- Dev server: API `uvicorn main:app --app-dir server --port <ports.dev>` with the env's
  bin first on PATH; web `cd web && npm run dev` (proxies `<base>api/` to the API).
- Build: `cd web && npm run build` (staging base unless `BASE` is set).
- Deploy: `scripts/deploy.sh staging`, `scripts/deploy.sh --production`,
  `scripts/deploy.sh --smoke-only <staging|production>`. Production promotes only the
  commit that passed the live staging smoke.
- Server config (Apache, systemd): `python scripts/render_server_config.py` rewrites
  docs/server-setup.md. A person applies it; agents never edit /etc.
- Fixtures: `python scripts/fetch_reference_smiles.py` (network; only when the compound list
  changes), then `python server/scripts/gen_reference_expected.py`.

## Layout (spec layout; "later" marks where future code goes)
- `app.config.json`: the only place the repo name and URL path are written.
- `web/src/editor/`: Ketcher wrapper and hidden-UI config; highlight helpers later.
- `web/src/chem/`: later: RDKit.js loader, descriptors, functional groups.
- `web/src/panels/`: later: properties, Lipinski, naming, export UI.
- `web/src/api.ts`: later: calls to `<base>api/*`.
- `web/src/pwa/`: service-worker registration (prompt mode).
- `web/public/`: icons; later functional-groups.json.
- `web/scripts/`: post-build guards. `web/e2e/`: Playwright smoke.
- `server/main.py`: FastAPI (`/api/health`; later `/api/name`, `/api/structure`).
- `server/{pubchem,opsin,cache}.py`, `server/opsin/opsin.jar`: later.
- `scripts/`: check.sh, deploy.sh, `lib/` (config), `checks/` (static checks), generators.
- `tests/fixtures/`: generated chemistry, `recorded/` API responses, `chemdraw/` (Jeff's files).
- `docs/`: SPEC.md, server-setup.md (rendered, do not hand-edit).

## Conventions
- Never write the name or URL path literally; derive them from app.config.json via
  scripts/lib/appconfig.py (Python, shell) or the web config module. Markdown is exempt.
- The conda env is also the production runtime of the API services. Change it only through
  environment.yml + `conda env update --prune`, then refresh environment.lock.txt.
- Small commits, one task each, only after check.sh passes. Never `check.sh | tail && git
  commit`. Add user-visible changes to CHANGELOG.md and surprises to BUILD-LEARNINGS.md.
- Tests are deterministic: wait on events or exact values, never sleep, never retry. The
  only allowed polling is `expect.poll` on an exact expected value. Force orderings.
- Every bug fix gets a test that fails without it; every guard has a negative test.
- No test touches the network (pytest-socket; a Vitest fetch stub). Naming tests replay
  recorded responses from tests/fixtures/recorded/.
- Playwright: full Chromium (`channel: 'chromium'`), a fresh persistent profile per test,
  `retries: 0`.
- Server: SMILES and names arrive in POST bodies only; never log bodies or put user input
  in exceptions. When RDKit or httpx is first used, call `RDLogger.DisableLog('rdApp.*')`
  and set the `httpx` logger to WARNING (both echo input).
- The update banner reloads only when the student clicks it.
- Don't touch the chem-tutor project or its env. Don't install system packages.

## Common AI failure modes (each one has bitten or nearly bitten this project)
- Typing a SMILES, InChIKey, mass or count from memory, or copying the spec's checklist
  numbers ("glucose shows 4") into a test. Generate it with RDKit/PubChem; read the fixture.
- PubChem property names: `IsomericSMILES`/`CanonicalSMILES` are legacy. PubChem silently
  answers with `SMILES`/`ConnectivitySMILES`, so old code fails with KeyError.
- Using the base conda env's Python (older rdkit with a chi2v/chi2n bug) or the system
  Node 18. check.sh puts the env first on PATH and asserts both versions.
- Adding a CDN, web font, analytics or any external URL. Everything ships from our origin.
- Workbox drops files that `globPatterns` doesn't match, silently; the precache guard
  fails the build instead. Keep `wasm` in globPatterns and the 30 MB size limit.
- Letting base, manifest `scope`, `start_url` and `id` drift; all come from `pwaOptions(base)`.
- `^` or `~` on pinned packages, or forgetting ketcher-core.
- Ketcher under Vite: needs `define: { global: 'globalThis' }`, the `events` package, and
  `ketcher-standalone/dist/binaryWasm`. No React StrictMode around the Editor.
- `tsc --noEmit` on the solution-style tsconfig checks zero files; use `tsc -b`.
- Playwright's default headless shell always reports a page as installable; the
  `controllerchange` wait hangs in prompt mode; `navigator.serviceWorker.ready` never
  rejects (race it against the worker going `redundant`).
- Calling `updateSW()` or posting SKIP_WAITING without the student clicking the banner.
- Molfiles with chiral flag 0 open in Ketcher as AND enantiomers (non-standard InChIKey).
- Sleeps, retries or real network calls in tests.
- Editing Apache or systemd directly instead of rendering docs/server-setup.md.
- Building After-v1 or Later features (3D view, practice mode, mechanism arrows, ...).
- `playwright uninstall --all`: other projects share ~/.cache/ms-playwright.
