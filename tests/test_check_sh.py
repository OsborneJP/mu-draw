"""check.sh runs every stage of the acceptance bar; deleting one fails here.

(check.sh can't run itself inside its own pytest stage, so this reads it.)
"""

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CHECK = (ROOT / "scripts" / "check.sh").read_text()
WEB = (ROOT / "scripts" / "lib" / "web.sh").read_text()

STAGES = [
    'stage "placeholder literals" checks placeholders',
    'stage "chemistry literals" checks chem_literals',
    'stage "AGENTS.md" checks agents_md',
    "stage \"ruff\" bash -c 'ruff check . && ruff format --check .'",
    'stage "pytest" python -m pytest -q',
    'stage "tsc" web npx --no-install tsc -b',
    'stage "eslint" web npx --no-install eslint . --max-warnings 0',
    'stage "vitest" web npx --no-install vitest run',
    'stage "build + verify (staging)" build_and_verify "$BASE_STAGING" dist',
]


def test_check_sh_runs_every_stage_in_order():
    positions = [CHECK.find(f"\n{line}\n") for line in STAGES]
    assert all(p >= 0 for p in positions), [
        s for s, p in zip(STAGES, positions, strict=True) if p < 0
    ]
    assert positions == sorted(positions)


def test_check_sh_is_strict_and_ends_with_the_tree_check():
    assert "\nset -euo pipefail\n" in CHECK
    for line in [
        "use_env",
        "npm_ci_if_stale",
        "require_chromium",
        'TREE_BEFORE="$(tree_fingerprint)"',
    ]:
        assert f"\n{line}\n" in CHECK, line
    tail = CHECK[CHECK.index('stage "build + verify (staging)"') :]
    assert re.search(r'if \[\[ "\$\(tree_fingerprint\)" != "\$TREE_BEFORE" \]\]', tail)
    assert tail.rstrip().endswith('echo "CHECK PASSED"')


def test_every_build_is_guarded_and_smoke_tested():
    body = WEB[WEB.index("build_and_verify() {") :]
    body = body[: body.index("\n}\n")]
    steps = ["npx --no-install vite build", "node scripts/verify-dist.ts", 'smoke "$base" "$dist"']
    positions = [body.find(step) for step in steps]
    assert all(p >= 0 for p in positions) and positions == sorted(positions), body
