# Changelog

All notable changes to this project. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow SemVer.

## [Unreleased]

### Added
- Project skeleton: app.config.json (name and URL path in one place), conda env, and
  `scripts/check.sh` as the single gate before every commit and deploy.
- Naming API skeleton (FastAPI) with `GET /api/health`; no request bodies are logged.
- AGENTS.md (CLAUDE.md symlink) with the project invariants and common AI failure modes.
- Installable PWA (prompt-mode service worker that precaches the whole app, placeholder icons).
- Content Security Policy: the browser may only contact the app's own origin.
- Ketcher's Alt+Shift+R debug shortcut (which put the drawing in the page URL) is disabled.
- RDKit.js 2026.9.1 WebAssembly shipped and precached, ready for the properties panel.
- Ketcher structure editor (standalone, Indigo in the browser). Help, About, the 3D viewer,
  structure-from-image and the macromolecules mode are hidden for v1.
- Deploy tooling: `scripts/deploy.sh` publishes the checked build to staging and promotes
  to production only the commit that passed the live staging checks. Apache and systemd
  setup is rendered into docs/server-setup.md for a person to apply.
- Staging is live at /draw-staging/ (campus and VPN only) and passes the live checks.
- The staging app installs as "Structure Editor (staging)", so it can't be mistaken for
  production.
- A header bar with the app's name. An "Offline" badge shows in it while the device has
  no network.
- An About box (in the header) shows the version number, so students can say which build
  they have. Plain text, no links; Ketcher's own About stays hidden.
- Autosave: the drawing is kept in this browser (never uploaded) as it changes and comes
  back after a refresh or relaunch, online or offline. Undo can't remove the restored
  drawing. If the browser refuses to store it (too large), the header says "Not autosaved".
- Update banner: when a new version has been downloaded, "An update is ready. Reload to
  use it." appears with a Reload button. The app never reloads by itself, and Reload in
  one tab doesn't reload the others.
- Production (/draw/) opens on the campus network and VPN only, for now, like staging.
- Export (in the header): download the drawing as a PNG at 1x, 2x or 4x, on white or with a
  transparent background, or as an SVG. Made on this device, offline too. PNGs record their
  resolution, so Word places 1x, 2x and 4x at the same size; higher scales are sharper.
- Copy image (in the header): one click puts a picture of the whole drawing (PNG, 2x, white
  background) on the clipboard, ready to paste into Word or Google Docs. "Image copied"
  shows until the drawing changes.
