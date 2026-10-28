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
        if e.body_fields is not None:
            body = json.dumps(nested(e.body_fields)).encode()
        results[e.path] = cl.Fetched(e.status, headers, body)
    return results


def nested(fields: dict[str, object]) -> dict:
    """{"a.b": 1} as {"a": {"b": 1}}."""
    out: dict = {}
    for path, value in fields.items():
        *parents, last = path.split(".")
        node = out
        for key in parents:
            node = node.setdefault(key, {})
        node[last] = value
    return out


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
        ("ir-bands.json", "cache-control", [IMMUTABLE], "ir-bands.json: Cache"),
        ("ir-bands.json", "content-type", ["text/html"], "ir-bands.json: Content"),
        # An HTML error page where the ¹³C table should be: the preview couldn't read it.
        ("nmr/carbon-shifts.bin", "content-type", ["text/html"], "nmr/carbon-shifts.bin: Content"),
        ("nmr/carbon-shifts.bin", "cache-control", [IMMUTABLE], "nmr/carbon-shifts.bin: Cache"),
        ("nmr/LICENSE-nmrshiftdb2.txt", "content-type", ["text/html"], "nmrshiftdb2.txt: Content"),
        # The same for the ¹H table.
        ("nmr/proton-shifts.bin", "content-type", ["text/html"], "nmr/proton-shifts.bin: Content"),
        ("nmr/proton-shifts.bin", "cache-control", [IMMUTABLE], "nmr/proton-shifts.bin: Cache"),
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


def test_safety_must_find_the_recorded_record_and_source():
    expected = cl.expectations(FILES)
    (safety,) = [e for e in expected if e.path == "api/safety"]
    assert set(safety.post_json) == {"smiles"}
    assert safety.body_fields["found"] is True
    results = good_results()
    # The hazards themselves may change at PubChem: other fields are not compared.
    body = {**nested(safety.body_fields), "others": {"count": 99, "sources": []}}
    results["api/safety"] = cl.Fetched(200, {}, json.dumps(body).encode())
    assert cl.check(results, expected, POLICY, WORKERS) == []
    results["api/safety"] = cl.Fetched(502, {}, b'{"error":"unavailable"}')
    assert cl.check(results, expected, POLICY, WORKERS) == ["api/safety: HTTP 502"]
    source = safety.body_fields["classification.source"]
    other = "echa" if source != "echa" else "eu"
    body = nested({**safety.body_fields, "classification.source": other})
    results["api/safety"] = cl.Fetched(200, {}, json.dumps(body).encode())
    assert cl.check(results, expected, POLICY, WORKERS) == [
        f"api/safety: classification.source is {other!r}, want {source!r}"
    ]
    results["api/safety"] = cl.Fetched(200, {}, b"<html>proxy error</html>")
    assert cl.check(results, expected, POLICY, WORKERS)[0] == "api/safety: found is None, want True"


def test_the_pictograms_must_be_served_as_svg_under_the_pages_csp():
    results = good_results()
    results["ghs/GHS07.svg"].headers["content-type"] = ["text/plain"]
    del results["ghs/GHS07.svg"].headers["content-security-policy"]
    results["ghs/GHS07.svg"].headers["cache-control"] = [IMMUTABLE]
    assert cl.check(results, cl.expectations(FILES), POLICY, WORKERS) == [
        f"ghs/GHS07.svg: Cache-Control [{IMMUTABLE!r}], want ['no-cache']",
        "ghs/GHS07.svg: Content-Type ['text/plain'], want image/svg+xml",
        "ghs/GHS07.svg: Content-Security-Policy differs from web/csp.json",
    ]


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


def test_ir_hint_table_must_be_this_commits():
    expected = cl.expectations(FILES)
    (table,) = [e for e in expected if e.path == cl.IR_BANDS]
    assert table.body_json["groups"]  # the repo's file, parsed
    results = good_results()
    results[cl.IR_BANDS] = cl.Fetched(404)
    assert cl.check(results, expected, POLICY, WORKERS) == [f"{cl.IR_BANDS}: HTTP 404"]
    edited = {**table.body_json, "version": table.body_json["version"] + "-edited"}
    results = good_results()
    results[cl.IR_BANDS].body = json.dumps(edited).encode()
    assert f"{cl.IR_BANDS}: body" in cl.check(results, expected, POLICY, WORKERS)[0]


def test_the_count_endpoint_must_be_live_and_refuse_a_wrong_summary():
    expected = cl.expectations(FILES)
    results = good_results()
    assert results["api/count?live-check-shape"].status == 400
    results["api/count?live-check-shape"] = cl.Fetched(404, {}, b"")  # the API not restarted yet
    assert cl.check(results, expected, POLICY, WORKERS) == ["api/count?live-check-shape: HTTP 404"]
    results = good_results()
    results["api/count?live-check-shape"] = cl.Fetched(204, {}, b"")  # counted it
    assert cl.check(results, expected, POLICY, WORKERS) == ["api/count?live-check-shape: HTTP 204"]
    results = good_results()
    results["api/count?live-check-shape"] = cl.Fetched(400, {}, b'{"detail": "other"}')
    assert "api/count?live-check-shape: body" in cl.check(results, expected, POLICY, WORKERS)[0]


def test_an_oversized_count_must_be_refused_by_the_api():
    expected = cl.expectations(FILES)
    results = good_results()
    results["api/count?live-check-size"] = cl.Fetched(204, {}, b"")
    assert cl.check(results, expected, POLICY, WORKERS) == ["api/count?live-check-size: HTTP 204"]
    # A 413 from anything but the API (an Apache error page) proves nothing about its limit.
    results["api/count?live-check-size"] = cl.Fetched(413, {}, b"<html>Too Large</html>")
    assert cl.check(results, expected, POLICY, WORKERS) == [
        "api/count?live-check-size: body b'<html>Too Large</html>', want {'error': 'too_large'}"
    ]


def test_count_checks_go_first_so_their_log_lines_are_written_by_the_end():
    paths = [e.path for e in cl.expectations(FILES, "live-abc")]
    assert paths[:2] == ["api/count?live-abc-shape", "api/count?live-abc-size"]


def test_a_count_request_of_this_run_in_apaches_log_is_a_problem():
    line = '10.95.20.32 - - [27/Oct/2026] "POST /app/api/count?live-abc-shape HTTP/1.1" 400 31'
    other = '10.0.0.9 - - [27/Oct/2026] "POST /app/api/count?live-xyz-size HTTP/1.1" 413 0'
    assert cl.logged_counts(f"{other}\n{line}\n", "live-abc") == [
        "Apache logged 1 count request(s): apply docs/server-setup.md (c) step 3"
    ]
    assert cl.logged_counts(f"{other}\n", "live-abc") == []


def test_the_log_is_read_from_its_end(tmp_path):
    log = tmp_path / "access.log"
    log.write_text("old line\n" * 100 + "new line\n")
    assert cl.log_tail(log, size=20).endswith("new line\n")
    assert "old line\nold line" not in cl.log_tail(log, size=12)
