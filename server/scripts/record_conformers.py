"""Record PubChem's 3D answers for the 3D view's test compounds, and build the fixtures that
the tests replay and check (docs/plans/v2-3d-view.md, bar A).

    python server/scripts/record_conformers.py            # network: record new ones, rebuild
    python server/scripts/record_conformers.py --all      # network: re-record all, rebuild
    python server/scripts/record_conformers.py --offline  # only rebuild the fixtures

The test compounds are tests/fixtures/conformer_compounds.csv (SMILES from PubChem) and a few
drawings generated from them (UNDRAWN, IMPOSSIBLE, INVENTED). Each is drawn as
gen_reference_expected draws (tests/fixtures/conformers/<slug>.mol), and its canonical SMILES
goes through the server's own client (server/pubchem.py), so each recording
(recorded/pubchem/conformer-<slug>.json) is exactly what the server sends and gets back. A
structure the server refuses before asking PubChem (more than one) has no recording. Then,
replaying the recordings through the real app:
  tests/fixtures/conformer_responses.json  the server's answer to each (the browser tests
                                           replay these)
  tests/fixtures/conformers_expected.json  where each model came from, its atoms by element,
                                           and the CIP labels its coordinates give, beside the
                                           drawing's own labels
tests/test_conformer_fixtures.py regenerates both to compare bytes, and checks them against
tests/fixtures/conformers_judged.json (judgement, never generated).

RDKit's models are built here without the embedding's 2 s timeout. The timeout only cuts a
slow run short; it never changes a model that finishes (the same coordinates with and
without it, measured), so the fixtures don't depend on how busy the machine is.
"""

from __future__ import annotations

import argparse
import asyncio
import functools
import json
import sys
import tempfile
from collections import defaultdict
from datetime import UTC, datetime
from pathlib import Path

import httpx
from rdkit import Chem
from rdkit.Chem import rdCIPLabeler
from rdkit.Chem.EnumerateStereoisomers import EnumerateStereoisomers

from gen_reference_expected import FIXTURES, ROOT, configure, molfile, read_rows, slug
from record_pubchem_names import Recorder, form, unpaced

if str(ROOT / "server") not in sys.path:
    sys.path.insert(0, str(ROOT / "server"))

from fastapi.testclient import TestClient  # noqa: E402

import threed  # noqa: E402
from main import create_app  # noqa: E402
from pubchem import PubChem, RateLimit, Unavailable, new_http  # noqa: E402

CSV_FILE = FIXTURES / "conformer_compounds.csv"
RECORDINGS = FIXTURES / "recorded" / "pubchem"
DIR = "conformers"
RESPONSES_FILE = "conformer_responses.json"
EXPECTED_FILE = "conformers_expected.json"
MIN_INTERVAL_S = 0.34  # PubChem allows 5 requests/s; stay under 3.
# Generated drawings, so nobody types a structure. Drawn with no stereo: PubChem's model of
# such a drawing has one arrangement of its centres (decision 7).
UNDRAWN = (
    ("(R)-2-butanol, stereo not drawn", "(R)-2-butanol"),
    ("cocaine, stereo not drawn", "cocaine"),
)
# Camphor's first stereoisomer that can't exist (stereoisomers_expected.json: not among those
# that embed in 3D): RDKit can't build it, so the panel says so.
IMPOSSIBLE = ("camphor, a stereoisomer that can't exist", "camphor")
# A structure PubChem has no record of (Get name's first invented one).
INVENTED = 0


def impossible_camphor(camphor: Chem.Mol) -> Chem.Mol:
    stereo = json.loads((FIXTURES / "stereoisomers_expected.json").read_text(encoding="utf-8"))
    (entry,) = (c for c in stereo["compounds"] if c["name"] == IMPOSSIBLE[1])
    key = next(
        s["inchikey"] for s in entry["stereoisomers"] if s["inchikey"] not in entry["embeds_in_3d"]
    )
    (found,) = (m for m in EnumerateStereoisomers(camphor) if Chem.MolToInchiKey(m) == key)
    return found


