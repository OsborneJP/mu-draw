"""The server's RDKit and RDKit.js in the browser are the same release, so expected values
generated on the server are valid for the web side."""

import json
from pathlib import Path

import rdkit

ROOT = Path(__file__).resolve().parents[1]


def normalise(version: str) -> tuple[int, ...]:
    return tuple(int(part) for part in version.split("."))


def test_rdkit_js_matches_server_rdkit():
    lock = json.loads((ROOT / "web" / "package-lock.json").read_text(encoding="utf-8"))
    web = lock["packages"]["node_modules/@rdkit/rdkit"]["version"]
    assert normalise(web) == normalise(rdkit.__version__), (web, rdkit.__version__)


def test_normalise_ignores_zero_padding():
    assert normalise("2026.09.1") == normalise("2026.9.1")
    assert normalise("2026.09.1") != normalise("2026.3.6")
