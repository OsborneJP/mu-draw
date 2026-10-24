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

### Changed
- Header buttons look greyed while they can't be used.

### Fixed
- Ketcher's image previews and exports could hang when two were made at once; they now
  take turns.
- Get name could wait forever if Ketcher was converting another drawing at the same moment
  (its Save dialog preview, say); Indigo's conversions now take turns too.
