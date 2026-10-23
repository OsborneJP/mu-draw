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
- rdChemDraw's CDXML has a DOCTYPE that names an external DTD URL. Parsers don't fetch
  it, but don't copy that URL anywhere the browser could request it.

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
  root for a favicon.
- Proven: a manifest without suitable icons makes Chrome's `Page.getInstallabilityErrors`
  return `manifest-missing-suitable-icon`, and the smoke test fails.
- @rdkit/rdkit 2026.9.1 exports only `.` and `./RDKit_minimal.wasm`: no `./package.json`
  and no `dist/` subpaths. The pin check and the wasm emitter read files by path instead.
  A small build plugin (config/rdkitWasm.ts) emits `rdkit/RDKit_minimal.wasm` (7.4 MB),
  so it is precached before any code imports RDKit. Precache is now 18 entries, 28 MB.
