"""The RDKit data the browser's tautomer and resonance ports use (web/src/chem/rdkitTables.json).

It must be what server/scripts/gen_rdkit_tables.py builds from the recorded RDKit source and
Python RDKit's periodic table, and its transforms must be RDKit's own: Python's enumerator,
loaded with them from a file, answers as its built-in transforms do (bar A.1).
"""

import json
from pathlib import Path

import gen_rdkit_tables as gen
import pytest
from rdkit import Chem, RDConfig
from rdkit.Chem.MolStandardize import rdMolStandardize

from test_reference_fixtures import locked_version

TABLES = json.loads(gen.TABLES_FILE.read_text(encoding="utf-8"))
# The first single structures of RDKit's bundled NCI set: varied, and read from SMILES.
NCI = Path(RDConfig.RDDataDir) / "NCI" / "first_5K.smi"
SAMPLE = 300


def enumerator(tmp_path: Path, rows: list[dict[str, str]]) -> rdMolStandardize.TautomerEnumerator:
    """Python's enumerator with these transforms, read from RDKit's tab-separated file form."""
    path = tmp_path / f"transforms-{len(rows)}.tsv"
    fields = [(r["name"], r["smarts"], r["bonds"], r["charges"]) for r in rows]
    lines = ["\t".join(f).rstrip("\t") for f in fields]
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    params = rdMolStandardize.CleanupParameters()
    params.tautomerTransformsFile = str(path)
    return rdMolStandardize.TautomerEnumerator(params)


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
    assert answers(mine, sample) == answers(rdMolStandardize.TautomerEnumerator(), sample)


def test_a_missing_transform_is_caught(tmp_path, sample):
    """The comparison above is not vacuous: without the keto/enol pair it fails."""
    fewer = enumerator(tmp_path, TABLES["tautomer_transforms"][2:])
    assert answers(fewer, sample) != answers(rdMolStandardize.TautomerEnumerator(), sample)


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
