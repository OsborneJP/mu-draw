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
- Env size 965 MB; web/node_modules 636 MB; Playwright's Chrome for Testing (chromium-1248,
  full browser, `--no-shell`) 403 MB in the shared ~/.cache/ms-playwright, next to the
  base env's chromium-1187 (left alone). Disk free went from 14 GB to 13 GB.
- pytest's default temp root `/tmp/pytest-of-webadmin` is shared with other projects and
  held 438 MB of leftovers; pruning it made every run take ~33 s for 25 trivial tests.
  The root conftest.py gives each checkout its own temp root (`PYTEST_DEBUG_TEMPROOT`), 0.1 s.
  A fixed `--basetemp` was tried first, but concurrent runs (check.sh inside deploy.sh
  while another pytest runs) would share and wipe one folder; pytest's numbered,
  lock-protected run folders under the per-checkout root avoid that (tests/test_pytest_temp.py,
  which skips only when the caller chose the location: an earlier version keyed the skip on
  a flag the conftest set, so deleting the conftest block skipped the test instead of failing it).
- 2026-10-24: web/test-results kept every Playwright test's browser profile (about 50 MB
  each, about 4 GB a run, in each checkout). With two checkouts the disk reached 97% full
  (3.9 GB free), Chrome's storage quota shrank, and three service-worker tests failed with
  "service worker registered but no registration found". playwright.config.ts now keeps
  output for failures only (`preserveOutput`); a passing run leaves 8 kB. 12 GB free after.
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

## Reference fixtures

- PubChem resolved every name to exactly one record. Titles differ from typed names
  ("Acetaminophen", "Ibuprofen, (+-)-", "(-)-2-Butanol"), so the CSV keeps both. "glucose"
  is cyclic D-glucose (CID 5793), not the open-chain form the spec's checklist describes;
  that is "aldehydo-D-glucose" (CID 107526).
- `FindPotentialStereo(flagPossible=False)` lists only definite stereo elements; an
  unspecified centre (ibuprofen's, glucose's anomeric carbon) shows up only with
  `flagPossible=True`. The JSON stores both lists raw; the properties panel decides.
- RDKit writes Molfile chiral flag 0 by default, and Ketcher turns flag 0 into an AND
  stereo group, which makes Indigo's InChIKey non-standard. The generator sets the flag
  to 1 when a tetrahedral centre is specified. Tests check the flag is present, and that
  RDKit writes 0 when the property is never set, so the check would catch a lost setting.
- RDKit's ChemDraw writer (rdChemDraw.MolToChemDrawBlock) emits an empty `BondLength=""`.
  Indigo 1.46 (Ketcher 3.18) can't parse it: Ketcher's Open dialog reports "Convert error!
  ... stoi: no conversion". Worse, `ketcher.setMolecule()` on the same text doesn't fail;
  it silently loads a different molecule (wrong InChIKey). Without that one attribute,
  the file loads with the correct InChIKey. So the generator writes no CDXML, and the
  editor test's CDXML leg uses a file saved by Ketcher. Jeff's ChemDraw files are the real
  cross-tool test. When the Open feature is built, don't trust setMolecule() to reject bad
  input: check what was loaded.
- 2026-10-24 (Get name): 9 more names make 20 (`fetch_reference_smiles.py --missing` records
  only the new ones). "sodium acetate" was tried and dropped: PubChem has two records with
  the same InChIKey and SMILES, CID 31372 (its name lookup) and 517045 (its structure
  search), so it can't pass the check that a structure lookup returns the name's CID.
  Aniline replaced it. Salts and other duplicates get whichever record the structure search
  picks.
- PubChem's structure-to-name lookup (POST `compound/smiles/property/IUPACName,Title/JSON`)
  answers a structure it has no record of with HTTP 200 and `{"CID": 0}` (no name), not 404.
- The 3 invented structures join two reference compounds at each one's lowest-ranked carbon
  with an implicit H (a methyl). Two gain an undefined stereocentre at the join (the old
  isopropyl CH). PubChem answered `CID 0` for all three.

## Web toolchain

- TypeScript is 6.0.3: typescript-eslint 8.72 supports `>=4.8.4 <6.1.0`, so not TS 7.
- The root tsconfig.json is solution-style (`files: []` + references); `tsc --noEmit` on it
  checks nothing. check.sh runs `tsc -b`. Proven: a planted type error fails check.sh.
- eslint-plugin-react-hooks 7 reports `exhaustive-deps` as a warning; check.sh runs
  `eslint --max-warnings 0`. Proven: a planted missing dependency fails check.sh.
- Vitest 5 doesn't look for config in parent directories; its include list is explicit and
  excludes e2e/ so Playwright specs never run under Vitest.

## Ketcher under Vite

- Ketcher 3.18 builds with Vite 8 (Rolldown) using only `define: { global: 'globalThis',
  'process.env': '{}' }`, the `events` package and `ketcher-standalone/dist/binaryWasm`:
  no Node polyfill plugin, no worker config. Build: 2.5 s, ~960 MB peak RSS. Output: the
  11.8 MB `indigo-ketcher-1.46.0-*.wasm`, a 74 kB Indigo worker, a 7.9 MB main chunk.
- npm prints ERESOLVE "overriding peer dependency" for miew-react (React 19); install works.
- `npm run dev` works too (Ketcher loads, Indigo answers). The smoke guards flag Vite's HMR
  websocket there, so the smoke runs only against builds.
- Ketcher fires `struct-service-initialized` on window when Indigo is ready; our onInit fires
  `editor-ready` (since session 2: once the autosaved drawing is back and saving has
  started). The smoke's init script arms promises for both before any page script runs, so
  tests wait on events, not timers.
- Toolbar test IDs differ from button names: the 3D viewer is `3D Viewer button`,
  create-monomer is `create-monomer`, macromolecules mode is `polymer-toggler`. Each was
  confirmed present with hiding switched off, so the absence checks are not vacuous.
- Indigo's InChIKey for the RDKit (R)-2-butanol Molfile equals RDKit's, once the Molfile
  carries chiral flag 1.

## PWA

- vite-plugin-pwa 2.0 output: `sw.js` and `workbox-<hash>.js` at the dist root,
  `manifest.webmanifest`, 17 precache entries (21 MB) for this build.
- `registerSW()` reloads the page by default when a new worker takes control; a no-op
  `onNeedReload` turns that off (src/pwa/register.ts, with a test).
- Playwright never reports requests for URLs ending in `/favicon.ico`. A planted
  `fetch('/favicon.ico')` passed the request guard, while `/outside-probe.txt` failed it.
  index.html therefore declares a relative `<link rel=icon>`, so Chrome never asks the site
  root for a favicon. Since the smoke tests can't see that request, verify-dist checks the
  built index.html instead (web/scripts/checks/html.ts): an icon link must exist, and every
  href/src must stay under the base and name a file in the build. Proven: removing the
  link fails the build check.
- Proven: a manifest without suitable icons makes Chrome's `Page.getInstallabilityErrors`
  return `manifest-missing-suitable-icon`, and the smoke test fails.
- @rdkit/rdkit 2026.9.1 exports only `.` and `./RDKit_minimal.wasm`: no `./package.json`
  and no `dist/` subpaths. The pin check and the wasm emitter read files by path instead.
  A small build plugin (config/rdkitWasm.ts) emits `rdkit/RDKit_minimal.wasm` (7.4 MB),
  so it is precached before any code imports RDKit. Precache is now 18 entries, 28 MB.
- With the plugin's `includeManifestIcons` on and png/webmanifest in globPatterns, the
  manifest and icons were each precached twice (18 entries; identical revisions, so
  Workbox tolerated it). `includeManifestIcons: false` and no webmanifest glob gives 14
  unique entries; the guard's test asserts uniqueness on a real sw.js.
