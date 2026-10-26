"""Build Practice mode's name lists (docs/plans/v2-practice-mode.md) and its test fixtures.

    python server/scripts/build_practice_lists.py            # network: record new names, rebuild
    python server/scripts/build_practice_lists.py --offline  # only rebuild from the recordings

A list is a names file: practice/<id>.txt for the app, tests/fixtures/practice_test_names.txt
for the browser tests. Its first line is "title: <title>", then one name per line, as a student
would read it; "#" starts a comment. Nothing in a names file is a chemistry value.

Each name goes through the server's own POST /api/structure, so the answer is what Name to
structure draws: the real OPSIN (the pinned jar) first, then PubChem, replayed from
tests/fixtures/recorded/pubchem/byname-<slug>.json, the same recordings record_name_lookups.py
makes (a name without one is recorded first, with network). PubChem's record for the name is
the independent check. RDKit then gives, for the answer:
  keys        the InChIKeys that count as right: the answer's, and its mirror image's when
              the name states only relative stereo (cis/trans, E/Z, rel-)
  stereo      "checked": the name states the stereo, so the whole key must match;
              "unchecked": the answer has stereo the name doesn't state, so only the skeleton
              (the key's first block) and its protonation letter count; "none": none at all
  formula     the InChI's formula layer; components: how many parts that formula has
  molfile     the server's Molfile (chem.molfile, its chiral flag set), for Show answer; a
              double bond the name gives no E/Z for is drawn plain, as laid out, since a
              crossed ("either") bond is one Indigo can't make a key for
The app's lists go to web/public/practice.json, the test list to
tests/fixtures/practice_test_lists.json. tests/fixtures/practice_cases.json holds drawings
for the hint tests, made by OPSIN and RDKit alone (CASES below). A name that can't be used
stops the build with the reason (Refused).
"""

from __future__ import annotations

import argparse
import asyncio
import json
import re
import sys
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT / "server") not in sys.path:
    sys.path.insert(0, str(ROOT / "server"))

from rdkit import Chem  # noqa: E402
from rdkit.Chem import rdChemReactions  # noqa: E402

import chem  # noqa: E402
import record_name_lookups as lookups  # noqa: E402
from opsin import Opsin  # noqa: E402
from pubchem import parse_structure  # noqa: E402

LISTS_DIR = ROOT / "practice"
APP_FILE = ROOT / "web" / "public" / "practice.json"
FIXTURES = ROOT / "tests" / "fixtures"
TEST_NAMES_FILE = FIXTURES / "practice_test_names.txt"
TEST_LISTS_FILE = FIXTURES / "practice_test_lists.json"
CASES_FILE = FIXTURES / "practice_cases.json"
GENERATOR = "server/scripts/build_practice_lists.py"


class Refused(ValueError):
    """A name the app can't use as a practice question; the message says why."""


@dataclass(frozen=True)
class NamesFile:
    id: str
    title: str
    names: list[str]


def read_names(path: Path) -> NamesFile:
    title, names = None, []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if title is None:
            if not line.startswith("title:") or not line[len("title:") :].strip():
                raise Refused(f"{path.name}: the first line must be 'title: <title>'")
            title = line[len("title:") :].strip()
            continue
        if line in names:
            raise Refused(f"{path.name}: {line!r} is listed twice")
        names.append(line)
    if title is None or not names:
        raise Refused(f"{path.name}: a title and at least one name are needed")
    return NamesFile(path.stem, title, names)


def app_names_files() -> list[NamesFile]:
    return [read_names(path) for path in sorted(LISTS_DIR.glob("*.txt"))]


# Stereo descriptors as names write them. Absolute: R/S in parentheses ("(R)", "(2R,3S)",
# "(4aS)"), and D/L ("L-alanine"). Relative: E/Z in parentheses, cis/trans, rel-, and R*/S*.
DESCRIPTOR_GROUP = re.compile(r"\(([^()]*)\)")
ABSOLUTE_TOKEN = re.compile(r"^\d*[a-z]?'*[RS]$")
STARRED_TOKEN = re.compile(r"^\d*[a-z]?'*[RS]\*$")
GEOMETRY_TOKEN = re.compile(r"^\d*[a-z]?'*[EZ]$")
FISCHER = re.compile(r"(?<![A-Za-z])[DL]-(?=[A-Za-z])")
RELATIVE_WORD = re.compile(r"(?<![A-Za-z])(cis|trans|rel)(?![A-Za-z])", re.IGNORECASE)


