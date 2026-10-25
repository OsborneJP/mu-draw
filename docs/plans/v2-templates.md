# Conformation and projection templates (version 2)

Requested by Jeff on 2026-10-25, for CHEM-311 as soon as possible. docs/SPEC.md, "After v1" > "Drawing tools":
- **Conformation and projection templates:** a chair cyclohexane with axial and equatorial positions, and Newman, Fischer and Haworth projections. Students drop them onto the canvas.
- Templates come first. Generating a Newman projection from a chosen bond comes later and is not part of this plan.

## Measured before building (Ketcher 3.18.0, RDKit 2026.09.1, throwaway probes)

**What Ketcher already has**
- Ketcher's Structure Library is already in the app. It opens from the "SL" button at the end of the bottom ring toolbar, or with Shift+T. Its library ships inside ketcher-react's JavaScript bundle; it is not a file the app fetches.
- The "Rings" group has bare chair and boat rings (Chair, Chair1 to Chair4, Boat), with no axial or equatorial bonds.
- The "Sugars" group has 8 α-D-hexopyranoses drawn as Haworth projections. "D-Sugars" has 21 open-chain sugars drawn as zigzag chains with wedges, not as Fischer projections.
- There are no Newman or Fischer projections.

**What an app can add**
- Ketcher has no option for adding templates. The only way in is the `ketcher-tmpls` key in localStorage, read at start-up. Ketcher always shows those templates in a group called "User Templates", where students can edit or delete them, and where "Save to Templates" puts the student's own. Measured: a template written there before start-up showed up as "User Templates (1)".
- Ketcher's paste tool (what Add uses, through src/editor/placeInHand.ts) and its template tool both place a structure together with a circle (an ellipse shape) and a text label. Measured from an empty canvas: 2 atoms, 1 shape and 1 text were placed, and one Undo removed all three.
- placeInHand's parser (`prepareStructToRender`) also reads Ketcher's own KET format, so a template can carry shapes and text.
- ketcher-react exports `StructRender`, the in-page renderer that Ketcher's own library uses for its thumbnails. It needs no Indigo call.
- Ketcher's `customButtons` option adds icon buttons to its top toolbar.

**Chair**
- RDKit's lowest-energy cyclohexane is a true chair (ETKDGv3 with seed 42, 20 conformers, MMFF). Its 6 axial C–H bonds are parallel to the ring axis (|cos| 1.00); the other 6 are at |cos| 0.37.
- Each equatorial C–H lies within 4.2° of the two ring bonds one removed. That is the textbook drawing rule, measured here rather than assumed.
- Projected as it is, the chair never looks like a textbook drawing from any viewing angle, because textbooks exaggerate the pucker.
- What works: stretch the conformer 1.5× along the ring axis, then view it from 18° above. That matches the shape of Ketcher's own Chair1 to within 5% (best similarity fit over viewing angle and stretch). The stretch is affine, so axial bonds stay parallel to the axis and equatorial bonds stay parallel to their ring bonds.

