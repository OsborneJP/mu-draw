# AGENTS.md: handoff notes for Claude Code, Cursor and people

`CLAUDE.md` is a symlink to this file. Keep this file under 150 lines; check.sh enforces both.

## Purpose
A free, installable structure editor (PWA) that replaces ChemSketch Freeware for Manchester
chemistry students. Ketcher (drawing, Indigo wasm) and RDKit.js (properties) run in the
browser; a small FastAPI service on osbornelab does the two naming lookups. Spec: docs/SPEC.md.

## Invariants (never break these; each line names what enforces it)
"/draw/" means the configured base (`path` in app.config.json); staging is "/draw-staging/".
1. The browser makes no requests except to /draw/api/* and its own static files.
   Enforced by: the CSP from web/csp.json (meta tag + Apache header; checker
   web/scripts/checks/csp.ts allows only listed sources); the request guard on every
   smoke test (web/e2e/fixtures.ts); the built-HTML link check (web/scripts/checks/html.ts,
   incl. the relative icon link, since Playwright can't see /favicon.ico); Help/About hidden.
2. No accounts, student identifiers, analytics, or logging of request bodies.
   Enforced by: server/tests/test_privacy.py (a sentinel body never reaches logs), uvicorn
   `--no-access-log`, FastAPI telemetry off, Ketcher's Alt+Shift+R debug shortcut blocked
   (it put the drawing in the URL; web/src/editor/debugHotkeys.ts + online smoke test).
   Accounts and analytics: review only.
3. Chemistry values come only from RDKit, Ketcher/Indigo, OPSIN, or PubChem: never from an
   LLM and never hand-typed into code or tests.
   Enforced by: generated fixtures with drift tests (tests/fixtures/), and
   scripts/checks/chem_literals.py (no Molfile/CDXML/InChI text in source). SMILES and
   numeric literals in source: review only.
4. Everything except the naming endpoints works offline.
   Enforced by: the precache guard (web/scripts/checks/precache.ts, run by
   web/scripts/verify-dist.ts in every check.sh and deploy build, not by a bare
   `npm run build`) and the two "offline:" smoke tests.
5. ketcher-react, ketcher-standalone, and @rdkit/rdkit are pinned to exact versions.
   Enforced by: the pin test (web/config/pins.ts), which also covers ketcher-core.
6. Build only what's in "Version 1 features" and the NMR proof of concept. Nothing from
   "After v1" or "Later version".
   Enforced by: review. Ketcher's 3D viewer, macromolecules mode, create-monomer and
   structure-from-image are hidden (web/src/editor/ketcherUi.ts and editor.css); the smoke
   tests check each is absent or display:none, in the compact toolbar too.

## Commands
`<env>` is the conda env name: `python3 -I scripts/lib/appconfig.py --get ENV_NAME`.
`$ENV/bin` must come first on PATH for npm/node/python (system Node 18 is too old):
`export PATH="$(conda info --base)/envs/<env>/bin:$PATH"`.
- Setup once: `conda env create -n <env> -f environment.yml`, then (env on PATH)
  `cd web && npm ci && npx playwright install --no-shell chromium`.
- Check (before every commit and deploy): `scripts/check.sh`. Ends with `CHECK PASSED`;
  the full log is in `.check.log`. Run it as its own command; read its exit status.
- Dev server: API `uvicorn main:app --app-dir server --port <ports.dev>`; web
  `cd web && npm run dev` (proxies `<base>api/` to the API). Both with the env on PATH.
- Build: `cd web && npm run build` (staging base unless `BASE` is set).
- Deploy: `scripts/deploy.sh staging`, `scripts/deploy.sh --production`,
  `scripts/deploy.sh --smoke-only <staging|production>`. Production promotes only the
  commit that passed the live staging checks; live checks run from that commit.
- After changing scripts/deploy.sh or scripts/lib/deploy.sh: `python scripts/mutation_sweep.py`
  (~5 min) must report every line covered.
- Server config (Apache, systemd): `python scripts/render_server_config.py` rewrites
  docs/server-setup.md. A person applies it; agents never edit /etc.
- Fixtures: `python scripts/fetch_reference_smiles.py` (network; only when the compound list
  changes), then `python server/scripts/gen_reference_expected.py`.

## Layout (spec layout; "later" marks where future code goes)
- `app.config.json`: the only place the repo name, URL path and host are written.
- `web/src/editor/`: Ketcher wrapper, hidden UI, debug-key blocker; highlight helpers later.
- `web/src/chem/`: later: RDKit.js loader, descriptors, functional groups.
- `web/src/panels/`: later: properties, Lipinski, naming, export UI.
- `web/src/api.ts`: later: calls to `<base>api/*`.
- `web/src/pwa/`: service-worker registration (prompt mode).
- `web/public/`: icons; later functional-groups.json.
- `web/config/`: build-time config (base, PWA, CSP, pins). `web/scripts/`: post-build guards.
- `web/e2e/`: Playwright smoke tests.
- `server/main.py`: FastAPI (`/api/health`; later `/api/name`, `/api/structure`).
- `server/{pubchem,opsin,cache}.py`, `server/opsin/opsin.jar`: later.
- `scripts/`: check.sh, deploy.sh, `lib/` (config, web, deploy), `checks/`, generators.
- `tests/fixtures/`: generated chemistry, `recorded/` API responses, `chemdraw/` (Jeff's files).
- `docs/`: SPEC.md, server-setup.md (rendered, do not hand-edit).

## Conventions
- Never write the name or URL path literally; derive them from app.config.json via
  scripts/lib/appconfig.py (Python, shell) or web/config/app.ts. Markdown is exempt.
- The conda env is also the production runtime of the API services. Change it only through
  environment.yml + `conda env update --prune`, then refresh environment.lock.txt.
- Small commits, one task each, only after check.sh passes. Never `check.sh | tail && git
  commit`. Add user-visible changes to CHANGELOG.md and surprises to BUILD-LEARNINGS.md.
- Tests are deterministic: wait on events, locator states or web-first assertions with a
  final value fixed in advance (exact value or format marker); `expect.poll` only on an
  exact value. Never sleep, never retry, never wait "long enough". Force orderings.
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
- Adding a CDN, web font, analytics or any external URL, or loosening web/csp.json.
- Workbox drops files that `globPatterns` doesn't match, silently; the precache guard
  fails the build instead. Keep `wasm` in globPatterns and the 30 MB size limit.
- Letting base, manifest `scope`, `start_url` and `id` drift; all come from `pwaOptions(base)`.
- `^` or `~` on pinned packages, or forgetting ketcher-core.
- Ketcher under Vite: needs `define: { global: 'globalThis' }`, the `events` package, and
  `ketcher-standalone/dist/binaryWasm`. No React StrictMode around the Editor.
- Trusting Ketcher's `buttons.hidden` (its compact toolbar ignores it) or its config to
  disable debug shortcuts. Trusting `setMolecule()` to reject bad input (it can silently
  load a different molecule). Molfiles with chiral flag 0 open as AND enantiomers.
- RDKit's CDXML (`BondLength=""`) doesn't load in Indigo 1.46.
- `tsc --noEmit` on the solution-style tsconfig checks zero files; use `tsc -b`.
- Playwright's default headless shell always reports a page as installable; it never
  reports /favicon.ico requests; the `controllerchange` wait hangs in prompt mode;
  `navigator.serviceWorker.ready` never rejects (race it against `redundant`).
- `eval "$(cmd)"` under `set -e` ignores cmd failing; assign first, then eval.
- Calling `updateSW()` or posting SKIP_WAITING without the student clicking the banner.
- Sleeps, retries or real network calls in tests.
- Editing Apache or systemd directly instead of rendering docs/server-setup.md.
- Building After-v1 or Later features (3D view, practice mode, mechanism arrows, ...).
- `playwright uninstall --all`: other projects share ~/.cache/ms-playwright.
