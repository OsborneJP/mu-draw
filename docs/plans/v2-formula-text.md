# Formula text (version 2)

Requested by Jeff on 2026-10-26: "Can we add a 'formula' feature, like in ChemDraw, that will automatically provide subscripts and superscripts as you're typing?" Added with this plan to docs/SPEC.md, "After v1" > "Drawing tools":
- **Formula text:** in Ketcher's Text Editor, a Formula button makes numbers subscripts and charges superscripts as the student types, as ChemDraw's Formula style does (Jeff, 2026-10-26).

Status: **approved by Jeff on 2026-10-26, every proposed answer (in bold) as written** (see "Decided" at the end).

## What a student sees

1. The Text tool opens Ketcher's Text Editor as today. Its formatting toolbar gains one button, "Formula", on a row of its own under the formatting buttons (see "Built"). It starts off (decision 5).
2. With Formula on, the text comes out as a chemical formula while the student types it: H2SO4 shows as H₂SO₄, (NH4)2SO4 as (NH₄)₂SO₄, CuSO4·5H2O as CuSO₄·5H₂O, and Cu2+ as Cu²⁺. While the student types Cu2+, the 2 is a subscript until the + arrives, then it rises: Cu2 could still be Cu₂.
3. Formula covers the whole text box, as a ChemDraw caption set to Formula does (decision 3). Turning it on formats what is already there.
4. While Formula is on, Ketcher's superscript and subscript buttons are greyed out, because Formula decides those. Bold, italic, symbols and font size work as before.
5. Turning Formula off leaves the text as it is, and the two buttons work again. That is how a student makes an isotope (¹³CO₂): type 13CO2, turn Formula off, highlight 13, press superscript (decision 4).
6. Apply puts the text on the canvas as Ketcher's own formatted text. Reopened later, a text box whose formatting is exactly what Formula gives opens with Formula on.
7. Autosave, Save as KET, CDXML and CDX keep the formatting, and ChemDraw shows it. Molfile, SMILES and CML drop all text, as they do today. Export and Copy image show it (decision 6).
8. It works offline and makes no request.

## What ChemDraw does (sources)

