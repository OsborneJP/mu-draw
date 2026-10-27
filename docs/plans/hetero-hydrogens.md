# Hydrogens on heteroatoms only, by default

Requested by Jeff on 2026-10-27: "let's change the default format mode for drawing to include showing hydrogens on hetero atoms (but not on terminal carbons)".

How I read it: Ketcher's Settings dialog has "Show hydrogen labels". Its default, "Terminal and Hetero", labels both heteroatoms (OH, NH) and terminal carbons (CH3). Its "Hetero" option labels heteroatoms with their hydrogens and draws terminal carbons as plain line ends. This plan makes "Hetero" what a student starts with, alongside the ACS style (docs/plans/acs-style-default.md). Ketcher's ACS preset doesn't touch this setting.

## Measured before building (Ketcher 3.18.0, a throwaway probe on the built app)
- **On the canvas with "Hetero":**
  - (R)-2-butanol shows only "OH".
  - Paracetamol shows "O", "NH" and "OH"; its CH3 is a line end.
  - Ethane shows no labels at all.
- **Pictures:** Ketcher passes the setting to Indigo (`render-label-mode` "hetero"), so Export, Copy image and Practice's Show answer draw the same labels as the canvas. For paracetamol, Indigo's SVG has 5 label glyphs with "Hetero" and 8 with Ketcher's default.
- **One quirk of Ketcher's "Hetero":** a carbon that Ketcher labels anyway shows no hydrogens on the canvas. Indigo's pictures keep them.

  | Carbon | Canvas | Pictures |
  |---|---|---|
  | A lone carbon (methane) | "C" | "CH4" |
  | A charged terminal carbon (ethyl cation's CH2+) | "C+" | with its hydrogens |
- **Storage:** both of Ketcher's settings readers accept "Hetero" (ketcher-core's schema and ketcher-react's form list the same spelling). So written before Ketcher loads, it is drawn from the start, with no redraw.

## Decisions (following the ACS plan's approved answers)
1. **Existing students:** switched once, at their first start of this version, as ACS was. Every browser has Ketcher's default stored (Ketcher writes all its settings back), so "only where nothing is stored" would reach nobody.
2. **A student's own choice after that:** kept across reloads. The switch is applied once per browser, with its own record, so browsers that already have ACS still get it.

## Acceptance bar
**A. A new browser**
1. Ketcher starts with hydrogen labels "Hetero" and the ACS settings as before. The first canvas is drawn with "Hetero", and there is nothing to undo on the empty canvas.
2. Ketcher's own ACS button still changes only image resolution.

**B. An existing browser**
1. **A browser that has ACS already** (what production leaves now):
   - Set up: Ketcher's default hydrogen labels stored, one other setting the student changed, and a saved drawing.
   - At the next start, hydrogen labels are "Hetero" and the student's other setting stays.
   - The drawing comes back unchanged, and Undo can't remove it.
2. **A browser from before ACS:** both are applied, once each.
3. **Applied once:** a student who picks another hydrogen label setting in Settings still has it after a reload.

**C. What the student sees**
1. **On the canvas:** paracetamol shows no carbon label. Each heteroatom that has hydrogens shows an H, counted from Ketcher's own structure.
2. **In Export:** the SVG has exactly as many label glyphs as the canvas has label characters. It fails if Indigo were asked for Ketcher's default labels.

**D. The start-up step on its own (Vitest)**
- The one-time step is generic: it takes a record name and the settings to merge.
- The ACS cases stay as they are.
- The start-up module writes ACS and "Hetero" into a new browser, and only "Hetero" into a browser that has ACS already.

**E. Everything else unchanged.** check.sh passes. An existing test that assumed terminal carbon labels is changed only for that reason, and the commit names it.

## Accepted limits
- The quirk above: on the canvas, a lone carbon shows "C" (methane) and a charged terminal carbon shows "C+" or "C–" without its hydrogens. Pictures show the hydrogens. This is Ketcher's own "Hetero" rendering, and the app can't change it without patching Ketcher.
- Ketcher's Reset (in Settings) goes back to Ketcher's own default, "Terminal and Hetero", as it does for ACS.