def stated_stereo(name: str) -> str | None:
    """'absolute' if the name states R/S or D/L, 'relative' if it states only cis/trans, E/Z,
    rel- or R*/S*, None if it states no stereo at all."""
    tokens = [t.strip() for group in DESCRIPTOR_GROUP.findall(name) for t in group.split(",")]
    relative = bool(RELATIVE_WORD.search(name)) or any(
        STARRED_TOKEN.match(t) or GEOMETRY_TOKEN.match(t) for t in tokens
    )
    absolute = any(ABSOLUTE_TOKEN.match(t) for t in tokens) or bool(FISCHER.search(name))
    if absolute and not re.search(r"(?<![A-Za-z])rel(?![A-Za-z])", name, re.IGNORECASE):
        return "absolute"
    return "relative" if relative or absolute else None


def stereo_counts(mol: Chem.Mol) -> tuple[int, int]:
    """(defined, undefined) stereocentres and stereogenic double bonds, counted as the
    properties panel counts them."""
    found = Chem.FindPotentialStereo(Chem.Mol(mol), cleanIt=False, flagPossible=True)
    defined = sum(1 for e in found if e.specified == Chem.StereoSpecified.Specified)
    return defined, len(found) - defined


def mirror_image(mol: Chem.Mol) -> Chem.Mol:
    """Every tetrahedral centre inverted; double bonds stay as they are."""
    image = Chem.Mol(mol)
    for atom in image.GetAtoms():
        if atom.GetChiralTag() in (Chem.CHI_TETRAHEDRAL_CW, Chem.CHI_TETRAHEDRAL_CCW):
            atom.InvertChirality()
    return image


def as_drawn(molfile: str) -> str:
    """The Molfile with each crossed ("either") double bond made plain, its geometry the one the
    layout shows: what a student draws for a name that gives no E/Z."""
    mol = Chem.MolFromMolBlock(molfile)
    either = [b for b in mol.GetBonds() if b.GetStereo() == Chem.BondStereo.STEREOANY]
    if not either:
        return molfile
    for bond in either:
        bond.SetStereo(Chem.BondStereo.STEREONONE)
    double_bond_dirs = (
        Chem.BondDir.ENDUPRIGHT,
        Chem.BondDir.ENDDOWNRIGHT,
        Chem.BondDir.EITHERDOUBLE,
    )
    for bond in mol.GetBonds():
        if bond.GetBondDir() in double_bond_dirs:
            bond.SetBondDir(Chem.BondDir.NONE)
    Chem.DetectBondStereoChemistry(mol, mol.GetConformer())
    Chem.AssignStereochemistry(mol, cleanIt=True, force=True)
    return Chem.MolToMolBlock(mol)


def formula_of(inchi: str) -> str:
    return inchi.split("/")[1]


def components(formula: str) -> int:
    """How many parts an InChI formula has: parts are separated by dots, and a part may start
    with how many of it there are."""
    return sum(int(m.group(1) or 1) for m in re.finditer(r"(?:^|\.)(\d*)[A-Z]", formula))


def practice_item(name: str, answer: dict, record) -> dict:
    """One question: what the app needs to judge a drawing for `name`. `answer` is the
    server's /api/structure answer, `record` PubChem's record for the name (None if PubChem
    doesn't know it)."""
    if not answer["found"]:
        raise Refused(f"{name!r}: neither OPSIN nor PubChem can draw it")
    if answer["source"] == "PubChem" and answer["matches"] > 1:
        raise Refused(f"{name!r}: PubChem has {answer['matches']} records for this name")
    mol = Chem.MolFromSmiles(answer["smiles"])
    key = Chem.MolToInchiKey(mol)
    if record is not None:
        theirs = Chem.MolToInchiKey(Chem.MolFromSmiles(record.smiles))
        if theirs[:14] != key[:14]:
            raise Refused(f"{name!r}: OPSIN and PubChem's record for it are different compounds")
    defined, undefined = stereo_counts(mol)
    stated = stated_stereo(name)
    keys = [key]
    if defined == 0:
        stereo = "unchecked" if undefined else "none"
    elif stated is None:
        stereo = "unchecked"
    elif undefined or answer["stereo_from_pubchem"]:
        raise Refused(f"{name!r}: the name states only part of the stereochemistry")
    else:
        stereo = "checked"
        mirrored = Chem.MolToInchiKey(mirror_image(mol))
        if stated == "relative" and mirrored != key:
            keys.append(mirrored)
    formula = formula_of(Chem.MolToInchi(mol))
    return {
        "name": name,
        "keys": keys,
        "stereo": stereo,
        "formula": formula,
        "components": components(formula),
        "molfile": as_drawn(answer["molfile"]) if stereo == "unchecked" else answer["molfile"],
    }


