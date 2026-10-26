# Version 2: tautomer enumerator and resonance structure generator

Requested by Jeff on 2026-10-26, through the main session (docs/SPEC.md, "After v1" > "Drawing tools"). Approved by Jeff as proposed, 2026-10-26.
- "Tautomer enumerator: replaces ChemSketch's tautomer tool (RDKit)."
- "Resonance structure generator: enolates, carboxylates, amides and similar (RDKit)."

Two buttons, and two panels below the canvas built alike. A student sees acetone beside its enol, 2-pyridone beside 2-hydroxypyridine, acetate's two structures, and the amide's N⁺=C–O⁻ form.

## What a student sees

1. A "Tautomers and resonance" section in the properties panel with two buttons, "Show tautomers" and "Show resonance structures". They work on one structure. A reaction, or more than one structure, gets "one structure at a time", as for stereoisomers.
2. A panel below the canvas, like the stereoisomers. Only one such panel is open at a time: opening either one closes Practice, the ¹³C NMR preview, the stereoisomers and the other one (belowCanvas.ts).
3. One numbered picture per structure, in the drawing's own layout, so they compare at a glance.
   - What differs from the drawing is highlighted. For a tautomer: the atoms that gained or lost an H, and the bonds that changed. For a resonance structure: the bonds that changed, and the atoms whose charge changed.
   - The drawing's own form is marked "Your drawing".
4. Each picture has an Add button. Add puts that structure in hand; a click places it, as one Undo (placeInHand.ts, as for stereoisomers). The panel stays open, and any other change closes it.
5. One-line notes say what RDKit's lists are and are not (decisions 4 to 6).

## Decisions for Jeff (proposed answers in bold)

1. **Where it runs: in the browser, as ports of RDKit's own code.** RDKit.js has neither tool (measured below), and invariant 4 keeps everything but naming offline.
   - The app gets TypeScript versions of RDKit's `TautomerEnumerator` and `ResonanceMolSupplier`, built on what RDKit.js does have.
   - Tests require them to give exactly what Python RDKit gives.
   - Alternatives: a `/draw/api/` endpoint running Python RDKit. It is exact by construction, but works online only, which changes invariant 4, and it sends the drawing to the server as naming does. Or tautomers only.
2. **Resonance settings: RDKit's `ALLOW_CHARGE_SEPARATION` and `KEKULE_ALL`.**
   - Charge separation gives the amide's N⁺=C–O⁻ form. RDKit's default leaves it out.
   - `KEKULE_ALL` gives both of benzene's Kekulé structures. The default gives one.
   - Not `UNCONSTRAINED_ANIONS`. It would add the carbanion forms of aniline, enamines and pyrrole, and diazomethane's second form. But it would not add phenol's or anisole's forms, which need `UNCONSTRAINED_CATIONS`, and that setting also gives radicals (81 of 1,103 probe molecules). So directing groups would be only half there. It would also make lists over 32 grow from 5 to 43 of the 1,103.
3. **Order.**
   - **Tautomers: the drawing's form first, then RDKit's order.** RDKit's order is alphabetical by SMILES, so no ranking is claimed.
   - **Resonance structures: RDKit's order.** RDKit puts complete octets first, then fewer charges, then negative charge on the more electronegative atom. The panel says that much and no more. There is no "major contributor" label, because RDKit's next rule (opposite charges further apart first) is not the textbook one.
   - Where RDKit ranks two structures equal on every measure, their order is the app's own (atom order), since RDKit's follows internal hash values.
4. **Tautomers: every one RDKit's rules reach, with a note, and never a "most stable" or "canonical" label.** RDKit's 36 rules (Sitzmann et al. 2010) also reach unstable forms: phenol's cyclohexadienones, and 9 tautomers for estradiol. Its "canonical" tautomer is a database convention; for open-chain glucose it is a 3-ketose. The note reads: "These are the forms RDKit's tautomer rules reach, not how stable they are."
5. **Stereo: as RDKit handles it.** RDKit drops the stereo of every atom an H moves to or from, in every tautomer (histidine's α-carbon: enolization scrambles it), and keeps the rest (testosterone's centres). The panel notes when stereo was dropped. A double bond that changes is drawn without E/Z.
6. **Resonance: what RDKit leaves out goes in a note.**
   - RDKit works only on conjugated groups, so an isolated C=O gets no C⁺–O⁻ form.
   - With decision 2, an enone, ester or acid shows no charge-separated form, and an aniline, phenol or enol ether shows only its Kekulé forms.
   - There are no lone pairs or curved arrows; those belong to the "later version" mechanism tools.
