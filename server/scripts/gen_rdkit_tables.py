"""Write the RDKit data the browser's tautomer and resonance code needs.

    python server/scripts/gen_rdkit_tables.py --fetch   # network: record RDKit's source files
    python server/scripts/gen_rdkit_tables.py           # rebuild the table from the recordings

The browser runs ports of RDKit's TautomerEnumerator and ResonanceMolSupplier
(web/src/chem/tautomers.ts, resonance.ts; docs/plans/v2-tautomers-resonance.md), because
RDKit.js has neither. They need data RDKit keeps in its C++ source or its periodic table:
  - the 37 tautomer transforms (MolStandardize/TautomerCatalog/tautomerTransforms.in),
  - the Allen electronegativities ResonanceMolSupplier ranks structures by (Resonance.cpp),
  - each element's outer electrons and valences (Python RDKit's periodic table).
The two source files are recorded once, at the release tag of the pinned RDKit, under
tests/fixtures/recorded/rdkit/; web/src/chem/rdkitTables.json is always built from those
recordings and the periodic table, which tests/test_rdkit_tables.py checks by rebuilding it,
and by loading the transforms into Python's own enumerator.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import urllib.request
from pathlib import Path

import rdkit
from rdkit import Chem

ROOT = Path(__file__).resolve().parents[2]
RECORDINGS = ROOT / "tests" / "fixtures" / "recorded" / "rdkit"
TABLES_FILE = ROOT / "web" / "src" / "chem" / "rdkitTables.json"
TAG = "Release_" + rdkit.__version__.replace(".", "_")
SOURCES = {
    "tautomerTransforms.in": "Code/GraphMol/MolStandardize/TautomerCatalog/tautomerTransforms.in",
    "Resonance.cpp": "Code/GraphMol/Resonance.cpp",
}
RAW = "https://raw.githubusercontent.com/rdkit/rdkit"
# The elements RDKit's periodic table holds (0, a dummy atom, to 118).
ELEMENTS = range(119)


def url(name: str) -> str:
    return f"{RAW}/{TAG}/{SOURCES[name]}"


def fetch() -> None:
    RECORDINGS.mkdir(parents=True, exist_ok=True)
    for name in SOURCES:
        with urllib.request.urlopen(url(name), timeout=30) as response:
            (RECORDINGS / name).write_bytes(response.read())
        print(f"recorded {(RECORDINGS / name).relative_to(ROOT)}")


def literal(text: str) -> str:
    """One C++ string argument: adjacent literals joined, as the compiler joins them."""
    return "".join(re.findall(r'"([^"]*)"', text))


# One argument, std::string("...") with adjacent literals; a tuple is four of them.
ARGUMENT = r'std::string\(((?:\s*"[^"]*")+)\s*\)'
TUPLE = r"std::make_tuple\(\s*" + r"\s*,\s*".join([ARGUMENT] * 4) + r"\s*\)"


def transforms(source: str) -> list[dict[str, str]]:
    """The (name, SMARTS, bonds, charges) tuples of defaultTautomerTransforms, in order:
    every one of them, or an error."""
    rows = []
    for match in re.finditer(TUPLE, source):
        name, smarts, bonds, charges = (literal(a) for a in match.groups())
        rows.append({"name": name, "smarts": smarts, "bonds": bonds, "charges": charges})
    if len(rows) != source.count("std::make_tuple("):
        raise ValueError(f"read {len(rows)} transforms of {source.count('std::make_tuple(')}")
    return rows


def electronegativities(source: str) -> list[int]:
    found = re.search(r"static const std::vector<unsigned int> en\{([^}]*)\}", source)
    if not found:
        raise ValueError("Resonance.cpp no longer has its electronegativity table")
    return [int(v) for v in found.group(1).replace("\n", " ").split(",")]


def elements() -> list[dict[str, object]]:
    table = Chem.GetPeriodicTable()
    return [
        {"outer": table.GetNOuterElecs(z), "valences": list(table.GetValenceList(z))}
        for z in ELEMENTS
    ]


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def build(directory: Path = RECORDINGS) -> str:
    texts = {name: (directory / name).read_text(encoding="utf-8") for name in SOURCES}
    data = {
        "generator": "server/scripts/gen_rdkit_tables.py",
        "rdkit_version": rdkit.__version__,
        "sources": {
            name: {"url": url(name), "sha256": sha256(directory / name)} for name in SOURCES
        },
        "tautomer_transforms": transforms(texts["tautomerTransforms.in"]),
        "electronegativity": electronegativities(texts["Resonance.cpp"]),
        "elements": elements(),
    }
    return json.dumps(data, indent=1) + "\n"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--fetch", action="store_true", help="record the source files first")
    args = parser.parse_args(argv)
    if args.fetch:
        fetch()
    TABLES_FILE.write_text(build(), encoding="utf-8")
    print(f"wrote {TABLES_FILE.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
