# Lab glassware library (version 2)

Asked for in docs/SPEC.md, "After v1" > "Drawing tools":
- **Lab glassware library:** an openly licensed SVG set placed with Ketcher's image tool, for lab reports.

The aim: a student builds an apparatus diagram (reflux, distillation, filtration, extraction, titration, TLC) from ready-made pieces, labels it, and pastes it into a lab report with Copy image or Export.

Status: **approved by Jeff on 2026-10-26, every proposed answer (in bold) as written** (see "Decided" at the end).

## What a student sees

1. The header's Templates menu gets two tabs: "Structures" (today's chair, Newman, Fischer and Haworth templates) and "Glassware". There is no new header button.
2. The Glassware tab shows the pieces in groups:
   - Flasks
   - Condensers and adapters
   - Funnels
   - Measuring
   - Heating and cooling
   - Chromatography

   Each piece shows its picture and its name. Under the groups are a short note on which file formats keep glassware (decision 5) and a plain-text credit line (decision 4).
3. Clicking a piece puts it in the student's hand, exactly as a template does. It follows the mouse over the canvas, and a click puts it down there. Esc or another tool puts it away, and one Undo removes it.
4. Pieces are placed at a common scale, so a still head drawn for a flask sits on that flask's neck without resizing. The scale is decision 6.
5. With the selection tool, the student drags a piece to move it, drags a corner or edge to resize it, and presses Delete to remove it.
6. Glassware is always drawn behind structures, text and arrows. Labels are added with Ketcher's text tool, and a structure can be drawn over a flask.
7. Copy image and Export include the glassware. So do autosave, a reload, and Save as "Ket Format". What other formats do is decision 5.
8. All of it works offline.

## Measured before planning

All on Ketcher 3.18.0, Indigo 1.46 and Chromium. The probes were throwaway browser tests on a build with a temporary hook, run on 2026-10-26; none of them is committed.

### Glassware sets

A survey looked at 7 candidate sets. Its per-file notes (URL, author, licence, size and checks) were kept outside the repo. The originals chosen, with their notes, go into third_party/glassware/ when building. Nothing from the files was executed: they were read as text, and rendered only as `<img>`.

| Set | Licence | Style | Do the pieces fit together? | Pieces, out of 24 common ones | Files |
|---|---|---|---|---|---|
| **Quantockgoblin** apparatus drawings, Wikimedia Commons (vectorised by Slashme, Mysid, Jxjl) | Public domain (`PD-self`) on each file page. One exception, the Perkin triangle SVG, is CC BY-SA 4.0. | Thin black lines, grey ground-glass joints, coloured liquid | Yes, within one drawing: the still head, condenser, receiver adapter and flasks of the simple distillation share one scale. Scale differs between drawings. | 10 | 6–45 KB. No external references, embedded images or scripts. Most drawings carry 4–16 `<text>` number labels. |
| Servier Medical Art, via Bioicons | CC BY. Bioicons labels it 3.0; Servier states 4.0 for all its art (smart.servier.com/how-to-cite-servier-medical-art). | Coloured, shaded, realistic, consistent | No: each piece has its own scale and no standard joints | 13. **No round-bottom flask, still head or thermometer**, so no reflux or distillation diagram. | 4–103 KB. Self-contained except the two burettes (31 `<text>` each). |
| B_Lachner lab-equipment collection, Openclipart | CC0 (openclipart.org/share) | German school-lab style, some lines, some shading | Round-bottom flasks come in a size series with joints; nothing else is designed to connect | 16, many only inside multi-item sheets or worksheets | 6–334 KB. Many have German `<text>` labels. |
| Openclipart, mixed authors | CC0 | Inconsistent | No | 14 | 1–123 KB |
| DBCLS TogoTV | CC BY 4.0 | Flat icons | No | 6 | 1–2 KB |
| LabEqx by chris 論, Wikimedia Commons | CC BY-SA 4.0 | Not seen (Commons rate-limited the download) | No joints (school kit) | 9, judged by file name | 3–20 KB |
| Public-domain and CC0 single pieces, Wikimedia Commons (NalesnikLD, Jü, Xavax, CLauterb, chris 論/Sven Weidauer) | PD or CC0, per file | Line drawings, by different hands | No | 9 | 3–107 KB. A few carry 1–5 `<text>` labels. |

