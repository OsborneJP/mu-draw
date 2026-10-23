# Changelog

All notable changes to this project. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow SemVer.

## [Unreleased]

### Added
- Project skeleton: app.config.json (name and URL path in one place), conda env, and
  `scripts/check.sh` as the single gate before every commit and deploy.
- Naming API skeleton (FastAPI) with `GET /api/health`; no request bodies are logged.
- AGENTS.md (CLAUDE.md symlink) with the project invariants and common AI failure modes.
