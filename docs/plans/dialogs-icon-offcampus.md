# Plainer Save and Open dialogs, a Kekulé icon, and /draw/ open off campus

Requested by Jeff on 2026-10-25, for CHEM-311 to start using the app as soon as possible:
- **Save and Open.** Ketcher's Save dialog shows the raw text of the file it will write, and its Open dialog shows a chosen file's raw text before loading it. Jeff found both confusing and of no use to students.
- **Icon.** The icon becomes a gold benzene ring drawn as a Kekulé structure: the hexagon with three alternating inner double-bond lines, in place of the inner circle, on black.
- **Off campus.** /draw/ opens to anyone, like /chemtutor, so CHEM-311 students can use and install it at home. Staging stays campus and VPN only.

## Measured before building (Ketcher 3.18)

- **Save dialog.** Its overlay carries `data-testid="save-dialog"`. It has tabs. "Preview" holds the file's text (or the image for SVG/PNG, or "Can not display binary content" for CDX), with a copy button. A "Warnings" tab appears only when the chosen format would lose something, for example a Molfile of a drawing with two reaction arrows.
- **Open dialog.** First it offers two tiles, "Paste from clipboard" and "Open from file". After a file is chosen, it shows the file's text in an editable box, with "Open as New Project" and "Add to Canvas". A ChemDraw file with several structures is shown as pictures to pick from instead; that view stays.

## Acceptance bar

**A. Icon**
1. icon-192, icon-512 and the maskable icon are a #EEB111 hexagon outline on black, with three inner double-bond lines on alternating edges and no circle.
2. The maskable icon keeps the drawing inside the 80% safe zone.
3. brand.test.ts still passes: the icon colours are the CSS tokens.

**B. Save**
1. The Preview tab and everything in it are hidden: the text, the picture and the copy button. The file name, the format, Save, Cancel and "Save to Templates" stay.
2. When the format would lose something, the Warnings tab still shows, and clicking it shows the warnings.
3. Saving still writes the same files. The offline Open/Save smoke test still passes.

**C. Open**
1. The "Paste from clipboard" tile is hidden, and the one tile left is centred. Ctrl+V on the canvas still pastes.
2. After a file is chosen, the text box is hidden. Cancel, "Open as New Project" and "Add to Canvas" are visible.
3. "Open as New Project" replaces the drawing, and "Add to Canvas" adds the file's structure to it. Each has a browser test.

**D. Off campus**
1. The rendered production Apache block has no active `Require ip`; staging's keeps it. Tests cover both.
2. docs/server-setup.md is re-rendered, and the server-config drift test passes.
3. Jeff applies the production block with a script I prepare: back up the vhost, swap the block between its markers, `apache2ctl configtest`, then reload.
4. Then `scripts/deploy.sh --smoke-only production` passes. Jeff opens /draw/ from off campus (a phone on mobile data) to confirm.

**E. Every change:** check.sh passes before each commit, and staging passes its live checks. Production only on Jeff's go-ahead.

## Done (2026-10-25)

- A to C shipped in 3df4f00 and 1ada5e8; D in 25eb814.
- Jeff applied the vhost change (backup osbornelab.conf.bak.20261025_173547). Production was promoted at 2dfc6a8: the full check passed on the production build, then 14 live checks and 85 browser tests passed against /draw/.
- Jeff opened /draw/ on his phone off campus.
