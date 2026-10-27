"""POST /api/count: anonymous weekly summaries added to totals, and nothing else kept
(docs/plans/v2-usage-counts.md, bar B)."""

import datetime as dt
import json
import sqlite3
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import main
import usage
from fakes import FAKE_OPSIN

ROOT = Path(__file__).resolve().parents[2]
# A Wednesday of ISO week 2026-W44, by the server's own calendar.
TODAY = dt.datetime(2026, 10, 28, 12, 0)
SHIPPED = ROOT / "tests" / "fixtures" / "usage_tools_shipped.json"


# What Apache's block sets on a count request it keeps out of its access log.
MARKED = {"X-Unlogged-Count": "1"}


@pytest.fixture
def client(tmp_path):
    app = main.create_app(
        state_dir=tmp_path, clock=lambda: TODAY.timestamp(), opsin_command=FAKE_OPSIN
    )
    with TestClient(app, headers=MARKED) as test_client:
        yield test_client


def week(name="2026-W43", days=3, installed=False, first=False, tools=()):
    return {"week": name, "days": days, "installed": installed, "first": first, "tools": [*tools]}


def totals(client) -> dict[str, dict[str, int]]:
    return client.app.state.counts.totals()


def test_a_summary_adds_exactly_its_items_to_its_weeks_totals(client):
    first = week(days=3, installed=True, first=True, tools=["get-name", "export"])
    assert client.post("/api/count", json={"weeks": [first]}).status_code == 204
    second = week(days=1, tools=["export"])
    assert client.post("/api/count", json={"weeks": [second]}).status_code == 204
    assert totals(client) == {
        "2026-W43": {
            "browsers": 2,
            "browser-days": 4,
            "installed": 1,
            "new": 1,
            "tool:get-name": 1,
            "tool:export": 2,
        }
    }


def test_two_weeks_in_one_summary_are_counted_apart(client):
    body = {"weeks": [week("2026-W42", days=2), week("2026-W43", days=5)]}
    assert client.post("/api/count", json=body).status_code == 204
    assert totals(client) == {
        "2026-W42": {"browsers": 1, "browser-days": 2},
        "2026-W43": {"browsers": 1, "browser-days": 5},
    }


def test_a_tool_the_server_doesnt_know_is_ignored_and_a_repeated_one_counts_once(client):
    body = {"weeks": [week(tools=["get-name", "get-name", "not-a-tool-yet"])]}
    assert client.post("/api/count", json=body).status_code == 204
    assert totals(client)["2026-W43"] == {"browsers": 1, "browser-days": 3, "tool:get-name": 1}


@pytest.mark.parametrize(
    "body",
    [
        {"weeks": []},
        {"weeks": [week()] * (usage.MAX_WEEKS + 1)},
        {"weeks": [week()], "id": "abc"},
        {"weeks": [{**week(), "browser": "abc"}]},
        {"weeks": [{k: v for k, v in week().items() if k != "first"}]},
        {"weeks": [week(days=0)]},
        {"weeks": [week(days=8)]},
        {"weeks": [{**week(), "days": "3"}]},
        {"weeks": [{**week(), "installed": "true"}]},
        {"weeks": [week(name="2026-44")]},
        {"weeks": [week(name="2026-W54")]},
        {"weeks": [week(tools=["Get-Name"])]},
        {"weeks": [week(tools=["x" * 41])]},
        {"weeks": [week(tools=[f"t{i}" for i in range(41)])]},
        [week()],
        "weeks",
    ],
)
def test_a_body_of_the_wrong_shape_is_refused_and_counts_nothing(client, body):
    answer = client.post("/api/count", json=body)
    assert (answer.status_code, answer.json()) == (400, {"error": "invalid_count"})
    assert totals(client) == {}


def test_text_that_is_not_json_is_refused(client):
    answer = client.post(
        "/api/count", content=b"not json", headers={"content-type": "application/json"}
    )
    assert (answer.status_code, answer.json()) == (400, {"error": "invalid_count"})


@pytest.mark.parametrize(
    ("name", "taken"),
    [
        ("2026-W40", False),  # four weeks back
        ("2026-W41", True),  # three weeks back: the oldest a browser keeps, and a day apart
        ("2026-W44", True),  # this week
        ("2026-W45", True),  # next week: a device a day ahead, at the week's end
        ("2026-W46", False),
    ],
)
def test_only_weeks_from_three_back_to_one_ahead_are_taken(client, name, taken):
    answer = client.post("/api/count", json={"weeks": [week(name)]})
    assert answer.status_code == (204 if taken else 400)
    assert (name in totals(client)) == taken


def test_one_week_out_of_the_window_refuses_the_whole_summary(client):
    body = {"weeks": [week("2026-W43"), week("2026-W30")]}
    assert client.post("/api/count", json=body).status_code == 400
    assert totals(client) == {}


