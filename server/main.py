"""Naming API, served by uvicorn behind Apache at <base>api/.

Only /api/health exists so far; /api/name and /api/structure arrive with the
naming features. Rules for every endpoint added here (see AGENTS.md):
SMILES and names travel in POST bodies only, request bodies are never logged,
and user input never goes into exception or log messages.
"""

from fastapi import FastAPI

app = FastAPI(
    title="Structure naming API",
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