- Properties panel (right of the canvas): molecular formula, average MW, exact mass,
  degree of unsaturation, H-bond donors and acceptors (Lipinski's NH + OH and N + O),
  rotatable bonds, TPSA and Crippen logP, with a Lipinski rule-of-5 card. Worked out on
  this device by RDKit as the drawing changes, offline too; nothing about the drawing
  leaves the device. Several structures get values for the whole drawing; a reaction, an
  empty canvas, R-groups or query atoms, and an impossible valence get a message instead.
- Stereochemistry in the properties panel: stereocenters and stereogenic double bonds
  (every potential one, defined or not), how many are undefined (flagged), and at most
  2ⁿ stereoisomers, with a note that meso forms can make fewer. Clicking a count
  highlights them on the canvas (undefined ones in amber); clicking again, or any change
  to the drawing, removes the highlight. It is not an edit: Undo and autosave ignore it.
- Get name (in the header): looks the drawn structure up in PubChem, through the app's own
  server, and shows its IUPAC name, PubChem title and CID, with a link that opens its
  PubChem page in a new tab. If PubChem has no record of the structure, it says so plainly;
  if the drawing leaves stereochemistry undefined, it notes that a specific stereoisomer may
  have a different name. A busy PubChem or a naming service that doesn't answer within 8 s
  gets its own message, and the drawing is never at risk. Greyed while offline ("Needs an
  internet connection") and while the canvas is empty. Only the structure (as SMILES) leaves
  the device; the server keeps PubChem's answers, chemistry only, for 30 days.
- Name to structure (in the header): type a name, then Add (beside the drawing) or Replace;
  Enter adds when there is a drawing. OPSIN, running on the app's own server, reads
  systematic names; common and trade names (aspirin, Tylenol) come from PubChem, and the
  panel says which answered, with OPSIN's message when it couldn't read the name. When
  OPSIN leaves the stereochemistry of a well-known compound undefined (nicotine), PubChem's
  record for it is drawn instead, and the panel says so. Then Get name runs on the result:
  "You typed" beside "PubChem's IUPAC name", with a check mark when they match. One Undo
  removes an addition or brings back what Replace cleared. Greyed offline.
- Functional groups in the properties panel: "Show functional groups" colours each group on
  the canvas (alkenes, alkynes, arenes, 1°/2°/3° alcohols and amines, phenols, ethers,
  aldehydes, ketones, acids, esters, amides, acid chlorides, anhydrides, nitriles, thiols,
  alkyl halides, epoxides) and lists them with counts. Each atom belongs to one group: an
  ester's O is not also an ether. The colours follow the drawing as it changes, are not an
  edit (Undo and autosave ignore them) and work offline. The patterns are in
  functional-groups.json, which can be edited without changing the app; a pattern it can't
  read is named in the panel and skipped.
- ¹³C NMR preview (in the properties panel, marked Preview): "Predict ¹³C NMR" shows a
  stick spectrum (220 to 0 ppm, with a TMS line that can be switched off) and a table of
  peaks: shift, C/CH/CH₂/CH₃, and how many equivalent carbons each represents. Equivalent
  carbons share one peak. Shifts come from measured spectra in NMRShiftDB2, looked up on
  this device (offline too); peaks matched only on a carbon's nearest surroundings are
  marked "low confidence". Clicking a peak or its row highlights its carbons on the
  drawing; clicking a carbon highlights its peak. A banner says these are predictions, not
  an answer key, and every prediction carries NMRShiftDB2's licence notice. Changing the
  drawing clears the prediction until it is predicted again.
- Stereoisomers (version 2's first feature): "Show stereoisomers" in the properties panel
  lists every stereoisomer of the drawing below the canvas, each drawn like the student's
  drawing, with (R) or (S) in place of each stereocentre and E or Z beside each stereogenic
  double bond. Enantiomer pairs sit side by side; achiral and
  meso forms are marked, and so are the ones that match the drawing. Add puts one in hand,
  as Name to structure's Add does, and the panel stays open to add another. Notes say where
  RDKit can't judge: bridged rings, allenes, biaryls and large-ring double bonds. Up to 8
  stereocentres and stereogenic double bonds are listed, and up to 32 stereoisomers drawn.
  Offline too. With more than one structure drawn, the properties panel says it works on
  one at a time.
- IR hints (version 2, in the properties panel's Functional groups section): "Show IR
  hints" lists the IR bands to expect for the groups found in the drawing: the range in
  cm⁻¹, the vibration, its intensity and shape. The bands to look for first are in bold,
  with the table's notes. A band shared by several groups (the alcohol O–H, the amine C–N)
  appears once, and the alkane C–H bands always appear as a reference. A closed "Where
  bands appear" list gives the four regions of the spectrum. The values come from a
  faculty-checked table, ir-bands.json (CC BY-SA 4.0), credited under the hints; bands
  still to be checked against a reference text are not shown, and their group says so.
  Works offline. An entry of the table the app can't use is named and skipped.
- Templates (header): conformation and projection templates to drop onto the canvas. A click
  on one puts it in hand, as Add does: it follows the mouse until a click places it, Esc
  puts it away, and one Undo removes it. Works offline. The templates: the cyclohexane chair
  with all 12 hydrogens, axial and equatorial, and the same chair ring-flipped; Newman
  projections, staggered and eclipsed, drawn as pictures with six "H" labels to edit (the
  properties panel leaves them out); Fischer projections with 1, 2 and 4 stereocenters to
  fill in, and D-glucose. A Fischer cross's horizontal bonds are wedges toward the viewer,
  which is what the cross means, so Get name and the stereocenter count read the right
  stereoisomer; Haworth projections of a pyranose and a furanose ring to fill in, and of
  α- and β-D-glucopyranose. No drawing of a Haworth projection carries stereo the app can
  read, so they have plain bonds (no thick front edge) and the app shows their
  stereocenters as undefined rather than as a wrong stereoisomer.

### Changed
- Save and Open no longer show the raw text of the file. Save asks only for the file name
  and format (Ketcher's warnings still show when a format would lose something). Open goes
  from choosing a file straight to "Open as New Project" or "Add to Canvas"; the "Paste
  from clipboard" tile is gone, and Ctrl+V on the canvas still pastes.
- The icon is a gold benzene ring with alternating double bonds, on black.
- Production (/draw/) opens off campus too, like /chemtutor, so CHEM-311 students can use
  and install it at home. Staging stays campus and VPN only.
- The app is called MU Draw ("MU Draw (staging)" on staging), in black and gold: a black
  header with a gold rule and a gold "MU", gold hover and focus on its buttons, and
  gold-on-black icons. An installed app picks up the new name and icon with the update.
  The canvas highlights keep their colours (light blue for defined stereocentres, gold for
  undefined ones).
- Name to structure's Add no longer puts the compound beside the drawing, where it could be
  off screen: the compound follows the mouse over the canvas until a click places it there.
  Esc, another tool or closing the panel puts it away. One Undo still removes it.
- In a short window, hand, select and eraser stay at the top of the left toolbar while the
  tools below them scroll, with Ketcher's arrows or the mouse wheel.
- Header buttons look greyed while they can't be used.
- The source is public under the MIT licence (LICENSE); THIRD-PARTY-NOTICES.md lists the
  parts under their own. NMRShiftDB2's data requires prediction software built on it to be
  open source.

### Fixed
- The properties panel missed double bonds drawn crossed (E/Z undefined), and double bonds
  stereogenic only through the stereocentres beside them, so its stereogenic double bonds
  and "Stereoisomers, at most" were too low.
- Ketcher's Structure Library no longer offers its "Sugars" group: its Haworth drawings of
  eight α-D-hexopyranoses were misread (α-D-glucopyranose came out with 2 of its 5
  stereocenters undefined and one inverted). The same sugars are still in "α-D-Sugars",
  drawn so they read correctly, and the Templates menu has Haworth projections.
- Ketcher's image previews and exports could hang when two were made at once; they now
  take turns.
- Get name could wait forever if Ketcher was converting another drawing at the same moment
  (its Save dialog preview, say); Indigo's conversions now take turns too.
- A deploy asked for an API restart when only the server's tests or fixture scripts had
  changed. Now only a change to the code the service runs, or to its environment, does.
