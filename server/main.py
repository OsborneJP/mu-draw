"""Naming API, served by uvicorn behind Apache at <base>api/.

POST /api/name names a structure from PubChem (Get name); /api/structure arrives with Name to
structure. Rules for every endpoint here (see AGENTS.md): SMILES and names travel in POST
bodies only, request bodies are never logged, and user input never goes into exception or
log messages.

The name cache lives in $STATE_DIRECTORY (systemd's StateDirectory=); the service refuses to
start without it. Importing this module needs no configuration (deploy.sh checks the import).
"""

from __future__ import annotations

import logging
import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass
from pathlib import Path

import httpx
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

import chem
from cache import NameCache
from pubchem import COMPOUND_PAGE, Busy, PubChem, RateLimit, Record, Unavailable, new_http

log = logging.getLogger("naming")
CACHE_FILE = "name-cache.sqlite"
MAX_SMILES = 10_000


class NameRequest(BaseModel):
    smiles: str = Field(min_length=1, max_length=MAX_SMILES)


@dataclass
class Naming:
    cache: NameCache
    pubchem: PubChem


def answer(record: Record | None, undefined_stereo: int) -> dict[str, object]:
    found = record is not None
    return {
        "found": found,
        "iupac": record.iupac if found else None,
        "title": record.title if found else None,
        "cid": record.cid if found else None,
        "url": COMPOUND_PAGE.format(cid=record.cid) if found else None,
        "undefined_stereo": undefined_stereo,
    }


def create_app(
    *,
    state_dir: Path | None = None,
    transport: httpx.AsyncBaseTransport | None = None,
    limit: RateLimit | None = None,
    sleep=None,
    clock=None,
) -> FastAPI:
    """The app. Tests pass a replay transport, a temporary state folder and fake time."""

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        folder = state_dir or os.environ.get("STATE_DIRECTORY")
        if not folder:
            raise RuntimeError(
                "STATE_DIRECTORY is not set: the name cache needs a writable folder "
                "(StateDirectory= in the systemd unit; see docs/server-setup.md)"
            )
        cache = NameCache(Path(folder) / CACHE_FILE, **({"clock": clock} if clock else {}))
        retry_sleep = {"sleep": sleep} if sleep else {}
        try:
            async with new_http(transport) as http:
                pubchem = PubChem(http, limit or RateLimit(), **retry_sleep)
                app.state.naming = Naming(cache, pubchem)
                yield
        finally:
            cache.close()

    app = FastAPI(
        title="Structure naming API",
        lifespan=lifespan,
        # The interactive docs pages load scripts and fonts from CDNs.
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
        # FastAPI's native telemetry records validation failures with their
        # messages, which can echo request bodies. Turn all of it off.
        telemetry={
            "tracing": False,
            "metrics": False,
            "logs": False,
            "operation_spans": False,
            "auto_configure": False,
        },
    )

    @app.get("/api/health")
    def health() -> dict[str, bool]:
        return {"ok": True}

    @app.post("/api/name")
    async def name(body: NameRequest, request: Request):
        mol = chem.parse(body.smiles)
        if mol is None:
            return JSONResponse({"error": "invalid_structure"}, status_code=400)
        smiles, undefined = chem.canonical(mol), chem.undefined_stereo(mol)
        naming: Naming = request.app.state.naming
        hit = naming.cache.get(smiles)
        if hit is not None:
            return answer(hit.record, undefined)
        try:
            record = await naming.pubchem.name(smiles)
        except Busy:
            return JSONResponse({"error": "busy"}, status_code=503)
        except Unavailable as error:
            log.warning("PubChem lookup failed: %s", error)
            return JSONResponse({"error": "unavailable"}, status_code=502)
        naming.cache.put(smiles, record)
        return answer(record, undefined)

    return app


app = create_app()