def pubchem_record(name: str):
    """PubChem's recorded record for the name, or None if it answered not found."""
    recording = json.loads(lookups.byname_path(name).read_text(encoding="utf-8"))
    return None if recording["status"] == 404 else parse_structure(recording["body"])


def build_lists(files: list[NamesFile], recordings: list[dict]) -> str:
    def work(client):
        lists = []
        for names_file in files:
            items = []
            for name in names_file.names:
                response = client.post("/api/structure", json={"name": name})
                if response.status_code != 200:
                    raise Refused(f"{name!r}: the server answered {response.status_code}")
                items.append(practice_item(name, response.json(), pubchem_record(name)))
            lists.append({"id": names_file.id, "title": names_file.title, "names": items})
        return lists

    data = {"generator": GENERATOR, "lists": lookups.run_app(recordings, work)}
    return json.dumps(data, indent=2, ensure_ascii=False) + "\n"


# Drawings for the hint tests, each made from OPSIN's structure for a name: what a student
# might draw for one of the test list's names, and what the panel must say (its data-verdict).
CASES = [
    # (case, asked, how the drawing is made, verdict)
    ("the answer, drawn", "(R)-butan-2-ol", ("name", "(R)-butan-2-ol"), "correct"),
    ("the other enantiomer", "(R)-butan-2-ol", ("name", "(S)-butan-2-ol"), "stereo"),
    ("no stereo drawn", "(R)-butan-2-ol", ("name", "butan-2-ol"), "stereo"),
    ("marked as an AND group", "(R)-butan-2-ol", ("and-group", "(R)-butan-2-ol"), "stereo"),
    ("E for a name without E/Z", "pent-2-ene", ("name", "(E)-pent-2-ene"), "correct"),
    ("Z for a name without E/Z", "pent-2-ene", ("name", "(Z)-pent-2-ene"), "correct"),
    ("a crossed double bond", "pent-2-ene", ("crossed", "(E)-pent-2-ene"), "query"),
    ("R for a name without R/S", "hex-1-yn-3-ol", ("name", "(R)-hex-1-yn-3-ol"), "correct"),
    (
        "the mirror image of trans",
        "trans-1,2-dimethylcyclohexane",
        ("mirror", "trans-1,2-dimethylcyclohexane"),
        "correct",
    ),
    (
        "cis for trans",
        "trans-1,2-dimethylcyclohexane",
        ("name", "cis-1,2-dimethylcyclohexane"),
        "stereo",
    ),
    (
        "the anion for the acid",
        "4-hydroxybenzoic acid",
        ("name", "4-hydroxybenzoate"),
        "protonation",
    ),
    ("an isomer", "3-methylbutanal", ("name", "pentanal"), "isomer"),
    ("a different formula", "3-methylbutanal", ("name", "butanal"), "formula"),
    ("an extra structure", "3-methylbutanal", ("plus", "3-methylbutanal", "methane"), "fragments"),
    (
        "a reaction",
        "3-methylbutanal",
        ("reaction", "3-methylbutan-1-ol", "3-methylbutanal"),
        "reaction",
    ),
    ("a generic atom", "3-methylbutanal", ("generic", "3-methylbutanal"), "not-elements"),
    (
        "a carbon with five bonds",
        "2,2-dimethylpropane",
        ("five-bonds", "2,2-dimethylpropane"),
        "valence",
    ),
]