- The precache guard (web/scripts/checks/precache.ts) evaluates only the bracket-matched
  array literal from the minified sw.js in `node:vm` (unquoted keys, so not JSON).
  Proven on a real build: dropping `wasm` from globPatterns makes check.sh fail and name
  both wasm files. Refresh its fixture with `node scripts/capture-sw-fixture.ts`.
- Offline test: Playwright does report the Indigo dedicated worker's wasm response, and
  `fromServiceWorker()` is true after the reload with the server stopped and the context
  offline. No service-worker network requests and no failed requests after the reload.

## Content Security Policy

- One source, web/csp.json: the build injects it as a meta tag (build only, since Vite's
  dev server needs inline scripts), the test server sends it as a header (covering sw.js
  and the Indigo worker, which a meta tag can't), and Apache will send the same header.
- Proven: without `'wasm-unsafe-eval'`, Indigo's wasm fails to compile
  (`CompileError ... violates the following Content Security policy directive`) and the
  smoke tests fail. Before the fail-fast change they hung to the 3-minute deadline,
  because waiting for "Indigo ready" never resolves. Now the editor, service-worker and
  Open-dialog waits race the first guard problem, and the same failure is reported in
  about 1 s. (The Save dialog and response waits still end at their deadlines.)
- Each loosening of the CSP, and why: `'wasm-unsafe-eval'` (script-src) to compile the
  WebAssembly engines; `'unsafe-inline'` (style-src) because Ketcher's emotion/MUI UI
  inserts `<style>` elements; `data:` (img-src) because Ketcher's CSS has 17
  `url(data:...)` images (modal overlay, cursors, checkboxes, radio buttons) and placed
  images load as data: URLs. `blob:` was in img-src at first, but Ketcher's only blob:
  image is the structure-from-image preview, which v1 hides, so it was dropped.
- The CSP checker (web/scripts/checks/csp.ts) is an allowlist per directive, compared
  case-insensitively. Its first version was a denylist and let a bare host such as
  `fonts.gstatic.com`, `host:443`, `wss:` or `HTTPS:` through (milestone review).
- Accepted limit: no static scan of URL strings in dist. Bundles contain many URLs that are
  never requested (XML namespaces, licence text, links in hidden UI). Invariant 1 is
  enforced at runtime by the CSP and by the smoke tests' request guard.
- Ketcher's CSS has 17 `url(data:...)` images (see above), hence `img-src data:`. The online and offline tests don't render any of them
  (dropping `data:` passed both); the Open/Save test opens modals and does. Since session 3
  Export and Copy image need it too: the drawing's SVG reaches the canvas as a `data:`
  image (proven: without `data:` the export test fails with a CSP report, below).
- Proven: adding `https:` to connect-src fails verify-dist (and so check.sh and deploy).
- Proven: a planted `url(https://example.com/...)` background is reported twice, as a CSP
  violation and by the request guard (Playwright still reports the blocked request).
- Ketcher 3.18 honours `buttons: { help: { hidden: true } }` on first render, but when a
  resize re-lays out the toolbar into its compact form (e.g. 1280x720 to 640x480), Help and
  About come back inside the collapsed menus and stay after the window grows again. A
  resize during startup made the smoke test fail once in ~40 runs. Fix: editor.css hides
  every out-of-scope control by test id. The smoke test now forces the compact layout
  (the duplicated Save button is the positive signal it rendered) and requires each
  control to be absent or `display: none` itself, since "not visible" passes while the
  menu is closed. Proven: against the previous CSS it fails, listing help and about.

## Deploy

- The production build can't be a copy of the staging build: the base path is baked into
  asset URLs, the manifest scope and the service worker. `deploy.sh --production` rebuilds
  the commit that staging verified and runs the same `build_and_verify` (guards plus all
  smoke tests, offline included) before copying anything. First run (2026-10-23): passes
  locally at `/draw/`.
- rsync order matters for service workers: everything else, then the manifest, then
  index.html, then sw.js, then a `--delete` pass (tests/test_deploy_lib.py checks the order
  from rsync's own transfer log). A client that fetches the new sw.js early finds every
  file it lists already in place.
- deploy.sh never uses sudo. When server code changes it records the time, and the live
  check refuses to mark the commit verified until the unit was restarted after it.
- "Server code" means what the service runs: `SERVER_RUNS` in scripts/lib/deploy.sh,
  server/ without tests/ and scripts/ (main.py imports nothing from either). ship_server
  archives exactly that list and server_changed diffs exactly that list (plus
  environment.yml and its lock). Before, ship_server dropped tests/ and scripts/ but
  server_changed diffed all of server/, so on 2026-10-24 four deploys (staging and
  production) whose only server change was server/scripts/gen_reference_expected.py
  made Jeff restart an API for nothing. test_server_changed and
  test_publish_records_what_it_deployed fail if the two lists drift apart again.
- Deploy decisions live in scripts/lib/deploy.sh as small functions. deploy.sh is
  sourceable, so tests/test_deploy_lib.py also runs its real mode functions in temp repos,
  with a temp HOME and shell-function stubs for the build, check.sh, curl, systemctl and
  the smoke tests. Two review rounds in a row found guard calls that could be deleted
  with every test green; patching one review at a time kept missing some. So
  `scripts/mutation_sweep.py` now deletes each executable line of both deploy scripts in
  turn and fails if any deletion goes unnoticed. It reports 133 caught and 4 accepted
  survivors (help text and three equivalent mutants, each explained in the script). Run it
  after changing the deploy scripts; it takes ~5 min, so it isn't in check.sh.
- rsync needs `--checksum` here. git archive stamps files with the commit time, so a file
  with the same length in two commits made in the same second looked unchanged, and
  ship_server kept the old main.py. The new test found it. Its first version only failed
  when the test's commits landed in the same second; the test helper now gives every
  commit one fixed date, so it fails every time without `--checksum`.
- The web.prev rollback copy was dropped: restoring files alone left the markers and
  server/ naming another commit. Rollback = redeploy the last good commit via staging.
- The health probe now says what a failure means: 404 is Apache not configured, 403 is
  this host not in 10/8, 502/503 is the service down. It also requires `{"ok": true}`.
  ProxyPass has `retry=0`, so a request right after a restart isn't refused for 60 s.
- `eval "$(cmd)"` doesn't stop a `set -e` script when cmd fails (eval's status is that of
  the evaluated text). config.sh assigns first, then evals; a test proves the old form
  carried on after a config error.
- Ketcher 3.18's debug shortcut Alt+Shift+R ("qs-serialize") navigates to
  `?mol=<the whole Molfile>`, which would put a student's structure in Apache's access log
  (the spec promises structures never appear in URLs) and lose the drawing. Its `hidden`
  option sits at the wrong level in ketcher-react, so the buttons config can't disable it.
  src/editor/debugHotkeys.ts swallows the key in window's capture phase, before Ketcher's
  element listener. The online smoke test checks it with a document-level spy that must see
  a harmless Alt+Shift+Q but not Alt+Shift+R. Proven: without the blocker the URL becomes
  `.../?mol=(R)-2-butanol...V2000...` and the test fails. (Found by the milestone review.)
- Smoke checks added after the milestone review, each proven to fail when broken:
  - the Open dialog's "Open from image" tile exists and is `display: none` (hidden by
    editor.css; without the rule it shows as `flex`);
  - sw.js and the Indigo worker are served with the CSP header (workers ignore the page's
    meta tag; without the preview header the test fails). First version awaited
    `request.response()` on the requests for sw.js and the worker script, which sometimes
    never resolves (it hung to the 3-minute deadline in a check.sh run): the browser
    fetches a worker's own script before Playwright attaches to that worker, so the
    response event can be lost. Fetches made inside a running worker (the Indigo wasm)
    are reported reliably. The header is now fetched from the server with
    `context.request`;
  - offline, every same-origin response after the reload must come from the service
    worker. With Apache-style `immutable` caching and the icons left out of the
    precache, Chrome answered the icon from its HTTP cache while offline; the old checks
    passed and the new one names the file. This is what keeps the live run honest.
