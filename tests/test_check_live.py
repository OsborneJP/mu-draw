"""scripts/check_live.py's rules, on canned responses (no network)."""

import check_live as cl
import pytest

from render_server_config import IMMUTABLE

POLICY = "default-src 'self'"
WORKERS = {"rdkit/worker.js": "default-src 'self'; script-src 'unsafe-eval'"}
FILES = [
    "index.html",
    "sw.js",
    "workbox-1a2b.js",
    "manifest.webmanifest",
    "assets/indigoWorker-d22340fa-Ab1.js",
    "assets/indigo-ketcher-1.46.0-Xy_z.wasm",
    "assets/index-Q.js",
    "rdkit/RDKit_minimal.wasm",
    "rdkit/worker.js",
]


def good_results() -> dict[str, cl.Fetched]:
    expected = cl.expectations(FILES)
    results = {}
    for e in expected:
        headers = {}
        if e.cache:
            headers["cache-control"] = [e.cache]
        if e.content_type:
            headers["content-type"] = [
                e.content_type + ("; charset=utf-8" if "html" in e.content_type else "")
            ]
        if e.csp:
            headers["content-security-policy"] = [POLICY]
        if e.worker_csp:
            headers["content-security-policy"] = [WORKERS[e.path]]
        body = b'{"ok":true}' if e.body_json is not None else b""
        results[e.path] = cl.Fetched(200, headers, body)
    return results


def test_a_correct_deploy_passes():
    assert cl.check(good_results(), cl.expectations(FILES), POLICY, WORKERS) == []


def test_two_cache_control_headers_fail():
    # What `Header always set` next to `Header set` would produce.
    results = good_results()
    asset = "assets/indigo-ketcher-1.46.0-Xy_z.wasm"
    results[asset].headers["cache-control"] = ["no-cache", IMMUTABLE]
    assert cl.check(results, cl.expectations(FILES), POLICY, WORKERS) == [
        f"{asset}: Cache-Control ['no-cache', {IMMUTABLE!r}], want [{IMMUTABLE!r}]"
    ]


@pytest.mark.parametrize(
    ("path", "header", "value", "problem"),
    [
        ("sw.js", "cache-control", [IMMUTABLE], "sw.js: Cache-Control"),
        ("rdkit/RDKit_minimal.wasm", "content-type", ["application/octet-stream"], "Content-Type"),
        ("", "content-security-policy", ["default-src *"], "differs from web/csp.json"),
        ("assets/indigoWorker-d22340fa-Ab1.js", "content-security-policy", [], "differs"),
        # The RDKit worker with the page's policy: RDKit couldn't start.
        (
            "rdkit/worker.js",
            "content-security-policy",
            [POLICY],
            "differs from web/csp-workers.json",
        ),
        ("rdkit/worker.js", "cache-control", [IMMUTABLE], "rdkit/worker.js: Cache-Control"),
    ],
)
def test_wrong_headers_fail(path, header, value, problem):
    results = good_results()
    results[path].headers[header] = value
    problems = cl.check(results, cl.expectations(FILES), POLICY, WORKERS)
    assert len(problems) == 1 and problem in problems[0]


def test_api_must_answer_through_apache():
    results = good_results()
    results["api/health"] = cl.Fetched(503)
    assert cl.check(results, cl.expectations(FILES), POLICY, WORKERS) == ["api/health: HTTP 503"]
    results["api/health"] = cl.Fetched(200, {}, b"<html>proxy error</html>")
    assert "api/health: body" in cl.check(results, cl.expectations(FILES), POLICY, WORKERS)[0]
