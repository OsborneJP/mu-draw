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
  The root conftest.py gives each checkout its own temp root (`PYTEST_DEBUG_TEMPROOT`), 0.1 s.
  A fixed `--basetemp` was tried first, but concurrent runs (check.sh inside deploy.sh
  while another pytest runs) would share and wipe one folder; pytest's numbered,
  lock-protected run folders under the per-checkout root avoid that (tests/test_pytest_temp.py).
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
  to 1 when a tetrahedral centre is specified; a test proves the flag is present and
  that RDKit's default would be caught.
- RDKit's ChemDraw writer (rdChemDraw.MolToChemDrawBlock) emits an empty `BondLength=""`.
  Indigo 1.46 (Ketcher 3.18) can't parse it: Ketcher's Open dialog reports "Convert error!
  ... stoi: no conversion". Worse, `ketcher.setMolecule()` on the same text doesn't fail;
  it silently loads a different molecule (wrong InChIKey). Without that one attribute,
  the file loads with the correct InChIKey. So the generator writes no CDXML, and the
  editor test's CDXML leg uses a file saved by Ketcher. Jeff's ChemDraw files are the real
  cross-tool test. When the Open feature is built, don't trust setMolecule() to reject bad
  input: check what was loaded.

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
  `editor-ready`. The smoke's init script arms promises for both before any page script
  runs, so tests wait on events, not timers.
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
  because waiting for "Indigo ready" never resolves. Now every wait races the first guard
  problem, and the same failure is reported in about 1 s.
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
  (dropping `data:` passed both); the Open/Save test opens modals and does.
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
  - sw.js and the Indigo worker arrive with the CSP header (workers ignore the page's meta
    tag; without the preview header the test fails);
  - offline, every same-origin response after the reload must come from the service
    worker. With Apache-style `immutable` caching and the icons left out of the
    precache, Chrome answered the icon from its HTTP cache while offline; the old checks
    passed and the new one names the file. This is what keeps the live run honest.
