# Click-to-place Add, pinned toolbar tools, MU Draw name and colours

Requested by Jeff on 2026-10-25:
- **Add placement:** Name to structure's Add put the compound at the top left, off screen. The compound should follow the mouse until a click places it.
- **Left toolbar:** hand, select and eraser should stay visible while the tools below them scroll.
- **Name and colours:** the app is called "MU Draw", and black with gold accents replaces the blue.

This changes one point of docs/SPEC.md section 6: "Added fragments must not overlap existing ones". The student now chooses the spot, so overlap is their choice. One Undo still removes the whole addition.

## Measured before building (Ketcher 3.18, throwaway probes)

- **Paste tool.** Ketcher's own "Add to canvas" uses its paste tool: `editor.tool('paste', struct)`.
  - The structure is shown at the mouse and follows it, with no change event.
  - A click places it centred on the click point (centre 15.19, 9.07 against the click's 15.17, 9.09 in model units), as one change and one Undo. The tool then returns to select.
  - Esc cancels: the drawing is unchanged.
  - The structure is built with `prepareStructToRender`, the parser `addFragment` uses, so stereo and the chiral-flag setting are handled the same way.
- **Left toolbar.** `[data-testid=left-toolbar-buttons]` is a column with `overflow-y: hidden`. Its first child holds exactly hand, select and eraser. When the window is too short, Ketcher adds an arrow button that scrolls the whole column.

## Acceptance bar

**A. Add by click**
1. When the server answers for Add (the button, or Enter on a drawing):
   - The drawing is unchanged and the compound is in hand: it follows the mouse over the canvas. Nothing shows until the mouse is over the canvas, so Export, Copy image and autosave never see an unplaced compound while the student is elsewhere.
   - The panel is in state `placing` and says "Click on the canvas to place it. Esc cancels."
   - Get name stays greyed.
2. A click places it centred on the click: the new fragment's centre is within 0.5 bond length of the click's model point (`render.page2obj`).
   - It is exactly one change, and one Undo removes it.
   - The panel then shows `drawn`, and the round trip runs on what was placed.
   - The selection tool is back afterwards, on Ketcher's toolbar too. (Measured: Ketcher's paste tool switches the editor to select directly, and the toolbar went on showing the bond tool chosen before Add.)
3. Esc (wherever the focus is), picking another tool, or closing the panel cancels.
   - Nothing is added, no change event fires, and no round-trip request is sent.
   - The panel closes. The toolbar shows the selection tool, or the tool picked.
4. A change to the drawing while the compound is in hand (for example Ctrl+Z) cancels the placement and closes the panel. This is the existing rule that answers are about the drawing as it was asked.
5. Replace is unchanged.
6. Tests:
   - The naming state machine (Vitest) forces each ordering with a stub placer: placed, cancelled, changed while placing, closed while placing.
   - Browser tests click real points and wait on events and the panel's `data-state`, never on timers.

**B. Pinned tools**
1. At a window height where the left toolbar overflows (1280×600), scrolling the tools (mouse wheel, and Ketcher's arrow buttons, down and back up) moves the lower tools. Hand, select and eraser stay where they were (within 1 px), and nothing scrolled shows through around them.
   - Why 1 px: Ketcher shows its up arrow only while the first group is not wholly in view (an IntersectionObserver at threshold 1). Pinned at `top: -1px`, 1 px of it is hidden once the column has scrolled, so the up arrow still appears; at `top: 0` it never would.
2. Where everything fits, nothing changes.
3. The hidden-UI tests, compact toolbar included, still pass.
4. Positive control: the column really scrolled, so its `scrollTop` is above 0 and a lower tool moved.

**C. Name and colours**
1. **Name.** The app is "MU Draw" ("MU Draw (staging)" on staging) everywhere it is named: manifest `name` and `short_name`, page title, header, About box. verify-dist already checks the manifest and the title for each target.
2. **Colours.** They are tokens in one place (`--mu-black` #000 and `--mu-gold` #f0b323 in web/src/index.css; a stand-in gold until there is an official brand value).
   - The header is black with a gold rule and gold "MU".
   - Buttons that were blue are black, with gold focus and hover states.
   - NMR sticks are black. `theme_color` is black.
   - Icons are a gold hexagon on black.
3. **What stays the same.** The canvas highlight colours stay: light blue marks defined stereocentres and gold marks undefined ones, so changing the blue would make the two look the same. The stereocentre count button's pressed colour keeps matching the canvas highlight.
4. **Guard.** A test (web/src/brand.test.ts) fails if the old blue or the old name appears in web source again, or if the pressed stereocentre button stops matching DEFINED_COLOR.

**D. Every change:** check.sh passes before each commit, and `scripts/deploy.sh staging` passes the live checks at the end. Production is promoted only on Jeff's say-so.