7. **Limits.**
   - **Up to 32 of either are drawn.** Beyond that the panel says "more than 32 tautomers" (enumeration stops at 33) or gives the resonance count, and draws none.
   - **A conjugated group of more than 60 bonds gets "too large for RDKit to list".** Python's own `ResonanceMolSupplier` ran over 2 minutes on buckminsterfullerene (90 bonds) without finishing; kekulene (60) takes 0.7 s in Node.
   - Each limit is a pure function of the drawing, computed the same way in the browser and in the generator.
8. **One structure at a time**, like the stereoisomers. A salt drawn with its counter-ion gets "draw the ion on its own".
9. **The test compounds.** Their SMILES come from PubChem through the fixture scripts (every name below was checked to resolve on 2026-10-26). Their expected answers are for you to judge. Please change the list:
   - Tautomers, keto/enol: acetone, 2-butanone, cyclohexanone, acetylacetone, ethyl acetoacetate, dimedone, phenylpyruvic acid, phenol.
   - Tautomers, heteroatoms: 2-pyridone, acetamide, thioacetamide, acetaldoxime, nitrosobenzene, 4-nitrosophenol, N-methylethanimine, nitromethane.
   - Tautomers, rings and bases: imidazole, 1,2,4-triazole, tetrazole, guanine, cytosine, uracil, thymine, adenine, barbituric acid, creatinine, allopurinol, warfarin.
   - Tautomers, stereo: L-histidine (dropped), testosterone (kept), aldehydo-D-glucose (dropped; its 3-ketose).
   - Tautomers, limits: curcumin (51: more than 32), ethanol (none but itself).
   - Resonance, anions: acetate, formate, benzoate, acetylacetonate, phenolate, 4-nitrophenolate, carbonate, nitrate, azide, cyclopentadienide.
   - Resonance, neutral and cations: acetamide, N-methylacetamide, hexaglycine (five amides: exactly 32), nitromethane, nitrobenzene, pyridine N-oxide, ozone, diazomethane, guanidinium, tropylium.
   - Resonance, Kekulé: benzene, naphthalene, anthracene, kekulene (200: counted, not drawn).
   - Resonance, notes and limits: aniline, methyl vinyl ketone, acetic acid, carbon dioxide, sulfate, buckminsterfullerene (too large).
   - Generated, where PubChem has no record or a wrong one: acetone's enolate (from acetone), the allyl cation and anion (from propene), the benzyl cation (from toluene), and benzene's arenium ion (from benzene). Each is made by RDKit from its parent, never typed. PubChem's "benzyl cation" record is the benzyl anion, and its "benzylium" record is the benzoyl cation.

## Measured before planning (RDKit.js 2026.9.1, Python RDKit 2026.09.1; throwaway probes)

- **RDKit.js has neither tool.** Its bindings are generated, and complete in `RDKit_minimal.d.ts`; none is for tautomers or resonance. The wasm holds RDKit's tautomer code only inside tautomer-aware fingerprints and R-group decomposition, neither of which gives tautomers back. It holds no resonance code.
- **What it has is enough to run RDKit's algorithms on it:**
  - SMARTS matching (`get_substruct_matches`).
  - Canonical SMILES.
  - Its JSON form, edited and read back with chosen sanitization steps. With `setAromaticBonds: false` and only the ring step, a Kekulé form keeps its aromatic atom flags, which is the form RDKit's enumerator matches against.
  - A sanitize-flags object turns on only the flags it lists: `{}` throws, and `{SANITIZE_CLEANUP: false}` turns everything off.
