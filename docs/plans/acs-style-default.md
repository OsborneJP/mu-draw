# ACS drawing style by default

Requested by Jeff on 2026-10-26: "regarding default settings for the molecule structure format, let's have ACS settings be default".

**Approved by Jeff on 2026-10-26, with the proposed answer to all six decisions.**

How I read it: Ketcher's Settings dialog has a "Set ACS Settings" button. It switches the drawing style to ACS Document 1996, the style ChemDraw users pick for journals and reports. This plan makes that style what a student starts with, without opening Settings. It is not about file formats. If you meant something else, say so and nothing gets built.

## Measured before building (Ketcher 3.18.0, throwaway probes on the built app)

**What "Set ACS Settings" changes** (ketcher-core's own `PRESETS.acs`)

| Setting | Ketcher default | ACS | On screen at 100% zoom |
|---|---|---|---|
| Bond length | 40 px | 14.4 pt (0.2 in) | 19 px |
| Line width | 2 px | 0.6 pt | 1 px |
| Wedge width | 6 px | 2 pt | 3 px |
| Hash spacing | 1.2 px | 2.5 pt | 3.3 px |
| Double-bond spacing | 15% | 18% of bond length | |
| Atom labels | 13 px Arial | 10 pt Arial | 13 px (unchanged) |
| Margin around reaction parts | 20 px | 1.6 pt | |
| Atom colours | on | off (all atoms black) | |
| Image resolution | 72 dpi | 600 dpi | only for images Indigo makes |

So on screen, molecules are about half today's size, with thinner lines and black heteroatoms, as in ChemDraw's ACS 1996 at 100%. Labels stay the same size.

**How Ketcher keeps settings**
- There is one browser-storage entry, `ketcher-opts`, for the whole site. Ketcher has two readers for it.
  - ketcher-react reads it as soon as its code loads.
  - ketcher-core's settings service reads it when Ketcher starts, and writes its full settings back each time.
- Ketcher has no option an app can use to set defaults. Its Reset button goes back to Ketcher's own defaults.
- Every student who has opened the app already has `ketcher-opts` (Ketcher's defaults). So "use ACS only when nothing is stored" would leave them all out.
- Writing ACS into `ketcher-opts` before Ketcher's code loads works. Ketcher's first canvas is drawn in ACS, and it is drawn only once.
- Two traps:
  - **Image resolution.** The two readers store it differently (text against a number). If 600 is stored, one reader drops it. Ketcher then redraws the canvas once at start, and that redraw leaves an Undo step on a fresh, empty canvas. With 72, Ketcher's default, there is no redraw and nothing to undo.
  - **Partial settings.** A partial set that ketcher-core finds inconsistent is silently thrown away, and every setting goes back to its default. Ketcher's whole ACS set passes.

**Pictures**
- Export and Copy image use Indigo's SVG of the drawing with the student's settings (web/src/panels/exportImage.ts). Practice's Show answer does the same.
- The stereoisomer and NMR pictures come from RDKit, so they don't change.
- At ACS's 600 dpi, caffeine's SVG is 705 × 521 px. Word places it 7.3 in wide, 6.25 × ACS size.
- Asked at 96 dpi (CSS pixels, which the app's export already assumes), it is 116 × 87 px. That is 1.2 in wide in Word: ACS print size. Today's default is 215 × 167 px (2.2 in).

## What a student sees
- A new student starts in the ACS style. On an existing browser, the next start of the app switches it to ACS once. The drawing and the student's other settings stay.
- Molecules on the canvas are about half today's size. Ketcher's zoom (top right) makes them bigger.
- Exported and copied images come out at ACS print size. 2x and 4x are sharper, not bigger, as now.
- Ketcher's Settings dialog shows the ACS values, with image resolution 72 (decision 6).

## Decisions for Jeff (proposed answers in bold)
1. **Where:** **on screen and in exported and copied images.** The alternative is exports only, with the canvas unchanged.
2. **Existing students:** **switched to ACS once, on their first start of this version.** The alternative is ACS only for browsers that have never used the app.
3. **A student's own changes in Settings:** **kept across reloads** (ACS is applied once per browser). The alternative is back to ACS at every start.
4. **Atom colours:** **off (all atoms black), as ACS has it.** A student can turn "Atom Coloring" back on in Settings. The alternative is ACS with coloured atoms.
5. **Size on screen:** **true ACS size at 100% zoom (bonds 19 px).** The alternative is starting at 200% zoom, so molecules are about today's size. Labels would then be twice today's size, and that is one more start-up rule.
6. **Image resolution:** **stays at 72 dpi, not ACS's 600,** because of the trap above. The app's own pictures don't use this setting (bar C).

## Acceptance bar
**A. A new browser**
1. With nothing stored, Ketcher's settings at start are exactly what its own "Set ACS Settings" gives, except image resolution. The canvas is drawn with them from the start.
   - Test: in a fresh profile, Ketcher's own ACS preset is applied after start. It changes only image resolution (72 to 600).
2. The start is as clean as today: no redraw, and nothing to undo on an empty canvas.
   - Test: Ketcher's undo count is 0 when the editor is ready. It fails if ACS is written after Ketcher's code loads, or with image resolution 600.

**B. An existing browser**
Set up with Ketcher's defaults stored as the live version leaves them, a saved drawing, and one non-ACS setting the student changed.
1. On the first start of this version, ACS is applied and the student's other setting is kept. The drawing comes back unchanged (same InChIKey, same relative positions), and Undo can't remove it.
2. ACS is applied only once. A setting the student changes after that is still there after a reload.

**C. Pictures the app makes**
1. A bond is 0.2 in in Export (SVG, and PNG at 1x, 2x and 4x) and in Copy image.
   - That is 19.2 ± 0.5 CSS px in the SVG, which is ACS's 14.4 pt. The PNGs stay exact multiples, tagged 96 × scale dpi, so Word places them at ACS size.
   - Test: the longest bond line in caffeine's exported SVG. It fails at Ketcher's 600 dpi (120 px).
2. Practice's Show answer picture is drawn the same way, and has the same test.

**D. The start-up step on its own** (Vitest, deterministic)
- Cases: nothing stored, Ketcher's defaults stored, unreadable text stored, already applied (no change), and storage that throws (no error, and the app starts).
- The ACS values are Ketcher's own `PRESETS.acs` minus image resolution, so they can't drift from Ketcher's button. Test: equal to it.

**E. Everything else unchanged**
- check.sh passes before every commit.
- An existing smoke test that assumed Ketcher's default sizes or colours is changed only for that reason, and its commit names it.

## How (small commits on branch claude/acs-default)
1. A new module, web/src/editor/acsStyle.ts.
   - It takes the values from ketcher-core's `PRESETS.acs`, merges them over what `ketcher-opts` holds, and records that it has done so. The record is per site, like Ketcher's own entry.
   - It is imported first in main.tsx, so it runs before ketcher-react's code loads. A2 fails if a bundler ever changes that order.
2. exportImage.ts asks Indigo for 96 dpi for the app's pictures, and Practice's Show answer uses the same call.
3. Tests for each bar item. CHANGELOG and BUILD-LEARNINGS (the two readers, the image-resolution trap, the silent reset, the 600 dpi sizes). One line in AGENTS.md's layout, which stays at 149 lines or fewer.

## Accepted limits
- Found while building: at 100% zoom, a bond is harder to click.
  - Ketcher takes a click for a bond only on its drawn line, a box in screen pixels, and only while the click is nearer the bond's middle than an atom. Labels stay 13 px, so on a 19 px bond to a labelled atom (C–OH, say) the band that picks the bond is a few pixels long. Before, it was about 20 px. A click outside it draws a new bond instead.
  - Ketcher's zoom (top right) widens it. Practice's wedge-tool test now clicks the drawn line, as a student aims, instead of the bond's middle, which now sits at the label's edge.
- Ketcher's Reset (in Settings) goes back to Ketcher's own defaults, not ACS. "Set ACS Settings" brings ACS back, with image resolution 600. From then on, Ketcher redraws once at each start, so a fresh empty canvas has one Undo step that does nothing.
- Ketcher's settings are one per site. /draw/ and /draw-staging/ share them, as does any other Ketcher on that host. ACS is applied once per browser for both.
- Pictures from Ketcher's own Save dialog ("SVG Document") use Ketcher's image resolution (72 dpi), so they are smaller than ACS size in Word. Export and Copy image are the app's way to get pictures.
- With browser storage switched off, Ketcher starts with its own defaults. Autosave can't work there either.
