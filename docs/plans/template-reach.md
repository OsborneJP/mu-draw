# Templates reach an atom or bond from further away

Requested by Jeff on 2026-10-27: "When dropping a structure template onto an existing structure, the cursor needs to be directly on top of the target atom or bond before the green highlight appears indicating that bond formation will occur. In ChemDraw, the cursor doesn't have to be so close to the target atom, so can we make the requirement looser?"

## Measured (Ketcher 3.18.0, the built app, ACS size, 100% zoom: a bond is 19 px)
- The rings under the canvas and Ketcher's Structure Library use Ketcher's template tool. It highlights an atom or bond (the teal-green highlight), and a moment later shows the template joined there. A click joins it.
- **How close the cursor must be:**
  - An atom: within 0.4 bond lengths, 7 px, in any direction.
  - A bond: within about 6 px of the middle of its line. Ketcher takes a bond only inside the box of its drawn line, in screen pixels.
  - Along a bond, the end fifth or so is the atom's and the rest is the bond's.
- Ketcher's highlight, its preview of the joined template and the click all ask the editor's `findItem`. So one change there moves all three together.
- The app's own Templates menu uses Ketcher's paste tool, which never joins a template to an atom. It isn't affected.

## What changes
While Ketcher's template tool is in use, if Ketcher finds nothing under the cursor, the app looks further. It takes the nearest atom or bond within **12 px** on screen, a 24 px target (WCAG 2.2's minimum target size).
- "Nearest" is as Ketcher ranks: an atom by its distance, a bond by the distance to its middle. So a bond's middle half is the bond's and its ends are its atoms'.
- A bond counts only beside it, not beyond its ends.
- Like Ketcher's own search, it never finds the template's own preview, or an atom inside a contracted abbreviation ("Ph", "CO2Et"). It also skips a bond into one: the label sits on the abbreviation's hidden attachment atom, so that bond, measured to the atom, would reach over the label.
- It looks only for what the tool joins a template to: atoms and bonds with a ring in hand, atoms alone with a functional group or a salt. (Ketcher's preview asks for bonds even then.)
- Where Ketcher finds something itself, its answer stands. Zoomed in far enough that a bond is over 30 px on screen, Ketcher's own reach is the larger.
- Other tools keep Ketcher's own reach.

12 px is one number (`REACH_PX` in web/src/editor/templateReach.ts), easy to change after Jeff has tried it.

## Acceptance bar
**A. In the browser** ((R)-2-butanol at ACS size, 100% zoom, Ketcher's benzene in hand)
1. 10 px beyond a terminal atom, the atom is highlighted, and 10 px beside its bond's middle, the bond is. 16 px away, nothing is. Ketcher alone highlights nothing at 10 px.
2. A click 10 px from the atom, or from the bond, joins the benzene to the molecule: one molecule, with more atoms. After Undo, a click 16 px away places a separate benzene: two molecules.
3. The select tool still highlights nothing 10 px from an atom, and still highlights it 4 px away.

**B. The rule on its own (Vitest)**
- Reach is inclusive at 12 px and nothing beyond, in screen pixels at zoom 1 and zoom 2.
- Along a bond, the ends are the atoms' and the middle half is the bond's.
- A bond is never in reach beyond its ends. A bond of no length is passed over. Of two atoms, the nearer wins.
- The editor's search:
  - Ketcher's own answer stands, asked with the same arguments.
  - Other tools, or a search that skips an item, get Ketcher's answer alone.
  - Only the kinds asked for are searched.
  - The preview, atoms inside contracted abbreviations and bonds into them are never found.
  - With a functional group in hand, bonds are never found.
  - Distances come back in bond lengths, Ketcher's unit.

**C.** check.sh passes.
- A1 and A2 fail on a build without the change.
- A3 fails on a build where the wider reach applies to every tool.

## Found in review (2026-10-27; fixed, each with a test)
- **Medium:** a bond into a contracted abbreviation reached over the abbreviation's label. With benzene in hand over "Ph", the bond was highlighted and a click fused the ring onto a bond hidden inside the label. Bonds into an abbreviation are now skipped. Ketcher's own reach still finds the bond's drawn line.
- **Low:** with a functional group in hand, Ketcher's preview asks for bonds, which that tool never joins to. Its preview then hid in a 12 px band beside every bond. Only what the tool joins is searched now.
- **Low:** no test covered zoom. There is now a unit test at zoom 2.

## Accepted limits
- Ketcher clears its hover highlight on a page-wide mousemove only when its search finds nothing. Leaving the canvas onto a toolbar button within 12 px of an atom at the canvas edge keeps the atom highlighted, and Ketcher's keys (Delete, element letters) act on it. Stock Ketcher does the same within its 7 px.
- The bond, chain and atom tools keep Ketcher's 7 px reach. The same change could cover them if wanted.
- Ketcher's own 300 ms delay before it shows the joined preview stays as it is.