- check.sh's "tree unchanged" guard compares a content fingerprint (scripts/lib/tree.sh),
  not just `git status`, which shows " M" before and after however a test rewrites an
  already-modified file. Proven with a planted test that rewrote CHANGELOG.md.
- The pin check asserts the exact versions in web/config/pins.ts, not just the x.y.z form,
  so an engine upgrade is a deliberate edit that re-reads the 3.18 workarounds above.

## Review and accepted limits (2026-10-23, end of session 1)

Three capped review rounds ran at this milestone. Round 1 found 7 medium issues, round 2
found 1 medium, round 3 found incomplete deploy test coverage (closed by the mutation
sweep rather than another review round). Everything high or medium was fixed with a test
that fails without the fix. Accepted as known limits:
- Installing the PWA on Chrome for macOS is still to check by hand (Windows 11 Chrome and
  Edge passed; see below).
- SMILES strings and numbers typed into source are caught by review only (the static
  check covers Molfile, CDXML, InChI and InChIKey text).
- No static scan of URL strings in the built bundles (CSP and the request guard enforce
  invariant 1 at runtime).
- check.sh's own stages are checked by reading the script (tests/test_check_sh.py), not
  by running check.sh inside its tests.
- `require_unchanged` relies on `set -e` to stop after `require_clean_tree`; every caller
  is a top-level statement in a set -e script.
- (Resolved 2026-10-23: production is campus and VPN only for now, so the probe's 403
  advice about 10.0.0.0/8 holds for both targets. `PRODUCTION_CAMPUS_ONLY` in
  scripts/render_server_config.py switches it.)
- (Closed in session 2: the update banner now lets a student switch to a new build
  without closing every tab.)

## First live staging run (2026-10-23)

- Jeff applied docs/server-setup.md (a) with two prepared sudo scripts: one inserted the
  staging block into the live vhost (after checking the file's hash, with a backup and
  configtest-or-restore), one installed and started `mu-draw-api-staging`.
- `scripts/deploy.sh --smoke-only staging` passed at 613d133: the API through Apache, 8
  header/type checks, and all 4 Playwright tests against
  https://osbornelab.manchester.edu/draw-staging/, both offline tests included. This host
  reaches its own name at 10.95.20.32, inside the campus-only range.
- Manual install check (Jeff, 2026-10-23): the staging app installs and works offline
  (relaunched with Wi-Fi off, drew, saved and reopened a Molfile) in Chrome and Edge on
  Windows 11. Chrome on macOS: not yet checked.
- First production run (2026-10-23): `--production` stopped at the health probe (404), as
  docs/server-setup.md (b) says. Production is campus and VPN only for now
  (`PRODUCTION_CAMPUS_ONLY`). Jeff applied (b) with two prepared sudo scripts, as for
  staging: insert the rendered block after the staging block (vhost hash check, backup,
  configtest-or-restore), and install and start `mu-draw-api`. The service script's first
  health request printed `curl: (7) ... Couldn't connect`, before uvicorn had bound the
  port; its retry then got `{"ok":true}`. Recording the campus-only change was a commit,
  so HEAD had moved past the deployed one: `--smoke-only` refuses that, so staging was
  redeployed and production promoted again. Production verified at d231cbb: 14 Playwright
  tests on the production build, then the API, headers and 12 Playwright tests against
  https://osbornelab.manchester.edu/draw/ (the 2 update-banner tests skip live).
- Staging installs as "Structure Editor (staging)" and production as "Structure Editor",
  so the two installed apps can't be confused. The name comes from `appTitle(base)`
  (web/config/pwa.ts) and is set in both the manifest and the page title; verify-dist
  checks both for the target being built. The manifest `id` didn't change, so an
  installed staging app is renamed rather than duplicated. Chrome may ask to confirm the
  name change when it next updates the app.

## App shell: autosave (session 2, 2026-10-23)

- Probed before building: `setMolecule()` fires Ketcher's change event (it goes through
  the undo history), and `getKet()` serializes in the page with no Indigo round trip, so a
  localStorage write made from the change event is done before a reload can start.
- ketcher-react 3.18's `Editor` calls `onInit` twice for one Ketcher instance: once when
  the molecules editor is up, and again when its lazily loaded macromolecules editor
  mounts (it mounts even with `disableMacromoleculesEditor`), up to ~1 s later. The first
  autosave wiring started twice: every change was saved twice, and the second start
  restored the drawing again (moving it) and cleared the undo history under the student's
  first edits. KetcherEditor.tsx now starts once per Ketcher and fires `editor-init` on
  every call; e2e/autosave.spec.ts waits for the second one and requires one write per
  change. Proven: without the guard it sees 2 writes.
- Ketcher moves the whole drawing without a change event: `setMolecule()` centres the
  structure after its change event fires (`centerStruct` uses `update(action, true)`, no
  history), and placing a template near the canvas edge shifts everything later. So the
  saved KET can differ from the live drawing by a translation (and gains
  `stereoFlagPosition`); Redo also renumbers atoms. Harmless (a restore re-centres anyway),
  but tests compare drawings by InChIKey plus atom positions relative to the drawing's
  corner, sorted, never KET text across a load.
- Ketcher's toolbar state, which also decides whether the Undo/Redo keys act, refreshes
  through a 100 ms debounce. Two Ctrl+Z presses inside that window call `undo()` on an
  empty stack, which throws "Undo stack is empty" (a page error; nothing else happens).
  Tests wait for the Undo/Redo button state before each key press. A student pressing
  Ctrl+Z twice quickly at the start of the history gets only a console error.
- `setMolecule()` never rejects: Ketcher's `runAsyncAction` reports a failure on its event
  bus and resolves `undefined`. autosave.ts treats a throw the same as that (start
  empty; the next change replaces the unreadable copy).
- The restore's own undo step is removed with `editor.clearHistory()` (in Ketcher's Editor
  type). The toolbar's debounced refresh runs after it, so Undo shows disabled. Proven: without
  `clearHistory` the history after a reload is `{undo: 1}` and the test fails.
- Ketcher has a second, hidden copy of several test ids (`ketcher-canvas`, `undo`, `redo`)
  in its macromolecules UI; tests use the molecules canvas and visible buttons.

## App shell: update banner, header, About (session 2, 2026-10-23)

- vite-plugin-pwa 2.0's `updateSW()` ignores its `reloadPage` argument: it only posts
  SKIP_WAITING. The reload comes from the `controlling` listener, which calls our
  `onNeedReload` (a no-op, so no tab ever reloads by itself). So the banner's
  `applyUpdate()` reloads the page itself, once the waiting worker reports `activated`
  (or `redundant`). If another tab's click already made the new build active, nothing is
  waiting and it reloads at once; otherwise that tab's Reload button would do nothing.
  Proven: without that branch the two-tab test never sees the second tab reload.
- Playwright cannot serve a test a second build on a live site: `context.route('**/sw.js')`
  sees the first fetch of sw.js but not the browser's later update checks (neither
  `registration.update()` nor the check on navigation is routed or even reported, measured
  with Playwright 1.64). Vite's preview server reads files from disk per request, so the
  update tests serve their own copy of dist and edit it (`publishSecondBuild`: a marker in
  index.html and a new index.html revision in sw.js). They run in check.sh and in the
  production pre-copy build, and are skipped against SMOKE_URL.
- Tests call `registration.update()` to make the browser's update check happen at a known
  point; on a real relaunch the browser checks by itself.
