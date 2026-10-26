"""Fake time and a fake PubChem for the server tests (server/tests/conftest.py)."""

import asyncio
import sys
from pathlib import Path

import httpx

import record_pubchem_names as rec

# server/tests/fake_opsin.py, answering as OPSIN 2.9.0 would say READY.
FAKE_OPSIN = (sys.executable, "-I", str(Path(__file__).with_name("fake_opsin.py")), "2.9.0")


class FakeTime:
    """A clock that moves only when something sleeps, so waits are exact and instant."""

    def __init__(self) -> None:
        self.now = 0.0
        self.sleeps: list[float] = []

    def clock(self) -> float:
        return self.now

    async def sleep(self, seconds: float) -> None:
        self.sleeps.append(seconds)
        self.now += seconds
        await asyncio.sleep(0)


class FakePubChem:
    """A MockTransport that answers from a list of (status, body) and notes each request's
    time on a FakeTime."""

    def __init__(self, time: FakeTime, answers: list[tuple[int, object]]) -> None:
        self.time = time
        self.answers = list(answers)
        self.requests: list[tuple[float, dict[str, str]]] = []
        self.urls: list[str] = []
        self.transport = httpx.MockTransport(self._handle)

    def _handle(self, request: httpx.Request) -> httpx.Response:
        self.requests.append((self.time.now, rec.form(request)))
        self.urls.append(str(request.url))
        status, body = self.answers.pop(0) if len(self.answers) > 1 else self.answers[0]
        if isinstance(body, Exception):
            raise body
        if isinstance(body, str):
            return httpx.Response(status, text=body)
        return httpx.Response(status, json=body)


class HeldDeadline:
    """A `wait` for server/opsin.py whose parse deadline passes only when the test says so.
    `waiting` is set once a parse is waiting for its answer; `expire()` ends that wait."""

    def __init__(self, parse_timeout_s: float) -> None:
        self.parse_timeout_s = parse_timeout_s
        self.waiting = asyncio.Event()
        self._expired = asyncio.Event()

    def expire(self) -> None:
        self._expired.set()

    async def __call__(self, awaitable, timeout: float):
        if timeout != self.parse_timeout_s:  # startup: just wait for READY
            return await awaitable
        answer = asyncio.ensure_future(awaitable)
        expired = asyncio.ensure_future(self._expired.wait())
        self.waiting.set()
        done, _ = await asyncio.wait({answer, expired}, return_when=asyncio.FIRST_COMPLETED)
        self.waiting.clear()
        if answer in done:
            expired.cancel()
            return answer.result()
        answer.cancel()
        self._expired.clear()
        raise TimeoutError
