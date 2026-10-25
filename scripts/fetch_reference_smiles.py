"""Build the compound CSVs in tests/fixtures/ from PubChem.

    python scripts/fetch_reference_smiles.py            # network: re-record, then write CSVs
    python scripts/fetch_reference_smiles.py --missing  # network: record only new names
    python scripts/fetch_reference_smiles.py --offline  # rebuild CSVs from the recordings

Each name in a names file (SETS: the reference compounds, the functional-group, NMR and
stereoisomer test sets) is looked up with PUG REST and the raw response is saved under
tests/fixtures/recorded/pubchem/ (one recording per name, shared by the sets). Each CSV is
always built from those recordings by parse() and write_csv(), which is what the replay
test checks, so the CSVs' SMILES provably came from PubChem.
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import re
import time
import urllib.parse
import urllib.request
from datetime import UTC, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / "tests" / "fixtures"
NAMES_FILE = FIXTURES / "reference_names.txt"
RECORDINGS = FIXTURES / "recorded" / "pubchem"
CSV_FILE = FIXTURES / "reference_compounds.csv"
FG_NAMES_FILE = FIXTURES / "functional_group_names.txt"
FG_CSV_FILE = FIXTURES / "functional_group_compounds.csv"
NMR_NAMES_FILE = FIXTURES / "nmr_names.txt"
NMR_CSV_FILE = FIXTURES / "nmr_compounds.csv"
STEREO_NAMES_FILE = FIXTURES / "stereoisomer_names.txt"
STEREO_CSV_FILE = FIXTURES / "stereoisomer_compounds.csv"
# (names file, CSV built from its recordings)
SETS = (
    (NAMES_FILE, CSV_FILE),
    (FG_NAMES_FILE, FG_CSV_FILE),
    (NMR_NAMES_FILE, NMR_CSV_FILE),
    (STEREO_NAMES_FILE, STEREO_CSV_FILE),
)
PUG = "https://pubchem.ncbi.nlm.nih.gov/rest/pug"
# Current PubChem names: SMILES includes stereo. Never IsomericSMILES/CanonicalSMILES.
PROPERTIES = "SMILES,Title"
COLUMNS = ("typed_name", "pubchem_cid", "pubchem_title", "smiles")
MIN_INTERVAL_S = 0.34  # PubChem allows 5 requests/s; stay under 3.


def read_names(path: Path = NAMES_FILE) -> list[str]:
    lines = path.read_text(encoding="utf-8").splitlines()
    return [line.strip() for line in lines if line.strip() and not line.startswith("#")]


def slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def recording_path(name: str, directory: Path = RECORDINGS) -> Path:
    return directory / f"name-{slug(name)}.json"


def name_url(name: str) -> str:
    quoted = urllib.parse.quote(name, safe="")
    return f"{PUG}/compound/name/{quoted}/property/{PROPERTIES}/JSON"


def record(name: str) -> dict:
    url = name_url(name)
    request = urllib.request.Request(url, headers={"Accept": "application/json"})
    with urllib.request.urlopen(request, timeout=30) as response:
        body = json.loads(response.read().decode("utf-8"))
        status = response.status
    return {
        "request": {"method": "GET", "url": url},
        "recorded_at": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "status": status,
        "body": body,
    }


def parse(name: str, recording: dict) -> dict[str, str]:
    """One CSV row from one recorded PUG REST response."""
    rows = recording["body"]["PropertyTable"]["Properties"]
    if len(rows) != 1:
        raise ValueError(f"{name!r}: PubChem returned {len(rows)} records; pick a narrower name")
    row = rows[0]
    return {
        "typed_name": name,
        "pubchem_cid": str(row["CID"]),
        "pubchem_title": row["Title"],
        "smiles": row["SMILES"],
    }


def write_csv(rows: list[dict[str, str]]) -> str:
    out = io.StringIO()
    writer = csv.DictWriter(out, fieldnames=COLUMNS, lineterminator="\n")
    writer.writeheader()
    writer.writerows(rows)
    return out.getvalue()


def build_csv(names: list[str], directory: Path = RECORDINGS) -> str:
    rows = []
    for name in names:
        recording = json.loads(recording_path(name, directory).read_text(encoding="utf-8"))
        rows.append(parse(name, recording))
    return write_csv(rows)


def all_names() -> list[str]:
    """Every name in every set, each once, in order."""
    return list(dict.fromkeys(name for names_file, _ in SETS for name in read_names(names_file)))


def to_record(names: list[str], missing_only: bool, directory: Path = RECORDINGS) -> list[str]:
    """The names to look up: all of them, or only those without a recording yet."""
    if not missing_only:
        return list(names)
    return [name for name in names if not recording_path(name, directory).exists()]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--offline", action="store_true", help="only rebuild the CSV")
    mode.add_argument("--missing", action="store_true", help="record only names not yet recorded")
    args = parser.parse_args(argv)
    if not args.offline:
        RECORDINGS.mkdir(parents=True, exist_ok=True)
        for i, name in enumerate(to_record(all_names(), args.missing)):
            if i:
                time.sleep(MIN_INTERVAL_S)
            recording = record(name)
            path = recording_path(name)
            path.write_text(json.dumps(recording, indent=2) + "\n", encoding="utf-8")
            print(f"recorded {path.relative_to(ROOT)}")
    for names_file, csv_file in SETS:
        csv_file.write_text(build_csv(read_names(names_file)), encoding="utf-8")
        print(f"wrote {csv_file.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
