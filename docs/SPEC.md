# Manchester Structure Drawing PWA — Version 1 Spec

Oct 21, 2026 · @Jeff Osborne

## Purpose and scope

Version 1 gives Manchester chemistry students a free, installable structure editor that replaces ChemSketch Freeware for everyday drawing, naming and property work. It is a Progressive Web App built on Ketcher and RDKit.js, hosted on osbornelab.manchester.edu, and installable from Chrome or Edge on Windows 11 and macOS.

**In scope for v1**

- Draw and edit structures and reactions (Ketcher, standalone mode)
- Open and save ChemDraw files (CDX, CDXML)
- Properties panel with a Lipinski Rule of 5 card and stereocenter count
- Functional group highlighter
- Get name (structure to name)
- Name to structure
- Export as PNG and SVG, and copy as image
- Installable, works offline for everything except the two naming features

**Out of scope for v1** (see the roadmap at the end)

- Practice mode, 3D view, safety data, biochem tools, course templates, and the version 2 drawing tools (enumerators, resonance, conformation templates, glassware)
- A later version: electron-pushing arrows, lone pairs, orbital pictures, structure from image
- Accounts, saved work on the server, grading, or any Canvas/LTI integration
- Stockroom inventory integration (on hold)
- Native installers (.exe, .dmg) and code signing

**Working name:** to be decided. Avoid "ChemDraw" and "ChemSketch", which are trademarks of other vendors.

## Architecture

The app is static files plus one small API: the student's browser does all drawing and calculation, and osbornelab handles only the two naming lookups.

```
STUDENT'S COMPUTER (installed PWA, works offline)
  Ketcher editor (Indigo, WebAssembly)   draws structures; opens/saves Molfile, SMILES, CDX, CDXML
  RDKit.js (WebAssembly)                 properties, Lipinski, stereocenters, functional groups
  Service worker                         caches every app file, including the .wasm files
  Browser storage                        autosaved drawing, never uploaded
        |  app files (download)            ^
        v                                  |  SMILES or name only (naming buttons)
OSBORNELAB.MANCHESTER.EDU
  Apache        serves the app at /draw/, proxies /draw/api/ to uvicorn
  FastAPI       /api/name, /api/structure, /api/health
  OPSIN .jar    systematic names to structures (local, Java)
  SQLite cache  chemistry only, kept 30 days
        |  rate-limited
        v
OUTSIDE SERVICES
  PubChem PUG REST   structure to name; common-name lookup
  EBI OPSIN          fallback only if Java is not used on the server
```

Drawings, properties and exports never leave the device. Only a SMILES string or a typed name goes to osbornelab, which answers from its cache, its local OPSIN, or PubChem.

## Version 1 features

Six features ship in v1; four run fully on the student's device and two call out for names. Every feature reads the current structure from Ketcher (`getSmiles()` / `getMolfile()`) and hands it to RDKit.js or the server, so they share one integration point.

| Feature | Runs where | Built with | Needs internet |
| --- | --- | --- | --- |
| Drawing and editing | Device | Ketcher (ketcher-react + ketcher-standalone) | No |
| Properties panel + Lipinski card | Device | RDKit.js `get_descriptors()` | No |
| Functional group highlighter | Device | RDKit.js SMARTS matching + Ketcher highlights | No |
| Export PNG / SVG, copy as image | Device | Ketcher image generation, Clipboard API | No |
| Get name | Server, then PubChem | FastAPI endpoint calling PubChem PUG REST | Yes |
| Name to structure | Server (local OPSIN), PubChem fallback | FastAPI endpoint, OPSIN jar | Yes |

### 1. Drawing and editing

