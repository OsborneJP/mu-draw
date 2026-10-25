# Version 2: IR hint table driven by the functional-group results

Requested by Jeff on 2026-10-25 (docs/SPEC.md, "After v1" > "Teaching features": "IR hint table driven by the functional group results"). When asked where the IR values may come from (invariant 3), Jeff uploaded a draft library, `ir-bands.json` (version 0.1-draft, "Draft for faculty review", CC BY-SA 4.0). It lists IR bands for each functional group, keyed by group. It also has spectrum regions, shared entries, `also_show` and `always_show`, and for each band a `diagnostic`, `note`, `sources` and `verify` flag. Three attributions come with it.

The aim: once a student ticks a box, the properties panel lists the IR bands to expect for the functional groups found in the drawing. The bands to look for first are in bold, with Jeff's notes, and the table's sources are credited.

## Measured before planning (Jeff's file and the shipped highlighter, read by script, not by eye)

- **Groups.** The library has 25 groups; the highlighter has 22. Every highlighter group has a library entry:

  | Highlighter (`name`) | Library key | | Highlighter (`name`) | Library key |
  |---|---|---|---|---|
  | Anhydride | anhydride | | Alcohol (1°) | alcohol_primary |
  | Acid chloride | acid_chloride | | Alcohol (2°) | alcohol_secondary |
  | Carboxylic acid | carboxylic_acid | | Alcohol (3°) | alcohol_tertiary |
  | Ester | ester | | Ether | ether |
  | Amide | amide | | Amine (1°) | amine_primary |
  | Nitrile | nitrile | | Amine (2°) | amine_secondary |
  | Aldehyde | aldehyde | | Amine (3°) | amine_tertiary |
  | Ketone | ketone | | Alkyl halide | alkyl_halide |
  | Epoxide | epoxide | | Alkyne | alkyne |
  | Thiol | thiol | | Alkene | alkene |
  | Phenol | phenol | | Arene | arene |

- **Mismatches.**
  - Library to highlighter: three library groups have no highlighter group, all on purpose:
    - `alkane` is `always_show`;
    - `alcohol_oh` is the `shared` entry of the three alcohols;
    - `amine_cn` is the `shared` entry of the three amines.
  - Highlighter to library: none is missing.
  - **The highlighter has no keys.** Its groups are known only by their display `name` ("Alcohol (1°)"), and the library's keys are snake_case. The plan adds an `id` to each entry of `functional-groups.json`, set to the library key. Joining on display names would break the moment a name is reworded.
  - **Labels differ.** Examples: "Arene" vs "Aromatic ring"; "Alcohol (1°)" vs "Alcohol, 1°"; "Amine (2°)" vs "Amine, 2°".
  - **Some groups never match.** The highlighter finds only neutral acids and amines, with an O–H on the acid and an uncharged N on the amine. So a drawn carboxylate or zwitterion matches no group, and the library's carboxylate band (under `carboxylic_acid`) shows only when the neutral acid is drawn.
  - **The library is finer-grained than the highlighter.** Halides list C–F, C–Cl, C–Br and C–I, but the highlighter has one "Alkyl halide" group. Alkene and arene list a bend for each substitution pattern. Amides list 1° and 2° N–H, but the highlighter has one "Amide".
- **Bands.** 60 bands: 26 are diagnostic, and 16 are single values (`approx`, low = high). Every range lies within the span of the four regions (400 to 4000 cm-1). `approx` is set exactly when low = high. Intensities used are strong, medium and weak; shapes are sharp, broad and null.
- **`"verify": true`.** 9 bands in 5 groups:
  - amide: C=O amide I, N–H stretch, N–H bend;
  - anhydride: C–O;
  - amine_secondary: N–H;
  - thiol: S–H;
  - epoxide: all three bands.

  If these are hidden, amide, thiol, epoxide and amine_secondary have no band left (amine 2° still shows the shared C–N). Every band citing `textbook` is one of the 9.
- **Group-level notes.** amine_tertiary (it has no bands at all), alkyl_halide and epoxide.
- **Sources.** Bands and regions cite `wikipedia`, `openstax` and `textbook`, and each has an attribution entry.
  - **OpenStax Organic Chemistry is CC BY-NC-SA 4.0** (its page, read 2026-10-25: "This book uses the Creative Commons Attribution-NonCommercial-ShareAlike License"). Table 12.1 there is "Characteristic IR Absorptions of Some Functional Groups". Numbers are facts, but its wording is non-commercial, so it can't go into a CC BY-SA file or an MIT app. Jeff's attribution already says "values only; no text copied".
- **The app today.**
  - The properties panel is 280 px wide.
  - The worker fetches the patterns file and reports problems as "Functional groups are unavailable: …" or "Skipped in functional-groups.json: …".
  - `json` is in the precache globPatterns. The precache guard requires `functional-groups.json` by name, and `scripts/check_live.py` fetches it through Apache.
  - AGENTS.md has 149 lines, and check.sh fails at 150.

## Invariant 3: what it means here