**Fischer** (built from PubChem's aldehydo-D-glucose in tests/fixtures: chain vertical, each OH and H horizontal)
- With plain crosses, RDKit reads none of the 16 left/right arrangements as that compound; all 4 centres are undefined.
- With the horizontal bonds wedged (toward the viewer, which is what the cross means), RDKit reads exactly one of the 16 as that compound. It is the textbook one: OH right, left, right, right, from C2 down.
- That drawing survives a trip through Ketcher: loaded, written back as a Molfile and read by RDKit, it is still PubChem's compound, and Indigo reads the same 4 centres.
- Loaded as a Molfile with chiral flag 0, it showed "AND Enantiomer". So templates must carry absolute stereo.

**Haworth**
- Ketcher's own Haworth α-D-glucopyranose ("Sugars" group) is misread in the app today: the panel shows 5 stereocentres, 2 of them undefined, and RDKit reads C2 inverted. Ketcher's flat-ring and zigzag sugars are read correctly.
- Up and down can be computed reliably: place each group up or down by which side of the ring plane it sits in an RDKit 3D model of PubChem's glucose. Rebuilt in 3D, that layout reads back as PubChem's glucose.
- Stereo can't be carried in the drawing. As a 2D Haworth, none of the 27 wedge patterns on the front edge made RDKit read it correctly. Neither did any wedge pattern on any ring bonds, with the vertical bonds splayed 5° to 20°.
- Ketcher has no bold bond except a wedge. So a thick front edge means wedges, and wedges make the app read a wrong or undefined stereoisomer.

**Newman**
- The C–C bond points at the viewer, so both carbons sit at one point. Ketcher can't hold that as one molecule.
- It can be a picture: a circle, the six bonds, and labels as text. The properties panel ignores text and shapes; on their own, they count as an empty drawing.

## Design

**Where the templates come from**
- `server/scripts/gen_templates.py` (RDKit, in the project env) writes `web/src/editor/templates.json`: each template's name, group, and KET.
- The app imports that file, so it ships in the precached JavaScript bundle: it works offline with no extra request.
- The generator also writes `tests/fixtures/templates_expected.json` (formula, InChIKey and stereocentre counts, from RDKit) for the browser tests. A pytest drift test re-runs it and finds both files unchanged.

**Where the chemistry comes from**
- The new names go in `tests/fixtures/template_names.txt`, and PubChem is asked for them through `scripts/fetch_reference_smiles.py --missing` (a new set, written to `template_compounds.csv`).
- The names: cyclohexane, alpha-D-glucopyranose and beta-D-glucopyranose. aldehydo-D-glucose is already recorded.
- What counts as chemistry comes from PubChem and RDKit and is checked by tests: which molecule, which side each group is on, and the chair's bond directions.
- Some geometry is only a drawing convention: Newman's 120° and 60°, Fischer's right angles, the Haworth's flattened hexagon, the bond length. The generator computes those; nothing is typed in.

**How students place one**
- Clicking a template puts it in the student's hand through placeInHand (widened from Molfile to KET), the same way Name to structure's Add works.
- It follows the mouse over the canvas, and a click puts it down. Esc or another tool puts it away. One Undo removes it.

**Starter set**
1. Chair cyclohexane, with all 12 positions as H atoms. It is cyclohexane; putting another atom on an H with the atom tool makes that group axial or equatorial.
2. The same chair after a ring flip.
3. Newman, staggered: the circle, front and back bonds, and six editable "H" labels.
4. Newman, eclipsed: the back bonds drawn 15° off the front ones so they show.
5. Fischer skeletons with 1, 2 and 4 stereocentres. Their bond ends are carbons until relabelled.
6. Fischer D-glucose.
7. Haworth pyranose and furanose skeletons.
8. Haworth α- and β-D-glucopyranose.

## Acceptance bar

**A. Generated, not typed**
1. gen_templates.py builds templates.json and templates_expected.json from tests/fixtures and RDKit. No SMILES, coordinates or Molfile text is typed into source. The drift test passes, and so does chem_literals.py.
2. Both chairs read in RDKit as PubChem's cyclohexane.
3. Fischer D-glucose, with its horizontal bonds wedged, has PubChem aldehydo-D-glucose's InChIKey.
4. Each Haworth glucose's up/down layout, rebuilt in 3D, reads back as PubChem's anomer.
5. Chair geometry: the 6 axial bonds are vertical to within 1° and alternate up and down; each equatorial bond is within 5° of parallel to the two ring bonds one removed.
6. Newman geometry: front bonds are 120° apart; back bonds start on the circle, 60° (staggered) or 15° (eclipsed) off the front ones.

**B. Picker**
1. A "Templates" button in the header opens a menu grouped Chair, Newman, Fischer, Haworth. Each item shows its picture (StructRender) and its name. The button is disabled until the editor is ready.
2. Clicking an item puts the template in the hand. A click on the canvas places it there. Esc, or picking another tool, puts it away with nothing added. One Undo removes the whole template. There is a browser test per group that counts atoms, shapes and texts before and after.
3. Picking a template while Add's compound is in hand puts that compound away, and the reverse.
4. Offline: a browser test places a template with the network off.

**C. What the app makes of them** (browser tests, expected values from templates_expected.json)
1. A chair on an empty canvas shows cyclohexane's formula and 0 stereocentres.
2. Fischer D-glucose shows 4 stereocentres, 0 undefined, and has the InChIKey in A3.
3. The Haworths have plain bonds only (no wedges), so the app never reads a wrong stereoisomer: a Haworth glucose shows 5 stereocentres, all undefined.
4. A Newman alone on the canvas shows "Draw a structure to see its properties". Export (SVG) contains its circle and labels.
5. A placed template, shapes and text included, survives a reload (autosave).

**D. Nothing else changes**
1. Ketcher's own Structure Library is unchanged.
2. The request guard, CSP and precache guard still pass. No new file is fetched.

**E. Every change:** check.sh passes before each commit. CHANGELOG.md and BUILD-LEARNINGS.md are updated, and so are AGENTS.md's layout lines (invariant 6 is left to the main session). No deploy, push or merge.

## Decided (Jeff, 2026-10-25)

Jeff approved the plan as written: the starter set above, all four types, one commit each, in the order chair, Newman, Fischer, Haworth.
1. **Where the templates appear:** a "Templates" button in the header, opening a menu with pictures. Not Ketcher's top toolbar, and not its Structure Library (where they could only be "User Templates", which students can delete or edit).
2. **Which templates first:** all four types, as in the starter set.
3. **Fischer:** wedged horizontal bonds, so the app reads the stereoisomer. Not plain crosses.
4. **Haworth:** plain bonds with no thick front edge, so the app never reads a wrong stereoisomer; its centres show as undefined.
5. **Still open:** Ketcher's own Haworth sugars (Structure Library, "Sugars") are misread in the app today. They stay as they are unless Jeff decides otherwise.
