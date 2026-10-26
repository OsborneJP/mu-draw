# Version 2: 3D view (a PubChem 3D conformer shown with 3Dmol.js)

Requested by Jeff on 2026-10-26 (docs/SPEC.md, "After v1" > "Teaching features": "3D view:
Ketcher already has a basic 3D viewer; v2 adds a PubChem 3D conformer shown with 3Dmol.js,
sharing code with the FirstGlance replacement").

**Approved by Jeff on 2026-10-26, as proposed**: the server's RDKit is the fallback, offline
the view says "Needs an internet connection", it docks below the canvas, and "sharing code
with the FirstGlance replacement" means decision 1's reading (a): the same pinned 3Dmol.js
(2.5.5) and the same look as ProteinFirst, with no shared files.

The aim: a student draws a structure, presses "3D view", and turns a real 3D model of it
with the mouse or a finger: the chair of a sugar, the cage of cocaine, the twist of a
biaryl, the two mirror-image 2-butanols. The model comes from PubChem where PubChem has one
and is computed by RDKit where it has none.

## What a student sees

1. A **3D view** button in the properties panel, beside Predict ¹³C NMR. It works on one
   structure at a time: a reaction, or more than one structure, gets "3D view works on one
   structure at a time". Offline the button says "Needs an internet connection" (decision 4).
2. A panel docked below the canvas, like the ¹³C NMR preview (decision 5). Opening it closes
   Practice, the NMR preview or the stereoisomers, and opening any of those closes it.
3. The model, which the student turns by dragging, zooms with the wheel or a pinch, and moves
   with a right-drag or two fingers. Under it:
   - the style: **Ball and stick** (first), **Sticks**, **Space-filling**; a **Hydrogens**
     checkbox (ticked); **Reset view** (decision 6);
   - where the model came from, in plain text: "3D model from PubChem (CID 2244)" or "3D model
     computed by RDKit: PubChem has none for this structure";
   - always: "One shape the molecule can take. Real molecules flex and rotate about single
     bonds.";
   - where the drawing leaves stereo undefined: "Your drawing leaves 2 stereocentres
     undefined. This model shows one arrangement of them." (decision 7).
4. Any change to the drawing: "The drawing has changed." with a **Show again** button, as in
   the NMR preview. A model for an older drawing is never shown.
5. Instead of a model, when there is none: "Busy, try again shortly"; "The 3D service is not
   responding"; "Too big for a 3D model here (more than 100 non-hydrogen atoms)"; "RDKit could
   not build a 3D model of this structure. Some arrangements of bridged rings cannot exist.";
   "This browser can't show 3D graphics (WebGL is turned off)."

## Decisions for Jeff (proposed answers in bold)

1. **"Sharing code with the FirstGlance replacement": a question for you, not decided here.**
   (Answered 2026-10-26: reading (a).)
   I found ProteinFirst (~/projects/protfirst), which says it replaces FirstGlance in Jmol: it
   vendors 3Dmol.js 2.5.5 as a global script, with no build step, from a white background with
   Jmol colours (js/viewer.js). What did you mean? Possible readings:
   - (a) the same pinned 3Dmol.js release (2.5.5) and the same look for small molecules
     (white background, Jmol colours), with no shared files;
   - (b) a small viewer module written once and copied into both repositories (MU Draw would
     need it as TypeScript under Vite; ProteinFirst loads plain ES modules with no build);
   - (c) something else, such as ProteinFirst later showing ligands with this code.
   One copy of 3Dmol served to both apps from one path is ruled out: invariant 1 allows only
   MU Draw's own files, and offline needs it in MU Draw's precache. I'd build (a) unless you
   say otherwise.
2. **PubChem's conformer first; RDKit only where PubChem has none.** PubChem's is one
   MMFF94-optimised conformer from its own pipeline, and says which compound it is. RDKit
   first would give one model everywhere, online or not, but not PubChem's.
3. **The fallback: the server computes it with Python RDKit.** RDKit.js can't (measured below:
   the pinned RDKit.js 2026.9.1 has no 3D embedding and no force field). The server's RDKit is
   the same release. It embeds with ETKDGv3 (fixed seed), capped by a 2 s timeout, then
   MMFF94 for at most 200 steps (UFF where MMFF has no parameters; neither for platinum and
   such). The alternative is OpenChemLib's conformer generator in the browser, which works
   offline but adds a fourth chemistry engine (invariant 3), 2.5 MB, and took 4.3 s for
   cholesterol.
