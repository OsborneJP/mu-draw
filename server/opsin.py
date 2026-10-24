"""OPSIN (systematic name to structure) as one long-running Java process per API service.

server/opsin/OpsinLines.java answers one name per line (see its header). This module starts
it with the env's own Java, waits for its READY line, asks one name at a time, and gives each
name PARSE_TIMEOUT_S: a name that gets no answer, or a process that dies, means the process is
killed and started again, and that name counts as unanswered (the caller goes on to
PubChem). The process's stderr is discarded: OPSIN's logging can quote the name, and names
never reach logs. Names with line breaks or other control characters never get here (the
endpoint refuses them), so one name is always one line.
"""

from __future__ import annotations

import asyncio
import sys
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from pathlib import Path

HERE = Path(__file__).resolve().parent / "opsin"
JAR = HERE / "opsin.jar"
HELPER = HERE / "OpsinLines.java"
VERSION = "2.9.0"
# The env's own Java (the same conda env as the Python running this).
JAVA = Path(sys.prefix) / "bin" / "java"
COMMAND = (
    str(JAVA),
    "-Xmx128m",
    "-XX:+UseSerialGC",
    "-Dorg.apache.logging.log4j.level=OFF",
    "-cp",
    str(JAR),
    str(HELPER),
)
START_TIMEOUT_S = 60.0  # starting Java and compiling the helper takes about 1 s
PARSE_TIMEOUT_S = 3.0  # OPSIN takes milliseconds per name

Wait = Callable[[Awaitable[bytes], float], Awaitable[bytes]]


@dataclass(frozen=True)
class OpsinAnswer:
    """status: OK, WARN, FAIL, or UNANSWERED (OPSIN timed out or wasn't running)."""

    status: str
    smiles: str | None = None
    message: str | None = None


UNANSWERED = OpsinAnswer("UNANSWERED")
STATUSES = ("OK", "WARN", "FAIL")


class OpsinUnavailable(Exception):
    """OPSIN didn't start or didn't say READY with the expected version."""


class Opsin:
    def __init__(
        self,
        command: tuple[str, ...] = COMMAND,
        wait: Wait = asyncio.wait_for,
        start_timeout_s: float = START_TIMEOUT_S,
        parse_timeout_s: float = PARSE_TIMEOUT_S,
    ):
        self._command = command
        self._wait = wait
        self._start_timeout_s = start_timeout_s
        self._parse_timeout_s = parse_timeout_s
        self._process: asyncio.subprocess.Process | None = None
        self._lock = asyncio.Lock()
        self.starts = 0  # how many processes were started (tests read it)

    async def _start(self) -> None:
        self.starts += 1
        self._process = await asyncio.create_subprocess_exec(
            *self._command,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
        )
        try:
            line = await self._wait(self._process.stdout.readline(), self._start_timeout_s)
        except TimeoutError:
            line = b""
        if line.decode("utf-8", "replace").rstrip("\n") != f"READY\t{VERSION}":
            await self._stop()
            raise OpsinUnavailable("OPSIN did not start")

    async def _stop(self) -> None:
        process, self._process = self._process, None
        if process is not None and process.returncode is None:
            process.kill()
            await process.wait()

    async def start(self) -> None:
        async with self._lock:
            await self._start()

    async def close(self) -> None:
        async with self._lock:
            await self._stop()

    async def parse(self, name: str) -> OpsinAnswer:
        async with self._lock:
            try:
                if self._process is None or self._process.returncode is not None:
                    await self._start()
                self._process.stdin.write(name.encode("utf-8") + b"\n")
                await self._process.stdin.drain()
                line = await self._wait(self._process.stdout.readline(), self._parse_timeout_s)
            except (TimeoutError, OpsinUnavailable, ConnectionError, BrokenPipeError):
                line = b""
            fields = line.decode("utf-8", "replace").rstrip("\n").split("\t")
            # No complete line: it timed out or ended. A malformed one: it can't be trusted.
            if not line.endswith(b"\n") or len(fields) != 3 or fields[0] not in STATUSES:
                await self._stop()
                return UNANSWERED
            status, smiles, message = fields
            return OpsinAnswer(status, smiles or None, message or None)