- Ketcher in standalone mode: the Indigo engine runs in the browser as WebAssembly, no structure server.
- Keep Ketcher's built-in tools rather than rebuilding them: reaction arrows (including multi-tailed arrows and multi-step reactions), text with subscripts and superscripts, rectangles, ellipses and lines, placed images, R-groups, polymer brackets, abbreviations, the functional group and template libraries, R/S and E/Z labels, enhanced stereochemistry, aromatize and dearomatize, clean-up, structure check, and reaction atom mapping.
- File formats: Molfile, SMILES, InChI, CML, and ChemDraw CDX and CDXML, for both open and save. Default ChemDraw export is CDXML, the more forgiving of the two. ChemDraw-only objects such as orbitals and TLC plates may be dropped or simplified on import.
- ChemSketch .sk2 files cannot be read. The Help page tells students and faculty to export old .sk2 files to Molfile from any copy of ChemSketch that is still installed.
- Last drawing autosaves to the browser so a refresh or relaunch does not lose work.
- **Done when:** a student can draw, save, reopen, and edit a molecule and a reaction offline, and 10 real ChemDraw files survive a round trip (ChemDraw to app to ChemDraw) with atoms, bonds, stereochemistry, arrows and text intact.

### 2. Properties panel + Lipinski card

- Side panel that updates as the drawing changes (debounce about 300 ms).
- Shows molecular formula, average MW, exact mass, degree of unsaturation, H-bond donors and acceptors, rotatable bonds, TPSA, and Crippen logP.
- Lipinski card: four rows (MW ≤ 500, logP ≤ 5, donors ≤ 5, acceptors ≤ 10), each pass or fail, plus a one-line summary.
- Stereocenters: the number of stereocenters and stereogenic double bonds, the maximum number of stereoisomers (2ⁿ, with a note that meso forms make the real number smaller), and a flag on any left undefined. Clicking the count highlights them on the canvas.
- Label logP as "Crippen estimate" so students know it is a prediction.
- Multiple fragments drawn: show values for the whole drawing and say so.
- **Done when:** values for 10 reference compounds (aspirin, ibuprofen, caffeine, glucose, etc.) match RDKit run on the server to the displayed precision.

### 3. Functional group highlighter