- Every smoke test now fails if the page navigates away (reload included) or posts
  SKIP_WAITING to a service worker unless a trusted click on the banner's Reload button came
  first. A script's `location.reload()` fires the Navigation API's `navigate` event
  (cancelable, so the guard also stops it); Playwright's own `goto()`/`reload()` fire none
  in the old document, and Ketcher's Save dialog download carries `downloadRequest`.
  e2e/guards.spec.ts proves both guards live. Proven against the banner: calling
  `updateSW()` from `onNeedRefresh` trips the takeover guard; reloading in `onNeedReload`
  (the plugin's default) trips the navigation guard in the second tab.
- A tab opened with `context.newPage()` starts on about:blank, which is not a secure
  context and has no `ServiceWorker`; init scripts must not assume it.
- The header (title from index.html's `<title>`, so staging says so) costs the editor 36 px;
  Ketcher's toolbars re-lay out without problems, and the banner adds 40 px while shown.
- `context.setOffline()` flips `navigator.onLine` and fires `offline`/`online`, so the badge
  test waits on the badge itself. Proven: without the event listeners it fails.
- `scripts/deploy.sh staging` passed at 54d1860 (2026-10-23): check.sh (98 unit tests, 14
  Playwright tests), then 12 Playwright tests against the live /draw-staging/ (autosave
  offline and across a relaunch, the guards, header, About, smoke); the 2 update-banner
  tests skip there by design.

## Export and copy (session 3, 2026-10-23)

- Measured before designing (Ketcher 3.18, Chromium, the real CSP):
  - Ketcher's Save dialog offers "PNG Image" and "SVG Document" at one size, with no scale
    or background option. Its PNG has a transparent background.
  - `ketcher.exportImage('svg')` copies the on-screen canvas: its viewBox subtracts Ketcher's
    own toolbar sizes (54 px top, 50 px left) from screen coordinates and follows the zoom,
    so the app's 36 px header would shift and clip it. Not used.
  - `ketcher.generateImage(ket, { outputFormat })` renders in the Indigo worker with the
    student's Ketcher display settings (`editor.serverSettings`, bond length 40 px). Its SVG
    has a unitless (px) width and height, draws letters as paths (no fonts needed, so it
    looks the same in any program) and has no background unless asked. An empty drawing
    renders as a 4×4 SVG that draws nothing.
  - Indigo's own PNG can't be scaled exactly: caffeine is 218×169 at bond length 40 and
    408×322 at 80 (margins and fonts don't follow); `image-resolution` changes nothing. So
    every PNG is the SVG drawn on a canvas at 1x, 2x or 4x: exactly scale × the SVG's size.
  - The SVG reaches the canvas as a `data:` image (img-src allows `data:`; `blob:` was
    dropped). No CSP report, and the canvas stays readable (`toBlob` works). Chromium's
    canvas PNGs are always RGBA (colour type 6) with no pHYs chunk, even when opaque.
  - Ketcher has its own Copy Image (Mod+Shift+F, toolbar copy menu): the selection only,
    1x, white background. Kept, like its Save dialog's PNG and SVG.
- ketcher-standalone 3.18 answers every image request through one shared event, and each
  request listens `once`, keeping only an answer for its own input. With two requests for
  different drawings in flight, the first answer removes the second's listener and the second
  never settles (5 of 5 when forced; a later request works). Ketcher's Save dialog sits
  inside `.Ketcher-root` and doesn't cover the header, so a student could start both. The
  provider now queues image requests (src/editor/imageQueue.ts), which covers Ketcher's own
  callers too: ketcher-react binds the service's methods once, in `createApi()`.
  - The browser test forces the ordering: ask for another drawing and this one together,
    then this one again once the first answered. Proven: without the queue it fails in 2 s
    ("third" settles, "second" never does). Its first version asked for the other drawing
    the third time: unqueued, the second's late answer then removed the third's listener as
    well, so both hung and the test only failed at the 3-minute deadline.
  - Proven in unit tests: a pass-through queue fails both ordering tests; keeping a failed
    request in the chain (no `.catch`) fails the failure test at once (it races "started"
    against settling instead of waiting for a start that never comes).
- Downloads use an `<a download>` with a `blob:` URL revoked right after `click()`:
  Chromium keeps it readable for the navigation already started (the file arrived intact).
  The navigate event carries `downloadRequest` (the file name), so the fixtures' navigation
  guard lets it through, and Playwright reports no request for `data:` images or `blob:`
  downloads, so the request guard sees nothing new.
- Each PNG carries a pHYs chunk of 96 × scale dpi (3780, 7559, 15118 pixels per metre), so
  that Word places 1x, 2x and 4x at the same size (Jeff, 2026-10-24: the three PNGs
  inserted into Word looked as expected). The clipboard can't carry it: Chromium
  re-encodes a copied PNG (a white RGBA PNG read back as colour type 2, no pHYs), so a
  pasted image's size follows its pixels; Copy image uses 2x.
- Copy image calls `navigator.clipboard.write` inside the click, with a promise for the PNG
  (`ClipboardItem` accepts one), so the browser counts the write as the student's action
  however long the drawing takes. Headless Chromium with
  `grantPermissions(['clipboard-read', 'clipboard-write'])` on the persistent context reads
  `image/png` back.
- tsconfig.app.json (all of src/) has no Node types, so a unit test in src can't import
  `node:zlib`. exportImage.test.ts checks the CRC against the standard check value (CRC-32
  of "123456789" is 0xCBF43926); e2e/export.spec.ts checks real PNGs' pHYs CRC with
  `zlib.crc32`.
- Each guard was removed in turn, rebuilt, and its test failed (e2e/export.spec.ts):
  - no white fill: corner pixel `[0,0,0,0]`; transparent box ignored: corner alpha 255;
    scale ignored: wrong size; no `withDpi`: no pHYs chunk (all in the Export test);
  - `img-src` without `data:`: "guard tripped: csp: img-src blocked data" in 2 s. Its first
    run only failed at the 3-minute deadline, because the download wait didn't race the
    guards; every download, message and copy-state wait now does (`guarded()`);
  - Export's catch turned into a rethrow: "guard tripped: pageerror: the canvas could not be
    encoded as PNG" in 2 s; the same for Copy image's catch;
  - no empty-drawing check (Export or Copy): no "Nothing to ..." message. These fail at the
    30 s assertion deadline (the app saves or copies a blank image instead);
  - Copy image's staleness rule removed: `data-state` is "done" where "idle" is expected,
    2 s; not clearing on a change: stays "done" (30 s deadline);
  - Copy image's `png.catch` removed: first SURVIVED, because with clipboard permission
    granted Chrome reads the PNG promise itself. It matters when the browser refuses the
    write and never reads the PNG. The new test refuses the write, records
    `unhandledrejection` events (with preventDefault, so they don't trip the page-error
    guard), then waits for a deliberate "control" rejection: the HTML spec reports
    rejections in the order they happen, so a PNG failure reported before it fails the
    test (2 s).
- The tests check what the student gets, not the code: PNG width and height read from the
  file's IHDR are exactly scale × the SVG's width and height; pixels decoded in the browser
  (`createImageBitmap`); the SVG parsed with DOMParser and equal to Indigo's rendering of
  the drawing at that moment; the clipboard read back with `navigator.clipboard.read()`.
- Accepted limits: the empty-drawing and clear-on-change mutations fail at the 30 s
  assertion deadline rather than at once. Pasting into Word and Google Docs (Windows 11
  Chrome and Edge, macOS Chrome), opening the SVG in PowerPoint and printing a 4x PNG are
  checked by hand (inserting 1x, 2x and 4x PNGs into Word: done, see above).
- `scripts/deploy.sh staging` passed at 4171645 (2026-10-23): check.sh (108 unit tests, 21
  Playwright tests), then 19 Playwright tests against the live /draw-staging/, all 7 export
  tests included (the offline copy-and-download test, clipboard read back over HTTPS); the
  2 update-banner tests skip there by design.
- Production verified at 376b80b (2026-10-23): 21 Playwright tests on the production build,
  then the API, headers and 19 Playwright tests against https://osbornelab.manchester.edu/draw/
  (all 7 export tests). The first `--production` refused, because the docs commit recording
  the staging run had moved HEAD past the verified commit; staging was redeployed at HEAD
  (a docs-only change, same build) and production promoted. Next time, record the staging
  result after promoting, in one docs commit with the production result.

## Properties panel (session 4, 2026-10-24)

- RDKit.js 2026.9.1 can't start under the app's CSP. Emscripten's embind builds every
  binding with `new Function` (`createJsInvoker`, and the emval method callers), with no
  fallback, so `initRDKitModule()` rejects with an EvalError on the page and in a worker
  served with the page's policy (measured in Chromium with web/csp.json). Decided with Jeff
  (2026-10-24): RDKit runs in `rdkit/worker.js`, the one file served with the page's policy
  plus `'unsafe-eval'` (web/csp-workers.json); the page's policy is unchanged. Apache:
  `<Directory .../rdkit><Files "worker.js">Header set ...`, since `<Files>` applies after
  `<Directory>`, so its `Header set` replaces the page's. The test server sets the header
  per path in a `configurePreviewServer` middleware (config/csp.ts `cspHeaders`), which runs
  before the static files. Proven: the worker served with the page's policy shows
  "Properties are unavailable" and the panel tests fail.
- Playwright's `page.evaluate` is exempt from the page's eval rule (DevTools evaluation):
  `new Function` inside it works under the page's CSP, while a string `setTimeout` is
  blocked. So no test probes the page's policy that way; tests compare headers.
- Vite 8 names worker bundles with `worker.rolldownOptions.output.entryFileNames` (a
  function of the chunk name; the Indigo worker keeps its hashed name). Every build warns
  that RDKit's `node:fs` and `node:crypto` (its Node-only branches) were externalized.
- Measured in the worker: RDKit starts in about 60 ms with the wasm cached; cholesterol
  takes about 3 ms per drawing (67 ms the first time). No debounce: one request in flight,
  later changes collapse into one request for the newest drawing, stale replies dropped
  (src/chem/tracker.ts). All 27 compounds load and show in the browser in about 5 s.
- RDKit.js `get_descriptors()` equals the server's `rdMolDescriptors.Properties` bit for bit
  (27 compounds). It has no formula and no `FindPotentialStereo`. The formula is built from
  RDKit's atoms, with element symbols from RDKit itself (`[#z]`), in RDKit's order: C, then
  H, then alphabetical, and H stays second without carbon (`HCl`, boric acid `H3BO3`). Stereo
  elements come from `get_stereo_tags()` and whether each is defined from `get_json()`
  (atom `cw`/`ccw`, bond `cis`/`trans`); this matches `FindPotentialStereo(flagPossible=True)`
  on all 27 compounds and the 3 invented ones.
- RDKit.js defaults to the legacy stereo perception (`use_legacy_stereo_perception(false)`
  returns the old value, true). Legacy finds no centres in 1,4-dimethylcyclohexane (ring
  cis/trans), the current one finds 2, as the server does. It joined the fixtures as the
  proof; legacy and current agree on every other compound.
- With hydrogens drawn as atoms, RDKit counts the bond to a methyl as rotatable (the methyl
  carbon is no longer terminal). The worker parses twice: hydrogens folded in for
  descriptors, kept (`removeHs: false`) for atom indices, so stereo maps to Ketcher's atoms.
- Ketcher's `getMolfile()` without a format and `getSmiles()` go through Indigo's converter,
  which answers through one shared event with `once` listeners, like its images (see
  "Export and copy"): two conversions in flight can lose one. `getMolfile('v2000')`
  and `MolSerializer` write in the page. The writer clones the drawing in the order of
  `struct.atoms`, so Molfile atom i is the i-th key. Delete and Undo put the restored atom
  last under its old id; a test highlights through that order.
- Ketcher fires its change event once the action is applied: valence warnings and implicit
  hydrogens are current (measured: a ring attached to a carbon with four bonds; the warning
  was set at the event). A microtask deferral was written first, on the opposite
  assumption; removing it failed no test, so it was dropped.
- Ketcher underlines a sodium ion whose Molfile gives it an explicit valence of 0
  (`Na+(0)`), as RDKit's writer does for ions; RDKit reads it as the valid ion it is. So the
  panel gives Ketcher's valence warning only when RDKit can't read the drawing (a
  pentavalent carbon); otherwise it shows the values. Found by the sodium benzoate fixture.
- Fixtures: sodium benzoate replaced sodium acetate (two PubChem records, see above).
  Paraquat (+2) is the case where only the charge rule hides the degree of unsaturation
  (its formula gives a whole number); tetramethylammonium's single charge gives a half.
- Highlights: ketcher-react's `editor.highlights` goes through `update(action, true)`: no
  undo step, no change event, not in the KET autosave stores. `HighlightDelete` isn't
  exported, but `fromHighlightCreate` returns the performed action's inverse, which deletes
  exactly those highlights by id (an id already gone is skipped). Ketcher's Add explicit
  hydrogens rebuilds the drawing and drops every highlight, the student's included.
- The autosave test placed a ring at canvas x = 1000; with the 280 px panel that is off the
  canvas, and the test hung to its 3-minute deadline (it waits for a save). Moved to 600.
- Guard proofs (each removed in turn; its test failed): worker given the page's policy
  (panel tests 33 s, smoke header check 4 s); no `{failed}` message (the "cannot start"
  test); legacy perception left on (unit tests); descriptors with hydrogens as atoms
  (explicit-hydrogens test); no reaction, empty or not-elements check (messages test);
  Ketcher's valence flag alone stopping the values (sodium benzoate); stale replies shown,
  no coalescing, ids not mapped (tracker tests); Lipinski on raw values, minus zero, plain
  alphabetical formula, degree of unsaturation for ions (unit tests); the precache and
  worker-extras checks, the worker built elsewhere (verify-dist), the Apache worker section
  and check_live's worker policy (their tests); the highlight kept after a change, removed by
  clearing the shared list, made through the undo history, clickable while out of date,
  placed by Molfile index, undefined ones not set apart, double bonds skipped, the meso note
  at one element, the undefined count. The browser mutations fail at the 30 s assertion
  deadline unless a guard trips first.
- Accepted limits: values for polymer brackets are for the atoms as drawn. Once RDKit fails
  to start, the panel says so until the app is reloaded. Stereo counts are RDKit's potential
  stereo elements, so atropisomers (not perceived from 2D) aren't counted. The meso note
  shows for any two or more stereo elements.

## Get name (session 5, 2026-10-24, alongside the properties panel)

- Measured before building:
  - For all 27 reference compounds (20 for Get name, then the properties panel's 7 edge
    cases, a salt, two cations and boric acid among them), PubChem's structure search (POST
    with RDKit's canonical SMILES) returned the same CID and title as its name lookup. Unknown structures: 200 with
    `CID 0` (see Reference fixtures).
  - Ketcher 3.18's `getSmiles()` for each of the 30 generated Molfiles (Kekulé, its own atom
    order) canonicalizes with RDKit to exactly the fixture's canonical SMILES, stereo
    included (glucose's undefined anomeric centre, E and Z double bonds). The server
    canonicalizes before the cache and PubChem see anything, so recordings replay for any
    way of writing the structure.
  - Ketcher's DOM has no links out of the app, with its dialogs open and in the compact
    toolbar too: only the app's files and in-SVG `#fragment` references. The link guard
    needs no exception for Ketcher.
  - RDKit.js 2026.9.1 loads in Playwright's Node process (`createRequire`) and, with
    `use_legacy_stereo_perception(false)`, canonicalizes like the server (a test checks all 30).
  - The API unit has `ProtectHome=read-only` and deploys live under ~/srv, so the cache
    can't sit beside the code: `StateDirectory=` gives each unit /var/lib/<unit> as
    `$STATE_DIRECTORY`, and the service refuses to start without it.
- httpx's default timeout is also 5 s, so the first timeout test passed with the setting
  removed. It now patches `TIMEOUT_S` to 4 and checks the client gets 4.
- Playwright's `page.clock.install()` leaves time running, so checking "still waiting" after
  `fastForward(7999)` raced the real clock by 1 ms. The 8 s test installs the clock once the
  drawing is loaded, pauses it (`pauseAt`), then steps `runFor(7999)` and `runFor(1)`. The
  click, `getSmiles()` (Indigo's worker) and React need no page timers, so nothing stalls.
- A route-fulfilled 400 or 503 is a same-origin HTTP error to the guards. The busy and
  invalid tests accept exactly that problem, last (the first problem also rejects
  `app.failed`, so later `guarded()` waits would fail). The link test accepts the popup and
  its request the same way: the student's click is the only way out, and the guards still
  report it.
- ketcher-standalone's `convert` (behind `getSmiles()`, `getMolfile()`, the Save dialog's
  preview) has the image bug (above, Export and copy): one shared `Convert` event, a `once`
  listener per request that drops answers for other input. The properties session found it;
  measured here: asking for another drawing's conversion and this drawing's SMILES in one
  task, then the SMILES again, the third request settled and the second never did. Get name
  would then sit at "Naming…" (its 8 s deadline starts after the SMILES). imageQueue.ts now
  queues `convert` with the images; proven by e2e (`'third'` wins without it, 2 s) and a
  unit test. Ketcher's other worker commands (layout, clean, CIP, check...) share the
  pattern and stay unqueued (accepted: one at a time from the toolbar).
- MutationObserver's `attributeFilter` can't name a namespaced attribute, so the link guard
  reads `xlink:href` only when its element is added (accepted).
- This session shared the folder with the properties-panel session, so it worked in a git
  worktree (branch get-name, its own node_modules and dist), so their check.sh runs and builds
  couldn't collide; the fixture commit landed on main first.
- Each guard removed in turn, and the test that failed:
  - server (pytest, about 1 s each): `RDLogger.DisableLog` (test_privacy: RDKit echoed the
    sentinel to stderr); the stereo-perception setting; the httpx WARNING level; the rate
    limit (request times not [0]*5 + [1]*2); one of its windows; the retry; its 1 s wait;
    the second try; `CID 0` as no record; the cache write; the 30-day age; deleting expired
    rows; caching a busy answer; the `STATE_DIRECTORY` check; asking PubChem with the raw
    SMILES; sending an invalid structure; the length limit; the timeout (once fixed, above);
    `StateDirectory=` in the unit; check_live's Get name check;
  - link guard (Playwright, at the 30 s assertion deadline): the observer; `linkProblem()`
    allowing everything; no PubChem exception; attribute changes; form actions;
  - web, rebuilt each time (Playwright at the 30 s deadline): not greyed offline (in
    getname.spec and the offline smoke test); not greyed on an empty canvas; clickable while
    naming; a change not closing the panel; no 8 s deadline; a reaction sent; the link
    without `noopener noreferrer`; no stereo note; busy and invalid shown as not responding.
    Vitest, at once: a late answer not dropped; any link trusted; a deadline of 8001 ms; a
    request made after a change (this one at Vitest's 5 s timeout: the held fetch never ends).
- Accepted limits: two identical requests before either is cached each ask PubChem (both
  rate-limited); staging and production limit separately but share this host's IP;
  not-found answers are kept 30 days; enhanced stereo (AND/OR) is sent as absolute; several
  fragments are looked up as one (salts work, unrelated molecules usually get "no record");
  the live Get name checks ask PubChem (or the cache) and fail if PubChem renames aspirin
  (then re-record); most UI mutations fail at the 30 s assertion deadline, not at once.
- Staging and production, together with the properties panel (2026-10-24, db66dbb):
  `scripts/deploy.sh staging` ran check.sh (257 pytest, 267 Vitest, 45 Playwright tests,
  the live-only one skipped), shipped, and stopped for the API restart. Jeff then ran two
  prepared sudo scripts: the properties session's staging Apache block (rdkit/worker.js gets
  its own CSP; vhost hash checked, backup, configtest or restore) and the re-rendered staging
  unit (`StateDirectory=`) with a restart. That script's first health request came before
  uvicorn listened; its retry got `{"ok":true}`. `--smoke-only staging` passed: check_live's
  10 checks (POST api/name for aspirin answered as recorded, through Apache and PubChem; the
  worker's CSP), then 43 Playwright tests against /draw-staging/, all 14 Get name tests with
  the real lookup among them. 3 skip by design: the 2 update-banner tests and the properties
  panel's "if RDKit cannot start" (local only).
- Production verified at db66dbb: `--production` ran the same 45 Playwright tests on the
  production build before copying, then stopped for the restart. Jeff ran the production
  Apache block and unit scripts the same way (a dry run on a copy of the vhost changed only
  the 7-line rdkit section). `--smoke-only production` passed the same 10 checks and 43
  Playwright tests against /draw/. Recorded after promoting, in one docs commit.

## Name to structure (session 6, 2026-10-24)

- Measured before building:
  - No Java on the host; conda-forge has OpenJDK 21 and 25, but no OPSIN. OPSIN 2.9.0 is the
    latest release: opsin-core-2.9.0-jar-with-dependencies.jar, 5.1 MB, SHA-256 equal to the
    digest GitHub publishes for it, kept as server/opsin/opsin.jar with its MIT licence.
  - `conda env update --prune` has no dry run (conda 24.11), so it was rehearsed on a clone
    (`conda create --clone`, update, compare `--explicit` lists, remove). Re-solving would
    also have upgraded fastapi-core 0.161.1 to 0.162.0; it is now pinned (Jeff). The real
    update added only openjdk 21.0.10, 8 small libraries and a newer ca-certificates.
  - OPSIN as a child process (server/opsin/OpsinLines.java, run from source by the env's
    `java`): ready in about 1 s, 150 MB at rest, 242 MB at most under a flood of 3,800 names
    a second, with `-Xmx128m -XX:+UseSerialGC`. With the API's Python (about 86 MB with
    RDKit) that fits the unit's 512 MB, so the unit is unchanged. The jar's log4j has no
    provider and says so on stderr, which is discarded, like any OPSIN logging.
  - OPSIN reads most common names too (ibuprofen, caffeine, vanillin, dopamine, citric acid);
    only aspirin, Tylenol and DMSO fell through to PubChem. But its trivial names carry no
    stereo: "nicotine" and "adrenaline" came out with their centre undefined, while PubChem's
    records for those names are the natural (S) and (R) forms. Jeff decided (2026-10-24):
    when OPSIN leaves stereo undefined, the server checks PubChem's record for the name and
    draws it if it is the same compound (InChIKey's first block) with less undefined; the
    panel says so. Ibuprofen and hex-1-yn-3-ol keep OPSIN's (PubChem's are undefined too).
  - PubChem's name lookup takes the name in a POST form, so names stay out of URLs; an
    unknown name is a 404 with `PUGREST.NotFound` (the structure search says `CID 0` instead).
  - Ketcher 3.18's `addFragment()` puts a structure beside the drawing without overlap
    (checked three in a row) and is one Undo step; `setMolecule()` is one Undo step too.
    Each fires Ketcher's change event exactly once, before its promise resolves, so the
    panel ignores change events only while its own insertion is awaited.
  - For all 30 names, the Molfile the server draws (RDKit, chiral flag 1 when a centre is
    specified) loads in Ketcher with Indigo's InChIKey equal to RDKit's, stereo included.
  - 20 systematic names: OPSIN read all, and each equals PubChem's record for the name;
    PubChem doesn't know "(2R,3S)-2-bromo-3-chlorobutane" by name, but its round trip gives
    exactly that name. The misnumbered "4-methyl-3-pentanol" round-trips to
    2-methylpentan-3-ol, as the spec says.
- Fixture rebuilds through the app replayed PubChem at its real rate limit (5 a second), so
  rebuilding 60 answers took 8 s; replays now use an unpaced limiter (fresh per app, as an
  asyncio.Lock binds to one event loop). The Python suite is back to about 10 s.
- Each guard removed in turn, and the test that failed:
  - server (pytest, about 1 s each): the JVM's stderr discarded; the READY version check;
    killing a stuck or dead OPSIN (the test now checks the stuck process was killed, so the
    mutation fails at once instead of hanging the next parse); refusing a garbled answer;
    one name at a time; one-line names; the length limit; OPSIN first; the PubChem stereo
    check, its connectivity test, its "less undefined" test, and its tolerance of PubChem
    trouble; caching names, case-insensitively; only `PUGREST.NotFound` meaning no compound;
    the chiral flag; the CoordGen setting (RDKit's default is already off, so the test turns
    it on first); purging and expiring the structures table; check_live's structure check;
  - web, rebuilt each time (Playwright at the 30 s assertion deadline): the panel surviving
    its own insertion (first at the 3-minute test deadline: the test waited for a round
    trip that never comes; it now checks the drawn state first); the insertion flag being
    cleared; Add using `addFragment`; Enter adding to a drawing; greyed offline; a change
    during the lookup dropping the answer; Get name greyed during a lookup (first SURVIVED:
    the canvas was empty, so Get name was greyed anyway; the test now starts from a
    drawing); the PubChem-stereo note; OPSIN's message; the check mark; the round trip naming
    the server's SMILES. Vitest, at once: case-insensitive matching; refusing an unknown source.
- Accepted limits: the 30 names are provisional until Jeff sends CHEM-312's; OPSIN's messages
  are its own English, technical for a student; a name PubChem matches several ways gets its
  first record (the panel says how many); the name box's width (190 px) shows short names
  whole, long ones scroll; most UI mutations fail at the 30 s assertion deadline.
- Staging and production (2026-10-24, f638f12): `scripts/deploy.sh staging` ran check.sh
  (412 pytest, 289 Vitest, 57 Playwright tests, 2 live-only ones skipped), shipped server/
  with opsin/ (jar, helper, licence), and stopped for the API restart. No unit or Apache
  change was needed. After Jeff's `sudo systemctl restart mu-draw-api-staging` the service
  ran its OPSIN JVM from the deployed copy (131 MiB for the whole unit at rest), and
  `--smoke-only staging` passed: check_live's 11 checks (the new POST api/structure draws a
  systematic name, which proves Java and OPSIN run there), then 56 Playwright tests against
  /draw-staging/, the live Name to structure test (one OPSIN name, one PubChem name) among
  them; 3 skip by design. Production verified at f638f12 the same way: `--production` ran
  the 57 Playwright tests on the production build before copying, Jeff restarted
  mu-draw-api, and `--smoke-only production` passed the same 11 checks and 56 tests against
  /draw/. Recorded after promoting, in one docs commit.

## Functional-group highlighter (session 7, 2026-10-24)

- Plan and acceptance bar: docs/plans/functional-groups.md, written before building. The 25
  molecules and their expected groups (tests/fixtures/functional_groups_expected.json) were
  chosen by Claude (Jeff delegated it) and are provisional until he checks them against
  CHEM-312. The expectations were written by reading the structures before any pattern was
  run on them; all 25 matched on the first run, so no pattern was tuned to the set.
- Measured before building (RDKit.js 2026.9.1):
  - A query molecule's JSON (`get_qmol(...).get_json()`) has no atom map numbers, so a
    SMARTS can't mark "the group's atoms" with `:1` without a hand-written SMARTS parser.
    The convention instead: every atom the SMARTS matches is the group's (coloured,
    claimed); context sits inside recursive SMARTS `$(...)`.
  - `get_substruct_matches` answers `{}`, not `[]`, when nothing matches.
  - SMARTS `H` and `X` count drawn hydrogen atoms (`[CX4;H2][OX2H]` matches with every H
    drawn), so matching runs on the Molfile's own atoms and indices map to Ketcher's ids.
- The patterns are kept textbook-simple and the overlap rule separates them: on its own the
  ether pattern matches an ester's, an anhydride's and an epoxide's O, the ester pattern an
  anhydride, the amine patterns an amide's N (unit tests show each, so the rule is not
  vacuous). Matches of one group that share atoms merge (a carbonate is one ester, a
  fused ring system one arene).
