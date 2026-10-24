# AGENTS.md: handoff notes for Claude Code, Cursor and people

`CLAUDE.md` is a symlink to this file. Keep this file under 150 lines; check.sh enforces both.

## Purpose
A free, installable structure editor (PWA) that replaces ChemSketch Freeware for Manchester
chemistry students. Ketcher (drawing, Indigo wasm) and RDKit.js (properties) run in the
browser; a small FastAPI service on osbornelab does the two naming lookups. Spec: docs/SPEC.md.

## Invariants (never break these; each line names what enforces it)
"/draw/" means the configured base (`path` in app.config.json); staging is "/draw-staging/".
1. The app requests nothing except /draw/api/* and its own static files. Only a link the
   student clicks may leave it, and the only such link is Get name's PubChem compound page.
   Enforced by: the CSP from web/csp.json (meta tag + Apache header; checker
   web/scripts/checks/csp.ts allows only listed sources; the RDKit worker alone adds
   'unsafe-eval', web/csp-workers.json, and nothing else); the request guard and the link
   guard on every smoke test (web/e2e/fixtures.ts; links per web/config/requestPolicy.ts);
   the built-HTML link check (web/scripts/checks/html.ts, incl. the relative icon link,
   since Playwright can't see /favicon.ico); Help/About hidden.
2. No accounts, student identifiers, analytics, or logging of request bodies.
   Enforced by: server/tests/test_privacy.py (a sentinel body never reaches logs), uvicorn
   `--no-access-log`, FastAPI telemetry off, Ketcher's Alt+Shift+R debug shortcut blocked
   (it put the drawing in the URL; web/src/editor/debugHotkeys.ts + online smoke test).
   Accounts and analytics: review only.
3. Chemistry values come only from RDKit, Ketcher/Indigo, OPSIN, PubChem, or NMRShiftDB2
   (¹³C shifts): never from an LLM and never hand-typed into code or tests.
   Enforced by: generated fixtures with drift tests (tests/fixtures/; the ¹³C table's
   header names its SD file's SHA-256), and scripts/checks/chem_literals.py (no
   Molfile/CDXML/InChI text in source). SMILES and numeric literals in source: review only.
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
- Dev server: API `STATE_DIRECTORY=<dir> uvicorn main:app --app-dir server --port <port>`
  (ports.dev); web `cd web && npm run dev` (proxies `<base>api/`). Both with the env on PATH.
- Build: `cd web && npm run build` (staging base unless `BASE` is set).
- Deploy: `scripts/deploy.sh staging`, `scripts/deploy.sh --production`,
  `scripts/deploy.sh --smoke-only <staging|production>`. Production promotes only the
  commit that passed the live staging checks; live checks run from that commit.
- After changing scripts/deploy.sh or scripts/lib/deploy.sh: `python scripts/mutation_sweep.py`
  (~5 min) must report every line covered.
- Server config (Apache, systemd): `python scripts/render_server_config.py` rewrites
  docs/server-setup.md. A person applies it; agents never edit /etc.
- Fixtures (network only for new names): `python scripts/fetch_reference_smiles.py --missing`,
  then in server/scripts: gen_reference_expected, record_pubchem_names, record_name_lookups.
  ¹³C table: in web/, `node scripts/build-carbon-table.ts <nmrshiftdb2withsignals.sd>` (plans/nmr).

## Layout (spec layout; "later" marks where future code goes)
- `app.config.json`: the only place the repo name, URL path and host are written.
- `web/src/editor/`: Ketcher wrapper, autosave, hidden UI, debug-key blocker, image request
  queue, the ready Ketcher (instance.ts), drawing.ts (Molfile + atom ids), stereoHighlight.ts.
- `web/src/chem/`: rdkitWorker.ts (rdkitWorkers.ts starts copies), compute.ts (RDKit values),
  properties.ts (display rules), tracker.ts (request ordering), functionalGroups.ts (SMARTS,
  overlap rule), hose.ts (symmetry, HOSE codes), carbonTable.ts (¹³C table), nmr.ts (peaks).
- `web/src/panels/`: Export, Copy image (exportImage.ts), properties panel (+ FunctionalGroups,
  NmrButton), Get name, Name to structure (naming.ts: shared state; NamePanel floats over
  `.canvas-area`), NMR preview (nmr.ts state, nmrStore.ts wiring, NmrPanel docks below).
- `web/src/api.ts`: calls to `<base>api/*` (name, structure), with the 8 s deadline.
- `web/src/pwa/`: service-worker registration (prompt mode) and the banner's Reload.
- `web/src/shell/`: header, offline badge, About box, update banner.
- `web/public/`: icons; functional-groups.json (editable patterns); nmr/ (¹³C table, licence).
- `web/config/`: build-time config (base, PWA, CSP, pins). `web/scripts/`: post-build guards.
- `web/e2e/`: Playwright smoke tests. `test.use({ buildCopy: true })` + `publishSecondBuild`
  for update tests (local only); `relaunch()`, `newPage()`, `nextAutosave()` in fixtures.ts.
  export.spec.ts reads PNG headers, pixels and the clipboard back; `holdableRdkitReplies()` (in
  fixtures.ts) holds RDKit's replies; getname and nametostructure specs hold API answers.
- `server/main.py`: FastAPI `/api/health`, `/api/name`, `/api/structure` (`create_app()` takes
  test fakes); `chem.py` (RDKit), `pubchem.py` (rate limit, retry), `cache.py` (SQLite in
  `$STATE_DIRECTORY`), `opsin.py` runs `opsin/` (pinned jar + OpsinLines.java) on the env's Java.
- `scripts/`: check.sh, deploy.sh, `lib/` (config, web, deploy), `checks/`, generators.
- `tests/fixtures/`: generated chemistry, `recorded/` API responses, `*_responses.json` (e2e
  replays), `functional_group*` and `nmr*` (test sets; judgement provisional), `chemdraw/`.
- `docs/`: SPEC.md, server-setup.md (rendered, do not hand-edit), plans/ (acceptance bars).

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
- Playwright: full Chromium (`channel: 'chromium'`), a fresh profile per test, `retries: 0`.
- Server: SMILES and names arrive in POST bodies only; never log bodies or put user input
  in exceptions. When RDKit or httpx is first used, call `RDLogger.DisableLog('rdApp.*')`
  and set the `httpx` logger to WARNING (both echo input).
- The update banner reloads only when the student clicks it; every smoke test fails on a
  reload or SKIP_WAITING without that click (web/e2e/fixtures.ts, guards.spec.ts).
- Don't touch the chem-tutor project or its env. Don't install system packages.

## Common AI failure modes (each one has bitten or nearly bitten this project)
- Typing a SMILES, InChIKey, mass or count from memory, or copying the spec's checklist
  numbers ("glucose shows 4") into a test. Generate it with RDKit/PubChem; read the fixture.
- PubChem: `IsomericSMILES`/`CanonicalSMILES` are legacy (it silently answers `SMILES`/
  `ConnectivitySMILES`, so old code gets KeyError); an unknown structure is 200, `CID 0`.
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
  load a different molecule; it never rejects). Molfiles with chiral flag 0 open as AND
  enantiomers.
- Assuming Ketcher calls `onInit` once (3.18 calls it twice, the second up to ~1 s later),
  or that saved KET equals the live drawing (Ketcher moves drawings without a change
  event; compare InChIKey and relative positions). Pressing Undo/Redo keys in a test
  without waiting for the button state (Ketcher refreshes it 100 ms after a change).
- RDKit's CDXML (`BondLength=""`) doesn't load in Indigo 1.46.
- Asking Indigo for two images, or two conversions (`getSmiles`, `getMolfile()` without
  'v2000'), at once: with different drawings one never settles (src/editor/imageQueue.ts
  queues both; keep the provider). `exportImage('svg')` copies the canvas offset by
  Ketcher's toolbar, so the app's header clips it; use `generateImage`.
- RDKit.js needs `'unsafe-eval'` (embind's `new Function`): it runs only in rdkit/worker.js,
  never on the page. It defaults to legacy stereo perception (`configureRdkit` turns it off).
- `tsc --noEmit` on the solution-style tsconfig checks zero files; use `tsc -b`.
- Playwright's default headless shell always reports a page as installable; it never
  reports /favicon.ico requests; the `controllerchange` wait hangs in prompt mode;
  `navigator.serviceWorker.ready` never rejects (race it against `redundant`).
- `eval "$(cmd)"` under `set -e` ignores cmd failing; assign first, then eval.
- Calling `updateSW()` or posting SKIP_WAITING without the student clicking the banner.
  Expecting `updateSW()` to reload: in vite-plugin-pwa 2.0 it only posts SKIP_WAITING.
- Expecting a worker started once the service worker is active to reach the server (it can't).
- `playwright uninstall --all`: other projects share ~/.cache/ms-playwright.
