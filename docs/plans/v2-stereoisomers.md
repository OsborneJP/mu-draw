# Version 2, feature 1: stereoisomer enumerator

Requested by Jeff on 2026-10-25, as the first version 2 feature (docs/SPEC.md, "After v1" > "Drawing tools"): "lists every stereoisomer of the drawn structure (RDKit), building on the stereocenter count."

The properties panel already says how many stereoisomers there can be at most (2ⁿ for n stereo elements). The enumerator shows them.
- One numbered picture per stereoisomer, drawn like the student's drawing, with R/S and E/Z next to the atoms.
- Which pairs are enantiomers ("enantiomer of 2"). Any two that aren't are diastereomers.
- Which stereoisomers are achiral, and meso.
- Which ones match the drawing.

So a student sees why 2,3-dibromobutane has 3 stereoisomers, not 4.

## What a student sees

1. A "Show stereoisomers" button beside "Stereoisomers, at most" in the properties panel.
2. A panel below the canvas, like the ¹³C NMR preview. Only one such panel is open at a time, and later features (tautomers, resonance structures) will use the same kind of panel.
3. Each picture has an Add button. Add puts that stereoisomer in hand: it follows the mouse until a click places it, as one Undo, the same as Name to structure's Add.
   - The panel stays open, so a student can place several, for example (R,R) beside (S,S).
   - Any other change to the drawing closes it.

## Decisions for Jeff (proposed answers in bold)

1. **Which stereo elements are varied: all of them**, including those the drawing already fixes. The ones that agree with the drawing are marked "Matches your drawing". The alternative is only the undefined ones.
2. **Marking.** **Every stereoisomer that agrees with what the drawing defines is marked**, so a partly defined drawing marks several. A drawing marked racemic ("and Enantiomer" in Ketcher, or any Molfile opened with chiral flag 0) marks both enantiomers.
3. **Layout. Each picture keeps the drawing's layout, with the student's own wedges flipped as needed**, the way enantiomers are taught. Only a stereoisomer whose double bond is flipped is laid out afresh, since its geometry has to change.
4. **Labels. R/S and E/Z go next to their atoms only, never as a caption.** RDKit has no IUPAC numbering, so a caption such as "(S,R)" would follow drawing order, not locants. Lowercase r/s (pseudo-asymmetric centres) show with a one-line note. "?" is never shown.
5. **Bridged rings. A note, not a fix.** In bridged rings (camphor, cocaine, tropine) RDKit lists stereoisomers that cannot exist: camphor gives 4 where 2 exist. Telling them apart needs 3D, which RDKit.js can't do. The panel says "In a bridged ring system some of these cannot exist." Building a bridgehead rule could come later.
6. **What RDKit can't judge. A note instead of "achiral".** RDKit has no axial or planar chirality: allenes, ortho-substituted biaryls, and (E)-cyclooctene and similar rings. Where the drawing has one of these, the panel says RDKit can't judge it and never prints "achiral". Standard InChI can't see stereo at nitrogen (Tröger's base), so there the same note replaces "achiral".
7. **Limits. Up to 8 stereo elements** (256 combinations; cholesterol) **are enumerated, and up to 32 stereoisomers are drawn.** Beyond 32, the panel gives the exact count and says there are too many to draw. Beyond 8 elements, it says there are too many to list. "Working…" shows while it runs.
8. **The test compounds.** Their SMILES come from PubChem through the fixture scripts, and their expected answers are for you to judge. Please change the list:
   - Simple: (R)-2-butanol, 2,3-dibromobutane, tartaric acid, threonine (and a copy with one centre left undefined), ephedrine, menthol, pentane-2,3,4-triol (pseudo-asymmetric).
   - Rings: 1,2-, 1,3- and 1,4-dimethylcyclohexane, trans-decalin, myo-inositol.
   - Double bonds: 2-butene, hexa-2,4-diene, (E)-cinnamic acid, acetaldoxime (C=N).
   - Other atoms: methyl phenyl sulfoxide (S), 1,2-dimethylaziridine and Tröger's base (N).
   - Sugars: aldehydo-D-glucose.
   - The notes: penta-2,3-diene, (E)-cyclooctene, camphor, cocaine.
   - The limits: cholesterol (256: counted, not drawn) and erythromycin (too many to list). The exact boundaries (8 and 9 elements, 32 and 33 stereoisomers) are tested on the limit function itself (bar A.5), so no compound has to land on them.
   - A racemic ("and Enantiomer") drawing.

## Measured before planning (RDKit.js 2026.9.1, Python RDKit 2026.09.1; throwaway probes, and three independent reviews)

- **RDKit.js has no enumerator.** Python's `EnumerateStereoisomers` is not in the JavaScript build, and invariant 4 rules out server-only (everything except naming works offline). The app enumerates in the browser instead.
- **How.** RDKit's JSON form of a molecule carries each atom's stereo (`cw`/`ccw`) and each double bond's (`cis`/`trans` with its reference atoms). The app already reads it (web/src/chem/compute.ts).
  - Each of the 2ⁿ combinations of the potential stereo elements (`get_stereo_tags`, non-legacy perception) is written into the JSON and read back with `get_mol`.
  - On 8 hard cases this gave exactly Python's `EnumerateStereoisomers(onlyUnassigned=False)`.
