import json
import subprocess
from pathlib import Path

import pytest

# A synthetic config, so these tests contain no real placeholder literals.
SAMPLE = {
    "name": "zz-app",
    "path": "zp",
    "ports": {"production": 9100, "staging": 9101, "dev": 9102},
}


@pytest.fixture
def repo(tmp_path: Path) -> Path:
    subprocess.run(["git", "init", "-q"], cwd=tmp_path, check=True)
    (tmp_path / "app.config.json").write_text(json.dumps(SAMPLE))
    return tmp_path
