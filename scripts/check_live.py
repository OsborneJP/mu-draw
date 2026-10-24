"""Check a deployed target's headers and API before the live smoke tests.

    python scripts/check_live.py <app-url> <dist-dir>

Confirms what docs/server-setup.md promises: the API answers through Apache, and names a
reference compound (aspirin) as recorded, which needs PubChem or the server's cache;
index.html, sw.js, the manifest and the RDKit files revalidate (no-cache); hashed assets
are immutable;
WebAssembly and the manifest have the right types; every page and worker script carries
the build's CSP, exactly once, and the RDKit worker its own (web/csp-workers.json).
"""

from __future__ import annotations

import json
import re
import sys
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path

from lib.appconfig import ROOT
from render_server_config import IMMUTABLE, csp_policy, worker_policies


@dataclass
class Fetched:
    status: int
    headers: dict[str, list[str]] = field(default_factory=dict)
    body: bytes = b""

    def header(self, name: str) -> list[str]:
        return self.headers.get(name.lower(), [])


@dataclass(frozen=True)
class Expect:
    path: str  # relative to the app URL
    cache: str | None = None
    content_type: str | None = None
    csp: bool = False  # the page's policy (web/csp.json)
    worker_csp: bool = False  # this worker's own policy (web/csp-workers.json)
    body_json: object = None
    post_json: object = None  # POST this as JSON instead of a GET


FIXTURES = ROOT / "tests" / "fixtures"


def name_check() -> Expect:
    """Get name through Apache and the API: aspirin's PubChem SMILES (from the reference
    fixtures) must get the answer recorded for it (tests/fixtures/name_responses.json)."""
    expected = json.loads((FIXTURES / "reference_expected.json").read_text(encoding="utf-8"))
    aspirin = next(c for c in expected["compounds"] if c["typed_name"] == "aspirin")
    responses = json.loads((FIXTURES / "name_responses.json").read_text(encoding="utf-8"))
    return Expect(
        "api/name",
        body_json=responses["responses"]["aspirin"],
        post_json={"smiles": aspirin["smiles"]},
    )


def expectations(dist_files: list[str]) -> list[Expect]:
    def one(pattern: str) -> str:
        found = [f for f in dist_files if re.fullmatch(pattern, f)]
        if len(found) != 1:
            raise ValueError(f"expected one dist file matching {pattern}, found {found}")
        return found[0]

    return [
        Expect("", cache="no-cache", content_type="text/html", csp=True),
        Expect("sw.js", cache="no-cache", csp=True),
        Expect(one(r"workbox-[\w-]+\.js")),
        Expect("manifest.webmanifest", cache="no-cache", content_type="application/manifest+json"),
        Expect(one(r"assets/indigoWorker-[\w-]+\.js"), cache=IMMUTABLE, csp=True),
        Expect(
            one(r"assets/indigo-ketcher-\d[\w.-]*\.wasm"),
            cache=IMMUTABLE,
            content_type="application/wasm",
        ),
        Expect("rdkit/RDKit_minimal.wasm", cache="no-cache", content_type="application/wasm"),
        Expect("rdkit/worker.js", cache="no-cache", worker_csp=True),
        Expect("api/health", body_json={"ok": True}),
        name_check(),
    ]


def check(
    results: dict[str, Fetched],
    expected: list[Expect],
    policy: str,
    workers: dict[str, str] | None = None,
) -> list[str]:
    problems = []
    for e in expected:
        got = results[e.path]
        where = e.path or "index.html"
        if got.status != 200:
            problems.append(f"{where}: HTTP {got.status}")
            continue
        if e.cache is not None and got.header("cache-control") != [e.cache]:
            problems.append(
                f"{where}: Cache-Control {got.header('cache-control')}, want [{e.cache!r}]"
            )
        if e.content_type is not None:
            types = got.header("content-type")
            if len(types) != 1 or not types[0].startswith(e.content_type):
                problems.append(f"{where}: Content-Type {types}, want {e.content_type}")
        if e.csp and got.header("content-security-policy") != [policy]:
            problems.append(f"{where}: Content-Security-Policy differs from web/csp.json")
        if e.worker_csp and got.header("content-security-policy") != [(workers or {}).get(e.path)]:
            problems.append(f"{where}: Content-Security-Policy differs from web/csp-workers.json")
        if e.body_json is not None:
            try:
                body = json.loads(got.body)
            except ValueError:
                body = None
            if body != e.body_json:
                problems.append(f"{where}: body {got.body[:80]!r}, want {e.body_json}")
    return problems


def fetch(url: str, with_body: bool, post_json: object = None) -> Fetched:
    if post_json is not None:
        data = json.dumps(post_json).encode("utf-8")
        headers = {"Content-Type": "application/json"}
        request = urllib.request.Request(url, data=data, headers=headers, method="POST")
    else:
        request = urllib.request.Request(url, method="GET" if with_body else "HEAD")
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            status, headers = response.status, response.headers
            body = response.read() if with_body else b""
    except urllib.error.HTTPError as error:
        status, headers, body = error.code, error.headers, b""
    collected: dict[str, list[str]] = {}
    for name in set(headers.keys()):
        collected[name.lower()] = headers.get_all(name) or []
    return Fetched(status, collected, body)


def main(argv: list[str]) -> int:
    if len(argv) != 3:
        print(__doc__)
        return 2
    url, dist = argv[1].rstrip("/") + "/", Path(argv[2])
    files = [p.relative_to(dist).as_posix() for p in sorted(dist.rglob("*")) if p.is_file()]
    expected = expectations(files)
    results = {
        e.path: fetch(url + e.path, with_body=e.body_json is not None, post_json=e.post_json)
        for e in expected
    }
    problems = check(results, expected, csp_policy(ROOT / "web" / "csp.json"), worker_policies())
    for problem in problems:
        print(f"live: {problem}")
    if not problems:
        print(f"live: {url} headers, types and API ok ({len(expected)} checks)")
    return 1 if problems else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
