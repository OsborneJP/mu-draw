import json
import subprocess
from pathlib import Path

import pytest

from conftest_sample import SAMPLE_CONFIG

# A synthetic config, so these tests contain no real placeholder literals.
SAMPLE = SAMPLE_CONFIG


@pytest.fixture
def repo(tmp_path: Path) -> Path:
    # The root conftest strips GIT_* variables and global config for the whole session.
    subprocess.run(["git", "init", "-q"], cwd=tmp_path, check=True)
    (tmp_path / "app.config.json").write_text(json.dumps(SAMPLE))
    return tmp_path
