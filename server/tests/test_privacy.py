import datetime as dt
import logging
import uuid

import pytest
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient
from pydantic import BaseModel

import main
from fakes import FAKE_OPSIN
from main import app


class Probe(BaseModel):
    smiles: str


@pytest.fixture
def client_with_probe():
    """The real app plus a body-validating route, so 422 handling is covered
    before the naming endpoints exist."""

    @app.post("/api/_probe")
    def probe(body: Probe) -> dict[str, str]:
        raise RuntimeError("probe failed")

    try:
        yield TestClient(app, raise_server_exceptions=False)
    finally:
        app.router.routes[:] = [
            r for r in app.router.routes if getattr(r, "path", None) != "/api/_probe"
        ]


def test_request_bodies_never_reach_logs(client_with_probe, caplog, capfd):
    sentinel = f"SENTINEL-{uuid.uuid4().hex}"
    caplog.set_level(logging.DEBUG)
    paths = [r.path for r in app.routes if isinstance(r, APIRoute)] + ["/api/missing"]
    assert "/api/_probe" in paths
    for path in paths:
        client_with_probe.post(path, json={"smiles": sentinel})  # 200/405/404/500
        client_with_probe.post(path, json={"wrong": sentinel})  # 422 on the probe
        client_with_probe.post(
            path, content=f"not json {sentinel}", headers={"content-type": "application/json"}
        )
    out, err = capfd.readouterr()
    assert sentinel not in caplog.text
    assert sentinel not in out + err


@pytest.mark.parametrize("path", ["/docs", "/redoc", "/openapi.json", "/api/docs"])
def test_docs_pages_are_off(path):
    assert TestClient(app).get(path).status_code == 404


def test_telemetry_is_off():
    for key in ("tracing", "metrics", "logs", "operation_spans", "auto_configure"):
        assert app._telemetry[key] is False, key


def test_count_bodies_never_reach_logs_or_the_totals(tmp_path, caplog, capfd):
    # Through the storing path (lifespan running, Apache's header set): the sentinel in every
    # field of a count body, valid or not.
    sentinel = f"sentinel-{uuid.uuid4().hex[:24]}"  # a valid tool name: at most 40 characters
    caplog.set_level(logging.DEBUG)
    week = dt.date(2026, 10, 28).isocalendar()
    today = dt.datetime(2026, 10, 28, 12).timestamp()
    valid = {"week": f"{week.year}-W{week.week:02d}", "days": 1, "installed": False, "first": False}
    app = main.create_app(state_dir=tmp_path, clock=lambda: today, opsin_command=FAKE_OPSIN)
    with TestClient(app, headers={"X-Unlogged-Count": "1"}) as client:
        taken = client.post("/api/count", json={"weeks": [{**valid, "tools": [sentinel]}]})
        assert taken.status_code == 204  # taken; the tool it doesn't know is ignored
        for body in (
            {"weeks": [{**valid, "week": sentinel, "tools": []}]},
            {"weeks": [{**valid, "tools": []}], sentinel: 1},
            {"weeks": [{**valid, "days": sentinel, "tools": []}]},
        ):
            client.post("/api/count", json=body)
        plain = {"weeks": [{**valid, "tools": []}]}
        assert client.post("/api/count", json=plain).status_code == 204
    out, err = capfd.readouterr()
    assert sentinel not in caplog.text
    assert sentinel not in out + err
    for path in tmp_path.iterdir():
        assert sentinel.encode() not in path.read_bytes(), path.name