- **Formula style:** "Formats in a way that is appropriate for most chemical formulas, that is, numbers are subscripted. You must, however, manually capitalize." ChemDraw 21.0 User Guide (PerkinElmer, 2022), "Setting the Baseline Style", p. 37. The same words are in the ChemDraw 17.0 and 18.1 guides and the ChemDraw 8 help. The guide also says styles can be applied to parts of one caption, and its shortcut list gives Formula as Ctrl+F (p. 69).
- **Superscript and Subscript styles** reduce the text "by about 25 percent" and raise or lower its baseline (p. 37).
- **Multipliers and fragments** (pp. 356–358, from the manual's pictures): fragments are separated "using a space, period (unsuperscripted or unsubscripted), bullet". "An unsuperscripted, unsubscripted integer at the start of a fragment is recognized as a stoichiometric multiplier": the picture shows (CHOO⁻)₃3Na⁺, with the 3 after the bracket subscripted and the leading 3 plain.
- **Charges and isotopes:** "Chemically-significant text must be entirely in formula or, for isotopes and charges, superscript style." The pictures show charges both raised and on the line (NH₃⁺, NH₃+, Fe++). "Charges may have repeat counts as long as both the charge and the repeat count are superscripted" (Fe⁺², Fe²⁺). An isotope is "a super-scripted number before the element symbol" (³⁵Cl, CH₂¹³COOH).
- **File format:** ChemDraw's CDX/CDXML specification (CDXString font styles, in the open-source ChemDraw SDK documentation) gives 0x20 subscript, 0x40 superscript, and 0x60 "formula (style in which subscript or superscript style is selected appropriately depending on the formula label)".
- **Not found anywhere:** whether ChemDraw's Formula style raises a charge by itself (Cu2+ to Cu²⁺). No manual, tip or tutorial says so. The manual's sentence on charges, which asks for Superscript style, suggests it doesn't. No source gives ChemDraw's exact per-character rule; the open-source SDK holds only the file format. Jeff's ChemDraw can settle it (decision 1).
- **Not ChemDraw, for comparison:** Nature Research's style guide for chemical structures asks for a superscript en dash for a negative charge in a text box, since a hyphen is too short.

So the rules below follow ChemDraw for counts and multipliers. They go further for charges, because Jeff asked for superscripts.

## Measured before planning (Ketcher 3.18.0, Indigo 1.46.0, Lexical 0.40.0)

**Ketcher's Text tool** (ketcher-react's Text dialog and ketcher-core, read and run)
- The Text Editor is a Lexical 0.40 editor. Its buttons (bold, italic, superscript, subscript, symbols, font size 4–144 px) format the highlighted text, or the next text typed.
- Apply stores Lexical's own editor state as the text's content: lines of text runs, each with a format bit mask (bold 1, italic 2, subscript 32, superscript 64) and a style (font size).
- In KET (Save, autosave), Ketcher writes KET 2.0 text: a `boundingBox` and `paragraphs` of `parts`, each `{ text, subscript: true }` (or `superscript`, `bold`, `italic`, `font: { size }`). It reads that back, and it also reads the older Draft.js form, converting it to Lexical's.
- The canvas draws a subscript or superscript at half the label subscript size, a quarter of the font size down or a third up (ketcher-core's ReText).

**What Indigo does with it** (indigo-ketcher 1.46.0 run in Node; Indigo's source at its 1.46.0 tag)
- CDXML and CDX keep each run, with face 32 (subscript) or 64 (superscript), which is ChemDraw's own encoding. Indigo reads them back.
- Molfile, SDF, SMILES and CML drop text, as they drop all text today.
- Indigo reads ChemDraw's Formula face (96) as plain text (molecule_cdxml_loader.cpp leaves it as an empty "special case"). A ChemDraw caption in Formula style opens in MU Draw with no subscripts.
- Pictures (Export, Copy image, Ketcher's Save as SVG or PNG): Indigo draws a subscript or superscript at full size, moved half its height down or up (render_context.cpp). The app's own Export showed the same: one glyph size throughout, with each subscript 4 px lower. Given a smaller font size on those runs, Indigo draws them smaller: 10 px on 13 px text gave 77% of the height, and 15 px on 20 px gave 75%.

**Formatting as the student types, without patching Ketcher**
- ketcher-react imports `lexical` as a package, and node_modules holds one copy (0.40.0). App code that imports `lexical` therefore gets the same module as Ketcher's dialog. Lexical's public `getNearestEditorFromDOMNode` finds the dialog's editor from its `[data-testid=text-editor]` element.
- A throwaway browser probe (the built app, Playwright) registered a text-node transform on that editor from page code, with a rough version of the rules, then typed "H2SO4 Cu2+ (NH4)2SO4 CH3CO2-" key by key:
  - The editor showed the subscripts and superscripts as they were typed, with Cu²⁺ rising when the + arrived. The transform ran 62 times for 30 keys and always settled.
  - Typing at the start (Home, then K) kept every character in order, and Ctrl+Z took the K away with the formatting intact.
  - A "Formula" button added to Ketcher's toolbar survived React re-rendering the toolbar on every key.
  - Apply saved exactly those runs. The autosave and `getKet()` hold `{"text":"2","subscript":true}` and `{"text":"2+","superscript":true}` parts, and CDXML holds face 32 and 64 runs.
  - Reopened with a double-click, the Text Editor started with the same runs. After a reload the text came back from autosave with them (Ketcher re-centres the drawing, as for any drawing). The CDXML opened back with them too.
- Ketcher's dialog keeps no copy of the text: Apply reads the editor state. So what the transform sets is what Ketcher saves.
- Ketcher's Save dialog in the app offers SVG Document and PNG Image, as well as KET, Molfile, SDF, RDF, SMARTS, SMILES, CML, InChI, CDXML and CDX.
- The canvas draws a 13 px text's subscripts and superscripts at 6 px: legible, but small at 100% zoom. Ketcher's own subscript button gives the same today.

**Alternatives looked at**
- **An app-made formula box** (type in an app field, then place the text with placeInHand): it works, since the paste tool places text (measured for the templates). But it is a second text editor beside Ketcher's, against SPEC's "keep Ketcher's built-in tools", and a placed formula is later edited in Ketcher's Text Editor, where Formula would not exist.
- **Converting the highlighted text once:** simpler, but not "as you type". Turning Formula on does the same conversion, for the whole box.

## The rules (`formulaScripts(text)`, a pure function)

Each line is read word by word (words are split at spaces). Characters are never changed; only the subscript and superscript formatting is set. Bold, italic and size stay as they are.

1. **Counts:** digits right after a letter, `)` or `]` are subscripts.
2. **Multipliers:** digits at the start of a word, or after `·`, `•` or `.`, stay on the line, as in ChemDraw. So do digits after anything else (a hyphen, comma or `+`).
3. **Charges:** a `+` or minus (`-`, `−` or `–`) at the end of a word, or a run of them (Fe++), is a superscript charge, if the word has a capital letter. A trailing `.`, `,`, `;`, `:`, `!`, `?` or state symbol (`(s)`, `(l)`, `(g)`, `(aq)`) doesn't count as the end. `e-` and `δ+`/`δ−` count too. A `+` or `-` standing alone, as in 2H2 + O2, is not a charge.
4. **Digits just before a charge:**
   - a. After `]`, all of them belong to the charge: [Fe(CN)6]3- gives [Fe(CN)₆]³⁻.
   - b. In a word that is one element-like symbol (a capital and at most one small letter) and one digit, the digit is the charge: Cu2+ gives Cu²⁺, O2- gives O²⁻.
   - c. With two or more digits, the last is the charge and the rest are the count: SO42- gives SO₄²⁻, Hg22+ gives Hg₂²⁺. If the last digit is 0, they are all the count: C60- gives C₆₀⁻.
   - d. Otherwise the one digit is a count and the charge is 1: NH4+ gives NH₄⁺, CH3CO2- gives CH₃CO₂⁻.

**Case table** (formula.test.ts checks every row; the expected values are these typing rules, not chemistry data):

| Typed | Shows | Rule |
|---|---|---|
| H2SO4, C6H12O6, CDCl3, DMSO-d6, Et3N, LiAlH4 | H₂SO₄, C₆H₁₂O₆, CDCl₃, DMSO-d₆, Et₃N, LiAlH₄ | 1 |
| (NH4)2SO4, [Cu(NH3)4]SO4, Ca3(PO4)2 | (NH₄)₂SO₄, [Cu(NH₃)₄]SO₄, Ca₃(PO₄)₂ | 1 |
| CuSO4·5H2O, CuSO4.5H2O, 2H2 + O2 | CuSO₄·5H₂O, CuSO₄.5H₂O, 2H₂ + O₂ | 2 |
| 2-butanol, but-2-ene, 25 °C, 2 mL, cm-1 | unchanged | 2 |
| Na+, Cl-, H+, OH-, NAD+, 2e-, δ+ | Na⁺, Cl⁻, H⁺, OH⁻, NAD⁺, 2e⁻, δ⁺ | 3 |
| cis-, trans- | unchanged | 3 |
| Cu2+(aq), Cl-. | Cu²⁺(aq), Cl⁻. | 3 |
| [Fe(CN)6]3-, [Cu(H2O)6]2+ | [Fe(CN)₆]³⁻, [Cu(H₂O)₆]²⁺ | 4a |
| Cu2+, Fe3+, Al3+, S2- | Cu²⁺, Fe³⁺, Al³⁺, S²⁻ | 4b |
| SO42-, PO43-, Cr2O72-, Fe(CN)64-, Hg22+, B12H122-, C60- | SO₄²⁻, PO₄³⁻, Cr₂O₇²⁻, Fe(CN)₆⁴⁻, Hg₂²⁺, B₁₂H₁₂²⁻, C₆₀⁻ | 4c |
| NH4+, H3O+, MnO4-, CH3CO2-, ArN2+, C5H5- | NH₄⁺, H₃O⁺, MnO₄⁻, CH₃CO₂⁻, ArN₂⁺, C₅H₅⁻ | 4d |

**Wrong on purpose** (in the table too, so that a change is noticed): superoxide O2-, azide N3- and triiodide I3- come out as O²⁻, N³⁻ and I³⁻ (rule 4b); C12H25- comes out as C₁₂H₂⁵⁻ (rule 4c); isotopes (13CO2) stay on the line; Fe+2 and SO4 2- (with a space) get no raised charge, and Na+Cl- (no space) raises only the last one; carbon numbers (C2, C1–C4) and names like SN2 get subscripts, as in ChemDraw's Formula style. In each case the student turns Formula off and fixes it with Ketcher's buttons.

## Decisions (proposed answers in bold; Jeff chose all of them)

1. **Charges.** No source says whether ChemDraw's Formula style raises charges. **Proposed: Formula raises charges too, by rules 3 and 4**, since Jeff asked for superscripts. The alternative is ChemDraw's documented behaviour: counts subscripted, charges by hand. If Jeff types these in his ChemDraw with Formula style, his results settle it: where counts or multipliers differ, the rules follow ChemDraw, and the charges show whether ChemDraw raises them. H2SO4, (NH4)2SO4, CuSO4·5H2O, CuSO4.5H2O, 2H2O, Cu2+, Fe3+, NH4+, SO42-, CH3CO2-, [Fe(CN)6]3-, Hg22+, 13CO2, Fe+2, 2-butanol.
2. **Where.** **Proposed: a Formula button in Ketcher's Text Editor toolbar.** Alternatives: (b) an app formula box placed with placeInHand; (c) a one-time "format the highlighted text as a formula" button.
3. **How much of the text.** **Proposed: the whole text box**, as a ChemDraw caption set to Formula. The alternative is only the text typed while Formula is on.
4. **Turning Formula off.** **Proposed: the text stays as it is**, and the subscript and superscript buttons work again. The alternative is that the text goes back to plain.
5. **New text boxes.** **Proposed: Formula starts off.** A box whose formatting is exactly Formula's, with at least one subscript or superscript, reopens with it on. The alternative is to remember the last choice while the app is open.
6. **Pictures.** Indigo draws subscripts and superscripts at full size, half a line off. **Proposed: every picture (Export, Copy image, Ketcher's Save as SVG or PNG) is drawn from a copy of the drawing whose subscript and superscript runs are 75% of their size, ChemDraw's "about 25 percent" smaller.** The saved drawing is unchanged. The alternative is to keep Indigo's look, as a known limit.
7. **Minus signs.** **Proposed: characters stay as typed**, so a typed hyphen stays a (raised) hyphen. The alternative turns it into a minus sign (−), which changes the student's text.
8. **Shortcut.** **Proposed: none**, so Ctrl+F stays the browser's Find (ChemDraw uses Ctrl+F for Formula).
9. **The note under the toolbar** ("Highlight the text first: …", being added on main now). **Proposed: once it is on main, add "Formula formats all of the text as you type."** The alternative is to leave the note as it is and explain Formula in the button's tooltip.
10. **Lexical's version.** The app will import `lexical` itself. **Proposed: add lexical 0.40.0 to package.json, exact, and to the pin test**, so the app and Ketcher's dialog always share one copy. Invariant 5's list gains it.

## Design

- `web/src/editor/formula.ts`: `formulaScripts(text)` returns, per character, subscript, superscript or neither. It is a pure function, unit-tested on the case table.
- `web/src/editor/formulaText.ts`: notices Ketcher's Text Editor opening (a MutationObserver on the document), finds its Lexical editor, and puts the Formula button in its toolbar. While Formula is on, a text-node transform sets each run's subscript and superscript bits from `formulaScripts` of its line. Transforms run inside Lexical's own update, synchronously, so there is no timer to race.
- Undo and Redo restore an earlier state without running transforms. An update listener re-applies Formula after them, merged into the same history step. A test types, undoes, redoes and checks the formatting after each.
- Decision 6: a pure function shrinks the subscript and superscript runs in a copy of the KET. It runs in the image provider (src/editor/imageQueue.ts already wraps `generateImageAsBase64`), so every picture gets it.
- `editor.css`: the greyed buttons, keyed on an attribute the app sets on the toolbar. The note's sentence (decision 9) is one line.

## Acceptance bar

**A. The rules** (Vitest)
1. Every row of the case table, including "wrong on purpose", gives exactly the formatting shown.
2. Characters never change: the output has one entry per input character, and only subscript and superscript are set.
3. Formatting an already formatted text changes nothing, so the transform settles.

**B. The Text Editor** (Playwright, typing key by key)
1. The Formula button is in the toolbar, off (`aria-pressed="false"`), and Ketcher's buttons are enabled.
2. With Formula on, typing "H2SO4 Cu2+ (NH4)2SO4 [Fe(CN)6]3-" shows the table's formatting in the editor. After Apply, the saved KET's parts are exactly the expected runs.
3. Typing in the middle, deleting, pasting, a second line, Undo and Redo: after each, the formatting equals `formulaScripts` of the text.
4. Turning Formula on formats the text already there. Turning it off leaves it, and the subscript and superscript buttons are greyed only while it is on.
5. Bold, italic and font size survive Formula.
6. A Formula text reopens with Formula on; a plain or hand-formatted one reopens with it off. Cancel changes nothing.
7. With Formula off, the Text Editor works as before (the existing dialog test still passes).

**C. What the app makes of it** (Playwright)
1. A Formula text survives a relaunch (autosave), and a KET save and open through Ketcher's dialogs, with the same parts.
2. CDXML saved through Ketcher's dialog has face 32 and 64 runs; opening that file gives the same formatting.
3. Decision 6: Export, Copy image and Ketcher's Save as SVG and PNG each hand Indigo the shrunk copy (a browser test records what reaches the image provider). In Export SVG, a subscript glyph is 75% (±3%) of the height of the same glyph on the line. The saved KET gains no font sizes.
4. A Formula text next to a structure leaves the properties panel as for the structure alone.
5. Offline: Formula works with the network off.

**D. Guards**
1. The request guard and CSP pass, with web/csp.json unchanged and no new file fetched.
2. The pin test covers lexical, with a negative test: a different version fails.

**E. Every change:** check.sh passes before each commit. CHANGELOG.md, BUILD-LEARNINGS.md and AGENTS.md are updated, and AGENTS.md stays at 149 lines or fewer. No deploy, push or merge; the main session merges.

**F. Review:** a capped review of the diff, with a skeptic checking each finding. Every high or medium is fixed with a test that fails without the fix; lows go under "Known limits".

## Known limits

- The rules guess at what a student means. The "wrong on purpose" cases above need Formula off and Ketcher's buttons.
- A ChemDraw caption in Formula style opens as plain text (Indigo). Captions with explicit subscripts open correctly.
- The canvas draws subscripts and superscripts at half size (Ketcher), smaller than pictures (decision 6).
- Formula's on or off is not saved. It is read back from the formatting when a text is reopened.
- In a Formula box, a capitalised word ending in a hyphen (N- and O-alkylation) gets a raised minus.
- A charge followed by a closing bracket, a slash or a quote is not raised, and its digit becomes a count: [Cu2+] gives [Cu₂+], Cu2+/Cu gives Cu₂+/Cu, and Ksp = [Ca2+][F-]2 gives [Ca₂+][F-]₂ (found in review; for Jeff, see "Built").
- Turning Formula on has no Undo step of its own: hand formatting that it replaces (a superscript isotope) can't be brought back with Undo.
- Pictures use whole pixels, so 75% is exact only at some sizes: 13 px gives 10 px (77%), 6 px gives 5 px (83%).
- While Formula is on, the greyed subscript and superscript buttons show no tooltip or "not allowed" cursor (a click passes through them to the toolbar, which keeps the focus in the text).
- The Formula row makes the Text Editor 36 px taller; in a window under about 490 px tall, Ketcher's dialog body scrolls.
- Typing through an input method (composition) is not tested in a browser; the composed run is formatted once it is committed.
- Each change reformats its whole line, so a long pasted paragraph full of formulas is slow: about 0.7 s per change at 3,000 characters (measured headless). Captions are short.

## Decided (Jeff, 2026-10-26)

Jeff approved the plan as written, with every proposed answer:
1. Formula raises charges too, by rules 3 and 4.
2. A Formula button in Ketcher's Text Editor toolbar.
3. Formula covers the whole text box.
4. Turning Formula off leaves the text as it is.
5. Formula starts off; a box formatted exactly as Formula would format it reopens with it on.
6. Every picture is drawn from a copy with subscripts and superscripts at 75% of their size.
7. Characters stay as typed.
8. No shortcut.
9. The note under the toolbar gains "Formula formats all of the text as you type."
10. lexical 0.40.0 is pinned exactly and covered by the pin test.

## Built (2026-10-26, on branch claude/v2-formula-text)

- Changed while building: the Formula button sits on a row of its own inside Ketcher's toolbar, under the formatting buttons. Beside them there was no room in the 340 px dialog: it squeezed Ketcher's buttons from 28 px to about 16 px and clipped the bold icon (review finding).
- Found in review and fixed, each with a browser test that failed without the fix: a click on a greyed subscript or superscript button took the focus out of the text, so the next keys went nowhere and Enter applied the dialog.
- For Jeff to decide (not built, not in the approved rules): whether a charge before a closing bracket, slash or quote should be raised, for concentrations and redox couples ([Cu2+], Cu2+/Cu). Proposed: yes, by treating `)`, `]`, `/` and quotes after a charge like the trailing punctuation of rule 3.