- The worker's first version left the pattern fetch's rejection without a handler until
  RDKit had started; with a file that isn't JSON that was an unhandled rejection, which
  Playwright reports from a worker as a page error. Found by the "not JSON" test; the fetch
  is now settled at once.
- Playwright's `context.route` sees both the service worker's precache request for the
  pattern file and the RDKit worker's own; `route.request().serviceWorker()` tells them
  apart. The 404 test holds the worker's request until the editor is up (the guards report
  the 404, which would otherwise fail the start) and lets the precache request through.
- A dedicated worker started once the service worker is active is controlled by it
  (matched by its own URL), so its fetches come from the precache even on a first visit.
  The 404 test therefore also holds the service worker's precache request for the file,
  so it can't take over; without that the test depended on the RDKit worker starting first.
- The edited-copy tests (`buildCopy`) first skipped live runs inside the test body, after
  the fixture had already refused to copy a deployed site: the first live staging run
  failed both. They now skip at the describe level, as the update tests do.
- Ketcher ignores keys once a form control (the checkbox) has had the focus; tests click
  an empty corner of the canvas first. Ketcher's Add explicit hydrogens finishes after the
  click returns, so the test waits for RDKit's exact atom count, not the next state.
- Precache: 16 entries, 28.5 MB (the pattern file adds 3 kB).
- Each guard removed in turn, and the test that failed (Vitest at once; Playwright, rebuilt
  each time, at once): the overlap rule (8 tests: the molecules, the overlap tests, one
  colour per atom); merging; the priority sort; bonds only between a group's own atoms;
  each format check (colour, duplicate name, priority, unreadable SMARTS, no list);
  mapping groups' atoms and bonds to Ketcher ids (tracker); passing "unavailable" through;
  the precache check for the file; check_live's pattern check; dropping colours at a
  change ("follow the drawing"); colouring a new drawing's groups when its values arrive
  (the 25-molecule browser test); colouring only values for the drawing as it is now (the
  recorded highlight states show the old groups on the new drawing); unticking; the HTTP
  status check; settling the fetch at once; showing skipped patterns; colouring bonds.
