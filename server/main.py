"""Naming API, served by uvicorn behind Apache at <base>api/.

POST /api/name names a structure from PubChem (Get name). POST /api/structure draws a name
(Name to structure): OPSIN first (server/opsin.py, local), then PubChem's name lookup. POST
/api/safety gives a structure's GHS hazard classification from PubChem (server/ghs.py),
/api/conformer gives the 3D view its model (server/threed.py), and POST /api/count adds a
browser's anonymous weekly summary to the usage totals (server/usage.py). Rules
for every endpoint here (see AGENTS.md): SMILES and names travel in POST bodies only, request
bodies are never logged, and user input never goes into exception or log messages.

The name cache and the usage totals live in $STATE_DIRECTORY (systemd's StateDirectory=); the
service refuses to start without it. Importing this module needs no configuration (deploy.sh
checks the import).
"""

from __future__ import annotations

import datetime as dt
import logging
import os
import time
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Annotated

import httpx
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, ConfigDict, Field, StringConstraints, ValidationError
from rdkit import Chem

import chem
import ghs
import threed
import usage
from cache import NameCache
from opsin import COMMAND as OPSIN_COMMAND
from opsin import Opsin, OpsinUnavailable
from pubchem import (
    COMPOUND_PAGE,
    Busy,
    NameRecord,
    PubChem,
    RateLimit,
    Record,
    Unavailable,
    new_http,
)

log = logging.getLogger("naming")
CACHE_FILE = "name-cache.sqlite"
MAX_SMILES = 10_000
MAX_NAME = 300
# A browser's summary is a few hundred bytes; Apache refuses more than this too.
MAX_COUNT_BODY = 2048
# Apache sets this on count requests it keeps out of its access log (docs/server-setup.md (c)).
# Without it, counts would sit in that log beside an address, so none is taken.
UNLOGGED = "x-unlogged-count"


class NameRequest(BaseModel):
    smiles: str = Field(min_length=1, max_length=MAX_SMILES)


class StructureRequest(BaseModel):
    # One line of text: OPSIN reads one name per line (server/opsin.py).
    name: Annotated[
        str,
        StringConstraints(
            strip_whitespace=True, min_length=1, max_length=MAX_NAME, pattern=r"^[^\x00-\x1f\x7f]*$"
        ),
    ]


class WeekSummary(BaseModel):
    """One browser's week (web/src/usage/usage.ts). Exactly these fields, nothing else."""

    model_config = ConfigDict(extra="forbid", strict=True)
    week: Annotated[str, StringConstraints(pattern=r"^\d{4}-W\d{2}$")]
    days: int = Field(ge=1, le=7)
    installed: bool
    first: bool
    tools: list[Annotated[str, StringConstraints(pattern=r"^[a-z0-9-]{1,40}$")]] = Field(
        max_length=40
    )


class CountRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    weeks: list[WeekSummary] = Field(min_length=1, max_length=usage.MAX_WEEKS)


@dataclass
class Naming:
    cache: NameCache
    pubchem: PubChem
    opsin: Opsin


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


def safety_answer(record: Record | None, snapshot: ghs.Snapshot) -> dict[str, object]:
    found = record is not None
    classification = snapshot.classification
    return {
        "found": found,
        "cid": record.cid if found else None,
        "title": record.title if found else None,
        "url": COMPOUND_PAGE.format(cid=record.cid) if found else None,
        "classification": None if classification is None else classification.as_json(),
        "others": snapshot.others.as_json(),
    }


def drawn(
    mol,
    source: str,
    message: str | None,
    record: NameRecord | None = None,
    stereo_from_pubchem: bool = False,
) -> dict[str, object]:
    return {
        "found": True,
        "smiles": chem.canonical(mol),
        "molfile": chem.molfile(mol),
        "source": source,
        "message": message,
        "title": record.title if record else None,
        "cid": record.cid if record else None,
        "matches": record.matches if record else 0,
        "stereo_from_pubchem": stereo_from_pubchem,
    }


def not_drawn(message: str | None) -> dict[str, object]:
    return {
        "found": False,
        "smiles": None,
        "molfile": None,
        "source": None,
        "message": message,
        "title": None,
        "cid": None,
        "matches": 0,
        "stereo_from_pubchem": False,
    }