4. **Offline: "Needs an internet connection", as Get name says.** Invariant 4 widens to
   "everything except the naming endpoints and the 3D view works offline". (With
   OpenChemLib, decision 3's alternative, the view would work offline instead.)
5. **Docked below the canvas, joining belowCanvas.ts's one-at-a-time rule**, so the student
   sees the drawing and the model together and the app keeps one kind of panel. The model
   gets the panel's full width and about 320 px of height. The alternative is a window over
   the canvas, as Ketcher's own viewer opens.
6. **Styles: ball and stick, sticks, space-filling; hydrogens on or off; Jmol colours on
   white**, as ProteinFirst shows ligands. Double bonds drawn as two sticks. Nothing else in
   this version: no labels, no measuring of distances or angles, no spinning (no motion that
   the student didn't start), no picture export.
7. **Stereo the drawing leaves undefined: the model is shown, with the note.** PubChem's model
   of flat 2-butanol is (S); of cocaine drawn without wedges, one of its diastereomers. RDKit's
   picks one too. The alternative is no model until the drawing defines its stereo.
8. **Ketcher's 3D viewer stays hidden.** It shows Indigo's flat 2D drawing in Miew (no 3D
   coordinates are made), and its Apply button loads Miew's copy back over the drawing.
9. **What is sent: the drawing's SMILES, as Get name sends it**, to a new endpoint
   `POST <base>api/conformer`, in the body. It goes to PubChem in the body too (one call:
   `compound/smiles/SDF?record_type=3d`). The answer is cached 30 days like a name.
10. **PubChem busy or not answering: RDKit's model, not cached.** The source line says
    "PubChem did not answer". The alternative is "Busy, try again shortly" with no model.
11. **Limits on the server: at most 100 non-hydrogen atoms are embedded; one embedding runs
    at a time, at most 4 wait behind it, and any more get "busy".** The public endpoint
    otherwise lets anyone keep the API's CPU busy. Embedding releases Python's lock, so names
    are answered meanwhile.
12. **The test compounds** (SMILES from PubChem through the fixture scripts; please change
    the list): aspirin; (R)- and (S)-2-butanol; 2-butanol drawn flat; (E)- and (Z)-2-butene;
    cyclohexane; β-D-glucopyranose; cholesterol; cocaine, and cocaine drawn without wedges;
    menthol; adamantane; 2,2'-dimethylbiphenyl; erythromycin (51 non-hydrogen atoms: PubChem
    has no 3D model); an invented structure PubChem has no record of (from the Get name
    fixtures); vancomycin (too big); camphor's impossible bridgehead stereoisomer (from the
    stereoisomer fixtures); sodium acetate drawn as two ions (one structure at a time).

## Measured before planning (throwaway probes in the session's scratch folder)

- **3Dmol.js 2.5.5** (2026-05-22; the latest; the release ProteinFirst vendors). BSD-3-Clause.
  Its bundle carries pako 2.2.0 (MIT and Zlib), iobuffer 5.4.0, netcdfjs 3.0.0 and upng-js
  2.1.0 (MIT). Built by Vite as its own chunk: 574 kB minified, 162 kB gzipped. Loaded only
  when the panel first opens, and precached for later.
- **It runs under the app's CSP.** A probe page with web/csp.json's policy (meta tag and
  header) rendered PubChem's aspirin record in Playwright's Chromium (`channel: 'chromium'`,
  headless, software WebGL): no CSP violation event, no request but its own files.
  - Its one `eval` turns a callback given as a string into a function (for py3Dmol); the app
    never passes one, and the CSP would block it. Rolldown warns about it at build time.
  - Its surfaces run in a `blob:` worker, which `worker-src 'self'` blocks; no surfaces here.
  - It names PubChem and RCSB URLs only in its download helpers and in `autoload`, which acts
    only on elements with class `viewer_3Dmoljs`. The request guard would catch any use.
