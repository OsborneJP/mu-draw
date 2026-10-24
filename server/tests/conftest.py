import json

import pytest

import record_pubchem_names as rec
from fakes import FakeTime


@pytest.fixture
def fake_time() -> FakeTime:
    return FakeTime()


@pytest.fixture(scope="session")
def recordings() -> dict[str, dict]:
    """Recorded structure-to-name exchanges, by test compound name."""
    compounds = rec.test_compounds()
    return dict(zip((c["name"] for c in compounds), rec.load_recordings(compounds), strict=True))


@pytest.fixture(scope="session")
def expected() -> dict:
    return json.loads(rec.EXPECTED_FILE.read_text(encoding="utf-8"))