- Accepted limits: 1°/2°/3° alcohols by the hydrogens on the carbinol carbon (methanol is
  1°; a hemiacetal OH is an alcohol and its ring O an ether); aryl halides, enols, imides
  (one amide), nitro groups and heteroaromatic rings (pyridine is not an arene) are not
  groups of their own; where the stereo highlight and a group mark the same bond (a
  stereogenic C=C is also an alkene), one colour covers the other; on a first visit the
  properties wait for the 3 kB pattern file.
- Staging and production (2026-10-24): ae6fe54 went to staging and stopped for the API
  restart (the fixture generator lives under server/, so deploy.sh asks for one); after
  Jeff's restart the first live run failed the two edited-copy tests (above). 0dd7350, with
  the fix, passed `scripts/deploy.sh staging` (check.sh, then check_live's 12 checks, the
  pattern file through Apache among them, and 62 Playwright tests; 6 skip by design).
  `--production` ran 66 Playwright tests on the production build, then stopped for the
  restart; after it, production passed the same 12 checks and 62 tests at 0dd7350.

## ¹³C NMR preview (session 7, 2026-10-24)

- Plan, licence findings and acceptance bar: docs/plans/nmr.md. Licences, checked first:
  current nmr-processing (22.25.6) is CC BY-NC-SA 4.0 and predicts ¹³C by calling Zakodium's
  web service (invariant 1 forbids it); v11.1.1 (MIT) needs the database supplied. The
  NMRShiftDB2 data is under the "nmrshiftdb2 Database License" (ODbL 1.0 plus a clause 4.5:
  software relying on the database for NMR prediction must be under an OSI-approved
  licence). Its official URL refused connections from here; the copy shipped
  (web/public/nmr/LICENSE-nmrshiftdb2.txt) is the Wayback Machine's 2024 capture. Jeff was
  asked about 4.5 (the repository is private and unlicensed) before anything ships.
