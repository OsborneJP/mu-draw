"""Record PubChem's answers for Name to structure's test names, and build the server answers
that the browser tests replay.

    python server/scripts/record_name_lookups.py            # network: record new names, rebuild
    python server/scripts/record_name_lookups.py --offline  # only rebuild the responses

Names come from tests/fixtures/name_to_structure_names.txt ([systematic], then [common]).
For each name, through the server's own PubChem client (server/pubchem.py):
  recorded/pubchem/byname-<slug>.json     PubChem's name lookup: the independent check on
                                          what OPSIN draws, and the fallback the server replays
  recorded/pubchem/roundtrip-<slug>.json  PubChem's structure-to-name answer for the structure
                                          the server draws (the round trip)
tests/fixtures/structure_responses.json is then built by running the real app, with the real
OPSIN (the pinned jar) and PubChem replayed: POST /api/structure, then POST /api/name with its
SMILES. tests/test_name_to_structure_fixtures.py checks it byte for byte.
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
from rdkit import Chem  # noqa: E402

import record_pubchem_names as names  # noqa: E402
from main import create_app  # noqa: E402
from pubchem import PubChem, RateLimit, new_http  # noqa: E402

FIXTURES = ROOT / "tests" / "fixtures"
NAMES_FILE = FIXTURES / "name_to_structure_names.txt"
RECORDINGS = FIXTURES / "recorded" / "pubchem"
RESPONSES_FILE = FIXTURES / "structure_responses.json"
MIN_INTERVAL_S = 0.34  # PubChem allows 5 requests/s; stay under 3.


def read_names(path: Path = NAMES_FILE) -> list[tuple[str, str]]:
    """(kind, name) pairs, kind being "systematic" or "common"."""
    kind, out = None, []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("[") and line.endswith("]"):
            kind = line[1:-1]
            continue
        if kind not in ("systematic", "common"):
            raise ValueError(f"{path.name}: a name before [systematic] or [common]")
        out.append((kind, line))
    return out


def byname_path(name: str) -> Path:
    return RECORDINGS / f"byname-{names.slug(name)}.json"


def roundtrip_path(name: str) -> Path:
    return RECORDINGS / f"roundtrip-{names.slug(name)}.json"


def all_recordings() -> list[dict]:
    """Every POST exchange the server may replay: names, structures and round trips (the
    name-*.json GET recordings are the reference fixtures' source, not server traffic)."""
    paths = [
        p for pattern in ("smiles-*", "byname-*", "roundtrip-*") for p in RECORDINGS.glob(pattern)
    ]
    return [json.loads(p.read_text(encoding="utf-8")) for p in sorted(paths)]


async def record(ask, accept: tuple[int, ...]) -> dict:
    """One exchange through the server's client; `ask(pubchem)` makes the request."""
    recorder = names.Recorder()
    async with new_http(recorder) as http:
        try:
            await ask(PubChem(http, RateLimit(((1, MIN_INTERVAL_S),))))
        except Exception:  # noqa: BLE001 - the recorded exchange is what matters
            pass
    statuses = [response.status_code for _, response in recorder.exchanges]
    if len(statuses) != 1 or statuses[0] not in accept:
        raise SystemExit(f"PubChem answered {statuses}; nothing recorded. Try again later.")
    request, response = recorder.exchanges[0]
    return {
        "request": {"method": request.method, "url": str(request.url), "form": names.form(request)},
        "recorded_at": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "status": response.status_code,
        "body": response.json(),
    }


def save(path: Path, recording: dict) -> None:
    path.write_text(json.dumps(recording, indent=2, ensure_ascii=False) + "\n", "utf-8")
    print(f"recorded {path.relative_to(ROOT)}")


def run_app(recordings: list[dict], work):
    with tempfile.TemporaryDirectory() as folder:
        app = create_app(
            state_dir=Path(folder), transport=names.replay(recordings), limit=names.unpaced()
        )
        with TestClient(app) as client:
            return work(client)


def structures(client, all_names: list[tuple[str, str]]) -> dict[str, dict]:
    out = {}
    for _, name in all_names:
        response = client.post("/api/structure", json={"name": name})
        if response.status_code != 200:
            raise ValueError(f"{name}: the server answered {response.status_code}")
        out[name] = response.json()
    return out


def build_responses(all_names: list[tuple[str, str]], recordings: list[dict]) -> str:
    def work(client):
        drawn = structures(client, all_names)
        responses = {}
        for kind, name in all_names:
            answer = drawn[name]
            roundtrip = inchikey = None
            if answer["found"]:
                reply = client.post("/api/name", json={"smiles": answer["smiles"]})
                if reply.status_code != 200:
                    raise ValueError(f"{name}: round trip answered {reply.status_code}")
                roundtrip = reply.json()
                inchikey = Chem.MolToInchiKey(Chem.MolFromSmiles(answer["smiles"]))
            responses[name] = {
                "kind": kind,
                "structure": answer,
                "roundtrip": roundtrip,
                "inchikey": inchikey,
            }
        return responses

    data = {
        "generator": "server/scripts/record_name_lookups.py",
        "responses": run_app(recordings, work),
    }
    return json.dumps(data, indent=2, ensure_ascii=False) + "\n"


async def record_new(all_names: list[tuple[str, str]]) -> None:
    for _, name in all_names:
        if not byname_path(name).exists():
            save(byname_path(name), await record(lambda p, n=name: p.structure(n), (200, 404)))
    drawn = run_app(all_recordings(), lambda client: structures(client, all_names))
    for _, name in all_names:
        smiles = drawn[name]["smiles"]
        if smiles and not roundtrip_path(name).exists():
            save(roundtrip_path(name), await record(lambda p, s=smiles: p.name(s), (200,)))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--offline", action="store_true", help="only rebuild the responses")
    args = parser.parse_args(argv)
    all_names = read_names()
    if not args.offline:
        RECORDINGS.mkdir(parents=True, exist_ok=True)
        asyncio.run(record_new(all_names))
    RESPONSES_FILE.write_text(build_responses(all_names, all_recordings()), encoding="utf-8")
    print(f"wrote {RESPONSES_FILE.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