- **Tautomers.**
  - A port of `TautomerEnumerator::enumerate` (about 200 lines, with RDKit's 36 transforms taken from its source) gave exactly Python's tautomers, stereo included. That held for all 130 fixture and teaching molecules, and for all 2,000 single-structure molecules in the first 2,044 lines of RDKit's bundled NCI set (`share/RDKit/Data/NCI/first_5K.smi`).
  - Times in Node: guanine (15 tautomers) 0.2 s, curcumin (51) 0.5 s, the largest NCI lists (256) 3 s.
  - Python, loaded with those 36 transforms from a file, gave the default enumerator's answers on all 2,000. With one transform dropped, 545 answers changed. So a test can prove the app's copy of the rules is RDKit's.
- **RDKit's tautomer list depends on atom order.** A pyrrole diester gave 9 tautomers from one SMILES and 10 from its canonical SMILES, in Python itself. The port follows Python for the same drawing, so the fixture's inputs are the Molfiles themselves.
- **Resonance.**
  - A port of `ResonanceMolSupplier` (Resonance.cpp is 1,850 lines; the port about 450) and of RDKit's conjugation rules gave exactly Python's sets of structures (bond orders and charges by atom) on 1,103 molecules, for four flag settings. It marked the same bonds conjugated. Each molecule took about 1 ms in Node.
  - Order: the same for 1,088 of the 1,103. The other 15 differ only among structures RDKit ranks equal.
  - Only beyond Python's own cap of 1,000 structures did counts differ (the probe had no cap); decision 7 keeps far below it.
- **Resonance counts with decision 2:** acetate 2, acetamide 2, allyl cation 2, benzene 2, naphthalene 3, nitrate 3, carbonate 3, guanidinium 3, azide 3, phenolate 5, benzyl cation 5, coronene 20, kekulene 200. Aniline 2, methyl vinyl ketone 1, diazomethane 1, sulfate 1. With RDKit's defaults, acetamide gives 1 and benzene 1.
- **Large conjugated systems.** Hexabenzocoronene (54 conjugated bonds, 250 structures) 0.5 s and kekulene (60, 200) 0.7 s in Node. Buckminsterfullerene did not finish in 2 minutes in Python, nor in the port with a cap of 1,000 stored structures: its search, not its output, is what grows.

## Design

- `web/src/chem/tautomers.ts` and `web/src/chem/resonance.ts`: the ports, each headed by the RDKit source file and release it follows. They run in the panels' RDKit worker copy (panelWorker.ts), like the stereoisomers.
- `web/src/chem/rdkitTables.json`: RDKit's own data the ports need.
  - The tautomer transforms, and the Allen electronegativities `ResonanceMolSupplier` ranks with, read from RDKit's source at the release tag.
  - Outer electrons and valences, from Python RDKit's periodic table.
  - It is written by `server/scripts/gen_rdkit_tables.py`, the only step that needs network. Its header names the source files and their SHA-256.
- `server/scripts/gen_tautomers_resonance_expected.py` writes the reference answers with Python RDKit. Pictures come from `stereoPictures.ts`'s way of drawing, with highlights. The state machine and store copy `stereo.ts` and `stereoStore.ts`, with a shared panel component for the two.
- Build order, each step its own commit after `check.sh` passes:
  1. The tables.
  2. Tautomers, port and fixtures.
  3. Resonance, port and fixtures.
  4. The tautomer panel.
  5. The resonance panel.
  6. Docs.
  7. Then a capped review with a skeptic checking each finding.

## Acceptance bar

**A. The same answers as RDKit, judged by Jeff**
1. **RDKit's tables.** A Python test loads the table's transforms into Python's `TautomerEnumerator` and requires the default enumerator's answers on every test compound and every NCI sample molecule (A.4). It also requires that dropping any one transform changes some answer. Another test requires the outer electrons and valences to equal Python's periodic table for every element.
2. **The reference.** The generator writes `tests/fixtures/tautomers_resonance_expected.json`. A drift test regenerates it and byte-compares. For each test drawing it records:
   - the drawing's Molfile (2D, from PubChem's SMILES, as gen_reference_expected draws it);
   - Python's tautomers (canonical SMILES in its order; the enumerator's status; which one is the drawing's; the atoms and bonds it changed);
   - Python's resonance structures (bond orders and charges by atom, in its order; the rank measures; which match the drawing);
   - the conjugated bonds;
   - the limit outcomes.