- **RDKit.js rejects whole-number coordinates in its JSON.** It reads `0.0` but not `0`, and JavaScript's `JSON.stringify` writes `0`, so coordinates are written with a decimal point. Half the cases failed before that.
- **Nothing passes through SMILES.** An RDKit SMILES round trip changes some stereoisomers into others: 10 of inositol's 64 combinations, and 4 of 16 for 1,2,3,4-tetramethylcyclobutane. Molfile and JSON round trips are exact. Python's `unique=True` is SMILES-based, so the reference uses `unique=False` and its own de-duplication.
- **Duplicates by InChI.** Two combinations are the same stereoisomer when their standard InChIs are equal.
  - The InChI is computed from the JSON without coordinates: with them, InChI reads E/Z from the drawn geometry and merges E and Z.
  - Canonical SMILES leaves duplicates in symmetric rings (inositol: 13 for 9).
  - InChI is blind to stereo at nitrogen (decision 6). The fixture also records the SMILES-unique count, and a test fails wherever the two differ, unless the compound is on a reviewed list with its reason.
- **Pictures.** A flipped double bond keeps the old geometry if drawn with the old coordinates (cinnamic acid's Z isomer, drawn so, reads back as E), so it is laid out afresh. RDKit.js draws text as glyph paths and ignores `addStereoAnnotation`. The labels are therefore the app's own text over each picture, placed at the atoms.
- **Labels.** `get_stereo_tags` gives each stereoisomer's CIP labels. It says "(?)" where Python's `rdCIPLabeler` gives none, for example C3 of a pentane-2,3,4-triol; the app shows nothing there.
- **Speed.** Cholesterol (8 centres): 256 combinations in 0.44 s in Node. It is to be measured in Chromium (bar B.7).
- **RDKit varies stereo at N** in rings and at bridgeheads (1,2-dimethylaziridine: 4). It does not vary allenes or biaryl axes (penta-2,3-diene: 1).

## Acceptance bar

**A. The same answers as RDKit's own enumerator, judged by Jeff**
1. A generator (server/scripts/, Python RDKit, non-legacy perception) writes tests/fixtures/stereoisomers_expected.json. For each test compound it records:
   - the drawing's Molfile (2D, from PubChem's SMILES);
   - its stereoisomers from `EnumerateStereoisomers(onlyUnassigned=False, unique=False)`, de-duplicated by coordinate-free InChI, in a fixed order (the order below);
   - each one's InChIKey and CIP labels by atom index (`rdCIPLabeler`);
   - the enantiomer pairs, the achiral ones, and the meso ones;
   - the stereoisomers that match the drawing;
   - the SMILES-unique count;
   - for bridged compounds, the set that embeds in 3D (`tryEmbedding=True`, seeded), for reference.

   A drift test regenerates it and byte-compares.
2. **Meso** is IUPAC's: an achiral stereoisomer in a set that also has chiral ones. Achiral means its mirror image has the same InChI. Jeff judges the counts and verdicts in a separate file (like functional_groups_expected.json), and a test checks the generated fixture against his file. No counts are typed into tests.
3. A Vitest runs the browser's enumerator (web/src/chem/, RDKit.js in Node, the code the worker runs) on every compound. These must equal the fixture's: the stereoisomers in order, the labels by atom, the pairs, achiral and meso, and the matches.
4. A test fails if any compound's InChI count is below its SMILES-unique count, unless it is on the reviewed list with its reason.
5. The limits are a pure function. Vitests check each boundary: 8 and 9 elements, 32 and 33 stereoisomers.

**B. In the app**
1. The button appears only when the drawing has stereo elements, and only for one structure. A reaction, or more than one structure, gets "works on one structure at a time".
2. The panel shows the fixture's stereoisomers, numbered and in its order:
   - the matches first;
   - then enantiomers side by side, pairs in InChIKey order;
   - each with "enantiomer of n", "achiral" or "meso", and "Matches your drawing";
   - each label as text at its atom (the test compares {atom: label} with the fixture for every compound);
   - the note "any two that are not enantiomers are diastereomers".
3. Pictures keep the drawing's layout and the student's wedge bonds, flipped where the configuration differs (decision 3). Each picture is drawn from exactly the Molfile that bar B.4 checks.
4. Add puts the stereoisomer in hand (web/src/editor/placeInHand.ts). A click places it.
   - The canvas then holds the drawing and the stereoisomer. Its InChIKey equals the fixture's two-component key for drawing + stereoisomer, so the hand-off kept the stereo and the chiral flag.
   - Placing two in turn works, with the panel open throughout.
   - Esc, another tool, closing the panel, and any change other than the panel's own placement each put the stereoisomer away, as for Name to structure. Vitest forces each ordering with a stub placer: placed, cancelled, changed while placing, closed while placing.
