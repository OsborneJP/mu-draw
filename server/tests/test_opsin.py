import asyncio
import hashlib
import sys
from pathlib import Path

import pytest

import opsin
from fakes import HeldDeadline
from opsin import UNANSWERED, Opsin, OpsinAnswer, OpsinUnavailable

FAKE = Path(__file__).with_name("fake_opsin.py")
PARSE_TIMEOUT_S = 3.0


def fake(version: str = opsin.VERSION) -> tuple[str, ...]:
    return (sys.executable, "-I", str(FAKE), version)


def run(coroutine):
    return asyncio.run(coroutine)


async def using(service: Opsin, work):
    try:
        return await work(service)
    finally:
        await service.close()


def test_one_name_one_answer():
    async def work(service):
        await service.start()
        return [await service.parse(name) for name in ("a", "b")], service.starts

    answers, starts = run(using(Opsin(fake()), work))
    assert answers == [OpsinAnswer("OK", "smiles-of-a"), OpsinAnswer("OK", "smiles-of-b")]
    assert starts == 1


def test_names_asked_together_are_answered_one_at_a_time():
    async def work(service):
        await service.start()
        return await asyncio.gather(*(service.parse(n) for n in ("a", "b", "c")))

    answers = run(using(Opsin(fake()), work))
    assert [a.smiles for a in answers] == ["smiles-of-a", "smiles-of-b", "smiles-of-c"]


def test_a_hung_parse_is_abandoned_at_its_deadline_and_the_next_name_answered():
    async def work(service):
        deadline = service._wait
        await service.start()
        hung = asyncio.ensure_future(service.parse("hang"))
        await deadline.waiting.wait()  # the name was sent and its answer is awaited
        stuck = service._process
        deadline.expire()
        first = await hung
        assert stuck.returncode is not None  # the stuck process was killed, not reused
        return first, await service.parse("next"), service.starts

    service = Opsin(fake(), wait=HeldDeadline(PARSE_TIMEOUT_S), parse_timeout_s=PARSE_TIMEOUT_S)
    first, second, starts = run(using(service, work))
    assert first == UNANSWERED
    assert second == OpsinAnswer("OK", "smiles-of-next")
    assert starts == 2


@pytest.mark.parametrize("trouble", ["die", "garbled"])
def test_a_process_that_dies_or_garbles_is_started_again(trouble):
    async def work(service):
        await service.start()
        return await service.parse(trouble), await service.parse("next"), service.starts

    first, second, starts = run(using(Opsin(fake()), work))
    assert first == UNANSWERED
    assert second == OpsinAnswer("OK", "smiles-of-next")
    assert starts == 2


def test_another_opsin_version_is_refused():
    async def work(service):
        with pytest.raises(OpsinUnavailable):
            await service.start()
        return await service.parse("a")

    assert run(using(Opsin(fake("2.8.0")), work)) == UNANSWERED


def test_the_jar_is_the_pinned_release():
    # opsin-core-2.9.0-jar-with-dependencies.jar from github.com/dan2097/opsin releases;
    # the digest is the one GitHub publishes for that asset.
    digest = hashlib.sha256(opsin.JAR.read_bytes()).hexdigest()
    assert digest == "627ee5da4af551f9c4d1d766f545eb7cf519a344776e0bb677247a47abac0252"
    assert opsin.VERSION == "2.9.0"


def test_opsin_runs_on_the_envs_own_java():
    assert opsin.COMMAND[0] == str(Path(sys.prefix) / "bin" / "java")
    assert Path(opsin.COMMAND[0]).is_file()


def test_real_opsin_starts_parses_and_writes_nothing_to_our_output(capfd):
    async def work(service):
        await service.start()  # READY with the pinned version, or OpsinUnavailable
        return await service.parse("certainly not a chemical name")

    answer = run(using(Opsin(), work))
    assert answer.status == "FAIL"
    assert answer.message and "certainly" in answer.message
    out, err = capfd.readouterr()
    # The JVM's stderr (log4j's notice, OPSIN's logging) is discarded.
    assert out == err == ""
