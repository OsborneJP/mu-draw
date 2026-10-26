"""The RDKit data the browser's tautomer and resonance ports use (web/src/chem/rdkitTables.json).

It must be what server/scripts/gen_rdkit_tables.py builds from the recorded RDKit source and
Python RDKit's periodic table, and its transforms must be RDKit's own: Python's enumerator,
loaded with them from a file, answers as its built-in transforms do, and each transform that
any molecule tried needs is needed by a test molecule (bar A.1).
"""

import json
from pathlib import Path

import gen_rdkit_tables as gen
import pytest
from rdkit import Chem, RDConfig
from rdkit.Chem.MolStandardize import rdMolStandardize

from test_reference_fixtures import locked_version

TABLES = json.loads(gen.TABLES_FILE.read_text(encoding="utf-8"))
FIXTURES = gen.ROOT / "tests" / "fixtures"
# Each transform, and a test molecule whose tautomers differ without it: a test drawing by
# name, or an NCI molecule by its line in RDKit's set (forms_nci_expected.json). Each is the
# first found, trying every test drawing and then every NCI molecule, whose whole answer the
# panel lists (RDKit completes it, with at most 32 tautomers) and that a tautomer of it
# matches the transform's pattern.
WITNESSES: dict[str, str | int] = {
    "1,3 (thio)keto/enol f": "acetone",
    "1,3 (thio)keto/enol r": "phenol",
    "1,5 (thio)keto/enol f": "testosterone",
    "1,5 (thio)keto/enol r": 4,
    "aliphatic imine f": "histidine",
    "aliphatic imine r": "histidine",
    "special imine f": 49,
    "special imine r": 50,
    "special imine r2": 49,
    "1,3 heteroatom H shift": "tetrazole",
    "1,5 aromatic heteroatom H shift": 3,
    "1,7 aromatic heteroatom H shift f": 20,
    "1,7 aromatic heteroatom H shift r": 7,
    "1,9 aromatic heteroatom H shift f": 46,
    "1,11 aromatic heteroatom H shift f": 158,
    "furanone f": 302,
    "furanone r": 3319,
    "keten/ynol f": "ketene",
    "keten/ynol r": "ethynol",
    "ionic nitro/aci-nitro f": "nitromethane",
    "ionic nitro/aci-nitro r": 2,
    "oxim/nitroso f": "(Z)-acetaldehyde oxime",
    "oxim/nitroso r": "nitrosoethane",
    "oxim/nitroso via phenol f": 4609,
    "oxim/nitroso via phenol r": 2,
    "cyano/iso-cyanic acid f": "cyanic acid",
    "cyano/iso-cyanic acid r": "isocyanic acid",
    "formamidinesulfinic acid f": "thiourea dioxide, drawn as RDKit's tautomer with C=S",
    "formamidinesulfinic acid r": "thiourea dioxide",
    "isocyanide f": "hydrogen cyanide",
    "isocyanide r": "hydrogen isocyanide",
    "phosphonic acid f": 3205,
    "phosphonic acid r": "dimethyl phosphite",
}
# Transforms no listed answer needs, trying the test drawings and all 4,854 single structures
# of RDKit's NCI set. They are still RDKit's own (read from its source like the rest), but no
# answer the panel lists would show one missing.
OVERLAPPED = "RDKit's other transforms make the same moves on every molecule tried"
CAPPED = (
    "needed only by NCI line 1570, where RDKit stops at 33 tautomers: more than the panel lists"
)
NEVER_NEEDED = {
    "1,3 aromatic heteroatom H shift f": CAPPED,
    "1,3 aromatic heteroatom H shift ": OVERLAPPED,
    "1,5 aromatic heteroatom H shift ": OVERLAPPED,
    "1,5 aromatic heteroatom H shift r": OVERLAPPED,
}
# The first single structures of RDKit's bundled NCI set: varied, and read from SMILES.
NCI = Path(RDConfig.RDDataDir) / "NCI" / "first_5K.smi"
SAMPLE = 300
# As the panel asks RDKit: it stops at 33 tautomers (decision 7).
MAX_TAUTOMERS = 33


def enumerator(tmp_path: Path, rows: list[dict[str, str]]) -> rdMolStandardize.TautomerEnumerator:
    """Python's enumerator with these transforms, read from RDKit's tab-separated file form."""
    path = tmp_path / f"transforms-{len(rows)}.tsv"
    fields = [(r["name"], r["smarts"], r["bonds"], r["charges"]) for r in rows]
    lines = ["\t".join(f).rstrip("\t") for f in fields]
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    params = rdMolStandardize.CleanupParameters()
    params.tautomerTransformsFile = str(path)
    made = rdMolStandardize.TautomerEnumerator(params)
    made.SetMaxTautomers(MAX_TAUTOMERS)
    return made


