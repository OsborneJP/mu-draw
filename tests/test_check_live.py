"""scripts/check_live.py's rules, on canned responses (no network)."""

import json

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
        body = json.dumps(e.body_json).encode() if e.body_json is not None else b""
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
        ("functional-groups.json", "cache-control", [IMMUTABLE], "functional-groups.json: Cache"),
        ("functional-groups.json", "content-type", ["text/html"], "functional-groups.json: Cont"),
        # An HTML error page where the ¹³C table should be: the preview couldn't read it.
        ("nmr/carbon-shifts.bin", "content-type", ["text/html"], "nmr/carbon-shifts.bin: Content"),
        ("nmr/carbon-shifts.bin", "cache-control", [IMMUTABLE], "nmr/carbon-shifts.bin: Cache"),
        ("nmr/LICENSE-nmrshiftdb2.txt", "content-type", ["text/html"], "nmrshiftdb2.txt: Content"),
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


def test_get_name_must_answer_as_recorded():
    expected = cl.expectations(FILES)
    (name,) = [e for e in expected if e.path == "api/name"]
    assert name.post_json == {"smiles": name.post_json["smiles"]}
    assert name.body_json["found"] is True
    results = good_results()
    results["api/name"] = cl.Fetched(502, {}, b'{"error":"unavailable"}')
    assert cl.check(results, expected, POLICY, WORKERS) == ["api/name: HTTP 502"]
    wrong = {**name.body_json, "cid": name.body_json["cid"] + 1}
    results["api/name"] = cl.Fetched(200, {}, json.dumps(wrong).encode())
    assert "api/name: body" in cl.check(results, expected, POLICY, WORKERS)[0]


def test_name_to_structure_must_answer_as_recorded():
    expected = cl.expectations(FILES)
    (structure,) = [e for e in expected if e.path == "api/structure"]
    assert structure.body_json["source"] == "OPSIN"
    assert set(structure.post_json) == {"name"}
    results = good_results()
    results["api/structure"] = cl.Fetched(502, {}, b'{"error":"unavailable"}')
    assert cl.check(results, expected, POLICY, WORKERS) == ["api/structure: HTTP 502"]
    wrong = {**structure.body_json, "source": "PubChem"}
    results["api/structure"] = cl.Fetched(200, {}, json.dumps(wrong).encode())
    assert "api/structure: body" in cl.check(results, expected, POLICY, WORKERS)[0]


def test_functional_group_patterns_must_be_this_commits():
    expected = cl.expectations(FILES)
    (patterns,) = [e for e in expected if e.path == cl.PATTERNS]
    assert patterns.body_json["groups"]  # the repo's file, parsed
    results = good_results()
    results[cl.PATTERNS] = cl.Fetched(404)
    assert cl.check(results, expected, POLICY, WORKERS) == [f"{cl.PATTERNS}: HTTP 404"]
    edited = {**patterns.body_json, "groups": patterns.body_json["groups"][1:]}
    results = good_results()
    results[cl.PATTERNS].body = json.dumps(edited).encode()
    assert f"{cl.PATTERNS}: body" in cl.check(results, expected, POLICY, WORKERS)[0]
