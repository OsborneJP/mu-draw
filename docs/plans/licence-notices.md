# Ship the third-party licence notices with the app

Requested by Jeff on 2026-10-28, after a sweep found that the app sent to students carries almost no notices for the code it bundles.

**Approved by Jeff on 2026-10-29, with the proposed answer to all six decisions.** Review round 3 then showed decision 5 was framed on a misreading of InChI §15. **Jeff re-decided it the same day: hide the three InChI formats in Save for good, with no letter to the InChI Trust.** The other five answers stand.

This is an engineering reading of the licences, not legal advice. The points a lawyer would look at are collected under "For counsel, if wanted".

## What ships today, and what is missing
Every build sends the browser, and precaches, about 32 MB, of which the two wasm files are 19 MB. Research on 2026-10-28 traced its contents.

**npm code: 142 packages.**
- **Licences:** mostly MIT; also ISC, BSD-2/3-Clause, Apache-2.0 (Ketcher, Indigo, cfb, and Eve inside raphael) and 0BSD. Nothing copyleft, once GLmol (inside 3Dmol) is taken under its MIT option. The exception is one Miew file (decision 4).
- **Copies inlined in other packages' prebuilt bundles,** most with no banner. They were found through source maps, lockfiles and version strings:
  - Ketcher: ketcher-macromolecules, immer, Redux Toolkit, d3 packages, Node's `events` polyfill and a vendored `subscription`.
  - 3Dmol: pako 2.1.0 and 1.0.11, iobuffer, netcdfjs, upng-js, and EDTSurf, mol*, mmtf and an MIT-licensed FXAA shader.
  - Miew: spin.js and Smooth.js.
  - raphael: Eve.
- **Odd cases:**
  - intersection-observer's file says W3C licence, but its package says Apache-2.0;
  - element-closest-polyfill has no copyright holder anywhere;
  - Ketcher's npm packages ship no LICENSE or NOTICE file.
- **What is missing:** minifying strips every licence comment, and no licence file for the bundled code ships. The only licence file is nmrshiftdb2's, for its data. About names only Ketcher, RDKit and 3Dmol, without their texts.
- **Vite's own option falls short.** Vite 8's `build.license` lists 136 of the 142 packages, 131 of them with a LICENSE text. It misses:
  - the worker builds (RDKit, Indigo) and the service worker's Workbox;
  - everything inlined;
  - NOTICE files.

**Inside the Indigo wasm** (indigo-ketcher 1.46.0, built from Indigo commit b36d38f5; the wasm's own version string names it, and Indigo's CI configuration names Emscripten 5.0.7):
- Indigo (Apache-2.0).
- **InChI 1.06, modified by EPAM in four files**, with Brainspark's SHA-2 code. Its sources carry the IUPAC/InChI-Trust InChI Licence No. 1.0, an LGPL-style licence.

  MIT headers start with 1.07. The InChI repo's root MIT LICENSE file also sits at the v1.06 tag, but whether that relicenses 1.06 is undecided (IUPAC-InChI/InChI issue 8).
- **cairo 1.17.4, modified by EPAM.** Most files are under "LGPL 2.1 or, at the recipient's option, MPL 1.1". A few, such as cairo-pattern.c and the scan converters, are under MIT-style or HPND terms.
- Permissive libraries:
  - pixman (MIT and HPND);
  - FreeType 2.12.1 (FTL, plus MIT-style notices on its BDF, PCF and hash code);
  - libpng (libpng-2.0), zlib and tinyxml2 (Zlib), RapidJSON and cppcodec (MIT), object_threadsafe (Apache-2.0);
  - lunasvg;
  - plutovg, which brings FTL-only rasteriser files and stb code (public domain or MIT).
- Four Noto Sans fonts (OFL 1.1).
- A ChemDraw constants header marked as CambridgeSoft's (see Accepted limits).
- Emscripten's runtime: musl, libc++ and the JS glue.