def test_compounds() -> list[dict[str, str]]:
    """name and SMILES of each test compound, in a fixed order."""
    configure()
    rows = read_rows(CSV_FILE)
    smiles = {row["typed_name"]: row["smiles"] for row in rows}
    compounds = [{"name": row["typed_name"], "smiles": row["smiles"]} for row in rows]
    for name, source in UNDRAWN:
        mol = Chem.MolFromSmiles(smiles[source])
        Chem.RemoveStereochemistry(mol)
        compounds.append({"name": name, "smiles": Chem.MolToSmiles(mol)})
    camphor = Chem.MolFromSmiles(smiles[IMPOSSIBLE[1]])
    compounds.append(
        {"name": IMPOSSIBLE[0], "smiles": Chem.MolToSmiles(impossible_camphor(camphor))}
    )
    reference = json.loads((FIXTURES / "reference_expected.json").read_text(encoding="utf-8"))
    invented = reference["invented"][INVENTED]
    compounds.append({"name": invented["name"], "smiles": invented["smiles"]})
    return compounds


def asks_pubchem(compound: dict[str, str]) -> bool:
    """The server asks PubChem about one structure only (main.py's conformer())."""
    return len(Chem.GetMolFrags(Chem.MolFromSmiles(compound["smiles"]))) == 1


def canonical(compound: dict[str, str]) -> str:
    return Chem.MolToSmiles(Chem.MolFromSmiles(compound["smiles"]))


def recording_path(name: str, directory: Path = RECORDINGS) -> Path:
    return directory / f"conformer-{slug(name)}.json"


def replay(recordings: list[dict]) -> httpx.MockTransport:
    """Answers each recorded request with its recorded response (text, as PubChem sent it).
    Any other request fails the test that made it."""
    table = {
        (r["request"]["method"], r["request"]["url"], json.dumps(r["request"]["form"])): r
        for r in recordings
    }

    def handler(request: httpx.Request) -> httpx.Response:
        key = (request.method, str(request.url), json.dumps(form(request)))
        if key not in table:
            raise AssertionError(f"no recording for {request.method} {request.url}")
        found = table[key]
        headers = {"content-type": found["content_type"]}
        return httpx.Response(found["status"], content=found["text"].encode(), headers=headers)

    return httpx.MockTransport(handler)


async def record(smiles: str, limit: RateLimit) -> dict:
    recorder = Recorder()
    async with new_http(recorder) as http:
        try:
            await PubChem(http, limit).conformer(smiles)
        except Unavailable:
            pass  # checked below: only PubChem's three expected answers are recorded
    statuses = [response.status_code for _, response in recorder.exchanges]
    if statuses not in ([200], [404], [501]):
        raise SystemExit(f"PubChem answered {statuses}; nothing recorded. Try again later.")
    request, response = recorder.exchanges[0]
    return {
        "request": {"method": request.method, "url": str(request.url), "form": form(request)},
        "recorded_at": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "status": response.status_code,
        "content_type": response.headers["content-type"],
        "text": response.text,
    }


def load_recordings(compounds: list[dict[str, str]], directory: Path = RECORDINGS) -> list[dict]:
    return [
        json.loads(recording_path(c["name"], directory).read_text(encoding="utf-8"))
        for c in compounds
        if asks_pubchem(c)
    ]


def labels(mol: Chem.Mol) -> dict[str, dict[str, list[str]]]:
    """The CIP labels RDKit gives `mol` (no H), keyed by canonical rank of the structure
    without stereo (ties kept), so a drawing and its model, atoms in any order, compare."""
    plain = Chem.Mol(mol)
    Chem.RemoveStereochemistry(plain)
    ranks = list(Chem.CanonicalRankAtoms(plain, breakTies=False))
    rdCIPLabeler.AssignCIPLabels(mol)
    found: dict[str, dict[str, list[str]]] = {
        "atoms": defaultdict(list),
        "bonds": defaultdict(list),
    }
    for atom in mol.GetAtoms():
        if atom.HasProp("_CIPCode"):
            found["atoms"][str(ranks[atom.GetIdx()])].append(atom.GetProp("_CIPCode"))
    for bond in mol.GetBonds():
        if bond.HasProp("_CIPCode"):
            ends = sorted((ranks[bond.GetBeginAtomIdx()], ranks[bond.GetEndAtomIdx()]))
            found["bonds"]["-".join(map(str, ends))].append(bond.GetProp("_CIPCode"))
    return {kind: {k: sorted(v) for k, v in sorted(by.items())} for kind, by in found.items()}


