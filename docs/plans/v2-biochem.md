# Version 2: biochem tools (peptides and nucleic acids)

Requested by Jeff on 2026-10-26 (docs/SPEC.md, "After v1" > "Teaching features"): "Biochem tools: Ketcher's peptide and RNA mode already calculates isoelectric point, extinction coefficient and hydrophobicity for peptides, and melting temperature for nucleic acids. v2 shows these in the side panel and adds net charge at a chosen pH."

The aim: a student types a peptide, DNA or RNA sequence in the side panel and sees its values there, with net charge at a pH they choose. Ketcher's macromolecules mode stays hidden.

## What a student sees

1. A section at the foot of the side panel, "Peptide or nucleic acid", closed until clicked. It is there with or without a drawing, and drawing changes don't touch it.
2. Opened, it has a sequence type, a sequence box and the values below them, which update as the student types. Sequence types:
   - Peptide, one-letter (ACDEF…);
   - Peptide, three-letter (Ala-Cys-Asp…);
   - DNA;
   - RNA.
3. **A peptide** shows:
   - its length;
   - formula and average mass;
   - net charge at a pH box (0 to 14, default 7.0);
   - isoelectric point;
   - ε280, two values: all Cys reduced, and all Cys paired in disulfides;
   - a small hydrophobicity chart, one bar per residue.
4. **DNA** shows:
   - its length;
   - the single strand's formula and average mass;
   - Tm of the strand paired with its exact complement, at a [Na⁺] box (default 140 mM) and a strand concentration box (default 200 µM), Ketcher's defaults.
5. **RNA** shows the same as DNA, apart from Tm (decision 8).
6. A one-line note per value names its method and source.
7. A sequence the app can't read gets a message naming the first bad character and its position, and no values.

## Decisions for Jeff (proposed answers in bold)

1. **Macromolecules mode stays hidden; invariant 6 is unchanged.** The values come from the same Indigo function Ketcher's properties window calls, given a typed sequence, in the app's own worker. Unhiding the mode would mean a second editor that the app's panels, autosave, export and Get name don't understand. Its own properties window shows the isoelectric point that decision 4 replaces. Its menus would also need checking against invariant 1.
2. **Entry is a typed sequence only.** No drawn peptide is recognised: Indigo 1.46 needs monomers and can't find residues in a structure drawn atom by atom. There is no "Add to drawing" in this version.
3. **Where the values show: the side panel**, as in the spec. The section is closed at first and sits below the drawing's values. The sequence is not autosaved.
4. **Isoelectric point: where the net charge is zero, from the same pKa values as the net charge. Ketcher's own figure is not shown.** Ketcher's "isoelectric point" is the median of the free groups' pKa values (Indigo 1.46 source; Ketcher's hint says so). It is far from the standard answer, and the net charge at Ketcher's figure is not zero (table under "Measured").
5. **The pKa values: Bjellqvist's (ExPASy's Compute pI/Mw), read from Biopython 1.88 by a generator.** Biopython joins environment.yml, pinned. Invariant 3 gains "Biopython (Bjellqvist pKa values)". Alternatives:
   - Indigo's own table: only in its C++ source, so it would be typed in and need your check, like the IR table;
   - a faculty-checked pKa table you supply, like ir-bands.json.
6. **ε280: ExPASy's two values, built from Indigo's coefficients.** Indigo counts 125 for every Cys. Pace's 125 is per cystine (two Cys), so Indigo's figure matches neither ExPASy value once there is a Cys. The app asks Indigo for W, Y and C alone and builds:
   - reduced: Indigo's value minus its Cys share;
   - all Cys paired: that plus one Cys share per pair.

   With no Trp, Tyr or Cys, it says ε280 is 0 and the peptide can't be measured at 280 nm. The alternative is Indigo's number with a note.
