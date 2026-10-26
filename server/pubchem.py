"""PubChem PUG REST client for Get name and Name to structure, and PUG View for Safety.

Every request, from every student at once, passes one rate limit (PubChem allows 5 requests
a second and 400 a minute). A 429 or 503 is retried once, after 1 s; a second one means
PubChem is busy. Anything else unexpected means it is unavailable. The SMILES or name goes
in the POST body, so it is never in a URL, and nothing here logs it or puts it in an exception.
Safety's GET has only a CID in its URL.
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
# Name to structure's fallback: SMILES (with stereo) and title for a name, POSTed as `name`.
STRUCTURE_URL = f"{PUG}/compound/name/property/SMILES,Title/JSON"
COMPOUND_PAGE = "https://pubchem.ncbi.nlm.nih.gov/compound/{cid}"
# Safety: PUG View's GHS section for a CID (server/ghs.py reads it).
GHS_URL = "https://pubchem.ncbi.nlm.nih.gov/rest/pug_view/data/compound/{cid}/JSON"
GHS_PARAMS = {"heading": "GHS Classification"}
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


@dataclass(frozen=True)
class NameRecord:
    cid: int
    smiles: str
    title: str | None
    matches: int  # how many records PubChem has for the name; this is its first


def parse_structure(body: object) -> NameRecord:
    """PubChem's first record in a name-to-structure answer."""
    try:
        rows = body["PropertyTable"]["Properties"]  # type: ignore[index]
        row = rows[0]
        cid, smiles = row["CID"], row["SMILES"]
    except (KeyError, TypeError, IndexError):
        raise Unavailable("unexpected answer") from None
    if not isinstance(cid, int) or isinstance(cid, bool) or cid <= 0:
        raise Unavailable("unexpected CID")
    title = row.get("Title")
    if not isinstance(smiles, str) or not smiles or not (title is None or isinstance(title, str)):
        raise Unavailable("unexpected record")
    return NameRecord(cid=cid, smiles=smiles, title=title, matches=len(rows))


def not_found(response: httpx.Response, code: str = "PUGREST.NotFound") -> bool:
    """PubChem's answer for a name it doesn't know: 404 with PUGREST.NotFound (PUG View: a
    compound with no such section, PUGVIEW.NotFound)."""
    try:
        return response.status_code == 404 and response.json()["Fault"]["Code"] == code
    except (ValueError, KeyError, TypeError):
        return False


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

    async def _post(self, url: str, form: dict[str, str] | None) -> httpx.Response:
        """POST `form`, or GET when there is none."""
        await self._limit.acquire()
        try:
            if form is None:
                return await self._http.get(url)
            return await self._http.post(url, data=form)
        except httpx.HTTPError as error:
            raise Unavailable(type(error).__name__) from None

    async def _ask(self, url: str, form: dict[str, str] | None) -> httpx.Response:
        """POST (or GET), retrying once after RETRY_AFTER_S on 429 or 503."""
        response = await self._post(url, form)
        if response.status_code in RETRY_STATUSES:
            await self._sleep(RETRY_AFTER_S)
            response = await self._post(url, form)
            if response.status_code in RETRY_STATUSES:
                raise Busy()
        return response

    @staticmethod
    def _json(response: httpx.Response) -> object:
        if response.status_code != 200:
            raise Unavailable(f"HTTP {response.status_code}")
        try:
            return response.json()
        except ValueError:
            raise Unavailable("not JSON") from None

    async def name(self, smiles: str) -> Record | None:
        """PubChem's record for this exact structure, or None if it has none."""
        return parse_name(self._json(await self._ask(NAME_URL, {"smiles": smiles})))

    async def structure(self, name: str) -> NameRecord | None:
        """PubChem's first record for a name (common or trade names), or None if none."""
        response = await self._ask(STRUCTURE_URL, {"name": name})
        if not_found(response):
            return None
        return parse_structure(self._json(response))

    async def ghs(self, cid: int) -> object | None:
        """PUG View's GHS section for a compound (JSON), or None if PubChem lists none."""
        url = str(httpx.URL(GHS_URL.format(cid=cid), params=GHS_PARAMS))
        response = await self._ask(url, None)
        if not_found(response, "PUGVIEW.NotFound"):
            return None
        return self._json(response)


def new_http(transport: httpx.AsyncBaseTransport | None = None) -> httpx.AsyncClient:
    return httpx.AsyncClient(
        transport=transport, timeout=TIMEOUT_S, headers={"Accept": "application/json"}
    )
