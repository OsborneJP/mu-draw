# Practice mode (version 2, SPEC "After v1" > "Teaching features")

Requested by Jeff on 2026-10-25, through the main session, as part of version 2. CHEM-311 is to use it as soon as possible.
- **The spec's line.** "The app gives a name, the student draws it, and the app compares InChIKeys. No records kept."
- **Constraints.** Expected answers come only from OPSIN, PubChem and RDKit, through generated, recorded fixtures (invariant 3). Nothing about the student is kept or sent (invariant 2). Header changes stay small, and `web/src/chem/` and `PropertiesPanel.tsx` are left alone, because other version 2 work is going on there.

## Measured before building (Ketcher 3.18, RDKit 2026.09, OPSIN 2.9.0; throwaway browser probe)

1. **How a key is made.** `ketcher.getInChIKey()` writes the drawing as KET in the page, then sends one `GetInChIKey` message to Indigo's worker. The app never calls it today; only the tests do (`inchiKey()` in e2e/fixtures.ts).
2. **Two requests at once get the same answer.** Asked for ethanol's and benzene's keys at the same moment, both requests got ethanol's key. All `GetInChIKey` answers go to one shared event, each request listens `once`, and nothing checks which drawing an answer is for. `imageQueue.ts` already queues images and conversions for this reason, but not `getInChIKey`.
3. **Indigo agrees with RDKit.** 13 of 15 OPSIN structures, loaded as RDKit 2D Molfiles, got exactly RDKit's key. So did aspirin drawn with a contracted COOH abbreviation, ethanol with every H drawn as an atom, benzene as aromatic and as Kekulé SMILES, two fragments together, and cholesterol (28 heavy atoms, 8 stereocentres). The existing Name to structure browser test already shows the same for its 30 names, loaded from the server's Molfiles.
4. **The 2 exceptions: a Molfile with chiral flag 0.** Ketcher reads such a file as an AND (racemic) group. Indigo then writes a non-standard InChI (`InChI=1/…/s3`), whose key ends in `NA` instead of `SA`, so (R)- and (S)-butan-2-ol got the same key. The server's `chem.molfile()` sets the flag, and its Molfiles get standard keys.
5. **A wedge drawn by hand is absolute.** Putting the wedge tool on butan-2-ol's C–O bond gave a standard key, equal to RDKit's key for (R)-butan-2-ol.
6. **A double bond drawn by hand is always E or Z.** Turning pentane's C2–C3 bond double gave RDKit's (E)-pent-2-ene key, never the key of plain "pent-2-ene", which has no E/Z. The crossed ("either") double bond makes `getInChIKey` fail with "<query molecule> is not a molecule", even though `getInchi()` answers for the same drawing. So if every key had to match in full, a name such as "pent-2-ene" could never be answered.
7. **Other drawings.**
   - An empty canvas gets a real key (the key of `InChI=1S//`), so Check must refuse an empty canvas itself.
   - A reaction fails with "<reaction> is not a molecule".
   - A generic atom (A, an R-group) fails with "<query molecule> is not a molecule".
   - A carbon with five bonds gets an ordinary key (Ketcher underlines the atom), so Check must refuse it itself.
   - Two fragments get one key for the mixture, and the InChI's formula reads `C2H6O.CH4`.
8. **What a key's three blocks can tell.** Block 1 (14 letters) is the skeleton. Block 2 is stereo, then S or N (standard or not), then the version letter. The last letter is protonation. Acetic acid and acetate share blocks 1 and 2 and differ only in that last letter (N vs M). (R)- and (S)-butan-2-ol share block 1.
9. **Speed.** 2–10 ms per key; the first one takes about 0.5 s while Indigo starts its InChI code. Cholesterol takes 6–10 ms.
10. **OPSIN and stated stereo.** "trans-1,2-dimethylcyclohexane" comes back as one enantiomer, although the name means either one. "alanine" comes back as L. "nicotine", "rac-…" and "(2RS)-…" come back without stereo. "(2R)-hex-4-en-2-ol" comes back with only partial stereo: R, and its C=C left open.
11. **Fixtures.** `server/scripts/record_name_lookups.py` already turns a names file into exactly what `/api/structure` answers: the real OPSIN jar, PubChem replayed from recordings. It also checks the answer against PubChem's own record for the name and adds RDKit's key. The 30 names there are already recorded, so a provisional list built from them needs no network.

## Design

- **What the student sees.** A Practice button in the header (one line in Header.tsx) opens a panel over the canvas, like Get name's. The panel shows the list's title, "Draw: (R)-butan-2-ol", "3 of 20", and the buttons Check, Previous, Next and Close. Show answer appears only if Jeff picks that (decision 3).
- **Check.**
  1. It reads the drawing when clicked. It refuses an empty canvas (the button is disabled), a reaction, generic or query atoms (a crossed double bond counts), an atom Ketcher flags for valence, and more separate structures than the answer has. Each gets its own plain sentence.
  2. It then asks Indigo for the InChIKey, and for the InChI (for its formula). Both go through the one Indigo queue.
  3. It compares the keys under the stereo rule (decision 2) and shows Correct or one hint (decision 3).
  4. Any change to the drawing clears the verdict. An answer for a drawing that changed after the click is dropped.