def model_labels(molblock: str) -> dict[str, dict[str, list[str]]]:
    model = Chem.RemoveHs(Chem.MolFromMolBlock(molblock, removeHs=False))
    Chem.AssignStereochemistryFrom3D(model)
    return labels(model)


def atoms_by_element(molblock: str) -> dict[str, int]:
    model = Chem.MolFromMolBlock(molblock, removeHs=False)
    counts: dict[str, int] = defaultdict(int)
    for atom in model.GetAtoms():
        counts[atom.GetSymbol()] += 1
    return dict(sorted(counts.items()))


def answers(compounds: list[dict[str, str]], recordings: list[dict]) -> dict[str, dict]:
    """The server's answer to each test compound, replaying the recordings."""
    found = {}
    no_timeout = functools.partial(threed.embed, timeout_s=0)
    with tempfile.TemporaryDirectory() as folder:
        app = create_app(
            state_dir=Path(folder), transport=replay(recordings), limit=unpaced(), embed=no_timeout
        )
        with TestClient(app) as client:
            for c in compounds:
                response = client.post("/api/conformer", json={"smiles": c["smiles"]})
                found[c["name"]] = {"status": response.status_code, "body": response.json()}
    return found


def generate(compounds: list[dict[str, str]], recordings: list[dict]) -> dict[str, str]:
    """Every generated file's text, by path under tests/fixtures/."""
    configure()
    files: dict[str, str] = {}
    responses = answers(compounds, recordings)
    expected = []
    for c in compounds:
        mol = Chem.MolFromSmiles(c["smiles"])
        path = f"{DIR}/{slug(c['name'])}.mol"
        files[path] = molfile(mol, c["name"])
        answer = responses[c["name"]]
        body = answer["body"]
        entry: dict[str, object] = {"name": c["name"], "file": path, "status": answer["status"]}
        if answer["status"] == 200:
            entry |= {k: body[k] for k in ("found", "source", "cid", "pubchem", "reason")}
            entry["undefined_stereo"] = body["undefined_stereo"]
            entry["drawing_labels"] = labels(mol)
            if body["found"]:
                entry["atoms"] = atoms_by_element(body["molblock"])
                entry["model_labels"] = model_labels(body["molblock"])
        else:
            entry["error"] = body["error"]
        expected.append(entry)
    files[RESPONSES_FILE] = dump(
        {"generator": "server/scripts/record_conformers.py", "responses": responses}
    )
    files[EXPECTED_FILE] = dump(
        {"generator": "server/scripts/record_conformers.py", "compounds": expected}
    )
    return files


def dump(data: object) -> str:
    return json.dumps(data, indent=2, ensure_ascii=False) + "\n"


async def record_all(compounds: list[dict[str, str]], everything: bool) -> None:
    limit = RateLimit(((1, MIN_INTERVAL_S),))
    for c in compounds:
        path = recording_path(c["name"])
        if not asks_pubchem(c) or (path.exists() and not everything):
            continue
        recording = await record(canonical(c), limit)
        path.write_text(json.dumps(recording, indent=2, ensure_ascii=False) + "\n", "utf-8")
        print(f"recorded {path.relative_to(ROOT)}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--offline", action="store_true", help="only rebuild the fixtures")
    mode.add_argument("--all", action="store_true", help="re-record every compound")
    args = parser.parse_args(argv)
    compounds = test_compounds()
    if not args.offline:
        RECORDINGS.mkdir(parents=True, exist_ok=True)
        asyncio.run(record_all(compounds, args.all))
    (FIXTURES / DIR).mkdir(exist_ok=True)
    for path, text in generate(compounds, load_recordings(compounds)).items():
        (FIXTURES / path).write_text(text, encoding="utf-8")
        print(f"wrote tests/fixtures/{path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
