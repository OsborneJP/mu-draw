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