Excluded:
- **Chemix:** proprietary terms (help.chemix.org/article/24-license); it gives no right to extract or redistribute its drawings.
- **LaboBib** (Dr Rainer Rensch: about 500 drawings designed to join at their joints): freeware "as long as no fee is charged" (fontain.userweb.mwn.de/C-Design/LaboBib.htm). Technically the best fit, but not an open licence. See decision 1.
- **CC BY-SA files** (LabEqx, the Perkin triangle SVG): share-alike could plausibly reach every image a student exports with them in it.

No set has a volumetric (bulb) pipette, a boiling tube or a heating mantle.

**Can the Quantockgoblin drawings be cut into single pieces?** Mostly yes. Each file was split into its top-level groups and loose elements, and each part was rendered on its own.
- **Simple distillation:** the condenser (with its water arrows), still-pot flask, receiving flask, oil bath and ice bath are separate groups, and the receiver adapter is one path. The still head and thermometer are drawn as one path, so they stay one piece. The hotplate is 5 loose elements to group.
- **Schlenk flasks:** each flask is its own group.
- **Single-piece files:** Allihn condenser, Burette (with a clamp), Graham condenser.
- **Dean–Stark, Soxhlet and Perkin triangle:** the glass is loose paths, so these are not in the starter set.

**Gap-fill pieces, seen rendered:**
- Jü's CC0 drawings (dropping funnels, two- and three-neck flasks, filter and powder funnels) share one clean line style with stippled joints, close to Quantockgoblin's.
- Xavax's measuring cylinder (PD) is detailed line art.
- NalesnikLD's Büchner funnel and receiver adapter (PD) are line art with labels to drop.
- Commons has no PD or CC0 SVG of a beaker, conical flask or separating funnel. Checked: the categories "Separatory funnels", "Beakers (laboratory equipment)", "Erlenmeyer flasks", "Diagrams of laboratory flasks" and "SVG Laboratory equipment"; the rest are CC BY-SA, GFDL or raster.
- So those three come from Openclipart (CC0), each in its own style: B_Lachner's beaker and conical flask (grey line, light fill), stefg1971's separating funnel (coloured, drawn in a stand), and MeV's matching Büchner funnel and flask (coloured).
- **The look is mixed.** Seen side by side on a contact sheet (sent to Jeff with this plan):
  - Jü's and Xavax's drawings sit well beside Quantockgoblin's.
  - B_Lachner's are thinner grey lines.
  - stefg1971's and MeV's are coloured, and MeV's has heavy black outlines.

### Ketcher 3.18 and images

- **Format.**
  - An image is a KET node `{type: "image", format: "image/svg+xml" or "image/png", boundingBox: {x, y, width, height}, data: <base64>}`. The box is in model units (1 = one bond length = 40 px at 100% zoom).
  - Ketcher keeps the image as a `data:` URL and draws it as an SVG `<image>`.
  - Images are drawn **behind** everything else: Ketcher's "images" layer comes right after the background.