3. **Jeff's judgement.** Jeff judges counts and verdicts in `tests/fixtures/tautomers_judged.json` and `resonance_judged.json`, written by reading each structure, never generated. A test compares the generated fixture with them; no count is typed into a test.
   - Honesty note: several were seen in the probes above before judging, like cyclooctatetraene for the stereoisomers.
4. **The browser equals the fixture.** A Vitest runs the browser's code (`src/chem/`, RDKit.js in Node, the code the worker runs) on every test drawing. It must equal the fixture:
   - the tautomers in order, and the drawing's own one;
   - the resonance structures as a set, in order except among structures RDKit ranks equal on every measure;
   - which ones match the drawing;
   - the conjugated bonds and the limit outcomes.
   - A second fixture holds Python's answers for the first 300 single-structure molecules of RDKit's NCI set, and the browser must equal it too, as a guard well beyond the hand-picked list.
5. **The limits are pure functions.** Vitests check each boundary: 32 and 33 structures, and 60 and 61 bonds in a conjugated group.

**B. In the app**
1. Both buttons appear for one structure only. A reaction, several structures, or a non-element atom gets its message in the panel.
2. The tautomer panel shows the fixture's tautomers, numbered and in order:
   - the drawing's form first, marked "Your drawing";
   - each picture in the drawing's layout, with the highlighted atoms and bonds equal to the fixture's changes from the drawing;
   - the notes from decisions 4 and 5 where they apply.
3. The resonance panel shows the fixture's structures in order, each charge drawn by RDKit, and "Your drawing" on the matching one. Each picture's Molfile, read back, has the fixture's bond orders and charges. Where the drawing is not among them, the panel says so.
4. Add puts the structure in hand (placeInHand.ts), and a click places it.
   - The placed structure's InChIKey equals the fixture's (for a tautomer), or its bond orders and charges do (for a resonance structure).
   - Placing two in turn works, with the panel open throughout.
   - Esc, another tool, closing the panel, and any change other than the panel's own placement each put the structure away. Vitest forces each ordering with a stub placer: placed, cancelled, changed while placing, closed while placing.
5. Any change other than the panel's own placements closes the panel. An answer for an older drawing is never shown: the worker's reply is held in the test to force that ordering.
6. Both run in the panels' worker copy, apart from the properties one. With a reply held, the properties panel still updates after a change, and the panel shows `data-state=working`.
7. In Playwright's Chromium, guanine's tautomers and its resonance structures each finish within 2 s, and kekulene's count within 2 s.
8. Opening either panel closes each of the other panels below the canvas, and the other way round.
9. The limits show: curcumin "more than 32 tautomers", kekulene's count, buckminsterfullerene "too large", hexaglycine's 32 drawn.
10. Offline: an "offline:" smoke test opens each panel with no network and gets the same answers.

**C. Every change:** check.sh passes before each commit, and CHANGELOG, BUILD-LEARNINGS and AGENTS.md are updated (AGENTS.md stays under 150 lines). THIRD-PARTY-NOTICES credits the two ports as derived from RDKit (BSD). Nothing is merged, pushed or deployed from this branch.

## Known limits (to state in the panels' notes and BUILD-LEARNINGS)

- Tautomers are what RDKit's 36 rules reach, not their stabilities. Unusual forms appear, and no form is called the most stable.
- RDKit's tautomer list can differ for the same compound drawn in another atom order (a pyrrole diester: 9 or 10). The app equals Python for the same drawing.
- Stereo at any atom an H moves to or from is dropped in every tautomer, the drawing's own included.
- Resonance covers conjugated groups only, with decision 2's settings. Isolated carbonyls, enones, esters and acids get no charge-separated forms; anilines, phenols and enol ethers get only their Kekulé forms; diazomethane gets one form. Hypervalent S and P are outside RDKit's conjugated groups (sulfate: 1).
- No lone pairs or curved arrows.
- More than 32 structures are counted, not drawn, and a conjugated group of more than 60 bonds is not listed.
- Among resonance structures RDKit ranks equal on every measure, the order is the app's own.
