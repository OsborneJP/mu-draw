# Plan: ¹³C NMR prediction proof of concept (SPEC "NMR prediction proof of concept")

Written 2026-10-24 by Claude, before building into the app (after a one-day-style
prototype on the data, below). Jeff asked for the remaining v1 items done.

## Licences (checked 2026-10-24)

- nmr-processing (Zakodium) 22.25.6, current: CC BY-NC-SA 4.0, and its ¹³C prediction
  calls Zakodium's web service (nmr-prediction.service.zakodium.com), which invariant 1
  forbids. v11.1.1 (MIT) needs its database supplied and adds openchemlib; its part (a
  lookup with back-off) is about 50 lines. Not used.
- NMRShiftDB2 data (both of the spec's options use it): the "nmrshiftdb2 Database
  License", an ODbL 1.0 variant (text: web/public/nmr/LICENSE-nmrshiftdb2.txt). It
  requires: a notice on every prediction (4.3); the derived shift table under the same
  licence, with the licence (4.2, 4.4) and offered free (4.7: the app serves it); and
  (4.5) "If you build a software which relies on the database ... this software must be
  licensed under an Open Source Initiative-approved license", NMR prediction software
  named. The repository was private with no licence. **Decided (Jeff, 2026-10-24):** "mu-draw
  goes under the MIT licence with its source public, and the NMR preview ships with the
  nmrshiftdb2 notice." 
- The standalone NMRShiftDB2 predictor (option A) would need the same 4.5 answer, a new
  API endpoint, and would not work offline (invariant 4). So: option B's shape, built here.

## Design

- Offline, in the browser: a shift table built from NMRShiftDB2's 43,258 assigned ¹³C
  spectra (nmrshiftdb2withsignals.sd, SHA-256 in the table header) by
  web/scripts/build-carbon-table.ts, precached as web/public/nmr/carbon-shifts.bin.
- Environments: HOSE-style codes on RDKit's heavy-atom graph (src/chem/hose.ts), out to 4
  bonds; each neighbour as bond + element (+ aromatic, charge, and a flag when it carries
  a double or triple bond further out). The table holds the median shift per code; a
  carbon gets the most specific code the table has, backing off one sphere at a time.
- Symmetry: one peak per set of topologically equivalent carbons (canonical ranks without
  tie-breaking, refined on the graph; RDKit.js has no CanonicalRankAtoms binding, so the
  tests compare the classes with server-side RDKit's CanonicalRankAtoms(breakTies=False)).
- Low confidence: a match at 2 bonds or fewer (held-out NMRShiftDB2 compounds: 4.0 ppm
  mean error at 2, 9.2 at 1, against 2.1 at 3 and 1.1 at 4).
- The table leaves out the test compounds (by InChIKey skeleton), so the accuracy tests
  measure predictions for compounds it has never seen.
- A second RDKit worker (the same rdkit/worker.js, so no new CSP or Apache change), started
  on the first prediction; the properties never wait for it.
- UI: "Predict ¹³C NMR" with a "Preview" tag in the properties panel; the result floats at
  the bottom of the canvas: the spec's banner, the licence notice, a stick spectrum on a
  reversed 220-0 ppm axis (optional TMS line), and a table (shift, C/CH/CH₂/CH₃, number of
  equivalent carbons, "low confidence"). Clicking a peak or row highlights its carbons on
  the canvas; selecting a carbon on the canvas selects its peak. A change to the drawing
  clears the prediction and its highlight ("Predict again").

## Test set (provisional, for Jeff to check against CHEM-312)

15 compounds: toluene, anisole, p-cresol, acetophenone, benzaldehyde, methyl benzoate,
ethyl acetate, cyclohexanone, propanoic acid, 2-butanol, benzyl alcohol, aniline,
triethylamine, cyclohexanamine, ibuprofen; plus squalene (30 heavy atoms) for the timing
criterion. Structures from PubChem; measured shifts from their NMRShiftDB2 records
(CDCl3 spectrum when there is one), kept in tests/fixtures/nmr/.

## Acceptance bar (the review checks against this)

1. Signal count: for each of the 15, the number of peaks equals the expected count in
   tests/fixtures/nmr/expected.json (judgement, provisional) and the number of carbon
   classes server-side RDKit gives (Vitest). The symmetry classes equal RDKit's on every
   NMR and functional-group fixture compound.
2. Shifts: at least 80% of the 15 compounds' signals within ±3 ppm of NMRShiftDB2's
   measured shift; every signal outside is listed in tests/fixtures/nmr/outliers.json and
   in BUILD-LEARNINGS.md (the test fails if the list and the predictions disagree).
3. Peak-to-atom highlighting both ways (Playwright): a row or stick colours exactly its
   carbons (Ketcher ids, also after ids are reordered); selecting a carbon selects its
   peak; a change to the drawing removes the colour; not an edit (no undo step, no change
   event).
4. Speed: squalene (30 heavy atoms) predicted in under 2 s from the click, the first time
   (worker start and table load included) and again (Playwright).
5. Offline (server stopped, context offline, after one visit): the table comes from the
   service worker and the prediction shows; option A's offline message does not apply.
6. The banner and the NMRShiftDB2 notice show on every prediction; the licence copy is a
   file in the app (no link leaves the app); the table's header names its source file's
   SHA-256, the licence, and exactly the left-out compounds.
7. Ordering: a reply for a drawing that has since changed is never shown (reply held).
8. The precache stays under the 30 MB per-file limit (and, as measured, the whole precache
   under 30 MiB); guards for the table (precache, live check) with tests that fail without.
9. Every guard has a test that fails without it, in BUILD-LEARNINGS.md; check.sh passes;
   deployed to staging and production with the live checks, once Jeff has answered 4.5.

Not in scope (spec "Later"): ¹H prediction, multiplets, solvent choice.

## Results (2026-10-24)

1. Signal counts: all 15 right, equal to the judgement file and to server-side RDKit; the
   symmetry classes equal RDKit's on all 41 fixture compounds.
2. Shifts, held out: 72 signals, mean absolute error 1.18 ppm, 64 (89%) within ±3 ppm; the
   8 outside are in tests/fixtures/nmr/outliers.json and BUILD-LEARNINGS.md.
3. Highlighting both ways, with ids reordered, not an edit: browser tests pass.
4. Squalene: about 2 ms in Node; first and second browser predictions under 2 s.
5. Offline: passes (table from the service worker).
6. Banner and notice on every prediction; licence file in the app; header checked.
7. Ordering: a held answer for a changed drawing is dropped.
8. Precache 30,508 KiB in 18 entries; largest file 11.8 MB.
9. Guard proofs: BUILD-LEARNINGS.md. The repository went public under MIT; staging and
   production verified at bf81dd5 (2026-10-25).