The IR table is a curated reference, not a calculation, so none of the five sources can produce it. A faculty-checked table becomes a sixth source, on two conditions:
- every band names its sources, and each source has an attribution entry;
- a band is shown only after a person has checked it against a cited source. `"verify": false` is that person's statement that they did.

Code and tests never contain IR numbers. They read `web/public/ir-bands.json`.

Proposed AGENTS.md wording, fitted to the 149-line limit by tightening elsewhere (not invariant 6):

> 3. Chemistry values come only from RDKit, Ketcher/Indigo, OPSIN, PubChem, NMRShiftDB2 (¹³C shifts), or the faculty-checked IR table web/public/ir-bands.json (every band cites its sources; a band marked "verify" is never shown): never from an LLM and never hand-typed into code or tests. Enforced by: generated fixtures with drift tests (tests/fixtures/; the ¹³C table's header names its SD file's SHA-256), web/src/chem/irBands.test.ts (sources, verify), and scripts/checks/chem_literals.py (no Molfile/CDXML/InChI text in source). SMILES and numeric literals in source: review only.

The first "Common AI failure modes" bullet also gains "or an IR wavenumber".

## Licence

- The app stays MIT. `web/public/ir-bands.json` stays CC BY-SA 4.0 as a separate file. The app reads and displays it but doesn't adapt it, so ShareAlike applies to the file and to later edits of it, not to the code.
- CC BY-SA 4.0 §3(a) needs a credit wherever the table is shown:
  - the creator;
  - the licence and its URI;
  - the sources, with a note that the values were adapted.

  Invariant 1 forbids outside links, so every URI is plain text. The NMR notice does the same.
- THIRD-PARTY-NOTICES.md gains an entry for the file. It names the licence, its URI, Wikipedia (CC BY-SA 4.0) and OpenStax (CC BY-NC-SA 4.0, values only).

## What the student sees

1. The Functional groups section of the properties panel gets a second checkbox, "Show IR hints", unticked at first. It works independently of "Show functional groups", but uses the same groups result, so its list is always for the same drawing as the groups list.
2. Ticked, it shows "IR hints". A line says "Typical bands (cm⁻¹) for the groups found. Bold bands are the ones to look for first." One entry per library group follows, in this order:
   - the groups found, in the highlighter's order (highest priority first);
   - each group's `shared` entry, right after the first group that names it, and shown only once;
   - each `also_show` entry, after its group, unless that group was found itself;
   - the `always_show` entries last.

   Each entry lists:
   - its heading;
   - its group note, if it has one;
   - its bands, in the file's order. Each band has a range ("1715–1720", or "≈1735" when `approx`), its vibration, and its intensity and shape ("strong, broad"). A diagnostic band is bold, with hidden text "(look for this first)" for screen readers. Its note goes underneath, in smaller type.
3. A closed "Where bands appear" disclosure lists the four regions.
4. A credit line, in plain text with no links, lists:
   - the table's name and version;
   - who compiled it;
   - "CC BY-SA 4.0 (https://creativecommons.org/licenses/by-sa/4.0/)";
   - each attribution that a shown band or region cites, with its text and URL.
5. A found group without an `id`, or whose `id` isn't in the file, gets an entry saying "No IR hints for ‹name› yet."
6. Unticked: none of it shows.

## Design

- `web/public/ir-bands.json`: Jeff's file, plus `title` and `compiled_by` (decision 4), and an `about` line like the patterns file. It can be edited with no code change.
- `web/public/functional-groups.json`: each group gains `"id"`, its library key.
  - In `functionalGroups.ts`, `readPatterns` accepts an optional `id`, which must be lowercase snake_case and unique. A broken `id` is a named problem and the group is skipped, the same as any other field.
  - `FoundGroup` and `GroupsView` (`tracker.ts`) carry the `id`. These are additive one-field edits in web/src/chem/.
- `web/src/chem/irBands.ts` (new, pure, no RDKit):
  - `readIrBands(file)` returns `{ table, problems }` or `{ unavailable }`;
  - `hintsFor(ids, table)` returns the ordered entries described above.
- `web/src/panels/IrHints.tsx` and `irHints.css` (new) fetch `<base>ir-bands.json` once, on the first tick, through the service worker's precache. `FunctionalGroups.tsx` renders the checkbox and `<IrHints>`. **PropertiesPanel.tsx is not touched**, so the stereoisomer branch merges cleanly.
- Guards: the precache guard requires `ir-bands.json`, and `scripts/check_live.py` expects it through Apache (no-cache, JSON). That is not deploy.sh, so no mutation sweep is needed.

## Decisions (Jeff approved the plan on 2026-10-25, choosing every answer in bold)

