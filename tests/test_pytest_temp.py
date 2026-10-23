"""Each pytest run gets its own numbered temp folder under this checkout's temp root."""

import getpass
import re


def test_runs_get_their_own_numbered_folder(tmp_path_factory):
    base = tmp_path_factory.getbasetemp()
    # pytest-<N> folders are created under a lock, one per run, so concurrent runs
    # can't clear each other's files (a fixed --basetemp would be shared).
    assert re.fullmatch(r"pytest-\d+", base.name), base
    assert base.parent.name == f"pytest-of-{getpass.getuser()}", base
    # ...and not in the /tmp/pytest-of-<user> folder that every project on the host shares.
    assert base.parent.parent.name.startswith(f"pytest-root-{getpass.getuser()}-"), base