- Data: nmrshiftdb2withsignals.sd from SourceForge (159 MB, 58,187 records, 43,258 ¹³C
  spectra; SHA-256 0e866883…3a0afe, also in the table header). Peaks are
  `shift;intensity+multiplicity;atom index`; the Solvent field numbers solvents by spectrum.
  The file is not in the repository; `node web/scripts/build-carbon-table.ts <file>`
  rebuilds the table, the excerpt and the reference spectra byte for byte (checked twice).
- Prototype on a random 2% of NMRShiftDB2 compounds held out (662 compounds, 7,085
  carbons): mean absolute error 2.55 ppm out to 5 bonds, 2.59 to 4 (60% of the codes),
  2.77 to 3; requiring two observations per code made it worse (2.70). By the sphere a
  match reached: 9.2 ppm at 1, 4.0 at 2, 2.1 at 3, 1.1 at 4, hence "low confidence" at 2
  or fewer. Marking a neighbour that has a double or triple bond further out ('u' in the
  code) helped on both sets (2.59 to 2.51; the 15 compounds 1.33 to 1.11) for 6% more codes;
  adding neighbours' hydrogen counts did not (the codes got too specific).
- The table as text was 17 MB (4 spheres) to 33 MB (5). Stored as a sorted 32-bit hash per
  code (delta varints) plus an 8-bit check and an int16 shift: 1.97 MB for 376,977 codes; a
  missing code matches by accident about once in 3 million lookups. Precache: 18 entries,
  30,508 KiB (29.8 MiB; 31.2 MB), up from 28,543 KiB; Workbox's limit is 30 MB per file.