1. **Where the values came from: a person compiled them from the cited sources**, so the 51 `verify: false` bands count as checked. Had an AI tool drafted them, every band would have started as `verify: true`.
2. **Bands marked verify: hidden until checked.** The entry says "Some values for this group are still being checked." Jeff checks each band against Pavia or Silverstein and sets `verify: false`. The `textbook` source then becomes a named reference with its own attribution, values only. The alternative is to show them greyed out and marked "not yet checked".
3. **Where the hints show: in the properties panel, under Functional groups.** The alternative is a panel below the canvas, like the ¹³C NMR preview, which has room for a full table. That panel slot is what the stereoisomer work is changing ("one such panel at a time"), so it would wait for that merge.
4. **Credit: "compiled by MU Draw contributors"**, which still holds when someone else edits the file. The alternative is Jeff's own name.
5. **Headings use the library's labels** ("Aromatic ring", "Alcohol, 1°"), not the highlighter's names.
6. **All four C–X bands show for any alkyl halide**, and every substitution-pattern bend for alkenes and arenes. The file doesn't say which halogen a band needs, and the vibration text names the case.
7. **The alkane C–H entry shows for every structure**, as the file says, under its own label ("present in most organic compounds"), including benzene.
8. **OpenStax:** Jeff confirmed that no label or note copies OpenStax wording, which matters because it is CC BY-NC-SA.
9. **Accepted limit:** a drawn carboxylate, zwitterion or ammonium salt gets no hint, because the highlighter doesn't find those groups.

## Acceptance bar

**A. The file's checks (Vitest, web/src/chem/irBands.test.ts)**
1. The shipped file passes with no problems:
   - units "cm-1", licence "CC BY-SA 4.0";
   - attribution keys unique, and each entry has text and a URL (or null);
   - every band and region has a range of two numbers with low ≤ high, inside the regions' span;
   - `approx` is set only when low = high;
   - intensity is strong, medium, weak or variable, and shape is sharp, broad or null;
   - `diagnostic` and `verify` are booleans, and the note is text or null;
   - every band cites at least one source, and every source has an attribution;
   - every `shared` or `also_show` names an existing group, and a shared entry has no `shared` of its own.
2. Each rule in 1 has a negative test. A broken band, region or reference is skipped and named ("amide" band 2: …), and everything else is still used. A file with no groups, a wrong licence or wrong units is unavailable, with the reason.
3. The two shipped files agree:
   - every highlighter group has a unique `id`, and that `id` is a library key;
   - every library group is reachable: it is some group's `id`, a `shared` or `also_show` target, or `always_show`.
4. `hintsFor` follows the order rules on made-up id lists: shared shown once, after its first referrer; `also_show` dropped when that group is found itself; `always_show` last; an unknown id gives "no hints". On each of the 25 test-set molecules, the entries are those that the expected groups in tests/fixtures/functional_groups_expected.json lead to.
5. A band marked `verify` is never among the shown bands. A group with one gets the "still being checked" line. Decision 2 may change this item.
6. functionalGroups.test.ts: a missing `id` is allowed. A malformed or duplicate `id` is a named problem. The 25 molecules give the same groups as before.

**B. In the browser (Playwright, web/e2e/irhints.spec.ts)**
1. Unticked: no IR hints. Ticked, before the file arrives (its response held): "Loading IR hints…". Released: the hints.
2. 4-hydroxybenzyl alcohol shows these entries, in this order: phenol, alcohol_primary, alcohol_oh, arene, alkane. Arene shows once, although phenol asks for it with `also_show`.
3. Glycerol shows alcohol_oh once, right after the 1° alcohol, which names it first; then the 2° alcohol. Procaine shows amine_cn once, and amine_tertiary's note with no bands.
4. Every band shown has `data-low`, `data-high`, `data-diagnostic` and `data-verify`. The test compares each with the file (read by the test, never typed). Diagnostic bands are bold.
5. Paracetamol's amide shows no band marked `verify`, and shows the "still being checked" line. A served copy of the file with one band of a shown group marked `verify` hides exactly that band. This is the guard's negative test.
6. The credit line shows the licence and URI, and the attribution of each source cited by a shown band. It contains no `<a>`, and the link guard passes.
7. The hints follow the drawing: after a change, they are those of the new drawing's groups, never of an older one. This is tested with RDKit's reply held (`holdableRdkitReplies`).
8. Offline (server stopped, context offline, after one visit): the file comes from the service worker and the hints show.
9. If the file is 404 or not JSON, the section says "IR hints are unavailable: ir-bands.json could not be loaded (…)." A file with a broken band shows "Skipped in ir-bands.json: …". In both cases the groups list and the properties still show.

**C. Guards and docs**
1. The precache guard requires `ir-bands.json`, with a negative test. `check_live.py` expects it through Apache.
2. AGENTS.md: the invariant 3 wording above and the Layout lines, still under 150 lines. THIRD-PARTY-NOTICES.md lists the file. CHANGELOG.md and BUILD-LEARNINGS.md are updated.
3. Every guard has a test that fails without it.
4. scripts/check.sh passes before each commit. Commits are small, on branch claude/v2-ir-hints. No deploy, push or merge: the main session does those, and production only on Jeff's word.

Not in scope: a drawn IR spectrum or a band chart; matching a student's peak list; hints for groups the highlighter doesn't find (carboxylates, ammonium, aryl halides); per-halogen filtering of bands; checking the 9 `verify` bands (Jeff's task, against Pavia or Silverstein).