- **PubChem's 3D record.** POST `compound/smiles/SDF?record_type=3d`, the SMILES in the form
  body, answers in about 0.4 s:
  - 200: one conformer (`-OEChem-` 3D header, every H, `PUBCHEM_COMPOUND_CID` among its
    fields), 1.8 kB (ethanol) to 10 kB (cholesterol);
  - 404 `PUGREST.NotFound`: the compound exists but has no 3D record: more than 50
    non-hydrogen atoms (erythromycin 51, taxol 62, cyclosporin 85, vancomycin 101), salts and
    mixtures, metals (ferrocene, cisplatin);
  - 501 `PUGREST.Unimplemented` ("without an existing CID"): PubChem has no record;
  - 400 `PUGREST.BadRequest`: it can't read the SMILES.
- **Stereo.** For all 14 compounds tried that leave no stereo undefined, the InChIKey of the
  3D record (stereo read from the coordinates) equals the drawing's. Where the drawing
  leaves stereo undefined, the record has one arrangement (decision 7). For cage compounds
  (adamantane, cubane) InChI reads bridgehead parities from 3D coordinates that it doesn't
  give the 2D structure, so the server compares connectivity (the InChIKey's first block),
  and the tests check stereo element by element.
- **RDKit.js 2026.9.1 can't embed.** Its API and its wasm have no ETKDG, distance geometry or
  force field (`set_new_coords` is 2D only).
- **Python RDKit 2026.09.1 can** (the env the API runs in). ETKDGv3, seeded, then MMFF94:
  under 0.25 s up to cholesterol; erythromycin 1.6 s, taxol 1.4 s, cyclosporin 2.7 s,
  vancomycin 4.1 s (MMFF run to 500 steps here). Its InChIKey matched the drawing's wherever
  the drawing leaves no stereo undefined (cages aside, as above). `EmbedMolecule` and
  `MMFFOptimizeMolecule` release Python's lock (another thread ran throughout). Camphor's
  impossible stereoisomer fails in 1.5 s with the 2 s cap (75 s uncapped in the stereoisomer
  work). Ferrocene gets UFF; cisplatin gets neither force field.
- **OpenChemLib 9.25** (decision 3's alternative): BSD-3-Clause; 1.1 MB of script plus 1.35 MB
  of resources; its ConformerGenerator in Node took 0.9 s for aspirin, 2.0 s for cocaine and
  4.3 s for cholesterol. Its stereo was not checked.
- **Ketcher's 3D viewer** (Miew 0.11.1, MIT; ketcher-react 3.18 source): it converts the
  drawing to CML with Indigo and loads that, so it shows the flat 2D drawing. Already hidden
  (web/src/editor/ketcherUi.ts, editor.css, a smoke test).

## Acceptance bar

**A. The server** (pytest; PubChem only from recordings, made by a script)
1. `POST /api/conformer {"smiles"}` answers `{found, source, cid, molblock, undefined_stereo,
   message}`. `source` is "pubchem" or "rdkit"; `molblock` is the 3D record's Molfile, through
   `M  END`. An unreadable SMILES gets 400 `invalid_structure`; more than one structure gets
   400 `one_structure`; more than 100 non-hydrogen atoms gets `found: false`, `too_big`, with
   nothing embedded.
2. PubChem first. A recorded 200 gives PubChem's Molfile and CID unchanged. A record of
   another structure or configuration, or a flat one, is not shown: RDKit's model is, marked
   `pubchem: "unusable"` (cached, as PubChem did answer). A record with no CID or no Molfile
   counts as PubChem not answering.
3. Recorded 404 and 501 give RDKit's model: ETKDGv3, fixed seed, 2 s timeout, MMFF94 at most
   200 steps (UFF, then none, where it lacks parameters). A generator (server/scripts/, like
   the stereoisomer one) writes tests/fixtures/conformers_expected.json: for each test
   compound, its source, CID, atom count by element, and its stereo elements' CIP labels read
   from the 3D model. A drift test regenerates it and byte-compares. Jeff judges a separate
   file (as for the stereoisomers) of which compounds keep which stereo; a test checks the
   generated fixture against it.
4. For every test compound that defines stereo, the model's labels (from its coordinates)
   equal the drawing's at every element the drawing defines, whichever source made it.
5. The impossible camphor isomer gets `found: false`, `no_model`; the embedding was given the
   2 s timeout (checked on the parameters passed).
6. Cache: 30 days, keyed by RDKit's canonical SMILES; PubChem's 200, 404 and 501 and RDKit's
   models are stored; busy and unavailable are never. With PubChem busy or unavailable the
   answer is RDKit's model, marked so, and the next request asks PubChem again.
7. One embedding at a time, at most 4 waiting: with a held stand-in embedder, the sixth
   request at once gets 503 `busy`, and releasing the first lets the next one start.
8. PubChem calls share the naming rate limit (5 a second, 400 a minute) and its retry rule.
9. Privacy: test_privacy.py's sentinel SMILES, sent to the new endpoint through every path
   (PubChem 200, 404, busy, RDKit failure), never reaches a log line or an error message.

**B. In the app** (Playwright replays recorded server answers, tests/fixtures/conformer_responses.json;
Vitest for the panel's state)
1. The button shows for one structure; a reaction or two structures gets the message, and
   offline the button is disabled with "Needs an internet connection" (an "offline:" test).
2. The panel docks below the canvas. Opening it closes Practice, the NMR preview and the
   stereoisomers, and each of them closes it (extends the belowCanvas tests).
3. For every test compound the model in the viewer (read back from 3Dmol: atoms by element and
   their coordinates) equals the replayed answer's Molfile, with the source line and the notes
   from "What a student sees" (CID, RDKit, undefined stereo with its count).
4. Each style and the Hydrogens box changes every atom's style in 3Dmol as named (read back
   from the viewer), and Reset view restores the first view.
5. Any change to the drawing makes the panel say "The drawing has changed."; Show again asks
   for the drawing as it is now. An answer for an older drawing is never shown: the server's
   answer is held, the drawing changed, then the answer released (Vitest and Playwright).
6. Each message in "What a student sees" (5) appears for its case: busy and not responding
   from replayed server answers; too big, no model and one structure from their test
   compounds; WebGL off from a browser started with WebGL disabled.
7. 3Dmol's chunk is not fetched until the button is first pressed, and is in the precache:
   the precache guard names it and fails without it (a negative test).
8. Every smoke test's request guard, link guard and CSP still pass, with a listener for CSP
   violation events added on the 3D tests; the panel shows no link.
9. 3dmol is pinned to exactly 2.5.5 in web/config/pins.ts (the pin test covers it).
10. Ketcher's 3D viewer stays hidden (the existing absence tests).

**C. Every change:** check.sh passes before each commit; CHANGELOG, BUILD-LEARNINGS,
THIRD-PARTY-NOTICES (3Dmol.js and what its bundle carries) and AGENTS.md are updated, and
AGENTS.md stays at 149 lines or fewer. The About box adds "3Dmol.js (BSD 3-Clause License)".

**D. Invariants** (AGENTS.md): 4 widens as in decision 4; 3 adds "3D coordinates from PubChem or
RDKit"; 5's pins add 3dmol. The API service must be restarted after the deploy that adds the
endpoint (Jeff runs `sudo systemctl restart mu-draw-api-staging`, then production's).

## As built (2026-10-26)

Small differences from the text above, none of them a decision:
- The button is **Show in 3D**, under a "3D view" heading below Predict ¹³C NMR; offline it is
  greyed with "Needs an internet connection" under it.
- The stereo note counts undefined stereocentres and double bonds together, as Get name does:
  "Your drawing leaves the stereochemistry undefined at 2 places. This model shows one
  arrangement."
- Invariant 3 needed no change: PubChem and RDKit are already its sources. Invariants 4 and 5
  changed as in bar D.
- PubChem's record of another structure or configuration is "unusable" (bar A.2): RDKit's model
  is shown, and the source line says "PubChem's model didn't match the drawing".

## Known limits

- One conformer: PubChem's first, or one RDKit embedding. Not the lowest in energy, and not
  checked against an experimental structure.
- No 3D view offline (decision 4), and none without WebGL.
- The model is turned by mouse or touch only; the keyboard reaches the buttons but can't turn it.
- A salt drawn as ions, or a metal complex PubChem stores as parts, gets "one structure at a
  time" rather than a model.
- Undefined stereo is shown as one arrangement, with the note.
- A class drawing new structures at once waits for one embedding at a time; past four waiting
  it gets "busy".
- RDKit counts the bridgeheads of cages such as adamantane as undefined stereocentres (as the
  properties panel and Get name do), so the stereo note shows for them.
- Large flexible molecules come near the 2 s cap (cyclosporin, 85 atoms: 1.6 s to embed on
  this machine), so some under 100 atoms will get "could not build".
