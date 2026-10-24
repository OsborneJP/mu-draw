"""PubChem PUG REST client for Get name.

Every request, from every student at once, passes one rate limit (PubChem allows 5 requests
a second and 400 a minute). A 429 or 503 is retried once, after 1 s; a second one means
PubChem is busy. Anything else unexpected means it is unavailable. The SMILES goes in the
POST body, so it is never in a URL, and nothing here logs it or puts it in an exception.
"""

from __future__ import annotations

import asyncio
import logging
import time
from collections import deque
from collections.abc import Awaitable, Callable
from dataclasses import dataclass

import httpx

# httpx logs every request URL at INFO (feature 6's name lookups put names in URLs).
logging.getLogger("httpx").setLevel(logging.WARNING)

PUG = "https://pubchem.ncbi.nlm.nih.gov/rest/pug"
# Current property names (never IsomericSMILES/CanonicalSMILES; not used here anyway).
NAME_URL = f"{PUG}/compound/smiles/property/IUPACName,Title/JSON"
COMPOUND_PAGE = "https://pubchem.ncbi.nlm.nih.gov/compound/{cid}"
# (requests, seconds): at most this many requests start in any window this long.
LIMITS = ((5, 1.0), (400, 60.0))
RETRY_STATUSES = frozenset({429, 503})
RETRY_AFTER_S = 1.0
TIMEOUT_S = 5.0  # per attempt; the browser gives up at 8 s

Clock = Callable[[], float]
Sleep = Callable[[float], Awaitable[None]]


class Busy(Exception):
    """PubChem answered 429 or 503 twice in a row."""


class Unavailable(Exception):
    """PubChem could not be reached or answered something unexpected. The message is a
    status code or an exception type, never request content."""


@dataclass(frozen=True)
class Record:
    cid: int
    iupac: str | None
    title: str | None


class RateLimit:
    """Lets a request start only while fewer than `limit` started in the last `window`
    seconds, for every (limit, window). Waiters go first come, first served."""

    def __init__(self, limits=LIMITS, clock: Clock = time.monotonic, sleep: Sleep = asyncio.sleep):
        self._limits = limits
        self._clock = clock
        self._sleep = sleep
        self._starts: deque[float] = deque()
        self._lock = asyncio.Lock()
        self._longest = max(window for _, window in limits)

    def _wait(self, now: float) -> float:
        wait = 0.0
        for limit, window in self._limits:
            recent = [t for t in self._starts if t > now - window]
            if len(recent) >= limit:
                wait = max(wait, recent[-limit] + window - now)
        return wait

    async def acquire(self) -> None:
        async with self._lock:
            while (wait := self._wait(self._clock())) > 0:
                await self._sleep(wait)
            now = self._clock()
            self._starts.append(now)
            while self._starts[0] <= now - self._longest:
                self._starts.popleft()


def parse_name(body: object) -> Record | None:
    """The record in a structure-to-name answer, or None for CID 0 (PubChem has none)."""
    try:
        rows = body["PropertyTable"]["Properties"]  # type: ignore[index]
        (row,) = rows
        cid = row["CID"]
    except (KeyError, TypeError, ValueError):
        raise Unavailable("unexpected answer") from None
    if not isinstance(cid, int) or isinstance(cid, bool) or cid < 0:
        raise Unavailable("unexpected CID")
    if cid == 0:
        return None
    iupac, title = row.get("IUPACName"), row.get("Title")
    if not all(v is None or isinstance(v, str) for v in (iupac, title)):
        raise Unavailable("unexpected name")
    return Record(cid=cid, iupac=iupac, title=title)


class PubChem:
    def __init__(self, http: httpx.AsyncClient, limit: RateLimit, sleep: Sleep = asyncio.sleep):
        self._http = http
        self._limit = limit
        self._sleep = sleep

    async def _post(self, smiles: str) -> httpx.Response:
        await self._limit.acquire()
        try:
            return await self._http.post(NAME_URL, data={"smiles": smiles})
        except httpx.HTTPError as error:
            raise Unavailable(type(error).__name__) from None

    async def name(self, smiles: str) -> Record | None:
        """PubChem's record for this exact structure, or None if it has none."""
        response = await self._post(smiles)
        if response.status_code in RETRY_STATUSES:
            await self._sleep(RETRY_AFTER_S)
            response = await self._post(smiles)
            if response.status_code in RETRY_STATUSES:
                raise Busy()
        if response.status_code != 200:
            raise Unavailable(f"HTTP {response.status_code}")
        try:
            body = response.json()
        except ValueError:
            raise Unavailable("not JSON") from None
        return parse_name(body)


def new_http(transport: httpx.AsyncBaseTransport | None = None) -> httpx.AsyncClient:
    return httpx.AsyncClient(
        transport=transport, timeout=TIMEOUT_S, headers={"Accept": "application/json"}
    )