7. **Hydrophobicity: Indigo's per-residue Black & Mould (1991) values as a bar chart, no summary number.** This is what Ketcher shows. A mean of this scale is not a standard figure, and GRAVY (Kyte–Doolittle) isn't Ketcher's.
8. **Tm:**
   - **DNA of 15 bases or more**, paired with its exact complement, by Indigo (Khandelwal and Bhyravabhotla 2010, Ketcher's method);
   - **both concentrations editable**, any positive value;
   - **under 15 bases, a note instead of a value**, since the paper fits 15-mers upward and Indigo gives a 4-mer 36 °C;
   - **RNA: no Tm, with a note** that the method is for DNA. Indigo treats U as T, but RNA duplexes are more stable. Ketcher does show it for RNA.
9. **Net charge is for peptides only.** The pH box takes 0 to 14 in steps of 0.1. The charge shows to 2 decimal places and the pI to 2. Both assume a free N-terminus and C-terminus.
10. **Input rules:**
    - up to 1000 residues or bases;
    - any case;
    - spaces, line breaks and digits ignored, so pasted sequences with position numbers work;
    - three-letter codes with or without hyphens;
    - the 20 standard amino acids only;
    - DNA: ACGT. RNA: ACGU.

    Ambiguity codes (X, B, N…), U and O in peptides, and "H-"/"-OH" ends are rejected with the message.
11. **Test sequences** (inputs, not values; the outputs all come from the generators; please change the list):
    - every residue alone;
    - every residue at the N-terminus (XG) and at the C-terminus (GX);
    - the 20 in one chain;
    - CC, CCC and WCYC (cystine counting);
    - D×10, R×10 and G×10 (extremes, no side chains);
    - YGGFL, RPPGFSPFR, DRVYIHPF, CYIQNCPLG and a 29-residue chain (HSQGTFTSDYSKYLDSRRAQDFVQWLMNT);
    - the 20 repeated to 1000 (the limit);
    - DNA of 14 and 15 bases (Tm boundary), GC-rich and AT-rich 16-mers, a 20-mer, a 100-mer and a 1000-mer, each also as RNA;
    - for Tm, a second concentration pair: 50 mM and 0.5 µM.

## Measured before planning (Ketcher 3.18.0, Indigo 1.46.0 in Node 24, Biopython 1.88 in a throwaway venv)

- **Where Ketcher computes them.**
  - The macromolecules editor (bundled in ketcher-react, loaded lazily) calls `structService.calculateMacromoleculeProperties`. Ketcher's standalone Indigo worker runs this as Indigo's `calculateMacroProperties`, in wasm.
  - No server, so it works offline.
  - Input: a KET document with monomers. Options: `upc` ([Na⁺], M) and `nac` (strand concentration, M; mandatory). The UI's defaults are 140 mM and 200 µM.
  - Output, per chain: `grossFormula`, `mass`, `pKa` (labelled "Isoelectric Point"), `extinctionCoefficient`, `hydrophobicity` (one value per residue), `Tm`, `monomerCount`.
- **Without macromolecules mode.** Indigo turns a sequence into KET with `convert` (input formats `chemical/x-peptide-sequence`, `-3-letter`, `x-dna-sequence`, `x-rna-sequence`, `x-helm`), but only when given Ketcher's monomer library.
  - Ketcher's standalone service takes the library from the macromolecules editor, so with that editor disabled its `convert` fails ("Monomer template … not found in monomer library").
  - The app therefore runs its own Indigo (`indigo-ketcher` 1.46.0, the same wasm Ketcher ships) in a worker. It passes the library from `ketcher-core/dist/application/editor/data/monomers` (4 MB), which is already in the main bundle: the built index-*.js contains it today.
  - Timings in Node: Indigo loads in 0.4 s. A 20-residue peptide takes 150 ms to convert and 17 ms for the properties; 1000 residues take 0.4 s and 3000 take 1 s. Most of the convert time is parsing the library, which happens on every call.
- **Indigo's formulas** (core/indigo-core/molecule/src/macro_properties_calculator.cpp at tag indigo-1.46.0):
  - **pI**: the median of the pKa values of every free group, from a free-amino-acid table its UI credits to Miclotte et al. (2020).
  - **ε**: 5500 per W, 1490 per Y, 125 per C.
  - **Hydrophobicity**: a fixed per-residue table.
  - **Tm**: only for two strands joined base to base by hydrogen bonds: 7.35·Sp + 17.34·ln(length) + 4.96·ln[Na⁺] + 0.89·ln[strand] − 25.42. U counts as T, and complementarity is not checked.
  - **Mass and formula**: those of the neutral chain with free ends.
- **Ketcher's pI against Bjellqvist's** (Biopython's `isoelectric_point`), and the net charge at Ketcher's figure:

  | Sequence | Ketcher | Bjellqvist | Charge at Ketcher's pI |
  |---|---|---|---|
  | ACDEFGHIKLMNPQRSTVWY | 8.00 | 6.78 | −0.82 |
  | YGGFL | 9.74 | 5.52 | −1.35 |
  | Y | 9.11 | 5.52 | −1.09 |
  | DRVYIHPF | 7.67 | 6.74 | −0.58 |
  | RPPGFSPFR | 10.76 | 12.00 | +0.89 |
  | HSQGTFTSDYSKYLDSRRAQDFVQWLMNT | 9.10 | 6.75 | −1.31 |

- **ε against Biopython's `molar_extinction_coefficient`** (reduced, cystines):
  - equal wherever there is no Cys;
  - C: Indigo 125, Biopython (0, 0);
  - CC: 250 against (0, 125);
  - WCYC: 7240 against (6990, 7115).
- **Hydrophobicity**: Indigo's values equal Biopython's `BlackMould` scale to 3 decimals, for all 20 residues.
- **Mass**: Indigo's agrees with Biopython's to within 0.04 g/mol, since they use different atomic weights.
- **Tm** (Indigo, duplex given as HELM with base pairs, 140 mM, 200 µM):
  - ACGT: 36.4 °C, and a 2-mer: −5.0 °C;
  - GC×5: 74.4 °C, AT×5: 34.7 °C;
  - a 16-mer: 60.9 °C, or 50.5 °C at 50 mM and 0.5 µM;
  - the same RNA 16-mer: 60.9 °C.
- **The paper behind Tm** (PLoS ONE 5(8): e12433, read on PMC): fitted on DNA from 15-mers to genomic length, Na⁺ from 0.015 to 0.6 M. It says nothing about RNA.
- **Bjellqvist in Biopython.** pKa tables: `positive_pKs`, `negative_pKs`, and the N- and C-terminal residue-specific values; the method is Henderson–Hasselbalch. Its pI search is bracketed to pH 4.05–12, so it clips very acidic or basic peptides. Biopython against a bisection over 0–14:
  - DDD: 4.05 against 3.67;
  - D×10: 4.05 against 3.08;
  - R×10: 12.00 against 12.95.
- **Input quirks.**
  - Indigo: a space starts a new chain, a digit is an error, X and B become "Other" with no mass, and DNA accepts U.
  - Three-letter input must be run together and capitalised ("AlaCysAsp"); "Ala-Cys-Asp" fails. The app normalises before calling Indigo.
- **Packages.**
  - `indigo-ketcher` is not a direct dependency today: ketcher-standalone pins it to 1.46.0.
  - conda-forge has biopython 1.88 for Python 3.12.
  - No other worktree has changed environment.yml.

## Acceptance bar

**A. The values, against generated references**
1. A Python generator (`server/scripts/gen_biochem_expected.py`, Biopython 1.88) writes two files, and a pytest drift test regenerates both and byte-compares:
   - the app's pKa table (`web/src/chem/bjellqvist.json`), Biopython's four tables with its version and the two Bjellqvist citations;
   - `tests/fixtures/biochem_peptides_expected.json`, for each test peptide:
     - Biopython's charge at pH 0 to 14 in steps of 1, and at 7.4;
     - its pI;
     - its two ε values;
     - its Black & Mould value for each residue.
2. A Node generator (`web/scripts/gen-biochem-indigo.ts`, Indigo 1.46.0 and Ketcher's monomer library) writes `tests/fixtures/biochem_indigo_expected.json`, and a Vitest drift test regenerates and byte-compares it. For each test sequence it records:
   - formula, mass, ε and hydrophobicity;
   - for DNA, Tm at both concentration pairs. The generator builds each duplex its own way, two strands converted apart and joined by hydrogen-bond connections in KET, not the app's HELM.
3. Cross-checks:
   - Indigo's hydrophobicity equals Biopython's Black & Mould for every test peptide;
   - the app's two ε values equal Biopython's;
   - Indigo's ε for W, Y and C alone are what the app builds them from.
4. The app's own code runs in Vitest with Indigo in Node, the code the worker runs, and must equal the fixtures:
   - net charge at every fixture pH, within 1e-9;
   - pI within 0.005 wherever Biopython's lies inside its bracket. Elsewhere the charge at the app's pI is within 0.001 of zero, and Biopython's figure sits on the bracket edge;
   - both ε values exactly;
   - hydrophobicity, formula and mass exactly;
   - Tm within 0.005.
5. Input rules: one Vitest per rule in decision 10, including the 1000/1001 boundary, the 14/15-base Tm boundary, and that three-letter input gives the same values as one-letter.

**B. In the app**
1. The section sits at the foot of the side panel, closed at first. A Playwright test checks it on an empty canvas and after drawing and changing a structure, with its values unchanged by the drawing change.
2. A peptide shows the fixture's values. Each hydrophobicity bar carries its value as a data attribute and in its tooltip ("Leu 7: 0.943"), read back by Playwright. The method notes name Bjellqvist, Pace and Black & Mould.
3. DNA shows the fixture's Tm at the defaults, and its second value after the two boxes are changed. Fewer than 15 bases gives the note, and RNA gives the RNA note; neither shows a Tm.
4. Changing the pH changes the net charge without a worker round trip. Playwright holds the worker and still sees the new charge.
5. **Ordering.** An answer for an older sequence or older concentrations is never shown, and while a request is in flight only the newest edit is sent next: no timers, no debounce. Playwright holds the worker's reply (as `holdableRdkitReplies()` does), types twice, releases and sees only the newest answer, with `data-state=working` meanwhile. A Vitest counts the requests: three edits during one held reply send one more request, not three.
6. An invalid sequence shows the message (character and position) and sends nothing to the worker.
7. **Offline:** an "offline:" smoke test gets a peptide's and a DNA's values with no network.
8. **Speed in Playwright's Chromium:** the first values within 5 s of opening the section, and a 1000-residue peptide within 2 s after that. The times are recorded in BUILD-LEARNINGS.
9. **Invariants:**
   - no request beyond the app's own files (the request guard);
   - no CSP violation, with csp.json unchanged;
   - one Indigo wasm in the build (the precache guard already requires exactly one);
   - the monomer library appears once in dist;
   - macromolecules mode still hidden (the existing smoke tests, unchanged).
10. Every box and the selector have labels, and the values sit in a `role=status` region.

**C. Every change:** check.sh passes before each commit, and CHANGELOG, BUILD-LEARNINGS and AGENTS.md (149 lines or fewer) are updated. Nothing is merged or deployed by this session.

**D. Pins (invariant 5):** `indigo-ketcher` becomes a direct dependency pinned to 1.46.0. The pin test covers it and fails if it differs from ketcher-standalone's own pin, so only one Indigo is ever shipped.

**E. Invariant 3** names Biopython as the source of the pKa values (if decision 5 stands), with the AGENTS.md text kept within its line limit.

## Known limits (to state in the notes and BUILD-LEARNINGS)

- **Sequences only.** Nothing is read from the drawing, nothing is added to it, and there are no cyclic, branched or modified peptides. Disulfides count only in ε's second value.
- **Net charge and pI** use Bjellqvist's values, made for denatured proteins in gels, with free termini. Real peptides can differ, and an amidated C-terminus (oxytocin) is not modelled.
- **Tm** is Khandelwal's DNA model:
  - perfect duplexes in Na⁺ only, with no Mg²⁺ and no mismatches;
  - fitted for 15 bp and longer, at 0.015–0.6 M Na⁺;
  - concentrations outside that range are accepted without a warning;
  - Indigo applies it to the whole length, so long DNA gets impossible values (measured while
    building, at the default concentrations): 100 bases 99 °C, 1000 bases 140 °C. The paper
    averages genomic DNA over 70-bp windows; Indigo doesn't. An open question for Jeff.
- **Hydrophobicity** is the Black & Mould scale only, residue by residue, with no window averaging.
- **A second Indigo instance** runs once the section has been opened, alongside Ketcher's own. Measured while building: about 60 MB once loaded, about 120 MB after a 1000-residue peptide and 1000 DNA bases (BUILD-LEARNINGS).

## After the review (2026-10-26)

A capped review (three reviewers, then a skeptic verifying each finding) found nothing high
and one medium, now fixed with a test that fails without the fix:
- **Bar A.2-A.3:** Indigo's fixture lacked the 40 dipeptides of decision 11 (each residue
  first, XG, and last, GX); the Biopython one had them. The Indigo generator now makes them
  too, and a test requires both fixtures to hold the same peptides.

Four lows were cheap to fix, each with a test that fails without it:
- A late answer for an edit since undone (type G, then GK, back to G before GK's answer)
  replaced the answer for G, so the values went back to "Working…" and G was asked for again.
- The properties panel's "updating" style greyed the section's values while the drawing's
  were worked out; the section now has its own list class.
- The build test now also fails if any script carries a wasm module inside it, as
  indigo-ketcher's default entry does: a second Indigo that no .wasm count would see.
- The smoke tests now name the notes' sources (Bjellqvist, Pace, Black and Mould,
  Khandelwal), read every hydrophobicity bar's tooltip, and check the section is still at
  the panel's foot after drawing.

Accepted limits (low):
- The worker, and its Indigo, stay for the rest of the session once the section has been
  opened; closing the section doesn't stop it. (The known limit above was reworded to say so
  after approval.)
- The `role=status` region holds the method notes as well as the values, so a screen reader
  re-reads them on each change.
- A poly-Arg of more than 101 residues has its model pI above 14; the panel shows 14.00.
- A one-letter box accepts three-letter text run together when it uses only one-letter
  letters (AlaGlyCys…; any Glu, Leu or Pro is rejected); an invisible pasted character
  (zero-width space) is named in a message that looks empty.
- Clearing a concentration box to retype it asks Indigo again for the formula and mass.
- The DNA smoke test changes both concentration boxes for the 1000-base duplex too, so each Tm
  check there waits for two duplex runs (about 6 s against the 30 s limit).
- The smoke tests' CSP guard listens in documents only, so a violation inside a worker that
  the code survives goes unreported (true of every worker).
- Indigo's Tm doesn't check that the bases pair, so equal Tm values from the app and the
  generator don't prove the pairing; the HELM test does.

## Priority

After the v1 checklist items that remain for CHEM-311, like the other version 2 features.