def test_a_browser_sending_global_privacy_control_is_not_counted(client):
    answer = client.post("/api/count", json={"weeks": [week()]}, headers={"Sec-GPC": "1"})
    assert answer.status_code == 204
    assert totals(client) == {}


def test_a_body_over_2_kb_is_refused_however_it_is_sent(client):
    big = json.dumps({"weeks": [week()], "pad": "x" * main.MAX_COUNT_BODY}).encode()
    answer = client.post("/api/count", content=big, headers={"content-type": "application/json"})
    assert (answer.status_code, answer.json()) == (413, {"error": "too_large"})

    def chunks():  # no Content-Length: read in pieces
        for start in range(0, len(big), 256):
            yield big[start : start + 256]

    json_type = {"content-type": "application/json"}
    assert client.post("/api/count", content=chunks(), headers=json_type).status_code == 413
    assert totals(client) == {}


def test_the_database_holds_only_week_item_and_count_with_no_row_order(client, tmp_path):
    marker = "zz-unknown-tool-marker"
    body = {"weeks": [week(installed=True, first=True, tools=["get-name", marker])]}
    assert client.post("/api/count", json=body).status_code == 204
    client.app.state.counts.close()
    files = sorted(p.name for p in tmp_path.iterdir() if p.name.startswith(usage.USAGE_FILE))
    assert files == [usage.USAGE_FILE]  # no journal left behind
    raw = (tmp_path / usage.USAGE_FILE).read_bytes()
    assert marker.encode() not in raw  # an ignored name is not stored
    assert b"testclient" not in raw  # nor the client's address
    db = sqlite3.connect(tmp_path / usage.USAGE_FILE)
    tables = db.execute("SELECT name, sql FROM sqlite_master WHERE type = 'table'").fetchall()
    assert [name for name, _ in tables] == ["counts"]
    assert tables[0][1].rstrip().endswith("WITHOUT ROWID")
    assert [row[1] for row in db.execute("PRAGMA table_info(counts)")] == ["week", "item", "count"]


def test_the_server_reads_its_own_copy_of_the_web_apps_tool_list():
    web = (ROOT / "web" / "src" / "usage" / "events.json").read_bytes()
    assert usage.EVENTS_FILE.read_bytes() == web, "copy web/src/usage/events.json to server/"


def test_every_tool_name_ever_shipped_is_still_counted():
    # Append-only: an older copy of the app still names these. Add a new name to the list
    # below when it ships; never remove one.
    shipped = set(json.loads(SHIPPED.read_text(encoding="utf-8")))
    assert shipped <= usage.tool_names()
    names = json.loads(usage.EVENTS_FILE.read_text(encoding="utf-8"))["tools"]
    assert len(names) == len(set(names))
    assert all(main.WeekSummary(**week(tools=[name])).tools == [name] for name in names)


def test_a_count_apache_hasnt_kept_out_of_its_log_is_not_taken(tmp_path):
    app = main.create_app(
        state_dir=tmp_path, clock=lambda: TODAY.timestamp(), opsin_command=FAKE_OPSIN
    )
    with TestClient(app) as unmarked:
        for headers in ({}, {"X-Unlogged-Count": "0"}):
            answer = unmarked.post("/api/count", json={"weeks": [week()]}, headers=headers)
            assert (answer.status_code, answer.json()) == (503, {"error": "not_ready"})
        assert unmarked.app.state.counts.totals() == {}


def test_the_same_totals_make_the_same_file_whatever_order_the_summaries_came_in(tmp_path):
    summaries = [
        usage.Summary("2026-W43", 2, True, True, ("resonance", "nmr-1h")),
        usage.Summary("2026-W43", 1, False, False, ("export",)),
        usage.Summary("2026-W44", 3, False, False, ("get-name", "export")),
        usage.Summary("2026-W43", 5, False, False, ()),
    ]
    files = []
    for name, order in (("forward", summaries), ("backward", summaries[::-1])):
        counts = usage.UsageCounts(tmp_path / f"{name}.sqlite")
        for summary in order:
            counts.add([summary], usage.tool_names())
        counts.close()
        files.append((tmp_path / f"{name}.sqlite").read_bytes())
    assert files[0] == files[1]


def test_a_file_that_wont_compact_still_keeps_the_count_and_answers_taken(client, monkeypatch):
    # Failing after the totals are stored would have the browser send the week again.
    def fail():
        raise sqlite3.OperationalError("disk I/O error")

    monkeypatch.setattr(client.app.state.counts, "_compact", fail)
    assert client.post("/api/count", json={"weeks": [week()]}).status_code == 204
    assert totals(client) == {"2026-W43": {"browsers": 1, "browser-days": 3}}