- "Show functional groups" toggle colors each matched group on the canvas and lists them in the panel with counts.
- Patterns live in one editable file (`functional-groups.json`: name, SMARTS, color, priority), so you can add groups without code changes.
- Starter list: alkene, alkyne, arene, alcohol (1°, 2°, 3°), phenol, ether, aldehyde, ketone, carboxylic acid, ester, amide, acid chloride, anhydride, nitrile, amine (1°, 2°, 3°), thiol, alkyl halide, epoxide.
- Overlap rule: the higher-priority match claims the atoms (an ester's oxygen is not also listed as an ether).
- **Done when:** the starter list gives the expected groups on a 25-molecule test set you choose from CHEM-312 material.

### 4. Export and copy

- Export PNG at 1x, 2x and 4x, with a transparent background option.
- Export SVG.
- "Copy as image" puts a PNG on the clipboard for pasting into Word or Google Docs.
- **Done when:** a copied structure pastes cleanly into Word and Google Docs on Windows 11 (Chrome and Edge) and macOS (Chrome).

### 5. Get name

- Button sends the drawing's SMILES to the app's own server, which asks PubChem for the compound.
- Shows IUPAC name, common name (PubChem title), CID, and a link to the PubChem page.
- Not in PubChem: say so plainly ("PubChem has no record of this exact structure, so no name is available"), not an error.
- Stereo matters: if the drawing has undefined stereocenters, note that the name may differ for a specific stereoisomer.
- **Done when:** 20 common compounds return correct names, and 3 invented structures return the not-found message.

### 6. Name to structure

- Text box: student types a name and the structure appears on the canvas.
- Order of attempts: OPSIN first (parses systematic names, including compounds not in any database), then PubChem name lookup (common and trade names such as "aspirin").
- Shows which source answered, and OPSIN's message when a name cannot be parsed.
- **Add or replace.** Two buttons: "Add to drawing" places the structure as a new fragment beside what is already there (Ketcher `addFragment`), so students can build a reaction one named compound at a time; "Replace drawing" clears the canvas first (`setMolecule`). "Add" is the default whenever the canvas is not empty. Added fragments must not overlap existing ones, and one Undo removes the whole addition.
- **Round-trip check.** After a name is drawn, the app automatically runs Get name on the result and shows both side by side: "You typed" and "PubChem's IUPAC name". A match gets a check mark. A difference is shown neutrally ("PubChem names this structure differently"), since common names and older conventions are not wrong. Example: "4-methyl-3-pentanol" is misnumbered but still parses; the round trip returns "2-methylpentan-3-ol", which teaches lowest-locant numbering. If PubChem has no record, the round trip says so and the drawn structure stays.
- **Done when:** 20 systematic names from CHEM-312 nomenclature exercises and 10 common names draw correctly; Add places a second compound beside the first without overlap and Undo removes it; the round trip shows the PubChem name for all 30 test names that PubChem knows.

## Offline and error behavior

The app must never look broken offline: local features keep working, and the two naming buttons explain themselves instead of failing.

| Situation | What the student sees |
| --- | --- |
| No internet | Naming buttons stay visible but greyed, with the tooltip "Needs an internet connection". A small offline badge appears in the header. |
| Server unreachable or slow (over 8 s) | "The naming service isn't responding. Your drawing is safe; try again in a minute." |
| PubChem has no match | "PubChem has no record of this exact structure, so no name is available." |
| OPSIN can't parse the name | OPSIN's own message, then the PubChem attempt result. |
| PubChem rate limit hit (HTTP 429 / 503) | Server retries once after 1 s, then shows "Busy, try again shortly". |
| Empty canvas | Naming and properties buttons disabled; panel shows "Draw a structure to see its properties". |
| Invalid structure (e.g. pentavalent carbon) | Properties panel shows Ketcher's valence warning instead of numbers. |
| New version available | Banner: "An update is ready. Reload to use it." Never reloads by itself mid-drawing. |

The drawing is autosaved to the browser before any network call, so no failure can lose work.

## Server endpoints and outside services

All outside calls go through a small FastAPI service on osbornelab, never directly from the browser. That removes the CORS question entirely, lets the server respect PubChem's rate limits for every student at once, and allows OPSIN to run locally instead of depending on a remote site.

### App endpoints (FastAPI, behind Apache)

| Endpoint | Request body | Returns |
| --- | --- | --- |
| `POST /api/name` | `{"smiles": "..."}` | `{"found", "iupac", "title", "cid", "url"}` |
| `POST /api/structure` | `{"name": "..."}` | `{"found", "smiles", "molfile", "source", "message"}` |
| `GET /api/health` | none | `{"ok": true}` for the offline check |

Both lookups use POST so structures and names never appear in URLs or in Apache's access log lines.

### PubChem PUG REST (structure to name, and common-name fallback)

- Base URL: `https://pubchem.ncbi.nlm.nih.gov/rest/pug`
- Structure to name: `POST /compound/smiles/property/IUPACName,Title/JSON` with form field `smiles=...`. POST avoids URL-encoding problems with `/`, `#` and `\` in SMILES.
- Name to structure fallback: `GET /compound/name/{name}/property/SMILES,Title/JSON`.
- PubChem renamed its SMILES properties: `SMILES` now includes stereochemistry and `ConnectivitySMILES` does not. Older tutorials use `IsomericSMILES` / `CanonicalSMILES`; don't copy those.
- Limits: no more than 5 requests per second and 400 per minute, no key required. The server queues requests and retries once on 429 or 503.

### OPSIN (systematic name to structure)

- OPSIN is open source (MIT) and runs as a Java .jar. Run it on osbornelab, called from FastAPI, so name parsing works even if outside services are down.
- Fallback if Java isn't wanted on the server: the public web service at `https://www.ebi.ac.uk/opsin/ws/{name}.json` (it moved from the old Cambridge address). It returns HTTP 404 with a JSON message when a name can't be parsed; treat that as "not parseable", not an error.
- EBI asks heavy users to run OPSIN locally, which is another reason to prefer the .jar.

### Caching

- Cache lookups on the server (SQLite or in memory), keyed by canonical SMILES or by lowercased name, for 30 days.
- A class of 25 naming the same 40 compounds then costs 40 PubChem calls, not 1,000.
- The cache holds chemistry only: structure, name, CID. No user information is stored with it.

## Privacy and FERPA

The app collects no education records: there are no accounts, no per-student logging, and drawings stay on the student's own device.

- **No sign-in.** Anyone with the URL can install and use it.
- **Drawings stay local.** Autosave uses the browser's own storage on that device; nothing is uploaded unless the student presses a naming button.
- **What leaves the device:** only a SMILES string or a typed chemical name, sent to osbornelab, and from there to PubChem or EBI. No name, email, student ID, or course is attached.
- **Server logs.** FastAPI does not log request bodies. Apache access logs still record IP addresses and paths; since lookups are POSTs, the paths are just `/api/name` and `/api/structure`. Rotate logs on the normal schedule.
- **No analytics or third-party scripts.** All JavaScript and WebAssembly is served from osbornelab, so no CDN or tracker sees student traffic.
- **Practice mode (v2)** must follow the same rule as chem-tutor: no per-student records unless it moves into Canvas, where Manchester already governs grade data.

## Build and deployment

The front end is a Vite + React + TypeScript build deployed as static files under `/draw/` on osbornelab's Apache, with the FastAPI service proxied at `/draw/api/`. This mirrors how chem-tutor already runs, so no new server software is needed beyond Java for OPSIN.

### Repository layout

```
mu-draw/
  web/                      React PWA (Vite)
    src/
      editor/               Ketcher wrapper and highlight helpers
      chem/                 RDKit.js loader, descriptors, functional groups
      panels/               Properties, Lipinski, naming, export UI
      api.ts                Calls to /draw/api/*
    public/
      functional-groups.json
      icons/                192 and 512 px app icons
    vite.config.ts          base '/draw/', PWA plugin settings
  server/                   FastAPI
    main.py                 /api/name, /api/structure, /api/health
    pubchem.py              rate-limited client + retry
    opsin.py                wrapper around the OPSIN .jar
    cache.py                SQLite lookup cache
    opsin/opsin.jar
  AGENTS.md                 Handoff notes for Cursor / Claude Code
```

### Key libraries

- `ketcher-react` and `ketcher-standalone`, same major version.
- `@rdkit/rdkit` (RDKit MinimalLib); copy its `.wasm` file into the build output.
- `vite-plugin-pwa` (Workbox) for the manifest and service worker.

### Gotchas to tell Cursor up front

- **Raise the precache size limit.** Workbox skips files over 2 MB by default, and the Ketcher/Indigo and RDKit WebAssembly files are larger. Set `maximumFileSizeToCacheInBytes` to about 30 MB, or the app will silently fail offline.
- **Ketcher's examples assume webpack.** Under Vite, expect to add a `process.env` define and possibly Node polyfills. Budget an hour for this.
- **HTTPS is required** for service workers and the clipboard. Confirm osbornelab's certificate covers the site.
- **Path scope.** Manifest `start_url` and `scope` must both be `/draw/`, matching Vite's `base`.

### Updates and versioning

- Use the PWA plugin's "prompt" update mode: a new build installs in the background and the student sees the reload banner (see Offline and error behavior).
- Serve `sw.js` and `index.html` with `Cache-Control: no-cache`; hashed asset files can be cached long term.
- Show the version number in an About box so students can tell you which build they have.

### Apache

- `Alias /draw /var/www/mu-draw/web/dist` for the static build.
- `ProxyPass /draw/api http://127.0.0.1:<port>/api` to uvicorn, run as a systemd service.
- Deploy = `npm run build`, copy `dist/` to the server, restart the FastAPI service only when `server/` changes.

## Testing checklist

v1 is ready for students when every box below is ticked on a Windows 11 laptop and a Mac.

**Install and offline**

- [ ] Installs from Chrome and from Edge on Windows 11; Start menu and taskbar icon appear
- [ ] Installs from Chrome on macOS; Dock icon appears
- [ ] With Wi-Fi off, the installed app launches and draws
- [ ] Offline: properties, functional groups and export all work; naming buttons show the offline message
- [ ] Publishing a new build shows the update banner on next launch

**Chemistry**

- [ ] Properties match server-side RDKit for the 10 reference compounds
- [ ] Stereocenter count: 2-butanol shows 1; open-chain glucose shows 4, up to 16 stereoisomers
- [ ] Functional group highlighter passes the 25-molecule CHEM-312 test set
- [ ] Get name: 20 known compounds correct, 3 invented structures give the not-found message
- [ ] Name to structure: 20 systematic names and 10 common names draw correctly
- [ ] Name to structure: Add and Replace both work, and the round trip shows PubChem's name next to the typed name
- [ ] Stereo: (R)- and (S)-2-butanol give different names and draw with the right wedges

**Output**

- [ ] Copy as image pastes into Word and Google Docs on both platforms
- [ ] PNG at 4x is sharp on a printed page; SVG opens in a browser and in PowerPoint
- [ ] 10 ChemDraw files (CDX and CDXML, including reactions) open correctly, and files saved from the app open correctly in ChemDraw

**Load**

- [ ] 30 simultaneous naming requests (one lab section) complete without PubChem rate-limit errors

**Privacy**

- [ ] Browser network tab shows no requests to any host except osbornelab
- [ ] FastAPI logs contain no request bodies

## NMR prediction proof of concept (alongside v1)

Ship a "Predict ¹³C NMR" button as a clearly labelled preview next to v1; add ¹H only after ¹³C proves accurate and stable. ¹³C comes first because it needs no coupling patterns: one predicted shift per unique carbon, drawn as a stick spectrum.

### Two ways to predict, both built on NMRShiftDB2

Both candidates use HOSE codes, which describe each atom's surroundings shell by shell and look up measured shifts for similar environments in the open NMRShiftDB2 database.

|  | A. Server-side NMRShiftDB2 predictor | B. In-browser nmr-processing (Cheminfo / Zakodium) |
| --- | --- | --- |
| Runs on | osbornelab, Java, next to OPSIN | Student's device, JavaScript |
| Works offline | No | Yes, once the ¹³C database file is cached |
| Licence | NMRShiftDB2 software is open source; data under an open content licence | CC BY-NC-SA 4.0 for current releases; older v11.1.1 was MIT |
| Fits v1 architecture | New endpoint `POST /api/nmr` | New module in `web/src/chem/` |
| Main risk | Confirming the standalone predictor is still distributed and maintained | Licence terms, and database file size in the offline cache |

**Recommendation:** spend one day prototyping both on the same test set and keep the one that scores better. If they tie, choose A: the server already runs Java for OPSIN, and it avoids the ShareAlike question for your app's own code. The NC licence on B is fine for noncommercial teaching use, but check with whoever decides how the app is licensed before adopting it.

### What the student sees

- **Predict ¹³C NMR** button in the side panel, with a "Preview" tag.
- Stick spectrum on a reversed axis, 220 to 0 ppm, with optional TMS reference line at 0.
- Peak table: predicted shift, carbon type (C, CH, CH₂, CH₃), and how many equivalent carbons each peak represents.
- Clicking a peak highlights its carbon(s) on the drawing using the same Ketcher highlight code as the functional group feature; clicking a carbon highlights its peak.
- Banner on every prediction: "Predicted shifts from a database of measured spectra. Real spectra can differ; use this to check reasoning, not as an answer key."
- Unusual environments with few database matches: mark those peaks as "low confidence" if the predictor reports how far it had to back off.

### Symmetry and signal count

Students will compare the number of peaks with what they expect, so equivalent carbons must collapse into one peak. Group carbons by topological symmetry (RDKit canonical atom ranks without tie-breaking), not by matching shift values, so two different carbons that happen to land at the same ppm still show as separate rows.

### Acceptance criteria

- [ ] 15 compounds from CHEM-312 (you choose, mixing aromatics, carbonyls, alcohols and amines) give the correct number of signals
- [ ] Predicted shifts sit within a tolerance you set (suggest ±3 ppm) of literature values for most signals; outliers are recorded, not hidden
- [ ] Peak-to-atom highlighting works both directions
- [ ] Prediction for a 30-heavy-atom molecule returns in under 2 seconds
- [ ] Option A only: offline shows the standard "Needs an internet connection" message

### Later: ¹H prediction

¹H adds multiplicity, coupling constants and field strength, which is where predictions most often mislead students. A 2008 study of NMRShiftDB data found HOSE-code proton predictions averaged 0.17 ppm absolute error, so shifts are reasonable; the multiplet patterns are the harder part. Start with a shift-only ¹H table before drawing simulated multiplets.

## After v1

Version 2 adds the teaching features; none of them change the v1 architecture.

**Teaching features**

- **Practice mode:** the app gives a name, the student draws it, and the app compares InChIKeys. No records kept.
- **3D view:** Ketcher already has a basic 3D viewer; v2 adds a PubChem 3D conformer shown with 3Dmol.js, sharing code with the FirstGlance replacement.
- **Biochem tools:** Ketcher's peptide and RNA mode already calculates isoelectric point, extinction coefficient and hydrophobicity for peptides, and melting temperature for nucleic acids. v2 shows these in the side panel and adds net charge at a chosen pH.
- **IR hint table** driven by the functional group results.
- **Safety snapshot:** GHS pictograms and hazard statements from PubChem.
- **¹H NMR prediction**, after the ¹³C proof of concept above.

**Drawing tools**

- **Stereoisomer enumerator:** lists every stereoisomer of the drawn structure (RDKit), building on the stereocenter count.
- **Tautomer enumerator:** replaces ChemSketch's tautomer tool (RDKit).
- **Resonance structure generator:** enolates, carboxylates, amides and similar (RDKit).
- **Conformation and projection templates:** chair cyclohexane with axial and equatorial positions, Newman, Fischer and Haworth. Templates first; generating a Newman projection from a chosen bond comes later.
- **Lab glassware library:** an openly licensed SVG set placed with Ketcher's image tool, for lab reports.
- **Course template libraries** for CHEM-312 and CHEM-405.

### Later version

These are held back because each needs substantial new drawing code or heavy server software.

- **Electron-pushing arrows** anchored to atoms, bonds and lone pairs. Ketcher's documented arrow tools are reaction arrows, not mechanism arrows. Reuse chem-tutor's tap-source/tap-sink arrow model.
- **Lone pairs and δ+/δ− labels**, built alongside the mechanism arrows.
- **Orbital pictures:** p orbitals, sp³ lobes, simple MO diagrams.
- **Structure from image:** open tools such as DECIMER exist but are heavy to run on the server.

### Open questions

- [ ] App name and URL path (`/draw/` is a placeholder; Kenapocomochem under consideration)
- [ ] Is Java acceptable on osbornelab for the OPSIN .jar, or start with the EBI web service?
- [ ] Does osbornelab's HTTPS certificate cover this path, and is it reachable off campus?
- [ ] Who besides you will maintain it (a student developer, IT)?
- [ ] Which department courses adopt it first: CHEM-312 in Spring 2027, or a smaller pilot?
- [ ] ChemDraw round-trip tests: Jeff runs them on his own ChemDraw

## Sources

- [OPSIN at EMBL-EBI: web service and local-install advice](https://ebi.ac.uk/opsin)
- [OPSIN web service output formats](https://opsin.ch.cam.ac.uk/instructions.html)
- [Ketcher overview and licensing (EPAM)](https://lifescience.opensource.epam.com/ketcher/)
- [ketcher-standalone package](https://npmjs.com/package/ketcher-standalone)
- [PubChem PUG REST endpoint and rate-limit summary](https://cdn.jsdelivr.net/npm/@saibolla/ada@0.1.3/skills/pubchem-database/references/api_reference.md) (secondary; confirm against PubChem's own PUG REST docs)

* [nmr-processing package and licence (Zakodium)](https://npmjs.com/package/nmr-processing)
* [nmr-processing v11.1.1 archive (Zenodo)](https://zenodo.org/records/5535735/latest)
* [NMRShiftDB2 overview and prediction](https://nmrshiftdb.nmr.uni-koeln.de/nmrshiftdbhtml/t1.html)
* [Kuhn et al. 2008, NMR prediction methods on NMRShiftDB data](https://pmc.ncbi.nlm.nih.gov/articles/PMC2605476)

- [Ketcher help: file formats, drawing tools, macromolecule mode](https://github.com/epam/ketcher/blob/master/documentation/help.md)
- [Indigo 1.19.0 release notes (ChemDraw format fixes)](https://lifescience.opensource.epam.com/indigo/release-notes/indigo-1.19.0.html)
