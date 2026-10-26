"""Record PubChem's GHS sections for Safety's test compounds, and build the server answers that
the browser tests replay.

    python server/scripts/record_ghs.py            # network: record new ones, rebuild
    python server/scripts/record_ghs.py --all      # network: re-record all, rebuild
    python server/scripts/record_ghs.py --offline  # only rebuild safety_responses.json

The test compounds are named in tests/fixtures/safety_names.txt; each is one of Get name's test
compounds, whose recorded structure-to-name lookup (recorded/pubchem/smiles-<slug>.json, from
record_pubchem_names.py) gives its CID. For each CID, PUG View's GHS section is asked for
through the server's own client (server/pubchem.py), so each recording is exactly what the
server sends (a GET with only the CID in it), and saved as recorded/pubchem/ghs-<slug>.json.
A compound PubChem has no record of (CID 0) has no GHS recording: the server never asks.
tests/fixtures/safety_responses.json is then built by replaying them through the real app
(create_app with replay()); server/tests/test_safety_fixtures.py checks it byte for byte.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
import tempfile
from datetime import UTC, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT / "server") not in sys.path:
    sys.path.insert(0, str(ROOT / "server"))

from fastapi.testclient import TestClient  # noqa: E402

import record_pubchem_names as names  # noqa: E402
from main import create_app  # noqa: E402
from pubchem import Busy, PubChem, RateLimit, Unavailable, new_http, not_found  # noqa: E402

NONE = "PUGVIEW.NotFound"  # the compound has no GHS section
FIXTURES = ROOT / "tests" / "fixtures"
NAMES_FILE = FIXTURES / "safety_names.txt"
RECORDINGS = FIXTURES / "recorded" / "pubchem"
RESPONSES_FILE = FIXTURES / "safety_responses.json"
MIN_INTERVAL_S = 0.34  # PubChem allows 5 requests/s; stay under 3.


def read_names(path: Path = NAMES_FILE) -> list[str]:
    lines = (line.strip() for line in path.read_text(encoding="utf-8").splitlines())
    return [line for line in lines if line and not line.startswith("#")]


def test_compounds(path: Path = NAMES_FILE) -> list[dict[str, str]]:
    """Get name's test compounds named in safety_names.txt, in its order."""
    known = {c["name"]: c for c in names.test_compounds()}
    missing = [name for name in read_names(path) if name not in known]
    if missing:
        raise ValueError(f"{path.name}: not Get name test compounds: {missing}")
    return [known[name] for name in read_names(path)]


def cid(compound: dict[str, str]) -> int:
    """The CID from the compound's recorded structure-to-name lookup (0: no record)."""
    recording = json.loads(names.recording_path(compound["name"]).read_text(encoding="utf-8"))
    return recording["body"]["PropertyTable"]["Properties"][0]["CID"]


def recording_path(name: str, directory: Path = RECORDINGS) -> Path:
    return directory / f"ghs-{names.slug(name)}.json"


async def record(compound_cid: int, limit: RateLimit) -> dict:
    recorder = names.Recorder()
    try:
        async with new_http(recorder) as http:
            await PubChem(http, limit).ghs(compound_cid)
    except (Busy, Unavailable):
        pass  # reported below
    statuses = [response.status_code for _, response in recorder.exchanges]
    if statuses != [200] and not (statuses == [404] and not_found(recorder.exchanges[0][1], NONE)):
        raise SystemExit(f"PubChem answered {statuses}; nothing recorded. Try again later.")
    request, response = recorder.exchanges[0]
    return {
        "request": {"method": request.method, "url": str(request.url), "form": names.form(request)},
        "recorded_at": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "status": response.status_code,
        "body": response.json(),
    }


def load_recordings(compounds: list[dict[str, str]]) -> list[dict]:
    """The structure-to-name and GHS exchanges the server replays for these compounds."""
    out = names.load_recordings(compounds)
    for c in compounds:
        if cid(c) != 0:
            out.append(json.loads(recording_path(c["name"]).read_text(encoding="utf-8")))
    return out


def build_responses(compounds: list[dict[str, str]], recordings: list[dict]) -> str:
    """What the server answers for each test compound, replaying the recordings."""
    responses = {}
    with tempfile.TemporaryDirectory() as folder:
        app = create_app(
            state_dir=Path(folder), transport=names.replay(recordings), limit=names.unpaced()
        )
        with TestClient(app) as client:
            for c in compounds:
                response = client.post("/api/safety", json={"smiles": c["smiles"]})
                if response.status_code != 200:
                    raise ValueError(f"{c['name']}: the server answered {response.status_code}")
                responses[c["name"]] = response.json()
    data = {"generator": "server/scripts/record_ghs.py", "responses": responses}
    return json.dumps(data, indent=2, ensure_ascii=False) + "\n"


async def record_all(compounds: list[dict[str, str]], everything: bool) -> None:
    limit = RateLimit(((1, MIN_INTERVAL_S),))
    for c in compounds:
        path = recording_path(c["name"])
        if cid(c) == 0 or (path.exists() and not everything):
            continue
        recording = await record(cid(c), limit)
        path.write_text(json.dumps(recording, indent=2, ensure_ascii=False) + "\n", "utf-8")
        print(f"recorded {path.relative_to(ROOT)}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--offline", action="store_true", help="only rebuild safety_responses.json")
    mode.add_argument("--all", action="store_true", help="re-record every compound")
    args = parser.parse_args(argv)
    compounds = test_compounds()
    if not args.offline:
        asyncio.run(record_all(compounds, args.all))
    text = build_responses(compounds, load_recordings(compounds))
    RESPONSES_FILE.write_text(text, encoding="utf-8")
    print(f"wrote {RESPONSES_FILE.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
