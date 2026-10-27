# "Structure Library" spelled out on its button

Requested by Jeff on 2026-10-27: "Can we make the SL icon say structure library in readable font so users know what it is?"

## Measured (Ketcher 3.18.0, the built app)
- The last button in Ketcher's bottom toolbar, after its eight ring templates, opens the Structure Library (test id `template-lib`).
- Its icon is a 22 px SVG: three small boxes under the letters "SL", drawn a few pixels high. Its only words are the tooltip, "Structure Library (Shift+T)".
- **Room on the right of the button:**

  | Window width | Bottom toolbar width | Buttons end at |
  |---|---|---|
  | 1280 px | 971 px | 326 px |
  | 1024 px | 715 px | 326 px |
  | 800 px | 491 px | 326 px |
  | 600 px | 291 px | 326 px |

  So a one-line label about 120 px long fits at 800 px and wider. At 600 px the buttons already run past the canvas into the properties panel.

## What changes
The button shows the words "Structure Library" in the app's font (13 px, semibold) in place of the SL icon, and widens to fit them. This is CSS on Ketcher's button (web/src/editor/editor.css), so Ketcher's own behaviour stays: the click, Shift+T, the tooltip, and the highlight while its dialog is open.

## Acceptance bar
1. At 1024 × 700 and 1280 × 800, the visible Structure Library button reads "Structure Library" at 12 px or larger.
   - The whole label fits inside the button: nothing is clipped.
   - The button sits inside the bottom toolbar's box and on screen.
   - The SL icon is not shown.
   - The button's accessible name is "Structure Library".
2. Clicking it still opens Ketcher's Structure Library.
3. check.sh passes.

## Accepted limits
- Below about 800 px wide, the bottom toolbar ran past the canvas already. The label makes that overflow about 90 px longer. The app is built for laptop and desktop widths.
- Ketcher's other letter icons stay as they are: "PT" (periodic table) and "ET" (extended table) in the right-hand toolbar. They could get the same treatment if wanted.
