"""Each pytest run gets its own numbered temp folder under this checkout's temp root."""

import getpass
import os
import re
from pathlib import Path

import pytest

ROOT_PREFIX = f"pytest-root-{getpass.getuser()}-"


def test_runs_get_their_own_numbered_folder(tmp_path_factory, request):
    # Skip only if the caller chose the location (conftest then leaves it alone). Never
    # key this on something conftest sets: deleting conftest's block would hide the test.
    chosen = os.environ.get("PYTEST_DEBUG_TEMPROOT")
    if request.config.option.basetemp or (chosen and not Path(chosen).name.startswith(ROOT_PREFIX)):
        pytest.skip("--basetemp or PYTEST_DEBUG_TEMPROOT was given")
    base = tmp_path_factory.getbasetemp()
    # pytest-<N> folders are created under a lock, one per run, so concurrent runs
    # can't clear each other's files (a fixed --basetemp would be shared).
    assert re.fullmatch(r"pytest-\d+", base.name), base
    assert base.parent.name == f"pytest-of-{getpass.getuser()}", base
    # ...and not in the /tmp/pytest-of-<user> folder that every project on the host shares.
    assert base.parent.parent.name.startswith(ROOT_PREFIX), base
