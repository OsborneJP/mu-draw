import logging
import uuid

import pytest
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient
from pydantic import BaseModel

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
