import sqlite3

from cache import (
    COLUMNS,
    CONFORMER_COLUMNS,
    HAZARD_COLUMNS,
    MAX_AGE_S,
    STRUCTURE_COLUMNS,
    Hit,
    NameCache,
    StructureHit,
)
from pubchem import NameRecord, Record
from threed import Model

RECORD = Record(cid=1, iupac="one", title="One")


class Clock:
    def __init__(self, now: float = 1_000_000.0) -> None:
        self.now = now

    def __call__(self) -> float:
        return self.now


def test_the_cache_holds_chemistry_only(tmp_path):
    NameCache(tmp_path / "c.sqlite").close()
    db = sqlite3.connect(tmp_path / "c.sqlite")
    tables = [row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")]
    names = tuple(row[1] for row in db.execute("PRAGMA table_info(names)"))
    structures = tuple(row[1] for row in db.execute("PRAGMA table_info(structures)"))
    hazards = tuple(row[1] for row in db.execute("PRAGMA table_info(hazards)"))
    conformers = tuple(row[1] for row in db.execute("PRAGMA table_info(conformers)"))
    assert tables == ["names", "structures", "hazards", "conformers"]
    assert names == COLUMNS == ("smiles", "cid", "iupac", "title", "stored_at")
    assert structures == STRUCTURE_COLUMNS
    assert STRUCTURE_COLUMNS == ("name", "cid", "smiles", "title", "matches", "stored_at")
    assert hazards == HAZARD_COLUMNS == ("cid", "classification", "others", "stored_at")
    assert conformers == CONFORMER_COLUMNS
    assert CONFORMER_COLUMNS == (
        "smiles",
        "pubchem",
        "source",
        "cid",
        "molblock",
        "reason",
        "stored_at",
    )


def test_3d_models_come_back_and_expire_after_thirty_days(tmp_path):
    clock = Clock()
    cache = NameCache(tmp_path / "c.sqlite", clock=clock)
    shown = Model("found", "pubchem", 1, "a model", None)
    none = Model("none", None, None, None, "no_model")
    cache.put_conformer("a", shown)
    cache.put_conformer("b", none)
    assert (cache.get_conformer("a"), cache.get_conformer("b")) == (shown, none)
    assert cache.get_conformer("c") is None
    clock.now += MAX_AGE_S - 1
    assert cache.get_conformer("a") == shown
    clock.now += 1
    assert cache.get_conformer("a") is None


def test_found_and_not_found_come_back(tmp_path):
    cache = NameCache(tmp_path / "c.sqlite")
    cache.put("a", RECORD)
    cache.put("b", None)
    assert cache.get("a") == Hit(RECORD)
    assert cache.get("b") == Hit(None)
    assert cache.get("c") is None


def test_entries_expire_after_exactly_thirty_days(tmp_path):
    assert MAX_AGE_S == 30 * 24 * 60 * 60
    clock = Clock()
    cache = NameCache(tmp_path / "c.sqlite", clock=clock)
    cache.put("a", RECORD)
    clock.now += MAX_AGE_S - 1
    assert cache.get("a") == Hit(RECORD)
    clock.now += 1
    assert cache.get("a") is None


def test_a_fresh_answer_replaces_the_old_one(tmp_path):
    clock = Clock()
    cache = NameCache(tmp_path / "c.sqlite", clock=clock)
    cache.put("a", None)
    clock.now += MAX_AGE_S
    cache.put("a", RECORD)
    assert cache.get("a") == Hit(RECORD)


def test_expired_entries_are_deleted(tmp_path):
    clock = Clock()
    cache = NameCache(tmp_path / "c.sqlite", clock=clock)
    cache.put("old", RECORD)
    clock.now += MAX_AGE_S
    cache.put("new", RECORD)
    rows = sqlite3.connect(tmp_path / "c.sqlite").execute("SELECT smiles FROM names").fetchall()
    assert rows == [("new",)]


def test_the_cache_survives_a_restart(tmp_path):
    NameCache(tmp_path / "c.sqlite").put("a", RECORD)
    assert NameCache(tmp_path / "c.sqlite").get("a") == Hit(RECORD)


NAME_RECORD = NameRecord(cid=2, smiles="s", title="Two", matches=3)


def test_structures_by_name_come_back_and_expire(tmp_path):
    clock = Clock()
    cache = NameCache(tmp_path / "c.sqlite", clock=clock)
    cache.put_structure("a name", NAME_RECORD)
    cache.put_structure("unknown", None)
    assert cache.get_structure("a name") == StructureHit(NAME_RECORD)
    assert cache.get_structure("unknown") == StructureHit(None)
    assert cache.get_structure("other") is None
    clock.now += MAX_AGE_S - 1
    assert cache.get_structure("a name") == StructureHit(NAME_RECORD)
    clock.now += 1
    assert cache.get_structure("a name") is None


def test_expired_structures_are_deleted(tmp_path):
    clock = Clock()
    cache = NameCache(tmp_path / "c.sqlite", clock=clock)
    cache.put_structure("old", NAME_RECORD)
    clock.now += MAX_AGE_S
    cache.put_structure("new", NAME_RECORD)
    rows = sqlite3.connect(tmp_path / "c.sqlite").execute("SELECT name FROM structures").fetchall()
    assert rows == [("new",)]


def test_every_recorded_classification_comes_back_exactly(tmp_path):
    # Every entry of every GHS recording, not only the chosen ones, and the shapes they cover:
    # shares, Annex VI notes, not classified, notes and summaries.
    import json

    import ghs
    import record_ghs

    cache = NameCache(tmp_path / "c.sqlite")
    stored = 0
    for c in record_ghs.test_compounds():
        path = record_ghs.recording_path(c["name"])
        if not path.exists() or json.loads(path.read_text("utf-8"))["status"] != 200:
            continue
        for entry in ghs.entries(json.loads(path.read_text("utf-8"))["body"]):
            snapshot = ghs.Snapshot(ghs.read(entry), ghs.Others(3, ("a", "b")))
            cache.put_hazards(1, snapshot)
            assert cache.get_hazards(1) == snapshot
            stored += 1
    assert stored > 50


def test_a_hazards_row_another_version_wrote_reads_as_a_miss(tmp_path):
    import ghs

    cache = NameCache(tmp_path / "c.sqlite")
    cache.put_hazards(1, ghs.NONE)
    db = sqlite3.connect(tmp_path / "c.sqlite")
    db.execute("""UPDATE hazards SET classification = '{"source": "eu"}'""")
    db.commit()
    assert cache.get_hazards(1) is None
    db.execute("UPDATE hazards SET classification = NULL, others = 'not json'")
    db.commit()
    assert cache.get_hazards(1) is None