5. Any change to the drawing other than the panel's own placements closes the panel. An answer for an older drawing is never shown: the worker's reply is held in the test to force that ordering.
6. It runs in a worker copy apart from the properties one: the NMR copy, since only one panel is open at a time. With the stereo reply held, the properties panel still updates after a change, and the panel shows `data-state=working`.
7. Cholesterol's 256 combinations finish within 2 s in Playwright's Chromium.
8. Opening the stereoisomer panel closes the NMR preview, and the other way round.
9. The notes from decisions 4–6 appear for their test compounds, and "achiral" never does there.
10. Offline: an "offline:" smoke test opens the panel with no network and gets the same stereoisomers.

**C. Every change:** check.sh passes before each commit, CHANGELOG and BUILD-LEARNINGS are updated, staging passes its live checks, and production is promoted only on Jeff's go-ahead.

**D. Invariant 6** (AGENTS.md) widens to "v1, the NMR proof of concept, and the version 2 features Jeff has started", in this feature's first commit.

## Known limits (to state in the panel's notes and BUILD-LEARNINGS)

- No 3D. Impossible bridgehead combinations are listed, with a note.
- No axial or planar chirality (allenes, biaryls, trans-cyclooctene): a note instead of "achiral".
- Stereo at a bridgehead nitrogen is invisible to RDKit (Tröger's base: no stereo elements, so
  no button); the bridged note says so where there is a list.
- Some settings of double bonds in a ring of 8 to 11 atoms can't be drawn flat as themselves
  (cyclooctatetraene with one or three E): listed without a picture or Add.

## After the first review (2026-10-25)

A review of the first build found 20 problems; each fix has a test that fails without it.
Three change the bar as written above, for Jeff to confirm:
- **A.1, the reference.** Python's `EnumerateStereoisomers` misses half of cyclooctatetraene's
  settings (it gives those with an even number of trans bonds twice each). The generator now
  writes every setting of `FindPotentialStereo`'s elements itself, and a test requires
  `EnumerateStereoisomers` to give the same stereoisomers for every other compound.
- **B.1, the button.** It also shows when the drawing may have an axis RDKit can't judge
  (penta-2,3-diene, BINOL), so the panel can say so (bar B.9). With more than one structure
  there is no button, and the properties panel says "one structure at a time".
- **Test compounds added:** hepta-2,5-dien-4-ol and 2,4-pentanediol (from PubChem),
  cyclooctatetraene (PubChem's record is all-Z), and generated drawings: the ethylidene diol,
  threonine and (R)-2-butanol wedged the textbook way and on other bonds, and meso
  2,3-dibromobutane drawn as the setting the ordering rule would not pick. Their judgements
  in stereoisomers_judged.json are provisional like the rest; cyclooctatetraene's was made
  after a probe, not blind.

**Round 2** (capped, 4 reviewers with a skeptic each) confirmed 7 medium findings, now fixed
with tests that fail without them:
- A biaryl axis wedged as textbooks draw it (RDKit reads atropisomer stereo from the wedge)
  was copied into every stereoisomer, so a diastereomer was shown as the enantiomer, and the
  properties panel counted the axis as an undefined double bond. Settings are now written
  into the drawing with all its stereo taken off, and only double bonds count; "matches"
  compares only the elements varied, in the browser and the generator alike.
- A crossed double bond sent every picture to a fresh layout. Now each picture tries the
  drawing's layout first and is laid out afresh only where that shows a double bond the
  other way; a test checks this per stereoisomer from the plain 2D geometry.
- Labels could sit on their own atom in a crowded drawing; they now keep at least half a
  label's diagonal away.
- Three test gaps: the labels on each picture are now read back from its own Molfile, the
  layout is checked per stereoisomer, and the undrawable ones are pinned by the fixture's
  labels (cyclooctatetraene with one or three E).
- Also fixed: the search for dependent double bonds (round 1) took about 1 s per properties
  update on a sugar with an allyl group drawn with its H; it now runs only where both
  branches at one end hold an open element. A failed Add now says so, the in-hand hint is
  visible text, each Add button names its stereoisomer, and lowercase e/z get the note.
- New test drawings: estradiol, limonene and (3E)-3-penten-2-ol from PubChem; generated:
  the wedged axis, limonene and glucose with every H drawn, and pentenol with its centre
  drawn beside a defined and a crossed double bond.

Accepted limits from round 2 (low): the notes on a counted or too-many list are rendered
but no test compound shows one there; where labels land on screen (the CSS) is not checked,
only their computed positions; the generator's cross-check with EnumerateStereoisomers
shares FindPotentialStereo, so only stereoisomers_judged.json checks which elements are
varied; a dependent double bond with 10 or more open elements around it is not found.

## Priority

The v1 checklist items that remain come before this for CHEM-311's start: the Mac checks, and "(R)- and (S)-2-butanol give different names and draw with the right wedges". This feature is built alongside them, not instead.