- RDKit.js 2026.9.1 has no CanonicalRankAtoms. Topological symmetry is refined in
  src/chem/hose.ts (element, isotope, charge, aromaticity, hydrogens, degree, then
  neighbours' ranks and bonds) and equals server-side CanonicalRankAtoms(breakTies=False,
  includeChirality=False) on all 41 NMR and functional-group fixture compounds.
- A second worker from the same rdkit/worker.js (one `new URL` site in
  src/chem/rdkitWorkers.ts, so Vite emits one file): no new CSP entry or Apache change.
  It starts on the first prediction. A dedicated worker started after the service worker
  is active is controlled by it (matched by its own URL), so its table fetch is answered
  from the precache even on the first visit; the properties worker, started before, went
  to the network. So the "missing table" test 404s the service worker's request too.
- The panel first floated over the bottom of the canvas and covered the drawing; docked
  below it, it shortened the canvas and Ketcher, which keeps its view's top-left corner on
  resize, left the drawing's lower half behind its bottom toolbar (a test's click on a
  carbon hit the toolbar). The panel now moves the view down by half its height (a
  ResizeObserver; Ketcher's own resize sets only the view's size, so they commute) and
  says so in data-docked; the test checks every atom is on the open canvas.
  `centerViewportAccordingToStruct` was not used: it also changes the zoom.
- Sticks less than about a ppm apart overlap at 2.4 px per ppm; Playwright then waits
  forever for an unobstructed click. Rows select any peak; tests click isolated sticks.
- Held-out results for the 15 (structures from PubChem, measured shifts from their
  NMRShiftDB2 records, CDCl3 when there is one): every signal count right; 72 signals,
  mean absolute error 1.18 ppm, 64 (89%) within ±3 ppm. The 8 outside, recorded in
  tests/fixtures/nmr/outliers.json (predicted / measured ppm): toluene C1 141.9 / 137.8;
  p-cresol C-CH3 132.0 / 127.4 (DMSO-d6 only); benzaldehyde para 131.1 / 134.3;
  propanoic acid COOH 176.6 / 181.5; 2-butanol CH2 27.6 / 32.0; aniline para 123.6 /
  116.3; triethylamine CH2 47.3 / 51.4; cyclohexanamine C2/C6 30.6 / 37.2.
- Squalene (30 heavy atoms) predicts in about 2 ms in Node; in the browser the first
  prediction, worker start and table load included, is well under the 2 s bar.
- Each guard removed in turn, and the test that failed (Vitest at once; Playwright, rebuilt
  each time, at once): symmetry refinement (the 41-compound class test); ties ordered by
  rank, the 'u' flag, folding drawn hydrogens, the back-off, grouping equivalent carbons,
  carbons only, CDCl3 preferred (the acceptance tests); the low-confidence threshold, the
  dropped late answer, a change dropping the request, mapping atoms to Ketcher ids,
  remembering an RDKit failure (state tests); the check byte, dropping colliding codes,
  the length and magic checks (table tests; the magic check first SURVIVED, because the
  test's error page was shorter than a header and failed the length check first); the
  precache checks for the table and its licence; removing the colour on a state change,
  the canvas selection, the docked view's shift, the HTTP status check, the licence
  notice, the banner, the low-confidence label, `bin` in globPatterns (browser tests).
  Naming the NMR worker like the properties one first SURVIVED: the first prediction was
  slow enough that the change came before its answer anyway, so the ordering test didn't
  prove its hold worked. It now waits for exactly one held answer before releasing it.
- Accepted limits: topological symmetry merges carbons that are only stereochemically
  different (squalene's gem-dimethyls, cis and trans to the chain, give one peak where its
  spectrum has two; menthol's isopropyl methyls likewise); shifts are medians over all
  solvents; sticks closer than about a ppm overlap (the table selects any peak); the
  table describes 4 bonds out, so a substituent 5 bonds away (a benzoyl ring's para
  carbon) is seen only through the 'u' flag; ¹H prediction is "Later" in the spec.
- Going public (Jeff, 2026-10-24): LICENSE (MIT, Copyright (c) 2026 Jeff Osborne) was
  pushed before the repository was switched to public, so it was never public unlicensed.
  gh 2.45 has no `--accept-visibility-change-consequences`; the API call
  (`gh api -X PATCH repos/<owner>/<repo> -f visibility=public`) did it. GitHub read the
  licence as "Other" while a third-party note shared the file; with the MIT text alone and
  the note in THIRD-PARTY-NOTICES.md it says MIT. The history scan before the switch found
  no secrets or student data (author email and server details are public now).
- Staging and production (2026-10-25, bf81dd5): `scripts/deploy.sh staging` ran check.sh
  (420 pytest, 413 Vitest, 75 Playwright tests) and stopped for the API restart; after it,
  check_live's 14 checks (the ¹³C table and its licence through Apache added) and 69
  Playwright tests passed against /draw-staging/, the NMR tests among them (offline, and
  the 2 s timing over the network); 8 skip by design. `--production` ran the 75 tests on
  the production build, stopped for the restart, then passed the same 14 checks and 69
  tests against /draw/. Recorded after promoting, in one docs commit.