def default() -> rdMolStandardize.TautomerEnumerator:
    made = rdMolStandardize.TautomerEnumerator()
    made.SetMaxTautomers(MAX_TAUTOMERS)
    return made


@pytest.fixture(scope="module")
def sample() -> list[Chem.Mol]:
    found = []
    for line in NCI.read_text(encoding="utf-8").splitlines():
        mol = Chem.MolFromSmiles(line.split()[0])
        if mol is not None and len(Chem.GetMolFrags(mol)) == 1:
            found.append(mol)
        if len(found) == SAMPLE:
            return found
    raise AssertionError("RDKit's NCI set is shorter than the sample")


def answers(made: rdMolStandardize.TautomerEnumerator, mols: list[Chem.Mol]) -> list:
    return [(str(r.status), list(r.smiles)) for r in map(made.Enumerate, mols)]


def test_tables_rebuild_from_the_recordings():
    assert gen.TABLES_FILE.read_text(encoding="utf-8") == gen.build()


def test_made_from_the_pinned_rdkit_source():
    assert TABLES["rdkit_version"] == locked_version("rdkit")
    for name, source in TABLES["sources"].items():
        assert source["url"].endswith(f"/{gen.TAG}/{gen.SOURCES[name]}")
        assert source["sha256"] == gen.sha256(gen.RECORDINGS / name)


def test_every_transform_in_the_source_is_read():
    source = (gen.RECORDINGS / "tautomerTransforms.in").read_text(encoding="utf-8")
    names = [t["name"] for t in TABLES["tautomer_transforms"]]
    assert len(names) == source.count("std::make_tuple(") == len(set(names))
    assert all(f'"{name}"' in source for name in names)


def test_a_transform_left_unread_is_caught():
    source = (gen.RECORDINGS / "tautomerTransforms.in").read_text(encoding="utf-8")
    broken = source.replace('std::string("[PX4H]=[O]")', "std::string([PX4H]=[O])")
    with pytest.raises(ValueError, match="read 36 transforms of 37"):
        gen.transforms(broken)


def test_transforms_answer_as_rdkits_own(tmp_path, sample):
    mine = enumerator(tmp_path, TABLES["tautomer_transforms"])
    assert answers(mine, sample) == answers(default(), sample)


def test_a_missing_transform_is_caught(tmp_path, sample):
    """The comparison above is not vacuous: without the keto/enol pair it fails."""
    fewer = enumerator(tmp_path, TABLES["tautomer_transforms"][2:])
    assert answers(fewer, sample) != answers(default(), sample)


def test_elements_are_rdkits_periodic_table():
    table = Chem.GetPeriodicTable()
    assert len(TABLES["elements"]) == 119
    for z, element in enumerate(TABLES["elements"]):
        valences = list(table.GetValenceList(z))
        assert element == {"outer": table.GetNOuterElecs(z), "valences": valences}
        # The ports take an element's default valence as the first of its list, as RDKit does.
        assert table.GetDefaultValence(z) == element["valences"][0], z


def test_electronegativities_are_the_ones_resonance_ranks_by():
    source = (gen.RECORDINGS / "Resonance.cpp").read_text(encoding="utf-8")
    assert TABLES["electronegativity"] == gen.electronegativities(source)


def witness(key: str | int) -> Chem.Mol:
    """A test drawing by name, or an NCI sample molecule by its line."""
    if isinstance(key, int):
        nci = json.loads((FIXTURES / "forms_nci_expected.json").read_text(encoding="utf-8"))
        return Chem.MolFromSmiles(next(m["smiles"] for m in nci["molecules"] if m["line"] == key))
    for name in ("tautomers_expected.json", "resonance_expected.json"):
        for c in json.loads((FIXTURES / name).read_text(encoding="utf-8"))["compounds"]:
            if c["name"] == key:
                return Chem.MolFromMolBlock((FIXTURES / c["file"]).read_text(encoding="utf-8"))
    raise AssertionError(f"{key} is no test molecule")


def test_every_transform_has_a_witness_or_a_reason():
    names = [t["name"] for t in TABLES["tautomer_transforms"]]
    assert not set(WITNESSES) & set(NEVER_NEEDED)
    assert sorted([*WITNESSES, *NEVER_NEEDED]) == sorted(names)


def test_each_witness_needs_its_transform(tmp_path):
    rows = TABLES["tautomer_transforms"]
    full = enumerator(tmp_path, rows)
    for i, row in enumerate(rows):
        if row["name"] not in WITNESSES:
            continue
        mol = witness(WITNESSES[row["name"]])
        without = enumerator(tmp_path, [r for k, r in enumerate(rows) if k != i])
        assert list(without.Enumerate(mol).smiles) != list(full.Enumerate(mol).smiles), row["name"]
