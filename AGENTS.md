# AGENTS.md: handoff notes for Claude Code, Cursor and people

`CLAUDE.md` is a symlink to this file. Keep this file under 150 lines; check.sh enforces both.

## Purpose
A free, installable structure editor (PWA) that replaces ChemSketch Freeware for Manchester
chemistry students. Ketcher (drawing, Indigo wasm) and RDKit.js (properties) run in the
browser; a small FastAPI service on osbornelab does the naming and safety lookups. Spec: docs/SPEC.md.

## Invariants (never break these; each line names what enforces it)
"/draw/" means the configured base (`path` in app.config.json); staging is "/draw-staging/".
1. The app requests nothing except /draw/api/* and its own static files. Only a link the
   student clicks may leave it, and only to a compound's PubChem page (Get name, Safety).
   Enforced by: the CSP from web/csp.json (meta tag + Apache header; checker web/scripts/checks/
   csp.ts allows only listed sources; the RDKit worker alone adds 'unsafe-eval', web/csp-workers.json,
   and nothing else); the request and link guards on every smoke test (web/e2e/fixtures.ts; links per
   web/config/requestPolicy.ts); the built-HTML link check (checks/html.ts, incl. the relative icon
   link: Playwright can't see /favicon.ico); the GHS pictograms' allowlist (checks/svg.ts); Help/About hidden.
2. No accounts, student identifiers, or logging of request bodies; usage only as anonymous weekly
   totals (docs/plans/v2-usage-counts.md). Enforced by: test_privacy.py (a sentinel body never reaches
   logs), test_usage.py (week, item, count only), the fixture's count guard on every smoke test, Apache
   kept off api/count (rendered), uvicorn `--no-access-log`, telemetry off, Ketcher's Alt+Shift+R blocked
   (debugHotkeys.ts + online smoke test). Accounts: review only.
3. Chemistry values come only from RDKit (and the tables in its source: chem/rdkitTables.json),
   Ketcher/Indigo, OPSIN, PubChem, NMRShiftDB2 (¹³C, ¹H shifts), Biopython (Bjellqvist pKa values)
   or the faculty-checked IR table web/public/ir-bands.json (every band cites its sources; one marked
   "verify" is never shown): never from an LLM, never hand-typed into code or tests. Enforced by:
   generated fixtures with drift tests (tests/fixtures/; the NMR and RDKit tables' headers name their
   sources' SHA-256), irBands.test.ts, chem_literals.py (no Molfile/CDXML/InChI); SMILES, numbers: review.
4. Everything except the naming and safety lookups and the 3D view works offline.
   Enforced by: the precache guard (web/scripts/checks/precache.ts, run by web/scripts/verify-dist.ts
   in every check.sh and deploy build, not by a bare `npm run build`) and the "offline:" smoke tests.
5. ketcher-react, ketcher-standalone, @rdkit/rdkit, indigo-ketcher (Ketcher's own release) and 3dmol
   are pinned exactly. Enforced by: the pin test (web/config/pins.ts), also covering ketcher-core, lexical.
6. Build only "Version 1 features", the NMR proof of concept, and the "After v1" features
   Jeff has started, each with his approved plan in docs/plans/v2-*.md. Nothing else.
   Enforced by: review. Ketcher's 3D viewer, macromolecules mode, create-monomer and
   structure-from-image are hidden (web/src/editor/ketcherUi.ts and editor.css); the smoke
   tests check each is absent or display:none, in the compact toolbar too. Miew and Save's
   InChI formats are left out of the build, for their licences (web/config/ketcherTrim.ts).

## Commands
`<env>` is the conda env name: `python3 -I scripts/lib/appconfig.py --get ENV_NAME`.
`$ENV/bin` must come first on PATH for npm/node/python (system Node 18 is too old):
`export PATH="$(conda info --base)/envs/<env>/bin:$PATH"`.
- Setup once: `conda env create -n <env> -f environment.yml`, then (env on PATH)
  `cd web && npm ci && npx playwright install --no-shell chromium`.
- Check before every commit and deploy: `scripts/check.sh` (ends `CHECK PASSED`; log `.check.log`). Run it alone; read its exit status.
- Dev server: API `STATE_DIRECTORY=<dir> uvicorn main:app --app-dir server --port <port>`
  (ports.dev); web `cd web && npm run dev` (proxies `<base>api/`); build `npm run build` (staging base unless `BASE`).
- Licence notices (docs/plans/licence-notices.md): after a dependency upgrade verify-dist lists what ships differently;
  review it, then `DIST_DIR=dist node scripts/build-notices.ts --accept` (in web/) records it in third_party/notices/.
- Deploy: `scripts/deploy.sh staging`, `scripts/deploy.sh --production`,
  `scripts/deploy.sh --smoke-only <staging|production>`. Production promotes only the
  commit that passed the live staging checks; live checks run from that commit.
- After changing scripts/deploy.sh or lib/deploy.sh, `python scripts/mutation_sweep.py` (~5 min) must cover every line.
- Server config (Apache, systemd): `python scripts/render_server_config.py` rewrites
  docs/server-setup.md. A person applies it; agents never edit /etc.
- Fixtures (network only for new names): `python scripts/fetch_reference_smiles.py --missing`, then
  server/scripts/ gen_*, record_* and build_practice_lists (gen_rdkit_tables `--fetch`: RDKit source).
  In web/: `node scripts/build-{carbon,proton}-table.ts <sd>` (NMR), `scripts/gen-biochem-indigo.ts`.

## Layout (spec layout; "later" marks where future code goes)
- `app.config.json`: the only place the repo name, URL path and host are written.
- `web/src/editor/`: Ketcher wrapper, autosave, hidden UI, debug keys, image queue, instance.ts (ready
  Ketcher), drawing, stereoHighlight, placeInHand, templates/glassware.json, groups*, formula*, pictureScripts, templateReach,
  the ACS and hydrogen-label defaults (acsStyle.ts; acsStart.ts: main.tsx's first import).
- `web/src/chem/`: rdkitWorker.ts (rdkitWorkers.ts starts copies), compute.ts (RDKit values), properties.ts
  (display rules), tracker.ts (request ordering), functionalGroups.ts (SMARTS, overlap rule), hose.ts, carbonTable.ts,
  nmr.ts (¹³C), protonNmr.ts (¹H), stereoElements/-isomers/-Pictures.ts; tautomers.ts, resonance.ts (RDKit's C++
  ported onto rdkitForm.ts), formPictures.ts; biochem.ts (sequences, charge, pI), indigoBiochem.ts (biochemWorker.ts).
- `web/src/panels/`: Export, Copy image, properties panel (IR hints: chem/irBands.ts; BiochemSection.tsx,
  state biochem.ts), Get name, Name to structure (naming.ts; NamePanel floats), Templates (+ Glassware tab:
  glassware.ts); Practice, NMR previews, stereoisomers, tautomers/resonance (FormsPanel.tsx), Safety
  (ghsPictograms.ts) and 3D view (viewer3d.ts loads 3Dmol) dock below the canvas (Docked.tsx), one at a time
  (belowCanvas.ts): state in nmr/protonNmr/stereo/forms/safety/threeD.ts, *Store.ts wiring, panelWorker.ts.
- `web/src/`: api.ts (`<base>api/*`, 8 s), pubchemPage.ts; pwa/ (SW, updates, install offer); shell/ (header, About, banners); usage/ (counts).
- `web/public/`: icons; functional-groups.json; ir-bands.json; nmr/ (¹³C, ¹H); practice.json; glassware/; ghs/.
- `web/scripts/`: post-build guards. `web/e2e/`: Playwright smoke tests. `test.use({ buildCopy: true })` + `publishSecondBuild`
  for update tests (local only); `relaunch()`, `newPage()`, `nextAutosave()` in fixtures.ts.
  export.spec.ts reads PNG headers, pixels and the clipboard back; fixtures' `holdable{Rdkit,Indigo,Biochem}Replies()`
  hold workers' replies; naming specs hold API answers. `web/config/`: build-time config (base, PWA, CSP, pins).
- `server/main.py`: FastAPI `/api/health`, `name`, `structure`, `safety`, `conformer`, `count` (`create_app()` takes
  fakes); `chem.py` (RDKit), `pubchem.py` (rate limit, retry), `ghs.py` (PubChem's GHS), `threed.py` (3D
  models: RDKit.js can't embed), `cache.py` (SQLite in `$STATE_DIRECTORY`), `usage.py`, `opsin.py` (jar, Java).
- `scripts/`: check.sh, deploy.sh, usage_report.py, `lib/`, `checks/`, generators (build_glassware.py
  cuts web/public/glassware/ from third_party/glassware/: PD/CC0 originals, pieces.json; build_indigo_source.py
  makes third_party/indigo-source/, the InChI and cairo source the app ships: redo it when indigo-ketcher changes).
- `tests/fixtures/`: generated chemistry, `recorded/` API responses, `*_responses.json` (e2e
  replays), `functional_group*`, `nmr*`, `proton_nmr*`, `proton_rule*` (test sets; judgement provisional), `chemdraw/`.
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
- No test touches the network (pytest-socket; a Vitest fetch stub); naming tests replay tests/fixtures/recorded/.
- Playwright: full Chromium (`channel: 'chromium'`), a fresh profile per test, `retries: 0`.
- Server: SMILES and names arrive in POST bodies only; never log bodies or put user input
  in exceptions. When RDKit or httpx is first used, call `RDLogger.DisableLog('rdApp.*')`
  and set the `httpx` logger to WARNING (both echo input).
- The update banner reloads only when the student clicks it; every smoke test fails on a
  reload or SKIP_WAITING without that click (web/e2e/fixtures.ts, guards.spec.ts).
- Don't touch the chem-tutor project or its env. Don't install system packages.

## Common AI failure modes (each one has bitten or nearly bitten this project)
- Typing a SMILES, InChIKey, mass, count or IR band from memory, or copying the spec's checklist
  numbers ("glucose shows 4") into a test. Generate it with RDKit/PubChem; read the fixture.
- PubChem: `IsomericSMILES`/`CanonicalSMILES` are legacy (it silently answers `SMILES`/
  `ConnectivitySMILES`, so old code gets KeyError); an unknown structure is 200, `CID 0`.
- Using the base conda env's Python (old rdkit, chi2v/chi2n bug) or system Node 18 (check.sh asserts both).
- Adding a CDN, web font, analytics or any external URL, or loosening web/csp.json.
- Workbox drops files that `globPatterns` doesn't match, silently; the precache guard
  fails the build instead. Keep `wasm` in globPatterns and the 30 MB size limit.
- Letting base, manifest `scope`, `start_url` and `id` drift; all come from `pwaOptions(base)`.
- `^` or `~` on pinned packages, or forgetting ketcher-core or indigo-ketcher.
- Ketcher under Vite: needs `define: { global: 'globalThis' }`, the `events` package, and
  `ketcher-standalone/dist/binaryWasm`. No React StrictMode around the Editor.
- Trusting Ketcher's `buttons.hidden` (its compact toolbar ignores it) or its config to disable
  debug shortcuts. Trusting `setMolecule()` to reject bad input (it can silently load a
  different molecule; it never rejects). Molfiles with chiral flag 0 open as AND enantiomers.
- Assuming Ketcher calls `onInit` once (3.18 calls it twice, the second up to ~1 s later),
  or that saved KET equals the live drawing (Ketcher moves drawings without a change
  event; compare InChIKey and relative positions). Pressing Undo/Redo keys in a test
  without waiting for the button state (Ketcher refreshes it 100 ms after a change).
- Indigo 1.46: RDKit's CDXML (`BondLength=""`) doesn't load; a sequence needs Ketcher's monomer library.
- Asking Indigo for two images, or two conversions (`getSmiles`, `getMolfile()` without
  'v2000'), at once: with different drawings one never settles (src/editor/imageQueue.ts
  queues both; keep the provider). `exportImage('svg')` copies the canvas offset by
  Ketcher's toolbar, so the app's header clips it; use `generateImage` (it rasterises an SVG
  image at its own width and height and drops its text). Ketcher can't rotate or flip images.
- RDKit.js needs `'unsafe-eval'` (embind's `new Function`): it runs only in rdkit/worker.js,
  never on the page. It defaults to legacy stereo perception (`configureRdkit` turns it off). It has no
  tautomer or resonance code: port RDKit's, test it against Python (both atom-order bound).
- `tsc --noEmit` checks zero files here (use `tsc -b`). Vitest 5's disk cache froze globs (off).
- Playwright's default headless shell always reports a page as installable; it never
  reports /favicon.ico requests; the `controllerchange` wait hangs in prompt mode;
  `navigator.serviceWorker.ready` never rejects (race it against `redundant`).
- `eval "$(cmd)"` under `set -e` ignores cmd failing (assign first). `playwright uninstall --all` (shared cache).
- Trusting a Web Lock to make tabs agree on localStorage (each tab caches it): use IndexedDB, awaiting commits.
- Calling `updateSW()` or posting SKIP_WAITING without the student's click, or expecting `updateSW()`
  to reload (2.0 only posts SKIP_WAITING). A worker started once the SW is active can't reach the server.
