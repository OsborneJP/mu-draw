"""Record PubChem's structure-to-name answers for Get name's test compounds, and build the
server answers that the browser tests replay.

    python server/scripts/record_pubchem_names.py            # network: record new ones, rebuild
    python server/scripts/record_pubchem_names.py --all      # network: re-record all, rebuild
    python server/scripts/record_pubchem_names.py --offline  # only rebuild name_responses.json

The test compounds are reference_expected.json's compounds (named ones) and its invented
structures (PubChem has no record of them). Requests go through the server's own client
(server/pubchem.py), so each recording is exactly what the server sends: its canonical
SMILES in the POST body. They are saved as tests/fixtures/recorded/pubchem/smiles-<slug>.json.
tests/fixtures/name_responses.json is then built by replaying them through the real app
(create_app with replay()); tests/test_name_fixtures.py checks it byte for byte.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import re
import sys
import tempfile
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import parse_qsl

import httpx

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT / "server") not in sys.path:
    sys.path.insert(0, str(ROOT / "server"))

from fastapi.testclient import TestClient  # noqa: E402

from main import create_app  # noqa: E402
from pubchem import PubChem, RateLimit, new_http  # noqa: E402

FIXTURES = ROOT / "tests" / "fixtures"
EXPECTED_FILE = FIXTURES / "reference_expected.json"
RECORDINGS = FIXTURES / "recorded" / "pubchem"
RESPONSES_FILE = FIXTURES / "name_responses.json"
MIN_INTERVAL_S = 0.34  # PubChem allows 5 requests/s; stay under 3.


def unpaced() -> RateLimit:
    """Replays never reach PubChem, so they needn't wait for its rate limit."""
    return RateLimit(((sys.maxsize, 1.0),))


def slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def test_compounds(path: Path = EXPECTED_FILE) -> list[dict[str, str]]:
    """name, SMILES (as PubChem gave it, or as RDKit made it) and canonical SMILES."""
    data = json.loads(path.read_text(encoding="utf-8"))
    named = [(c["typed_name"], c) for c in data["compounds"]]
    invented = [(c["name"], c) for c in data["invented"]]
    return [
        {"name": name, "smiles": c["smiles"], "canonical_smiles": c["canonical_smiles"]}
        for name, c in named + invented
    ]


def recording_path(name: str, directory: Path = RECORDINGS) -> Path:
    return directory / f"smiles-{slug(name)}.json"


def form(request: httpx.Request) -> dict[str, str]:
    return dict(parse_qsl(request.content.decode("utf-8"), keep_blank_values=True))


def replay(recordings: list[dict]) -> httpx.MockTransport:
    """A transport that answers each recorded request with its recorded response. Any other
    request fails the test that made it."""
    table = {
        (r["request"]["method"], r["request"]["url"], json.dumps(r["request"]["form"])): r
        for r in recordings
    }

    def handler(request: httpx.Request) -> httpx.Response:
        key = (request.method, str(request.url), json.dumps(form(request)))
        if key not in table:
            raise AssertionError(f"no recording for {request.method} {request.url}")
        return httpx.Response(table[key]["status"], json=table[key]["body"])

    return httpx.MockTransport(handler)


class Recorder(httpx.AsyncBaseTransport):
    def __init__(self) -> None:
        self._inner = httpx.AsyncHTTPTransport()
        self.exchanges: list[tuple[httpx.Request, httpx.Response]] = []

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        response = await self._inner.handle_async_request(request)
        await response.aread()
        self.exchanges.append((request, response))
        return response


async def record(smiles: str, limit: RateLimit) -> dict:
    recorder = Recorder()
    async with new_http(recorder) as http:
        await PubChem(http, limit).name(smiles)
    if len(recorder.exchanges) != 1 or recorder.exchanges[0][1].status_code != 200:
        statuses = [response.status_code for _, response in recorder.exchanges]
        raise SystemExit(f"PubChem answered {statuses}; nothing recorded. Try again later.")
    request, response = recorder.exchanges[0]
    return {
        "request": {"method": request.method, "url": str(request.url), "form": form(request)},
        "recorded_at": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "status": response.status_code,
        "body": response.json(),
    }


def load_recordings(compounds: list[dict[str, str]], directory: Path = RECORDINGS) -> list[dict]:
    return [
        json.loads(recording_path(c["name"], directory).read_text(encoding="utf-8"))
        for c in compounds
    ]


def build_responses(compounds: list[dict[str, str]], recordings: list[dict]) -> str:
    """What the server answers for each test compound, replaying the recordings."""
    responses = {}
    with tempfile.TemporaryDirectory() as folder:
        app = create_app(state_dir=Path(folder), transport=replay(recordings), limit=unpaced())
        with TestClient(app) as client:
            for c in compounds:
                response = client.post("/api/name", json={"smiles": c["smiles"]})
                if response.status_code != 200:
                    raise ValueError(f"{c['name']}: the server answered {response.status_code}")
                responses[c["name"]] = response.json()
    data = {"generator": "server/scripts/record_pubchem_names.py", "responses": responses}
    return json.dumps(data, indent=2, ensure_ascii=False) + "\n"


async def record_all(compounds: list[dict[str, str]], everything: bool) -> None:
    limit = RateLimit(((1, MIN_INTERVAL_S),))
    for c in compounds:
        path = recording_path(c["name"])
        if path.exists() and not everything:
            continue
        recording = await record(c["canonical_smiles"], limit)
        path.write_text(json.dumps(recording, indent=2, ensure_ascii=False) + "\n", "utf-8")
        print(f"recorded {path.relative_to(ROOT)}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--offline", action="store_true", help="only rebuild name_responses.json")
    mode.add_argument("--all", action="store_true", help="re-record every compound")
    args = parser.parse_args(argv)
    compounds = test_compounds()
    if not args.offline:
        RECORDINGS.mkdir(parents=True, exist_ok=True)
        asyncio.run(record_all(compounds, args.all))
    text = build_responses(compounds, load_recordings(compounds))
    RESPONSES_FILE.write_text(text, encoding="utf-8")
    print(f"wrote {RESPONSES_FILE.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
