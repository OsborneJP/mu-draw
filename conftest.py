import getpass
import hashlib
import tempfile
from pathlib import Path


def pytest_configure(config):
    # pytest's default temp root (/tmp/pytest-of-<user>) is shared with every
    # other project on this host, and pruning its leftovers took ~30 s per run.
    # Use a per-checkout root instead; pytest clears it at the start of a run.
    if not config.option.basetemp:
        digest = hashlib.sha1(str(Path(__file__).resolve().parent).encode()).hexdigest()[:10]
        config.option.basetemp = Path(tempfile.gettempdir()) / (
            f"pytest-{getpass.getuser()}-{digest}"
        )