- **Ketcher's own image tool** ("Add image", `images`) is already in the app's toolbar. A click on the canvas opens a file picker for PNG or SVG, and the image is placed at its own pixel size. The app hides nothing there today.
- **Placing through placeInHand.ts works unchanged.**
  - The KET above, given to `placeInHand`, showed the image under the mouse.
  - A click placed it there as 1 change, at exactly the size in its KET (`struct.rescale()` doesn't touch images).
  - placeInHand's `prepareStructToRender` reads KET image nodes.
- **Selection tool.**
  - A drag moves an image (1 change).
  - A drag on a corner resizes it **freely**: Ketcher has no aspect-ratio lock and draws images with `preserveAspectRatio="none"`. Measured: 80×112 px became 136×138 px.
  - Delete removes an image, and Undo brings it back.
  - **Ketcher cannot rotate or flip an image**: `fromRotate` and `fromFlip` handle atoms, arrows, pluses, text and data, never images.
- **Autosave and reload.**
  - `getKet()` includes the image node with its data.
  - A relaunch puts the image back.
  - `setMolecule(ket)` loads it.
- **Other formats (silently, no error and no warning in Ketcher's Save dialog):**

  | Format | What happens to an image |
  |---|---|
  | Molfile V2000 and V3000, SDF, SMILES, InChI | Dropped: an image-only drawing gives an empty Molfile and empty SMILES. |
  | CDXML | A PNG image is embedded as it is (`<embeddedobject PNG=…>`). **An SVG image becomes Indigo's 1024×1024 "image not available" icon**, and that icon is what comes back when the file is opened again. |
  | Ketcher's own Save as SVG or PNG | As the app's Export (next bullet). |

- **Export, Copy image and Ketcher's SVG/PNG (all Indigo's `generateImage`).**
  - Indigo rasterises each SVG image into a PNG **at the SVG's own width and height**, embeds it in its SVG, and scales it into place. A 100×140 SVG placed at 4× its size came out as a 100×140 PNG drawn 4× larger, so it was blurred. With width and height set 4× larger (viewBox unchanged), the PNG was 400×560 and drawn at 0.2×, so it was sharp.
  - Time and size grow with the images' pixel area, not with their number. Measured on Quantockgoblin's whole simple-distillation drawing (an apparatus-sized image, 392×520 px placed), averaged over repeats after Indigo's first call (which costs about 450 ms once):

    | Shipped width and height | Indigo's export SVG | Time |
    |---|---|---|
    | 1× (392×520) | 43 KB | 55 ms |
    | 2× | 113 KB | 180 ms |
    | 4× | 311 KB | 690 ms |
  - Indigo's rasteriser kept gradients, dashes, transforms and opacity, but **dropped `<text>`**. Shipped pieces must carry no text.
- **Content Security Policy.** `img-src 'self' data:` already allows this: the canvas images are `data:` URLs, and the menu's pictures are the app's own files. web/scripts/checks/csp.ts already says "Ketcher's CSS images and placed images are data: URLs". Nothing in web/csp.json changes.
- **The smoke tests' link guard trips on any image on the canvas.** It reports `image[href]: data:image/svg+xml;base64,…` as a link leaving the app (scheme `data:`). No test has put an image on the canvas before, so this never showed. It applies equally to images a student adds today with Ketcher's own image tool. See decision 7.
- **Precache.** `svg` is already in the Workbox globPatterns, and the precache guard fails the build for any file in dist that isn't precached.
- **Sizes.** An image costs its SVG's size ×4/3 (base64) in autosave and in a KET file. localStorage holds about 5 MB per origin, shared by staging and production.

### The app today

- The Templates menu holds 12 templates in 4 groups, in a 400 px wide panel with 3 columns. Its pick logic (src/panels/templates.ts) already handles "a later pick wins", "Add's compound and a template put each other away" and "Esc".
- The header is crowded: at 390 px the page already scrolls sideways (a known low).
- AGENTS.md has 149 lines, and check.sh fails at 150.

## Decisions (proposed answers in bold; Jeff chose all of them)

1. **Which set.**
   - **Proposed: Quantockgoblin's public-domain apparatus drawings from Wikimedia Commons as the base, cut into single pieces by a committed script, with the general kit they lack (beaker, conical flask, Büchner funnel and flask, filter, dropping and separating funnels, measuring cylinder, multi-neck flasks) from public-domain or CC0 drawings by other authors on Commons and Openclipart.** It is the only open set whose pieces join: still head, condenser, adapter and flasks at one scale. It is line art, which suits a lab report. Nothing in it is CC BY or CC BY-SA, so students' exported images carry no licence obligation.
   - The alternatives:
     - **(b) Servier Medical Art (CC BY).** One polished, consistent set of separate files, but no round-bottom flask, still head or thermometer, so no reflux or distillation.
     - **(c) The Quantockgoblin base plus Servier for the gaps.** More pieces, but shaded and line art mixed at different scales.
     - **(d) Ask Dr Rensch for an open licence for LaboBib.** Jeff writes to him; the best drawings, but an open-ended wait.
2. **Which pieces.** **Proposed starter set (23):**

   | Group | Piece | Source (author, licence) | Work needed |
   |---|---|---|---|
   | Flasks | Round-bottom flask | Simple distillation (Quantockgoblin/Slashme, PD) | cut out |
   | | Small round-bottom flask (receiver) | Simple distillation (PD) | cut out |
   | | Two-neck flask, three-neck flask | Mehrhalskolben (Jü, CC0) | cut out |
   | | Schlenk flask | Schlenk flasks (Quantockgoblin/Slashme, PD) | cut out |
   | | Conical flask | Erlenmeyerkolben (B_Lachner, Openclipart CC0) | cut one out of 4 |
   | | Beaker | Becherglaeser (B_Lachner, Openclipart CC0) | cut one out, drop its volume numbers |
   | | Büchner flask | Buchner funnel and flask (MeV, Openclipart CC0) | cut out |
   | Condensers and adapters | Liebig condenser, slanted | Simple distillation (PD) | cut out |
   | | Liebig condenser, upright | the same, turned upright by the script | cut out, rotated |
   | | Allihn condenser | Allihn condenser (Quantockgoblin/Jxjl, PD) | none |
   | | Still head with thermometer | Simple distillation (PD) | cut out |
   | | Receiver adapter | Simple distillation (PD) | cut out |
   | Funnels | Büchner funnel | Buchner funnel and flask (MeV, Openclipart CC0), drawn to fit its flask | cut out |
   | | Filter funnel | Funnel types (Jü, CC0) | cut out |
   | | Dropping funnel | Dropping funnel (Jü, CC0) | cut out the plain one of the 2 |
   | | Separating funnel | Separatory funnel (stefg1971, Openclipart CC0) | cut out of its stand, drop 5 labels |
   | Measuring | Burette with clamp | Burette (Mysid after Quantockgoblin, PD) | none |
   | | Measuring cylinder | Graduated cylinder (Xavax, PD) | none |
   | Heating and cooling | Stirrer hotplate | Simple distillation (PD) | group 5 parts |
   | | Oil bath, ice bath | Simple distillation (PD) | cut out |
   | Chromatography | TLC tank with plate | Tlc sequence (Quantockgoblin, vectorised by Shakiestone, PD): its developing-tank frame | cut out, drop 4 labels |

   Left out for now: Dean–Stark, Soxhlet, cold finger, Graham condenser (their glass is loose paths, or rarely needed), a volumetric pipette, boiling tube and heating mantle (no open drawing found), and Bunsen burner and stand (school kit, not a joint-glassware drawing).
3. **Where they appear.** **A "Glassware" tab in the Templates menu**, with the 12 templates under a "Structures" tab, so the header gains no button. The alternative is a "Glassware" header button of its own, which needs a plan for header space at 390 px first.
4. **Attribution.** PD and CC0 need none, but **credit anyway, as plain text**:
   - THIRD-PARTY-NOTICES.md lists every original: its title, author, licence and page URL.
   - The Glassware tab ends with one line: "Drawings from Wikimedia Commons and Openclipart by Quantockgoblin, Slashme, Mysid, Jxjl, Shakiestone, Jü, Xavax, B_Lachner, stefg1971 and MeV; public domain and CC0. Details: About."
   - The About box gains one line saying the same.

   If decision 1 picks Servier instead, CC BY 4.0 needs Servier's credit wherever the pieces are shown (the tab, About, THIRD-PARTY-NOTICES), and the tab adds "Credit Servier Medical Art (CC BY 4.0) if you publish a figure".
5. **Molfile, CDXML and the other formats.**
   - **Proposed: keep Ketcher's behaviour and tell the student where they will read it, in the Glassware tab's note: "Glassware is kept by autosave, Ket Format files, Copy image and Export. Molfile, SMILES and other chemistry formats leave it out, and CDXML shows a placeholder." Browser tests pin each behaviour, so a Ketcher upgrade that changes one is noticed.** The trap is real: Ketcher's Save dialog opens on MDL Molfile and warns of nothing. But autosave keeps the drawing, and a lab report uses Copy image or Export, which keep it.
   - The alternatives:
     - **(b) A warning inside Ketcher's Save dialog** while the drawing has images and the chosen format drops them. This means app-owned DOM in Ketcher's own dialog: more code, and it breaks if Ketcher changes the dialog.
     - **(c) Place glassware as PNG**, rasterised in the browser when picked, so CDXML keeps it. Pieces then blur on a zoomed canvas, and autosave grows.
6. **Scale and sharpness.**
   - **Proposed scale: a piece's default size is its size in its source drawing at 100% zoom (1 source px = 1 screen px), so a whole simple distillation is about 400×520 px.** Pieces from other drawings are scaled so their necks and joints match, and the scale chosen is recorded per piece. The student can resize any piece.
   - **Proposed sharpness: each shipped SVG's width and height are 4× its placed size**, so Copy image (2×) and every Export scale are sharp at the default size. An apparatus-sized diagram then exports in about 0.7 s, and its SVG file is about 310 KB.
   - The alternative is 2×: about 0.2 s and 113 KB. Copy image stays sharp, but a 4× Export is soft.
7. **The link guard (test code, not app code).** **Proposed: the guard judges an SVG `<image>` element's source as an image, not a link.**
   - Allowed sources: `data:image/png;base64,…`, `data:image/svg+xml;base64,…`, or the app's own files.
   - Everything else still fails: any other `data:` type, any other host, and any `<a>` with such a link.
   - This is needed for any image on the canvas, including those from Ketcher's own image tool. It doesn't loosen web/csp.json, and it gets negative tests.
8. **No rotation.** Ketcher can't turn an image, so **pieces ship in each orientation a common set-up needs**: in the starter set, only the Liebig condenser comes both slanted and upright. Any other orientation is a new piece.

## Design

- **Sources.**
  - `third_party/glassware/originals/` holds each original file unchanged, about 450 KB in all.
  - `third_party/glassware/pieces.json` lists each piece:
    - id, name and group;
    - its original's file name, page URL, author and licence, and the SHA-256 recorded when it was downloaded;
    - the element ids to keep;
    - an optional rotation;
    - its crop box in source units;
    - its scale (model units per source unit).
- **Generator.** `scripts/build_glassware.py` uses Python's standard library only, so the conda env doesn't change. It:
  - checks each original's SHA-256;
  - keeps the listed elements, with their ancestors' transforms and the definitions they use;
  - drops every `<text>`, metadata block and Inkscape/Sodipodi attribute;
  - applies the rotation and crop box;
  - sets width and height for Indigo's raster (decision 6);
  - writes `web/public/glassware/<id>.svg`, and `web/src/editor/glassware.json` (the menu: id, name, group, file, size in model units, credit).
  - It refuses (rather than strips) a source with `<script>`, `<foreignObject>`, `<image>`, an `on…` attribute, a `style` with `@import` or `url(` other than `url(#id)`, or any href that isn't `#id`.
  - A pytest drift test re-runs it and finds both outputs unchanged.
- **Picking.**
  - templates.ts's pick takes either the KET text or a function that makes it.
  - For glassware, that function fetches `<base>glassware/<id>.svg` (from the precache when offline), encodes it as base64, and returns a KET image node of the piece's size centred on 0,0.
  - placeInHand.ts is unchanged.
  - The hand is shared with templates and Add, so a later pick, Add, Esc and "another tool" behave as they do now.
- **Menu.**
  - TemplatesMenu.tsx gains the two tabs.
  - A glassware picture is `<img src="<base>glassware/<id>.svg" alt="">`, with the piece's name as the button's text.
- **Guards.**
  - The precache guard requires every file in glassware.json.
  - requestPolicy.ts gains `imageSourceProblem()`, and the page guard in fixtures.ts applies it to SVG `<image>` elements only (decision 7).
- **Docs.**
  - THIRD-PARTY-NOTICES.md gets the credits, and CHANGELOG.md and BUILD-LEARNINGS.md the usual entries.
  - AGENTS.md gets its layout lines and a failure-mode line ("Ketcher can't rotate images; Indigo drops SVG text and rasterises images at their own size"), staying within 149 lines.

## Acceptance bar

**A. The pieces**
1. build_glassware.py builds every piece from the committed originals. Each original's SHA-256 matches the one recorded at download. The drift test passes.
2. Every shipped SVG has a viewBox, a width and a height, and is under 120 KB. It contains no `<text>`, `<script>`, `<foreignObject>` or `<image>`, no `on…` attribute, no `@import`, and no href or `url()` that points outside the file. Each rule has a negative test: a doctored original is refused, with its name in the message.
3. Each piece's crop box holds all of its ink and is tight. A browser test renders each piece inside a wider box and finds no ink outside its own box, and ink within 2 source px of each of its 4 edges.
4. Every original in pieces.json is credited in THIRD-PARTY-NOTICES.md (title, author, licence, URL), and no licence other than PD or CC0 appears. Checked by a test.
5. Pieces cut from one drawing keep that drawing's scale: their model-units-per-source-unit is equal. Checked by a test.

**B. Picker** (browser tests, unless marked)
1. The Templates menu has the two tabs. Glassware lists every piece of glassware.json under its group, in order. Each picture has loaded (`naturalWidth > 0`), and each button's name is the piece's name. The note and the credit line show as plain text, with no links. The Structures tab still shows the 12 templates.
2. For every piece: a click puts it in hand, and a click on the canvas places 1 image there at the size in glassware.json, as 1 change. The selection tool is back. One Undo removes it. Esc, or picking another tool, puts it away with nothing added.
3. Picking glassware puts away a template or Add's compound in hand, and the reverse. A piece whose SVG arrives after a later pick is put away. The SVG reply is held, the later pick made, then the reply released, both in Vitest (a deferred loader) and in the browser (a held route).
4. Offline: a browser test places a piece with the network off.
5. Placing a piece requests only `<base>glassware/<id>.svg` (the request guard), and the CSP reports nothing.

**C. What the app makes of it** (browser tests)
1. Glassware alone: the properties panel says "Draw a structure to see its properties".
2. Glassware next to a structure: the formula and InChIKey are those of the structure alone.
3. Glassware sits behind structures: the canvas draws its `<image>` before any atom or bond.
4. A placed piece survives a relaunch (autosave), and a KET save and open (Ketcher's Save and Open dialogs).
5. Export SVG holds one `<image>` per piece, with a PNG of the shipped width and height. Export PNG, and the PNG that Copy image puts on the clipboard, have ink where the piece is.
6. Molfile and SMILES leave glassware out, and CDXML holds Indigo's placeholder (decision 5). These tests fail if a Ketcher upgrade changes any of it. The note is in the tab.

**D. Guards**
1. requestPolicy.test.ts: `imageSourceProblem` allows `data:image/png;base64` and `data:image/svg+xml;base64` and the app's own files. It refuses `data:text/html`, `data:image/svg+xml` without base64, `https://` elsewhere, and `javascript:`. A browser test with an `<a href="data:…">` still trips the link guard.
2. web/csp.json and web/csp-workers.json are unchanged.
3. The precache guard fails when a glassware file is missing from the build or the precache, with a negative test.

**E. Every change:** check.sh passes before each commit. CHANGELOG.md, BUILD-LEARNINGS.md and AGENTS.md's layout lines are updated (invariant 6 is left to the main session), and AGENTS.md stays at 149 lines or fewer. No deploy, push or merge: the main session merges.

**F. Jeff's look:** a contact sheet of every piece, and of a distillation and a reflux built from them, goes to Jeff with the build report. Pieces he rejects are taken out before merge.

## Known limits

- Pieces can't be rotated or flipped (Ketcher). Only the orientations shipped exist.
- Resizing is free, so a piece can be stretched out of shape; Undo puts it back.
- Molfile, SMILES and the other chemistry formats drop glassware, and CDXML shows a placeholder (decision 5).
- In exported images, glassware is a picture (a PNG inside the SVG) at the shipped resolution, so it softens when enlarged far beyond its default size. An export with glassware takes longer (about 0.7 s for an apparatus) and its SVG is larger (about 310 KB).
- Pieces from different source drawings join only approximately, and the student may need to resize one.
- Each piece adds its SVG's size ×4/3 to autosave. A very large diagram can fill the browser's storage, and then the existing "Not autosaved" badge shows.
- Ketcher's own image tool (a student's own PNG or SVG) stays as it is.

## Decided (Jeff, 2026-10-26)

Jeff approved the plan as written, with every proposed answer:
1. Quantockgoblin's public-domain drawings as the base, with the gaps filled from public-domain and CC0 drawings by others.
2. The 23-piece starter set.
3. A Glassware tab in the Templates menu.
4. Plain-text credits in THIRD-PARTY-NOTICES.md, the tab and About.
5. Ketcher's behaviour for other formats, explained in the tab and pinned by tests.
6. Placed at source size, shipped at 4×.
7. The link guard judges canvas images as images.
8. Orientation variants instead of rotation.
