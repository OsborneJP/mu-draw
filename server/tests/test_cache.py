import sqlite3

from cache import COLUMNS, MAX_AGE_S, Hit, NameCache
from pubchem import Record

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
    columns = tuple(row[1] for row in db.execute("PRAGMA table_info(names)"))
    assert tables == ["names"]
    assert columns == COLUMNS == ("smiles", "cid", "iupac", "title", "stored_at")


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