def create_app(
    *,
    state_dir: Path | None = None,
    transport: httpx.AsyncBaseTransport | None = None,
    limit: RateLimit | None = None,
    sleep=None,
    clock=None,
    opsin_command: tuple[str, ...] = OPSIN_COMMAND,
    embed: threed.Embed = threed.embed,
) -> FastAPI:
    """The app. Tests pass a replay transport, a temporary state folder, fake time and
    stand-ins for OPSIN and the 3D embedding."""

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        folder = state_dir or os.environ.get("STATE_DIRECTORY")
        if not folder:
            raise RuntimeError(
                "STATE_DIRECTORY is not set: the name cache needs a writable folder "
                "(StateDirectory= in the systemd unit; see docs/server-setup.md)"
            )
        cache = NameCache(Path(folder) / CACHE_FILE, **({"clock": clock} if clock else {}))
        app.state.counts = usage.UsageCounts(Path(folder) / usage.USAGE_FILE)
        retry_sleep = {"sleep": sleep} if sleep else {}
        opsin = Opsin(opsin_command)
        try:
            await opsin.start()
        except OpsinUnavailable:
            log.warning("OPSIN did not start; it is tried again with the next name")
        try:
            async with new_http(transport) as http:
                pubchem = PubChem(http, limit or RateLimit(), **retry_sleep)
                app.state.naming = Naming(cache, pubchem, opsin)
                app.state.embedding = threed.EmbedQueue(embed)
                yield
        finally:
            await opsin.close()
            cache.close()
            app.state.counts.close()

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

    known_tools = usage.tool_names()
    now = clock or time.time

    @app.post("/api/count")
    async def count(request: Request):
        # Never reads the client's address: nothing here could tell one browser from another.
        # A browser that asks not to be tracked (Global Privacy Control) is never counted.
        if request.headers.get("sec-gpc") == "1":
            return Response(status_code=204)
        if request.headers.get(UNLOGGED) != "1":
            return JSONResponse({"error": "not_ready"}, status_code=503)
        body = bytearray()
        async for chunk in request.stream():
            body += chunk
            if len(body) > MAX_COUNT_BODY:
                return JSONResponse({"error": "too_large"}, status_code=413)
        try:
            weeks = CountRequest.model_validate_json(bytes(body)).weeks
        except ValidationError:
            return JSONResponse({"error": "invalid_count"}, status_code=400)
        today = dt.date.fromtimestamp(now())
        if not all(usage.week_in_window(week.week, today) for week in weeks):
            return JSONResponse({"error": "invalid_count"}, status_code=400)
        summaries = [
            usage.Summary(w.week, w.days, w.installed, w.first, tuple(w.tools)) for w in weeks
        ]
        request.app.state.counts.add(summaries, known_tools)
        return Response(status_code=204)

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

    @app.post("/api/safety")
    async def safety(body: NameRequest, request: Request):
        mol = chem.parse(body.smiles)
        if mol is None:
            return JSONResponse({"error": "invalid_structure"}, status_code=400)
        smiles = chem.canonical(mol)
        naming: Naming = request.app.state.naming
        try:
            hit = naming.cache.get(smiles)  # shared with Get name
            record = hit.record if hit is not None else await naming.pubchem.name(smiles)
            if hit is None:
                naming.cache.put(smiles, record)
            if record is None:
                return safety_answer(None, ghs.NONE)
            snapshot = naming.cache.get_hazards(record.cid)
            if snapshot is None:
                section = await naming.pubchem.ghs(record.cid)
                snapshot = ghs.NONE if section is None else ghs.snapshot(section)
                naming.cache.put_hazards(record.cid, snapshot)
        except Busy:
            return JSONResponse({"error": "busy"}, status_code=503)
        except Unavailable as error:
            log.warning("PubChem safety lookup failed: %s", error)
            return JSONResponse({"error": "unavailable"}, status_code=502)
        return safety_answer(record, snapshot)

    async def by_name(naming: Naming, name: str) -> NameRecord | None:
        """PubChem's first record for a name, from the cache when it has one. Raises Busy or
        Unavailable, which are never cached."""
        key = name.lower()
        hit = naming.cache.get_structure(key)
        if hit is not None:
            return hit.record
        record = await naming.pubchem.structure(name)
        naming.cache.put_structure(key, record)
        return record

    async def with_pubchems_stereo(naming: Naming, name: str, mol):
        """OPSIN left stereo undefined (trivial names such as "nicotine" carry none in OPSIN).
        PubChem's record for the name, if it is the same compound with less left undefined
        (Jeff, 2026-10-24); else None. PubChem trouble here never fails the request."""
        try:
            record = await by_name(naming, name)
        except (Busy, Unavailable) as error:
            log.warning("PubChem stereo check skipped: %s", type(error).__name__)
            return None
        other = chem.parse(record.smiles) if record else None
        if other is None or not chem.same_connectivity(mol, other):
            return None
        if chem.undefined_stereo(other) >= chem.undefined_stereo(mol):
            return None
        return other, record

    @app.post("/api/structure")
    async def structure(body: StructureRequest, request: Request):
        naming: Naming = request.app.state.naming
        parsed = await naming.opsin.parse(body.name)
        mol = chem.parse(parsed.smiles) if parsed.smiles else None
        if mol is not None:
            better = None
            if chem.undefined_stereo(mol) > 0:
                better = await with_pubchems_stereo(naming, body.name, mol)
            if better is None:
                return drawn(mol, "OPSIN", parsed.message)
            other, record = better
            return drawn(other, "PubChem", parsed.message, record, stereo_from_pubchem=True)
        # OPSIN's own words, shown before PubChem's answer (None if it didn't answer).
        message = parsed.message
        try:
            record = await by_name(naming, body.name)
        except Busy:
            return JSONResponse({"error": "busy"}, status_code=503)
        except Unavailable as error:
            log.warning("PubChem lookup failed: %s", error)
            return JSONResponse({"error": "unavailable"}, status_code=502)
        if record is None:
            return not_drawn(message)
        mol = chem.parse(record.smiles)
        if mol is None:
            log.warning("PubChem lookup failed: unreadable SMILES")
            return JSONResponse({"error": "unavailable"}, status_code=502)
        return drawn(mol, "PubChem", message, record)

    @app.post("/api/conformer")
    async def conformer(body: NameRequest, request: Request):
        mol = chem.parse(body.smiles)
        if mol is None or not threed.elements_only(mol):
            return JSONResponse({"error": "invalid_structure"}, status_code=400)
        if len(Chem.GetMolFrags(mol)) != 1:
            return JSONResponse({"error": "one_structure"}, status_code=400)
        smiles, naming = chem.canonical(mol), request.app.state.naming
        model = naming.cache.get_conformer(smiles)
        if model is None:
            try:
                model = await threed.model_for(
                    mol, smiles, naming.pubchem, request.app.state.embedding
                )
            except threed.TooBusy:
                return JSONResponse({"error": "busy"}, status_code=503)
            if threed.cacheable(model):
                naming.cache.put_conformer(smiles, model)
        return {
            **asdict(model),
            "found": model.source is not None,
            "undefined_stereo": chem.undefined_stereo(mol),
        }

    return app


app = create_app()
