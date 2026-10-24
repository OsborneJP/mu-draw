# Plan: functional-group highlighter (SPEC "3. Functional group highlighter")

Written 2026-10-24 by Claude, before building. Jeff delegated the 25-molecule set
("use your best judgement to produce the 25 molecule set").

## What the student sees

- A "Functional groups" section in the properties panel with a "Show functional groups"
  checkbox. Ticked: every matched group is coloured on the canvas and listed under the
  checkbox with a colour swatch, its name and a count ("Alcohol (2°) ×2"). Unticked:
  no list and none of its colours on the canvas.
- The colours follow the drawing: a change removes them at once, and the new drawing's
  colours appear when RDKit has answered. A highlight is never shown on a drawing it was
  not made for.
- Colouring is not an edit: no undo step, no change event, not autosaved; the student's
  own Ketcher highlights and the stereo highlight are left alone.
- Works offline (the pattern file is precached, RDKit runs on the device).
- If the pattern file can't be loaded, or one of its entries is broken, the section says
  which, and the properties panel works as before.

## Design

- `web/public/functional-groups.json`: `{ "groups": [{ name, smarts, color, priority }] }`,
  editable without code changes. Every atom a SMARTS matches belongs to the group (it is
  coloured and claimed); atoms that only have to be nearby go inside recursive SMARTS
  `$(...)`. So an alcohol is its O, `[OX2H1;$(O[CX4;H2,H3])]`, and an ester is its
  C(=O)O, never the carbon on either side (which an arene may own).
- Overlap rule (spec): groups are applied from the highest priority down. A match that
  uses an atom a higher-priority group already claimed is dropped; matches of one group
  that share atoms merge into one instance (naphthalene is one arene, urea one amide).
  The SMARTS stay textbook-simple on purpose and the rule does the separating: the ether
  pattern matches an ester's O, and the ester (higher priority) claims it first.
- Matching runs in the RDKit worker with the properties, on the same request (a few
  milliseconds), on the Molfile's own atoms so indices map to Ketcher's atom ids as for
  the stereo highlight. The worker fetches the pattern file once, from the app's base.
- 1°/2°/3° alcohols by the hydrogens on the carbinol carbon (CH2/CH3, CH, C); 1°/2°/3°
  amines by the hydrogens on N (NH2, NH, N), with every heavy neighbour a carbon.
- Highlights: the instance's atoms plus the bonds between two of them, in the group's
  colour, through the same create/remove-by-id code as the stereo highlight.

## The 25-molecule set (provisional, for Jeff to check against CHEM-312)

Names in `tests/fixtures/functional_group_names.txt`; structures from PubChem through
`scripts/fetch_reference_smiles.py`; expected groups in
`tests/fixtures/functional_groups_expected.json`, written by judgement (not from the
patterns under test) and marked provisional. Each molecule's line there says what it
checks. Coverage: every starter group at least once, plus ester vs ether vs acid (ethyl
acetate, aspirin, 4-methoxybenzoic acid, methylparaben, acetic anhydride), phenol vs
alcohol (4-hydroxybenzyl alcohol, vanillin, paracetamol), amide vs amine (paracetamol,
lidocaine, N,N-dimethylformamide, procaine), 1°/2°/3° alcohols (glycerol, 2-butanol,
tert-butanol, propargyl alcohol) and amines (procaine, diethylamine, lidocaine,
L-cysteine), anhydride, acid chloride (not an alkyl halide), epoxide (not an ether),
nitrile, thiol, alkyl halide.

## Acceptance bar (the review checks against this)

1. For each of the 25 molecules, the listed groups and counts equal the expected file
   exactly (Vitest, RDKit.js in Node, the shipped pattern file; and the same in the
   browser for all 25).
2. The shipped pattern file is valid (every SMARTS parses in RDKit.js; colours `#rrggbb`;
   unique names; numeric priorities) and names every starter group (Vitest).
3. The overlap rule is proven non-vacuous: on its own, the ether pattern matches ethyl
   acetate's ester O and epichlorohydrin's epoxide O, the ester pattern matches acetic
   anhydride, and the amine pattern matches paracetamol's amide N; with the rule, none of
   those is listed.
4. Browser: ticking colours exactly the atoms and bonds of each instance (Ketcher ids,
   also after delete + undo reorders ids, and with explicit hydrogens drawn); unticking
   removes exactly those; no undo step or change event; the student's own highlight stays.
5. Browser, RDKit's reply held: after a change the old colours are gone at once and the
   list is marked out of date; the late reply for an older drawing is never coloured.
6. Browser offline (server stopped, context offline, after one visit): the pattern file
   comes from the service worker and the groups show.
7. Pattern file missing (404) or an entry RDKit can't read: the section says so, the
   other groups and the properties still show.
8. Every guard has a test that fails without it, recorded in BUILD-LEARNINGS.md;
   `scripts/check.sh` passes; deployed to staging and production with the live checks
   (which also fetch the pattern file through Apache).

Not in scope: groups beyond the starter list, aryl halides, hemiacetals, imides as their
own group, IR hints (After v1).