**Inside the RDKit wasm** (2026.9.1, traced to RDKit's own published build run, with Emscripten 6.0.11):
- RDKit (BSD-3, plus its Novartis text and the quatfit line) and InChI 1.07.3 (MIT).
- coordgen and RingDecomposerLib (BSD-3).
- FreeType 2.13.3.
- The Telex font (OFL 1.1) and the Roboto font (Apache-2.0).
- Emscripten's runtime.

**This app's own material that copies others':**
- the RDKit code ported to TypeScript (tautomers, resonance; RDKit's tautomer code descends from MolVS, MIT);
- Biopython's pKa values;
- nmrshiftdb2's tables, the IR table (CC BY-SA), the glassware and the GHS pictograms.

nmrshiftdb2, the IR table and the glassware are credited where they show. The GHS pictograms are public domain. The RDKit ports and the Biopython values ship with no visible notice.

**What the licences ask:**
- **Text must travel with every copy, binaries included:** MIT, ISC, BSD, Apache-2.0 (with any NOTICE), OFL, HPND, W3C, Biopython's licence and EDTSurf's terms. zlib, libpng, Boost and LLVM ask for nothing in a binary; their texts are included as a courtesy.
- **FreeType:** a credit to the FreeType Project, with the version's year, in the documentation.
- **InChI 1.06 (§6):**
  - prominent notice that the app uses InChI;
  - a copy of its licence;
  - InChI's copyright line, with a pointer to that copy, wherever the app shows copyright notices;
  - InChI's source code (EPAM's modified copy), either with the app or "from the same place", or else a written offer.

  If the wasm counts as a combined library, §7 asks for the same uncombined copy and a notice saying where it is.
- **InChI §15:** "If you modify the Library in any way whatsoever, the output from any such modified Library may not be referred to as 'InChI' or any similar name. Any attempt to refer to such output as 'InChI' will automatically terminate your rights under this Licence." Any change counts, whether or not it alters the output, and "any similar name" takes in InChIKey. See decision 5.
- **Breaches end the licences.**
  - MPL 1.1 §8.1 ends the rights unless a breach is cured "within 30 days of becoming aware of the breach". Awareness came with the sweep on 2026-10-28, so the cure date is 2026-11-27.
  - InChI §8, like LGPL 2.1 §8, has no cure period: distribution that broke the licence "will automatically terminate your rights". Only the licensor, the InChI Trust, can restore them.
- **cairo under MPL 1.1:**
  - §3.6: a notice saying where its source is;
  - §3.3: naming its original developers where the notices describe where the code came from;
  - no other terms offered for it.
- **cairo under LGPL 2.1:** the same source and notice, plus cairo's copyright lines wherever copyright notices show, and what a student would need to relink the wasm.

## Decisions for Jeff (proposed answers in bold)
1. **How InChI's source is supplied:** **inside the app**, as a precached archive of EPAM's InChI and cairo sources at the exact commit. The archive holds their licences, the build files, and a README listing what EPAM changed. It measured about 1.6 MB, against 19 MB of wasm already precached.

   About gets a "Save InChI and cairo source" button, which saves it the way Ketcher saves a drawing. It works offline, and each installed version holds the source matching its wasm. Nothing changes on the server.

   Alternatives:
   - **An archive on osbornelab outside the app.** Needs an Apache change you apply, a deploy change, and it isn't available offline.
   - **A written offer** ("on request for three years, to …"). Needs a named contact the university stands behind.
   - **A plain-text pointer to Indigo's GitHub tag only.** Simplest, but InChI §6 doesn't list a third party's server as a way to supply source.
2. **cairo's licence:** **MPL 1.1**, which needs the notice, the source above and its developers named. LGPL 2.1 adds the relinking materials and cairo's copyright lines in About.
3. **How a student reads the notices:** **a "Third-party licences" button in About that shows the text in a scrollable panel inside the dialog.** The panel reads the app's own precached file, so it works offline and in the installed app on every platform, and it can be fully tested.

   The alternative is a link that opens the file in a new window, like the NMR licence link. How an installed app opens such a window differs by platform, and no test here can cover it.
4. **Miew, Ketcher's 3D viewer:** it is hidden but still shipped and precached (1.2 MB). One of its files says its method was "adapted from AstexViewer", which is LGPL, and it isn't clear whether code or only the idea was taken.

   Ketcher loads Miew from exactly one place: the 3D button's dialog, which the app hides. Proposed: **stop shipping Miew**, by giving the build an empty stand-in for `miew-react`. That also takes Miew and the packages only it brings out of the notices (see Design).

   The alternative is to keep it and ask EPAM about that file.
5. **"InChI" in Ketcher's Save dialog (reopened):** the dialog offers "InChI", "InChI AuxInfo" and "InChIKey", made by EPAM's modified InChI 1.06.
   - **What EPAM changed:** we already have EPAM's diff against InChI 1.06. Two of its four changes are build and memory fixes. The other two can change output: one initialises a value that upstream reads uninitialised, and one makes an ignored option work.
   - **What §15 says:** a modified InChI's output may not be called "InChI" or any similar name.
   - **Who can decide:** only the InChI Trust, not EPAM, can give permission or say whether 1.06 may be used under MIT. MIT would also settle §6 and §8.

   **Decided (Jeff, 2026-10-29): hide "InChI", "InChI AuxInfo" and "InChIKey" in Save for good, and write no letter.** Hiding them is a scope change under invariant 6, which Jeff approved.

   InChI's code still ships inside Indigo, so §6's notices and source are still owed. Practice keeps using Indigo's InChIKey internally; it never calls it InChI on screen.
6. **Priority:** **its own release, ahead of other features, in production by 2026-11-27** (MPL 1.1's 30-day cure). Production has shipped without these notices since launch.

## Design
**A reviewed inventory.** `third_party/notices/inventory.json` lists everything the build ships that isn't the app's own code:
- every package and version whose code reaches the browser. Its sources:
  - each module id of the main and worker builds (the recorder is registered in `plugins` and in `worker.plugins`);
  - the build tools' virtual ids, mapped to Vite, rolldown and vite-plugin-pwa;
  - the service worker's Workbox modules by name, with versions read from their package.json, plus workbox-build's template. Each Workbox package's own `_version.js` marker is recorded beside its version: 7.4.1 packages carry a 7.4.0 marker, so built markers are compared with those, not with package.json;
- the SHA-256 of every shipped file that comes from node_modules (bundled modules, wasm files, glue).

  A file is **prebuilt** if it is a .wasm, if it contains a bundler runtime or wrapper (`__webpack_require__`, `define.amd`, Emscripten's `wasmBinary`), or if its source map names sources outside its package. The last case was added while building: four bundles, Ketcher's macromolecules chunk among them, inline other packages with no marker. A copy vendored in a `node_modules` folder without its own package.json counts too. Each such file needs a reviewed record for its current hash, even one that says "inlines nothing from other authors";
- every file copied from `web/public`;
- the app's own modules that copy others' work (the RDKit ports, the Biopython values).

**Reviewed records.** `third_party/notices/` also holds one record for each component node_modules can't describe:
- inlined copies;
- the wasm contents;
- texts missing from npm, such as Ketcher's LICENSE and NOTICE from its v3.18.0 tag;
- the fonts and the app's derived material.

Each record is keyed to what it was researched against: package@version and the SHA-256 of the prebuilt file it describes. It keeps its evidence (the link line, strings seen in the binary, the lockfile commit, the source-map entry) and each text's pinned upstream URL and SHA-256.

Texts are copied from primary sources, never typed. For the Noto fonts the record keeps both the name-table line and the upstream Noto OFL header; Indigo's vendored OFL.txt names the wrong project and is not used.

The build records its module log in `<outDir>.notices-build.json`, beside the output folder, never inside it, so it isn't deployed or precached. That file is gitignored and its paths are relative to `web/`. `rdkitWasm.ts` passes the wasm's source path to `emitFile` so the log can place it.

**The notices file.** `web/public/third-party/NOTICES.txt` is committed and precached. A script, `web/scripts/build-notices.ts`, writes it offline from the inventory, node_modules and the records. It is UTF-8 with a byte-order mark, so browsers that don't guess the encoding still show ©. Measured size: about 500 kB, about 100 kB gzipped. Most of it is licence texts that differ in small ways (eight LLVM copies, several Apache ones), each kept as copied. The panel loads it only when opened. It has four parts:
1. **About this file:**
   - where the source archive is;
   - that MU Draw's MIT licence and EPAM's Apache-2.0 cover only their own code;
   - the licence choices made: MPL 1.1 for cairo, FTL for FreeType, MIT for Emscripten's runtime and GLmol, public domain for stb, and both texts for intersection-observer;
   - the FreeType credit.
2. **The app's code:** every package and inlined copy.
3. **Each wasm file:** its compiled-in parts. The cairo entry quotes its original developers and lists EPAM's changes.
4. **The app's own derived material and data.**

Every entry in parts 2 to 4 gives its version, licence, copyright lines, any NOTICE text, and its licence text.

**Copyright lines are found by subtraction.** Each licence file is matched against the canonical body of its licence, a pinned text from a primary source. Every line above the matched body except a bare title is kept as the package's notice, so a holder named mid-line isn't lost. At least one of those lines must mention a copyright. Lines inside the body, Apache's appendix included, never count. The build tools' and Workbox's packages get entries the same way. A licence body appears in full once, under a label, and entries whose bodies are identical apart from line breaks and spacing share it. A record's component has at least one copyright line, or a `noCopyright` reason (public domain, CC0, none named upstream). A part-2 record that no package's entry would print is refused.

**The one main guard.** After every build, a check rebuilds the inventory from that build and compares it with the committed one. Any difference fails the build and names what changed:
- a new or removed package or version;
- a changed file hash;
- a new public file;
- a virtual id it can't place.

**Clearing a failure is a deliberate step.** `build-notices.ts --accept` copies the build's log into the committed inventory. The script then refuses to write NOTICES.txt while:
- a record is keyed to something no longer in the inventory;
- a prebuilt file in the inventory has no record for its current hash.

So an upgrade can't go green until each changed bundle or wasm has been looked at. Dependencies are pinned, so this happens only on a deliberate upgrade, which is exactly when the notices need a look.

This replaces the many per-case guards an earlier draft had.

**About.** The present credit line stays. Three plain-text lines are added:
- InChI: "Includes InChI software, Copyright (C) IUPAC and InChI Trust, under the IUPAC/InChI-Trust InChI Licence No. 1.0 (in Indigo) and the MIT licence (in RDKit); its text is under Third-party licences".
- FreeType: "Portions of this software are copyright © 2022, 2024 The FreeType Project (www.freetype.org). All rights reserved." These are the years of FreeType 2.12.1 in Indigo and 2.13.3 in RDKit.
- The source: "The source of InChI and cairo (MPL 1.1) as used here", with the Save button.

The "Third-party licences" button opens the panel.

**Source archive** (decision 1):
- built once by a script from Indigo's commit b36d38f5;
- committed under `third_party/indigo-source/`, with its README beside it, and copied into the build at `<base>third-party/`;
- recorded, with its SHA-256 and the commit, in the Indigo wasm's record, which is keyed to that wasm's SHA-256;
- tied to the wasm that actually ships: a check reads the `-g<commit>` in the shipped wasm's version string, and the README inside the archive must name the same commit. The README beside it must be byte-identical to the one inside.

To list EPAM's changes reliably, the script also commits a SHA-256 manifest of the pristine upstream sources: InChI v1.06 at commit a515b397, and cairo at upstream commit 06f405c7. Indigo's cairo turned out to be that 2021 git snapshot, which calls itself 1.17.4, not the 1.17.4 release (found while building).

`xz` joins the precache patterns. NOTICES.txt and the archive join the precache guard's required files.

**InChI formats** (decision 5): Ketcher's Save dialog loses "InChI", "InChI AuxInfo" and "InChIKey". How to remove them in Ketcher 3.18 is found while building; `buttons.hidden` doesn't cover formats. They join the hidden-UI smoke checks (`ketcherUi.ts`, editor.css), in the compact toolbar too.

**Miew** (decision 4): a Vite alias points exactly `miew-react` to a stand-in that raises the app's editor-error event, so a test that reached it would fail. That removes miew, miew-react, three@0.153.0, spin.js, Smooth.js and Miew's mmtf.js copy. 3Dmol's own mmtf and Three.js-derived code stay, with their notices.

**Repo changes this brings:**
- **AGENTS.md:** two Layout lines folded to make room under its 150-line cap, and a new failure mode: "a dependency upgrade fails the notices inventory: rerun the script and review what changed".
- **THIRD-PARTY-NOTICES.md:**
  - a pointer to the app's notices;
  - names, by path, web/public/third-party/NOTICES.txt and the `third_party/notices/` files that hold nmrshiftdb2 text, for `scripts/checks/notices.py`; inventory.json joins that check's list of files that only name it;
  - the corrections the research found (3Dmol carries pako 2.1.0, not 2.2.0, plus pako 1.0.11, EDTSurf, mol* and mmtf).
- **About's rule** in AboutBox.tsx changes from "nothing here may link or load anything" to "no links; it loads only the app's own precached files". The About test that expects no links keeps doing so: both new controls are buttons.

## Acceptance bar (with the proposed answers)
**A. Complete.** NOTICES.txt has an entry, as described under Design, for:
1. every package whose code reaches the browser (main bundle, every worker, the service worker);
2. every inlined copy;
3. every part of each wasm file, including:
   - FreeType's extra notices, Brainspark's line, cairo's MIT/HPND notices and its developers;
   - RDKit's Novartis text and the quatfit line, plutovg's FTL files;
   - the OFL texts and Emscripten's runtime notices;
4. every part of the app's own derived material, including the RDKit ports (with MolVS's MIT notice) and Biopython's notice.

**B. Guards** (each with a negative test over small fixtures)
1. **Inventory:** the build's inventory must equal the committed one. The check also fails on a dist file that no chunk, public file, plugin asset or Workbox marker accounts for. Negative tests:
   - an added package, a changed version, a changed file hash, a new public file;
   - an unplaced virtual id, an unaccounted dist file;
   - a built Workbox marker that differs from its installed package's `_version.js`.
2. **Notices up to date:** the script, run offline, reproduces the committed NOTICES.txt byte for byte.
3. **The script refuses to write a file that would be incomplete.** It fails on:
   - a licence outside MIT, ISC, BSD-2/3-Clause, Apache-2.0, 0BSD and Zlib with no record covering it;
   - no copyright line found by subtraction (see Design), unless a record says "none upstream". Fixtures:
     - indigo-ketcher's bare Apache LICENSE: none found;
     - a LICENSE whose body says "COPYRIGHT HOLDERS": the body doesn't count;
     - an MIT LICENSE with a holder: found;
   - a record whose text no longer matches its SHA-256;
   - a record keyed to something not in the inventory, or a prebuilt file without a record for its hash. Negative fixtures: a file with `__webpack_require__` and no record; a record for an old hash;
   - a missing byte-order mark.
4. **Source archive:**
   - its SHA-256 must match the Indigo wasm's record, which is keyed to the shipped wasm's SHA-256;
   - the commit in the shipped wasm's version string must equal the one named by the README inside the archive. Negative fixtures: a wasm string with another commit; a record with another wasm hash;
   - a pytest reads the README inside the archive and hashes every file against the pristine-upstream manifests. It fails when a changed file is missing from that README, or when the README beside the archive differs from it. Negative fixture: a small archive with one unlisted change.
5. **Miew gone:**
   - the inventory may not contain miew, miew-react or three; negative test with today's module list;
   - a Vitest finds exactly one `import('miew-react')` in `ketcher-react/dist/index.js` (the file Vite resolves; source maps and the CommonJS build excluded), inside the 3D dialog's lazy loader.
6. **InChI formats gone:** a smoke test opens Save and finds no "InChI", "InChI AuxInfo" or "InChIKey" among its formats, while MOL and SMILES are still there, in the normal and the compact toolbar.
7. **About in step:** a Vitest compares About's InChI and FreeType holders and years with the records.
8. **Required files:** NOTICES.txt and the archive are in the precache guard's required list.

**C. Seen by students** (automated, offline, in the test browser)
1. About shows the three new lines and both buttons.
2. The panel shows NOTICES.txt as served by the service worker. Checked lines: InChI's copyright and a fixed phrase of its licence, the FreeType credit, Ketcher's NOTICE, and the MPL 1.1 statement for cairo.
3. Save, offline: the archive comes from the service worker, and the saved file's SHA-256 equals the recorded one.
4. By hand on staging, once each: the installed app on Chrome desktop and Android, and Safari on iOS.
   Jeff confirmed on 2026-10-29, after the production deploy, that the Third-party licences panel behaves as expected.

**D. Unchanged**
- **Invariants 1 and 4:** no link is added; the only new requests are two same-base fetches of precached files; the new files are precached.
- **Checks:** check.sh passes, and the live checks also fetch NOTICES.txt and the archive (`text/plain`, `application/x-xz`).

## For counsel, if wanted
- **"Accompany" and "the same place":** whether a precached copy on the same site counts as source that "accompanies" the app, or comes "from the same place" (InChI §6).
- **InChI 1.06 as MIT:** whether it may be treated as MIT. That would drop the source duty, but only the InChI Trust could settle it.
- **InChI §15** (decision 5): whether it reaches a redistributor that didn't modify InChI.
- **InChI §8:** whether shipping without §6's notices since launch ended MU Draw's InChI licence, and whether to ask the InChI Trust to confirm reinstatement. This can go in the same letter as the §15 and MIT questions.
- **Change notices:** whether a redistributor must add notices of EPAM's changes to the files themselves, or whether the README's list is enough.

## Accepted limits (proposed)
- **Small cited snippets:** one adapted Stack Overflow answer inside 3Dmol (CC BY-SA, treated as too small to matter), a Three.js text-sprite example and chg2cube.pl are credited by name only. The FXAA shader has a full MIT entry.
- **Ketcher's own data:** its templates, monomer library and icons are treated as its own, under Apache-2.0.
- **Indigo's ChemDraw constants header:** marked "all rights reserved" by CambridgeSoft, it holds a published file format's constants. NOTICES carries its copyright line; ask EPAM if challenged.
- **Versions of inlined code:** they come from the lockfile at the published commit (Ketcher, Miew) or at the release tag (3Dmol, whose published commit isn't public). Two are confirmed by banners. Miew's mmtf.js has no known version and goes with Miew.
- **Unverified RDKit origins:** these were not traced:
  - RDKit's built-in font widths (Adobe AFM) and isotope data (BODR);
  - its Conrec contouring code, the Daylight-derived a2b code and a Stack Overflow endianness snippet;
  - the PNG details credited to OpenBabel, which read as format knowledge rather than copied code.
- **VFLib:** RDKit's substructure matcher is "an extensive modification … of pieces from several files in the vflib-2.0 distribution". VFLib's terms ask for a note of the change and a pointer to the original source. Its site is gone, so NOTICES points to an Internet Archive copy (decided while building; Jeff can change it).
- **Credited copies inside packages' own files:** short adapted code that a package credits in a comment is covered by that package's entry, not listed separately. These are:
  - Facebook's regenerator banner in @babel/runtime;
  - assert's function from feross/buffer;
  - @emotion/hash's MurmurHash2 port;
  - get-intrinsic's lodash snippet;
  - svgpath's code from Esprima and Raphaël;
  - MUI's copy of a W3C combobox example and material-components-web shadow values.
- **Bundler runtimes inside prebuilt files:** webpack's runtime in 3Dmol.js and raphael.min.js is not listed. MIT, a few hundred bytes each.
- **InChI §8 (decision 5):** whether shipping without §6's notices since launch ended MU Draw's InChI licence stays open. Jeff chose not to write to the InChI Trust.
- **Runtime objects:** which few libc and libc++ objects the wasm files link can't be seen in the binaries, so the full runtime notices are shipped.

## Reviews of this plan (2026-10-28 and 29)
- **Round 1:** 1 high and 6 medium. The fixes:
  - guards keyed to file hashes;
  - a licence allowlist;
  - worker builds and Workbox covered;
  - fuller wasm lists;
  - honest wording on what is re-derived.
- **Round 2:** 1 high and 7 medium, two of them in round 1's fixes:
  - **High:** a plain or `download` link can't save the archive offline. Now a button saves it the way Ketcher saves files.
  - **Medium:** the Miew banner check couldn't fail, since minifying strips banners. Now: no Miew package in the inventory.
  - **Medium:** what counts as "prebuilt" was undefined. It no longer matters: every shipped file is in the inventory.
  - **Medium:** the README check couldn't find unlisted changes. Now: pristine-upstream manifests.
  - **Medium:** the wasm and derived entries weren't required to carry licence texts. Now: A3 and A4.
  - **Medium:** InChI §15 is now decision 5.
  - **Medium:** the shader has a full MIT entry.
  - The lows are folded in.
- **Stepping back:** fixes were starting to cause new problems, so the many per-case guards became one inventory comparison.
- **Round 3** (on the approved plan): 3 high and 4 medium, all fixed here.
  - **High:** decision 5 rested on a cut quote of §15, so it is reopened with the full text.
  - **High:** copyright lines are now found by subtraction from canonical licence bodies.
  - **High:** the source archive is now tied to the commit in the shipped wasm.
  - **Medium:** the cure date and the InChI §8 point were missing. Both are now in decision 6 and the counsel list.
  - **Medium:** Workbox's built markers (7.4.0) differ from its package versions (7.4.1); they are now compared with each package's own `_version.js`.
  - **Medium:** records were not keyed to the bytes they describe, so `--accept` could clear the guard over stale records.
  - The lows are folded in.
- **The implementation** was reviewed twice against this bar while it was built: the generator and its output, then the whole release.
  - **The generator review:** 2 high and 3 medium, all fixed:
    - **High:** Workbox and the build tools' runtime had no entries.
    - **Medium:** holders named mid-line were dropped.
    - **Medium:** assert's narwhal.js notice was missing.
  - **The release review:** 2 medium, both fixed:
    - **Medium:** a late answer could reopen a closed licences panel. The panel and the Save now live in thirdPartyActions.ts, whose tests hold each answer to force each order.
    - **Medium:** the archive's hash was recorded nowhere. It is now in the Indigo record, and verify-dist checks the shipped bytes against it. A list of Indigo's trees by git blob id (indigo.git-blobs, from `git ls-tree`) catches an archive missing a file.
  - Their lows are fixed too.
  - **A last capped round, on those fixes:** 1 medium, fixed with a test. Focusing Close on opening scrolled the now taller About to its end, hiding the title; focus now starts on the title. Its three lows are fixed: the licences button retries after an error, the tree list comes from git, and a missing negative test was added.
  - **Stopped here.** That round's fixes are small, and each has a test that fails without it. Another round would review a few lines.
