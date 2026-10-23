"""Mutation sweep for the deploy scripts: every guard line must have a test.

    python scripts/mutation_sweep.py        # ~5 min; run after changing deploy scripts

Deletes each executable line of scripts/deploy.sh and scripts/lib/deploy.sh in turn
(replacing it with ':'), runs tests/test_deploy_lib.py, and fails if a deletion goes
unnoticed, other than the accepted survivors below. Not part of check.sh (too slow for
every commit); the files are always restored, even on Ctrl-C.
"""

from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FILES = [ROOT / "scripts" / "deploy.sh", ROOT / "scripts" / "lib" / "deploy.sh"]
TESTS = [sys.executable, "-m", "pytest", "-q", "-x", str(ROOT / "tests" / "test_deploy_lib.py")]

# Lines that are not commands: blank, comments, braces, keywords, case labels, local
# declarations, function headers. Messages (echo) are output, not guards.
NOT_A_COMMAND = re.compile(
    r"^\s*($|#|\}|\{|fi\b|else\b|then\b|do\b|done\b|esac\b|;;|local \w+(=\S+)?( \w+)*$"
    r"|[\w|* -]+\)\s*$|.*\(\)\s*\{\s*$|echo |set -|source )"
)

# Deleting these changes nothing a test can observe, and why that is fine.
ACCEPTED = {
    # usage(): help text only.
    "sed -n '2,10p' \"$ROOT/scripts/deploy.sh\" | sed 's/^# \\{0,1\\}//'",
    # require_deployed_head with nothing deployed: without the early return it still
    # returns 1, since "" never equals HEAD.
    "return 1",
    # server_changed with no previous deploy: git diff on "" fails, which also means changed.
    '[[ -z "$previous" ]] && return 0',
    # started_since with no start time: `date -d n/a` fails, which also means not started.
    '[[ -n "$started" && "$started" != "n/a" ]] || return 1',
}


def main() -> int:
    survivors = []
    for path in FILES:
        original = path.read_text()
        lines = original.splitlines(keepends=True)
        try:
            for i, line in enumerate(lines):
                if NOT_A_COMMAND.match(line):
                    continue
                path.write_text("".join(lines[:i] + [":\n"] + lines[i + 1 :]))
                caught = subprocess.run(TESTS, cwd=ROOT, capture_output=True).returncode != 0
                where = f"{path.relative_to(ROOT)}:{i + 1}: {line.strip()}"
                print(f"{'caught' if caught else 'SURVIVED':8s} {where}", flush=True)
                if not caught and line.strip() not in ACCEPTED:
                    survivors.append(where)
        finally:
            path.write_text(original)
    if survivors:
        print("\nDeleting these lines breaks no test; add a test for each:")
        print("\n".join(survivors))
        return 1
    print("\nEvery deploy line is covered (apart from the accepted survivors).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
