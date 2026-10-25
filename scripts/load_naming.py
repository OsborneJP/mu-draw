"""The spec's load check: 30 Get name requests at once against a deployed target.

    python scripts/load_naming.py <staging|production>

One lab section asking at the same moment, each for a structure the target hasn't cached,
so every request goes to PubChem through the server's one rate limit (5 a second). It
passes when every answer is a name or a plain "no record" (never "busy" or an error), each
inside the browser's deadline (web/src/api.ts). The structures come from the generated
fixtures; on osbornelab the target's cache is read to skip ones it already holds, so a
run warms the cache and the next run takes others.

This reaches the deployed API and, through it, PubChem. Run it by hand, never from tests.
"""

from __future__ import annotations

import asyncio
import csv
import json
import re
import sqlite3
import sys
import time
from pathlib import Path

import httpx

from lib.appconfig import ROOT, load

sys.path.insert(0, str(ROOT / "server"))
import chem  # noqa: E402  (the server's own canonical SMILES, the cache's key)

SECTION = 30
FIXTURES = ROOT / "tests" / "fixtures"
CSVS = ("reference_compounds.csv", "functional_group_compounds.csv", "nmr_compounds.csv")


def deadline_s() -> float:
    api = (ROOT / "web" / "src" / "api.ts").read_text(encoding="utf-8")
    return int(re.search(r"NAMING_DEADLINE_MS = (\d+);", api).group(1)) / 1000


def fixture_smiles() -> list[str]:
    """Every structure in the fixtures, canonical, without repeats, in file order."""
    found: list[str] = []
    for name in CSVS:
        with (FIXTURES / name).open(encoding="utf-8", newline="") as rows:
            found += [row["smiles"] for row in csv.DictReader(rows)]
    responses = json.loads((FIXTURES / "structure_responses.json").read_text(encoding="utf-8"))
    found += [r["structure"]["smiles"] for r in responses["responses"].values()]
    canonical = [chem.canonical(mol) for mol in map(chem.parse, found) if mol is not None]
    return list(dict.fromkeys(canonical))


def cached(unit: str) -> set[str] | None:
    """The structures the target's cache holds, or None where it can't be read."""
    path = Path("/var/lib") / unit / "name-cache.sqlite"
    try:
        db = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
        return {smiles for (smiles,) in db.execute("SELECT smiles FROM names")}
    except sqlite3.Error:
        return None


async def ask(client: httpx.AsyncClient, url: str, smiles: str, start: asyncio.Event):
    await start.wait()
    began = time.monotonic()
    try:
        response = await client.post(url, json={"smiles": smiles})
        status, body = response.status_code, response.json()
    except (httpx.HTTPError, ValueError) as error:
        status, body = 0, {"error": type(error).__name__}
    return status, body, time.monotonic() - began


async def run(url: str, structures: list[str]) -> list[tuple[int, dict, float]]:
    start = asyncio.Event()
    limits = httpx.Limits(max_connections=len(structures))
    async with httpx.AsyncClient(timeout=60.0, limits=limits) as client:
        tasks = [asyncio.create_task(ask(client, url, s, start)) for s in structures]
        await asyncio.sleep(0)  # every task waits on `start`
        start.set()
        return await asyncio.gather(*tasks)


def main(argv: list[str]) -> int:
    if len(argv) != 1 or argv[0] not in ("staging", "production"):
        print(__doc__.strip().splitlines()[2].strip(), file=sys.stderr)
        return 2
    config, target = load(), argv[0]
    known = cached(config.unit(target))
    structures = [s for s in fixture_smiles() if known is None or s not in known][:SECTION]
    if len(structures) < SECTION:
        print(f"only {len(structures)} uncached structures left in the fixtures", file=sys.stderr)
        return 1
    print(f"{SECTION} Get name requests at once to {config.url(target)}api/name")
    seen = "unreadable here, so some may be cached" if known is None else "none of them cached"
    print(f"cache: {seen}")
    limit = deadline_s()
    results = asyncio.run(run(f"{config.url(target)}api/name", structures))
    failures = 0
    for status, body, seconds in sorted(results, key=lambda r: r[2]):
        found = "found" if body.get("found") else "no record"
        answer = found if status == 200 else body.get("error")
        late = seconds >= limit
        failures += status != 200 or late
        print(f"  {status} {answer:<10} {seconds:5.2f} s{'  LATE' if late else ''}")
    slowest = max(seconds for _, _, seconds in results)
    print(f"slowest {slowest:.2f} s against the browser's {limit:.0f} s deadline")
    print("LOAD CHECK PASSED" if failures == 0 else f"LOAD CHECK FAILED: {failures} of {SECTION}")
    return 0 if failures == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
