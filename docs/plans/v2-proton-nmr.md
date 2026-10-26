# Version 2: ¹H NMR prediction (SPEC "Later: ¹H prediction", "After v1")

Written 2026-10-26 by Claude, after measuring NMRShiftDB2's ¹H data and a prototype on
held-out compounds (below). **Approved (Jeff, 2026-10-26):** "Approved as proposed: build it
with the bold answers to all 8 decisions."

The spec: "Start with a shift-only ¹H table before drawing simulated multiplets." This plan
does that, the way the ¹³C preview works (docs/plans/nmr.md): HOSE-style codes on RDKit's
heavy-atom graph (src/chem/hose.ts), a table of median measured shifts built from NMRShiftDB2
and shipped in web/public/nmr/, looked up in the browser, offline.

## What a student sees

1. A **Predict ¹H NMR** button with a "Preview" tag, beside "Predict ¹³C NMR" in the
   properties panel.
2. A panel below the canvas, like the ¹³C one (decision 4), with the same banner ("Predicted
   shifts from a database of measured spectra. Real spectra can differ; use this to check
   reasoning, not as an answer key.") and the same NMRShiftDB2 licence notice.
3. A stick spectrum on a reversed axis, 12 to 0 ppm (widened in whole ppm when a peak lies
   above 12, as carboxylic acids can), with the optional TMS line at 0. Each stick's height is
   proportional to its number of H, so the integration reads off the picture.
4. A table, one row per signal: δ (ppm, to 0.01), the number of H ("3H"), what they sit on
   (CH₃, CH₂, CH, OH, NH, …), and a note: "low confidence", "exchangeable", "diastereotopic".
5. Clicking a row or stick colours the atoms carrying those H on the drawing; selecting one
   such atom selects its row. Any change to the drawing clears the prediction ("Predict
   again"), as for ¹³C.

## Decisions for Jeff (proposed answers in bold)

1. **Shifts and integration only; no multiplicity or coupling constants yet.** NMRShiftDB2
   holds no coupling constants at all, and only 8% of its ¹H peaks carry a multiplicity letter
   ("m" among the commonest). A multiplet drawn from the structure by the n+1 rule would be
   wrong for aromatic rings, diastereotopic CH₂ and most OH, which is where the spec says
   predictions mislead students. Alternative: a "neighbouring H" column (n, counted from the
   structure) as a hint, not a pattern.
2. **Exchangeable H (OH, NH, SH): shown at the database's median, marked "exchangeable", and
   left out of the accuracy bar**, with one note in the panel: their shifts depend on solvent,
   concentration and temperature, and in D₂O they exchange and are not seen. Held out, they are
   off by 0.95 ppm on average (median 0.46), against 0.23 for C–H. Alternatives: leave them out,
   or list them without a shift.
3. **Diastereotopic H: a CH₂ whose two H differ gets two rows of 1H each, marked
   "diastereotopic"**, at the higher and lower medians the table records for that environment
   (the panel does not say which H is which). Which CH₂ qualify is a rule on the structure
   (measured below: right about 80% of the time when it says "differ", and 98% when it says
   "same"). Held out, the two rows were off by 0.14 ppm per H, against 0.23 for one averaged
   row. Alternative: one 2H row with the note. Diastereotopic methyl groups (an isopropyl next
   to a stereocentre, as in menthol) stay one 6H row: a known limit. (After the review: the
   rule counts another stereocentre, not a double bond; and where the CH₂'s own code matches
   further out than its pair, the two rows sit half the pair's gap either side of its median.)
4. **Beside the ¹³C preview: two buttons and two panels in the one place below the canvas, one
   at a time** (belowCanvas.ts gains 'proton'; opening it closes ¹³C, the stereoisomers or
   Practice, and each of those closes it). The ¹³C panel and its tests stay as they are, and
   the edits to shared files are small. Alternative: one "Predicted NMR" panel with ¹H and ¹³C
   tabs, which lets a student flip between the two for one drawing in one click.
5. **"Low confidence" when the match reached 2 bonds or fewer from the H's own atom**, the same
   rule as ¹³C. Held out, C–H matches were off by 0.72 ppm on average at 1 bond, 0.36 at 2,
   0.21 at 3 and 0.11 at 4.
6. **The test compounds are left out of the shipped table, as for ¹³C**, so the tests measure
   compounds the table has never seen. The cost: those compounds are predicted from similar
   ones, and the smallest are marked "low confidence" even where the shift is right (acetone:
   2.19 predicted, 2.20 measured).
7. **No solvent choice** (the spec's "Later"): the table pools every measured spectrum, since
   86% of NMRShiftDB2's ¹H spectra don't name a solvent, and training only on those that do
   made held-out predictions worse (0.38 ppm against 0.23). Reference spectra for the tests are
   CDCl₃ where there is one.
8. **The test compounds** (structures from PubChem through the fixture scripts; each has a
   measured ¹H spectrum in NMRShiftDB2; the expected signal counts are for you to judge,
   provisional). Five of the ¹³C set have no ¹H spectrum (anisole, benzaldehyde, methyl
   benzoate, aniline, squalene), so this set differs. Please change the list:
   - Aliphatic: ethanol, acetone, ethyl acetate, tert-butanol, 2-chloro-2-methylpropane,
     2-butanol, propanoic acid, diethylamine, triethylamine, cyclohexanone.
   - Aromatic: toluene, acetophenone, benzyl alcohol, aspirin, ibuprofen, caffeine, nicotine.
   - Alkenes: (E)-cinnamic acid, crotonic acid ((E)-but-2-enoic acid; first (Z)-but-2-enoic
     acid, whose only NMRShiftDB2 ¹H spectrum turned out to be the E isomer's: the review),
     carvone, limonene.
   - Diastereotopic CH₂: menthol (also nicotine, carvone, limonene, 2-butanol).
   - Squalene again for the timing bar only (it has no ¹H spectrum).
   - Aspirin's NMRShiftDB2 record (CDCl₃) puts its COOH H at 7.06 ppm and three ring H 0.4 to
     0.7 ppm from the prediction; keep it as a recorded outlier, or drop it?

## Measured (2026-10-26; nmrshiftdb2withsignals.sd, SHA-256 0e866883…3a0afe, the file the ¹³C table names)

- **The data.** 58,187 records; 17,671 have a ¹H spectrum (18,222 spectra, 151,439 peak
  entries, 16,830 distinct compounds by InChIKey skeleton; 7,457 of them also have ¹³C).
  - Peaks are `shift;intensity+multiplicity;atom`, the atom being the one carrying the H. In
    records that draw their H (4,535), 8,337 entries point at an H atom; those go to its
    heavy neighbour. 44 entries point at an atom with no H and are dropped.
  - Per H or per group: about 77,000 atoms list one entry per H, 55,000 a single entry for a
    group. Of 6,448 CH₂ listed with both H, 4,091 give shifts more than 0.05 ppm apart.
  - Multiplicity letters on 11,858 entries (8%): s, m, d, dd, t, … No coupling constants
    anywhere (6 J-resolved spectra, no values in the peak lists).
  - Solvent: 15,705 spectra (86%) "Unreported", mostly one block of records (IDs about
    20,165,000 to 20,178,000; field strength and temperature unreported too); then CDCl₃
    1,169, D₂O 545, CD₃OD 115, DMSO-d₆ 112, CCl₄ 72, acetone-d₆ 62, others.
  - 177 ¹H spectra are calculated (NMRProgram: Spartan 174, Quantum ESPRESSO 3). They are left
    out, and the table's header says how many.
- **The prototype** (throwaway, in Node with the app's hose.ts and RDKit.js). Codes are
  centred on the atom carrying the H, out to 4 bonds; each spectrum contributes one value per
  atom (the mean of its entries), and the table holds the median per code, backing off one
  sphere at a time. Held out: a fixed 2% of compounds chosen by InChIKey hash (357 compounds
  with a ¹H spectrum), plus the test set. Mistake: those 357 included the 38 test compounds
  (¹³C's and ¹H's), which are small and easy, so the figures below are better than the random
  share alone gives (see "While building").
  - C–H signals, 2,286: mean absolute error 0.228 ppm (median 0.10); 77% within ±0.3 ppm, 88%
    within ±0.5. By kind: sp³ 0.22, aromatic 0.23, alkene 0.34, aldehyde 0.11 (13 signals).
  - Exchangeable H, 138: 0.95 ppm (median 0.46); 52% within ±0.5.
  - The test set (22 compounds, reference spectra in CDCl₃ for 16, CCl₄ 3, unreported 3):
    90 C–H signals, mean error 0.131 ppm; 80 (89%) within ±0.3 and 86 (96%) within ±0.5. The
    ten outside ±0.3 (predicted / measured): nicotine's N–CH 4.00 / 3.08; carvone's CH 3.04 /
    2.69 and =CH 6.36 / 6.76; menthol's CH–O 4.18 / 3.42; ethanol's CH₂ 4.01 / 3.70;
    caffeine's ring H 8.80 / 7.53; aspirin's ring H 6.88 / 7.30, 7.53 / 8.25, 7.10 / 7.53;
    ibuprofen's ring H 7.55 / 7.21.
  - 3 spheres: 0.238; 5 or 6: 0.229 (no better, for 1.7 to 2.4 times the codes). Training on
    reported-solvent spectra only: 0.381. One value per entry instead of per atom: 0.230.
  - For comparison, the spec cites Kuhn et al. 2008: 0.17 ppm for HOSE-code ¹H predictions on
    NMRShiftDB data (another data set and protocol).
- **Diastereotopic CH₂, the rule** (Python RDKit, all 6,448 CH₂ in measured spectra that list
  both H). An sp³ CH₂ qualifies when replacing one of its H by deuterium makes it a possible
  stereocentre and the molecule then has another stereo element (FindPotentialStereo; the
  review narrowed it to another stereocentre, below); an
  =CH₂ qualifies when the other end of its double bond carries two different groups (by
  symmetry rank), or one group and an H. Flagged sp³: 3,480 of 4,312 differ by more than 0.05
  ppm (81%; median gap 0.22 ppm). Not flagged: 28 of 1,398 differ (2%). Flagged =CH₂: 583 of
  733 differ (80%); not flagged: 0 of 5. In the browser the rule uses the app's own
  FindPotentialStereo equivalent (src/chem/stereoElements.ts).
- **Size.** The table encoded as the ¹³C one is (hashes, check byte, int16 shift, here in
  hundredths of a ppm): 708 kB for 126,012 codes; 798 kB with the diastereotopic pairs (17,118
  codes more), so the precache grows by about 0.8 MB (it was 30,508 KiB with the ¹³C table);
  Workbox's 30 MB limit is per file.
- **Speed.** The ¹³C lookup takes about 2 ms for squalene in Node; ¹H adds the stereo check
  per CH₂ (to be measured in the browser: bar 7).
- **Also found, about the ¹³C table** (not changed here): 8,235 of the ¹³C spectra it was built
  from have a Program field naming a predictor (NMRShiftDB2's HOSE code 3,997; ACD/Labs 3,863;
  CSEARCH 200) or NMRProgram a calculation (Spartan 175). Most of those differ from the
  measured spectrum in the same record, so they are probably predictions. Whether to rebuild the
  ¹³C table without them is a separate change.

## Acceptance bar (the review checks against this)

1. **Signal count.** For each test compound the number of rows equals
   tests/fixtures/proton_nmr/expected.json (judgement, provisional; a diastereotopic CH₂ counts
   as two). The classes of H-bearing atoms equal server-side RDKit's
   CanonicalRankAtoms(breakTies=False) on every NMR and functional-group fixture compound.
2. **Integration.** Each row's H count is the number of H on its atoms (drawn or implicit),
   and the rows add up to the molecular formula's H (RDKit) for every fixture compound. Stick
   heights are proportional to the H counts.
3. **Diastereotopic flags.** The browser's flags equal a Python generator's (the rule above,
   server/scripts/) on every fixture compound, with a drift test. When the table is built,
   flagged CH₂ listed with both H in NMRShiftDB2 differ by more than 0.05 ppm at least 75% of
   the time and unflagged ones at most 5% (measured: 81% and 2%); the build stops otherwise.
4. **Shifts, test set (held out).** At least 80% of the test compounds' C–H signals within
   ±0.3 ppm of NMRShiftDB2's measured shift and at least 90% within ±0.5 ppm (measured: 89%,
   96%). Every C–H signal outside ±0.3 is in tests/fixtures/proton_nmr/outliers.json and
   BUILD-LEARNINGS.md; the test fails if the list and the predictions disagree. The
   exchangeable rows' errors are recorded in the same file, outside the bar.
5. **Shifts, random held out (at build time).** build-proton-table.ts also builds a table
   without the fixed 2% of compounds and measures it: C–H mean error at most 0.27 ppm and at
   least 72% within ±0.3 ppm (corrected by Jeff, 2026-10-26, from 0.25 and 75%: see "While
   building"). It writes the figures, by sphere too, into the shipped table's header, and stops
   without writing a table that misses them. A test reads the header.
6. **Highlighting both ways** (Playwright): a row or stick colours exactly the atoms carrying
   its H (Ketcher ids, also after ids are reordered); selecting one such atom selects its row
   (the first of a diastereotopic pair); a change to the drawing removes the colour; not an
   edit (no undo step, no change event).
7. **Speed.** Squalene (30 heavy atoms) predicted in under 2 s from the click, the first time
   (worker start and table load included) and again (Playwright).
8. **Offline** (server stopped, context offline, after one visit): the table comes from the
   service worker and the prediction shows.
9. **Notices.** The banner and the NMRShiftDB2 notice show on every prediction; the licence
   copy is a file in the app (no link leaves it); the table's header names its source file's
   SHA-256, the licence, exactly the left-out compounds, and the calculated spectra left out.
10. **Ordering.** A reply for a drawing that has since changed is never shown, and a ¹³C reply
    never reaches the ¹H panel or the other way round (replies held, both kinds).
11. **One panel below the canvas.** Opening ¹H closes the ¹³C preview, the stereoisomers and
    Practice, and opening each of them closes ¹H (Vitest on belowCanvas.ts; one Playwright test).
12. **Precache and ¹³C unchanged.** The precache guard requires the ¹H table (a test fails
    without it); it stays under the 30 MB per-file limit, and the size is recorded. The ¹³C
    table rebuilds byte for byte with the shared encoder, and the ¹³C tests pass unchanged.
13. Every guard has a test that fails without it (BUILD-LEARNINGS.md), check.sh passes before
    each commit, and CHANGELOG.md, BUILD-LEARNINGS.md and AGENTS.md (149 lines at most) are
    updated. Nothing is merged, pushed or deployed from this branch.

## Known limits

- Shifts and integration only: no multiplets, coupling constants or field strength.
- One row per set of topologically equivalent atoms: restricted rotation is not seen
  (N,N-dimethylformamide's two N–CH₃ show as one row), nor are conformers (time-averaged).
- HOSE codes carry no stereo, so E/Z or cis/trans isomers get the same shifts, a diastereotopic
  pair's rows don't say which H is which, and diastereotopic methyl groups stay one row.
- No solvent choice; exchangeable H are rough (decision 2).
- The test compounds are predicted without their own spectra (decision 6).
- The reference shifts are NMRShiftDB2's as recorded, including records that look wrong
  (aspirin's COOH at 7.06 ppm); they are listed, not corrected.
- Added by the review (accepted, low): the rule can be wrong in bridged ring systems (RDKit
  marks bridgeheads as possible stereocentres; adamantane, DABCO, bicyclo[2.2.2]octane and
  norbornane's C7 get two rows), so the panel then says a CH₂ marked diastereotopic may give
  one signal; also wrong: an exocyclic CH₂ on C1 of a 1,4-disubstituted cyclohexane (two rows),
  (E)-cyclooctene and chiral allenes (one row though their CH₂ are diastereotopic), and a
  C₂-symmetric molecule's central CH₂. A CH₂ that NMRShiftDB2 lists with each H twice gives no
  pair entries. The solvent preference matches "CDCl3" exactly and counts only D₂O as
  exchanging. Selecting a drawn H on the canvas selects no row, and a row colours the atom
  carrying the H, not drawn H atoms. The sticks are reached by mouse only (the rows are the
  keyboard path), as in the ¹³C panel.

## While building (2026-10-26)

- **Bar 5 was mis-measured.** The builder holds out the random 2% alone (333 compounds with a
  measured ¹H spectrum, the test compounds apart) and shows decision 3's two rows for each
  diastereotopic CH₂: C–H mean error 0.257 ppm, 73.4% within ±0.3, 85.1% within ±0.5 (2,534
  signals; by sphere 0.68, 0.36, 0.22, 0.12 ppm). The two rows were not the cause: plain
  signals alone score 0.238; one averaged row per CH₂ would score 0.253. CH₂ pairs that
  NMRShiftDB2 lists only once score about 0.32 however they are shown; where it lists both H
  the two rows beat one (0.146 against 0.192). Jeff corrected bar 5 to 0.27 and 72%, keeping
  decision 3 and bar 4.
- **Bar 4 as built:** all 22 signal counts as expected; 105 C–H signals, mean error 0.137 ppm,
  92 (87.6%) within ±0.3 and 100 (95.2%) within ±0.5. The 13 outside ±0.3 and every
  exchangeable signal are in tests/fixtures/proton_nmr/outliers.json. Three spectra leave out
  an exchangeable H (ethanol's and menthol's OH, ibuprofen's COOH), so those are recorded
  without a measured shift.
- **Bar 3 as built:** of 5,027 flagged CH₂ listed with both H, 4,049 (80.5%) differ by more
  than 0.05 ppm; of 1,363 unflagged, 30 (2.2%).
- **Speed.** The rule first called the stereo search (src/chem/stereoElements.ts) in full for
  each CH₂: the stereoisomer list's slowest drawing (cholesterol with =CH₂ for its OH, every H
  drawn) took 6.8 s. The search for dependent double bonds can't change the answer (it runs
  only beside open elements, which already count), so the rule skips it: 35 ms. Squalene: 20 ms.
- **The table:** 812 kB, 145,438 entries (128,066 codes, 8,686 of them with a higher and a
  lower entry), from 17,939 measured spectra
  (130,248 atoms); 177 calculated spectra left out.

## After the review (2026-10-26)

A capped review: three reviewers (the chemistry pipeline; the panel, worker and browser tests;
guards, invariants and docs), and two skeptics who tried to refute each high and medium. Each
confirmed one is fixed with a test that fails without the fix (guard proofs: BUILD-LEARNINGS.md).
- **The rule counted a double bond as another stereo element**, so enantiotopic CH₂ got two
  rows (ethyl crotonate's OCH₂, all ten of squalene's CH₂). A reflection keeps E and Z, so such
  H are mirror images. In NMRShiftDB2, CH₂ flagged only because of a double bond differ in 6 of
  81 pairs (7%), against 82% where there is another stereocentre. The rule now asks for another
  possible stereocentre (RDKit.js's stereo tags; in Python, FindPotentialStereo's atom-centred
  elements). Nine drawings for the rule alone (tests/fixtures/proton_rules/, from PubChem) carry
  a judgement (judged.json, provisional) of how many CH₂ in each are diastereotopic.
- **(Z)-but-2-enoic acid was compared with the E isomer's spectrum**: records were matched on
  the InChIKey skeleton alone, and NMRShiftDB2 has a ¹H spectrum only for E. Records now match
  on stereo too (a mirror image, or stereo left undefined on one side, still matches), and the
  test compound is crotonic acid ((E)-but-2-enoic acid).
- **A pair matched closer in than the CH₂'s own code replaced the better estimate.** Pairs come
  only from CH₂ listed with both H; the CH₂'s own median comes from every spectrum. Where that
  matched further out, the two rows are now half the pair's gap either side of it, as confident
  as that match (held out: 0.257 to 0.239 ppm).
- **A click on a stick could select its neighbour**, whose click target covered it (bar 6), and
  **coincident sticks hid the integration** (toluene's 2H and 1H ring signals drew as one 2H
  stick). Click targets now stop halfway to each neighbour, and signals drawn closer than a
  line's width make one stick, as tall as their H together.
- **"element 17 H"** for H on atoms outside a short list: the panel now uses Ketcher's element
  table.
- Also fixed (low): the axis widens below 0 ppm for a negative shift; exchangeable sticks are
  broad and pale, apart from the dashed low-confidence ones; stick positions are tested; a
  missing figure (nothing held out, no pairs) stops the build; counts typed into tests now come
  from the fixtures; bar 2 covers every fixture compound; both tables' round trips are tests;
  `erasableSyntaxOnly` in the TypeScript configs catches code plain Node can't strip (it found a
  second such constructor, in stereoisomers.ts); stale comments and counts.
- Accepted (low): the limits added to "Known limits" above.

**The bar after the review:** bar 3: 4,043 of 4,946 flagged CH₂ differ (81.7%), 36 of 1,444
unflagged (2.5%). Bar 4: all 22 signal counts as expected; 105 C–H signals, mean error 0.129
ppm, 94 (89.5%) within ±0.3 and 101 (96.2%) within ±0.5; the 11 outside ±0.3 are in
outliers.json. Bar 5: 333 compounds, 2,513 C–H signals, mean error 0.239 ppm, 75.6% within
±0.3, 86.9% within ±0.5 (by sphere 0.74, 0.36, 0.23, 0.12 ppm); exchangeable H 0.89 ppm (128).
Squalene: 11 ms in Node.

**For Jeff to judge:** how decision 3 places a pair (above); crotonic acid in place of the Z
isomer; the judgement in proton_rules/judged.json and proton_nmr/expected.json.

## Build order, once approved

1. Shared reading of the SD file (web/scripts/nmrReference.ts: ¹H spectra, calculated ones
   marked) and the table encoder (src/chem/carbonTable.ts, with the scale and magic as
   parameters), with the ¹³C table rebuilt byte for byte.
2. web/scripts/build-proton-table.ts: public/nmr/proton-shifts.bin, the excerpt and reference
   spectra in tests/fixtures/proton_nmr/, the held-out figures in the header.
3. src/chem/protonNmr.ts (prediction, diastereotopic rule) and its Vitest bar items (1–5),
   with the fixtures (proton_nmr_names.txt, PubChem structures, Python generator).
4. The worker message, the state (panels/protonNmr.ts, held-reply tests), the panel, the
   button, belowCanvas.ts, the precache guard.
5. Playwright: highlighting, speed, offline, notices, one panel at a time.
6. A capped review of the diff (reviewers with a skeptic each); highs and mediums fixed with a
   test that fails without the fix, lows recorded here as accepted limits.