async def opsin_structures(names: set[str]) -> dict[str, Chem.Mol]:
    opsin = Opsin()
    await opsin.start()
    try:
        out = {}
        for name in sorted(names):
            parsed = await opsin.parse(name)
            if parsed.smiles is None:
                raise Refused(f"case drawing {name!r}: OPSIN can't parse it")
            out[name] = chem.parse(parsed.smiles)
        return out
    finally:
        await opsin.close()


def case_drawing(how: tuple, mols: dict[str, Chem.Mol]) -> dict:
    """{"molfile": ...} or {"rxn": ...}, plus RDKit's keys when the drawing is a molecule."""
    kind, *names = how
    mol = Chem.Mol(mols[names[0]])
    if kind == "reaction":
        reaction = rdChemReactions.ChemicalReaction()
        reaction.AddReactantTemplate(mol)
        reaction.AddProductTemplate(Chem.Mol(mols[names[1]]))
        return {"rxn": rdChemReactions.ReactionToRxnBlock(reaction)}
    if kind == "plus":
        mol = Chem.CombineMols(mol, mols[names[1]])
    elif kind == "mirror":
        mol = mirror_image(mol)
    elif kind == "generic":
        # The first carbon becomes a dummy atom (written as an "A" query atom).
        carbon = next(a for a in mol.GetAtoms() if a.GetSymbol() == "C")
        editable = Chem.RWMol(mol)
        editable.GetAtomWithIdx(carbon.GetIdx()).SetAtomicNum(0)
        mol = editable.GetMol()
    elif kind == "five-bonds":
        # A methyl more on the carbon that already has four bonds, unsanitized.
        editable = Chem.RWMol(mol)
        centre = next(a.GetIdx() for a in mol.GetAtoms() if a.GetDegree() == 4)
        added = editable.AddAtom(Chem.Atom(6))
        editable.AddBond(centre, added, Chem.BondType.SINGLE)
        mol = editable.GetMol()
        mol.UpdatePropertyCache(strict=False)
        return {"molfile": chem.molfile(mol)}
    block = chem.molfile(mol)
    if kind == "crossed":
        drawn = Chem.MolFromMolBlock(block)
        double = next(b for b in drawn.GetBonds() if b.GetBondType() == Chem.BondType.DOUBLE)
        double.SetStereo(Chem.BondStereo.STEREOANY)
        return {"molfile": Chem.MolToMolBlock(drawn)}
    if kind == "and-group":
        drawn = Chem.MolFromMolBlock(block)
        drawn.SetIntProp("_MolFileChiralFlag", 0)
        return {"molfile": Chem.MolToMolBlock(drawn)}
    if kind not in ("name", "plus", "mirror", "generic"):
        raise ValueError(f"unknown drawing {kind!r}")
    out = {"molfile": block}
    if kind != "generic":
        out["rdkit"] = {"inchikey": Chem.MolToInchiKey(mol), "inchi": Chem.MolToInchi(mol)}
    return out


def build_cases() -> str:
    names = {n for _, _, how, _ in CASES for n in how[1:]}
    mols = asyncio.run(opsin_structures(names))
    cases = [
        {"case": case, "asked": asked, "verdict": verdict, **case_drawing(how, mols)}
        for case, asked, how, verdict in CASES
    ]
    data = {"generator": GENERATOR, "cases": cases}
    return json.dumps(data, indent=2, ensure_ascii=False) + "\n"


def every_name() -> list[str]:
    names = [n for f in app_names_files() for n in f.names] + read_names(TEST_NAMES_FILE).names
    return list(dict.fromkeys(names))


async def record_new(names: list[str]) -> None:
    for name in names:
        if not lookups.byname_path(name).exists():
            recording = await lookups.record(lambda p, n=name: p.structure(n), (200, 404))
            lookups.save(lookups.byname_path(name), recording)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--offline", action="store_true", help="only rebuild from recordings")
    args = parser.parse_args(argv)
    if not args.offline:
        lookups.RECORDINGS.mkdir(parents=True, exist_ok=True)
        asyncio.run(record_new(every_name()))
    recordings = lookups.all_recordings()
    outputs = (
        (APP_FILE, build_lists(app_names_files(), recordings)),
        (TEST_LISTS_FILE, build_lists([read_names(TEST_NAMES_FILE)], recordings)),
        (CASES_FILE, build_cases()),
    )
    for path, text in outputs:
        path.write_text(text, encoding="utf-8")
        print(f"wrote {path.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