- **Next and Previous.** Each clears the canvas in one step that a single Undo reverses, then shows the new name. Opening Practice leaves the canvas as it is.
- **Lists.** Plain-text files `practice/<list>.txt`: a title line, then one name per line, in the same style as `tests/fixtures/name_to_structure_names.txt`. `server/scripts/build_practice_lists.py` runs the real server code on each name (OPSIN first, then PubChem). Names it hasn't seen before are recorded once, with network. `--offline` rebuilds from the recordings alone. It writes `web/public/practice/index.json`, plus one `<list>.json` per list. Each name gets:
  - the accepted key or keys (RDKit's), and whether stereo counts;
  - the formula and the number of components (RDKit);
  - with Show answer, the answer's Molfile from `chem.molfile()`, so the chiral flag is right.
- **What the builder refuses.** It stops with an error that names the name if:
  - neither OPSIN nor PubChem can draw it;
  - OPSIN's structure and PubChem's record have different skeletons (block 1);
  - the name states only part of its stereo (fact 10);
  - PubChem has more than one record for it.
- **Order.** Names come in list order. Nothing is shuffled, so the tests need no randomness.
- **Nothing is kept.** No score, no progress, no storage: the list and position live in memory and are gone on reload.
- **Offline.** The list files are precached (the `json` glob; the precache guard checks them), and keys are made on the device, so practice needs no network.

## Decisions for Jeff

**Decided (Jeff, 2026-10-25):** the recommended answer to each of the four, and the plan approved as written.

1. **Where the name lists come from.** Recommended: Jeff writes plain-text lists per course, CHEM-311 first. Until his arrive, there is one provisional "CHEM-311 (provisional)" list: the 19 systematic names already tested for Name to structure. "4-methyl-3-pentanol" is left out because it is deliberately misnumbered. The lists ship inside the app, so practice works offline, and a list change goes out with the next deploy. The alternative is lists served by osbornelab: they could change without a deploy, but practice would need the internet.
2. **How strict the stereo check is.** Recommended: only what the name states counts.
   - A name with R/S or D/L, such as "(R)-butan-2-ol" or "L-alanine": the whole key must match.
   - A name with only cis/trans, E/Z or rel-: the whole key must match, or the mirror image's key. So either enantiomer of "trans-1,2-dimethylcyclohexane" is right.
   - A name with no descriptor, such as "pent-2-ene", "alanine" or "nicotine": only block 1 and the protonation letter count, so any stereo, or none, is right.

   The alternatives:
   - **The structure decides:** alanine must be drawn L and nicotine (S), as Name to structure draws them.
   - **Always the full key:** names like "pent-2-ene" can't be answered (fact 6).
   - **Never:** stereo is not checked at all.
3. **What a wrong answer gets.** Recommended: one hint from comparing keys and formulas:
   - same skeleton, different stereo: "check the wedges or the E/Z geometry", with a note when the stereocentres are marked & or "or";
   - differs only by H⁺: "check charges and hydrogens";
   - same formula, different structure: "an isomer";
   - different formula;
   - plus the refusals above.

   After a wrong Check, Show answer draws a picture of the answer in the panel and leaves the canvas untouched. The alternatives are hints without ever showing the answer, or only "Correct" / "Not quite, try again".
4. **Defaults to approve with the plan.**
   - No score is shown and nothing is stored.
   - Next and Previous clear the canvas, and one Undo brings it back.
   - Name to structure and Get name stay available while practising. Nothing is recorded, so they could only help a student cheat themselves, and it saves code. The alternative is greying them out while the practice panel is open.

## Acceptance bar

**A. Lists and expected answers**
1. Each list is a names file under `practice/`. The first is the provisional CHEM-311 list (decision 1).
2. `build_practice_lists.py` writes `web/public/practice/*.json` from the real OPSIN jar and recorded PubChem answers only. pytest checks that the files rebuild byte for byte from the recordings, and that each recording is the exchange the server makes.
3. pytest checks that each accepted key is RDKit's key for the server's structure, or its mirror image under decision 2's rule, and that each formula and component count is RDKit's.
4. Each refusal has a negative test: a name drawn by no one, a skeleton disagreement (with faked replies), partial stereo, and several PubChem records.
5. The name rule for decision 2 (which descriptors count as absolute, which as relative, which names have none) has a unit test on names alone.

**B. Checking**
1. For every name in every shipped list, its answer loaded into the app gets Indigo's key equal to a shipped key, and Check says Correct. With Show answer, the answer is the shipped Molfile; without it, the test-only fixture below supplies it.
2. A browser test draws one stereo answer by hand: the wedge tool on a bond, as a student would. Check says Correct.
3. Each hint and each refusal has a browser test with a drawing from a generated fixture: `tests/fixtures/practice_cases.json`, made with OPSIN and RDKit, with a drift test. The cases include (S) drawn for (R), plain drawn for (R), E drawn for "pent-2-ene" (Correct under the recommended rule), acetate for acetic acid, an isomer, a different formula, an empty canvas, a reaction, a generic atom, a five-bond carbon, and an extra fragment.
4. Ordering, forced. A test hook holds the Indigo worker's replies, like `holdableRdkitReplies()`. The test clicks Check, edits the drawing, then releases the replies: no verdict appears. An edit after a verdict clears it. A second click while checking does nothing, because the button is disabled.
5. `getInChIKey` waits in the Indigo queue. A unit test with a fake service fails without that. A browser test asks for two drawings' keys at once, and each gets its own key (this fails today, fact 2).

**C. Flow**
1. The Practice button opens the panel, and Close or Esc closes it. The panel covers none of Ketcher's toolbars, and an atom under its edge can still be clicked, as checked for the NMR panel.
2. Next and Previous show the right name and "n of N", stopping at both ends. Each clears the canvas, and one Undo brings the drawing back.
3. With Show answer, the answer's picture appears after a wrong Check, and the canvas's key is the same before and after.
4. Name to structure and Get name behave as decision 4 says, with a test.

**D. Privacy and offline**
1. A practice session sends no request except GETs of the app's own files. Afterwards, browser storage holds nothing but the autosave key.
2. `offline:` smoke test: with the network cut after the first visit, the panel opens, the list loads, and Check says Correct.
3. The precache guard lists the practice files, and the CSP is unchanged.

**E. Every change:** small commits on this branch, each only after `scripts/check.sh` passes. CHANGELOG.md and BUILD-LEARNINGS.md updated. This session doesn't deploy, push or merge; the main session does. Invariant 6 in AGENTS.md is left to the main session.

## Not in this plan

Scores, saved progress, Canvas/LTI, and teacher-made lists edited in the app. Shuffled order, timers, and names generated from structures. Other version 2 features.

## Done (2026-10-25, on this branch; not deployed)

Commits: plan 2d041e2; InChIKey queue fix 8497e0c; lists and builder b40dbdc; the panel
4a94c90. Each item of the bar, and the test that holds it:

- **A1–A5.** `practice/chem-311.txt` has the 19 provisional names. tests/test_practice_lists.py
  covers the rest:
  - the byte-for-byte rebuild, and the recorded lookups;
  - RDKit's keys, formulas and components;
  - each refusal: a name drawn by no one, several PubChem records, a skeleton disagreement,
    partial stereo, stereo filled in from PubChem, and bad names files;
  - the descriptor rule, on 17 names.
- **B1.** "every shipped name". For names whose stereo isn't checked, the test compares the
  key's first block and its protonation letter, which is the rule itself.
- **B2.** The wedge tool, chosen from Ketcher's bond menu and clicked on the C–O bond.
- **B3.** 17 hint cases in the browser (tests/fixtures/practice_cases.json), plus the
  AND-group note and the "stereo isn't checked" note. The cases that a key decides are also
  unit-tested on RDKit's keys (src/panels/practice.test.ts).
- **B4.** Held Indigo replies: the drawing changes while checking; Next while checking;
  Close while checking; Next while the answer's picture is being drawn. Each guard removed
  in turn failed its test.
- **B5.** The unit test and the browser test both fail without the queue change.
- **C1–C4.** The panel docks below the canvas, so it covers nothing (asserted). Close, Esc
  and the header button all close it. Next and Previous clear the canvas in one Undo step
  and stop at both ends. Show answer leaves the canvas untouched. Naming stays available.
  Two lists get a chooser. Lists that fail to load say so, and opening again retries.
- **D1–D3.** Practice adds nothing to browser storage and makes no request except GETs.
  (Ketcher's own settings keys exist without it.) The `offline:` test passes. The precache
  guard requires practice.json, with a negative test, and the CSP is unchanged.

Accepted limits:
- The "couldn't read this drawing" message (an Indigo failure other than a query feature,
  or a drawing Ketcher can't write) has no test. Nothing found makes Indigo fail that way.
- Stereo words other than R/S, D/L, E/Z, cis/trans and rel- (endo/exo, syn/anti, α/β
  without D or L) count as no descriptor, so stereo isn't checked for such names.
- Nobody has tried it by hand in a browser yet, and it isn't on staging. Once the main
  session deploys, Jeff should try a few names on staging. He replaces the provisional list
  with CHEM-311's own: edit practice/chem-311.txt, then run build_practice_lists.py.
