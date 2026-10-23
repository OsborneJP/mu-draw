import getpass
import hashlib
import os
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def checkout_temproot() -> Path:
    digest = hashlib.sha1(str(ROOT).encode()).hexdigest()[:10]
    return Path(tempfile.gettempdir()) / f"pytest-root-{getpass.getuser()}-{digest}"


def pytest_configure(config):
    # pytest's default temp root (/tmp/pytest-of-<user>) is shared with every other
    # project on this host, and pruning its leftovers took ~30 s per run. Give this
    # checkout its own root, but keep pytest's numbered, lock-protected run directories
    # inside it, so two runs at once (check.sh and deploy.sh, say) never share a folder.
    if not config.option.basetemp and "PYTEST_DEBUG_TEMPROOT" not in os.environ:
        root = checkout_temproot()
        root.mkdir(mode=0o700, exist_ok=True)
        os.environ["PYTEST_DEBUG_TEMPROOT"] = str(root)
