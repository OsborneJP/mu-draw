import asyncio

import httpx
import pytest

import pubchem
from fakes import FakePubChem
from pubchem import Busy, PubChem, RateLimit, Record, Unavailable

NOT_FOUND = {"PropertyTable": {"Properties": [{"CID": 0}]}}


def found(cid: int) -> dict:
    return {"PropertyTable": {"Properties": [{"CID": cid, "IUPACName": "i", "Title": "t"}]}}


def client(fake_time, answers):
    server = FakePubChem(fake_time, answers)
    limit = RateLimit(clock=fake_time.clock, sleep=fake_time.sleep)
    http = httpx.AsyncClient(transport=server.transport)
    return server, PubChem(http, limit, sleep=fake_time.sleep)


def run(coroutine):
    return asyncio.run(coroutine)


def test_rate_limit_starts_five_a_second_first_come_first_served(fake_time):
    limit = RateLimit(clock=fake_time.clock, sleep=fake_time.sleep)
    order: list[tuple[int, float]] = []

    async def one(i: int) -> None:
        await limit.acquire()
        order.append((i, fake_time.now))

    async def all_at_once() -> None:
        await asyncio.gather(*(one(i) for i in range(12)))

    run(all_at_once())
    assert [i for i, _ in order] == list(range(12))
    assert [t for _, t in order] == [0.0] * 5 + [1.0] * 5 + [2.0] * 2


def test_rate_limit_applies_every_window(fake_time):
    # Small numbers, same code: 2 per second and 3 per 10 s.
    limit = RateLimit(((2, 1.0), (3, 10.0)), clock=fake_time.clock, sleep=fake_time.sleep)
    starts = []

    async def five() -> None:
        for _ in range(5):
            await limit.acquire()
            starts.append(fake_time.now)

    run(five())
    assert starts == [0.0, 0.0, 1.0, 10.0, 10.0]


def test_the_server_uses_pubchems_published_limits():
    assert pubchem.LIMITS == ((5, 1.0), (400, 60.0))
    assert RateLimit()._limits == pubchem.LIMITS


def test_every_request_waits_for_the_rate_limit(fake_time):
    server, names = client(fake_time, [(200, found(1))])

    async def seven() -> None:
        await asyncio.gather(*(names.name(f"s{i}") for i in range(7)))

    run(seven())
    assert [t for t, _ in server.requests] == [0.0] * 5 + [1.0] * 2


def test_429_is_retried_once_after_one_second(fake_time):
    server, names = client(fake_time, [(429, {}), (200, found(7))])
    assert run(names.name("s")) == Record(cid=7, iupac="i", title="t")
    assert [t for t, _ in server.requests] == [0.0, 1.0]
    assert fake_time.sleeps == [1.0]


@pytest.mark.parametrize("statuses", [(429, 429), (503, 503), (429, 503), (503, 429)])
def test_a_second_429_or_503_means_busy(fake_time, statuses):
    server, names = client(fake_time, [(s, {}) for s in statuses] + [(200, found(1))])
    with pytest.raises(Busy):
        run(names.name("s"))
    assert [t for t, _ in server.requests] == [0.0, 1.0]


@pytest.mark.parametrize("status", [400, 404, 500, 504])
def test_other_errors_are_not_retried(fake_time, status):
    server, names = client(fake_time, [(status, {})])
    with pytest.raises(Unavailable, match=f"HTTP {status}"):
        run(names.name("s"))
    assert len(server.requests) == 1


@pytest.mark.parametrize("error", [httpx.ReadTimeout("t"), httpx.ConnectError("c")])
def test_network_failures_are_unavailable_and_not_retried(fake_time, error):
    server, names = client(fake_time, [(0, error)])
    with pytest.raises(Unavailable, match=type(error).__name__):
        run(names.name("s"))
    assert len(server.requests) == 1


def test_each_attempt_times_out_after_five_seconds(monkeypatch):
    assert pubchem.TIMEOUT_S == 5.0
    # httpx's own default is also 5 s, so prove the setting is passed, not inherited.
    monkeypatch.setattr(pubchem, "TIMEOUT_S", 4.0)
    assert pubchem.new_http().timeout == httpx.Timeout(4.0)


def test_the_smiles_goes_in_the_post_body(fake_time):
    server, names = client(fake_time, [(200, NOT_FOUND)])
    assert run(names.name("the smiles")) is None
    assert server.requests == [(0.0, {"smiles": "the smiles"})]


@pytest.mark.parametrize(
    "body",
    [
        {},
        {"PropertyTable": {"Properties": []}},
        {"PropertyTable": {"Properties": [{"CID": 1}, {"CID": 2}]}},
        {"PropertyTable": {"Properties": [{"CID": "1"}]}},
        {"PropertyTable": {"Properties": [{"CID": True}]}},
        {"PropertyTable": {"Properties": [{"CID": -1}]}},
        {"PropertyTable": {"Properties": [{"CID": 1, "Title": 5}]}},
        [],
    ],
)
def test_unexpected_answers_are_unavailable(body):
    with pytest.raises(Unavailable):
        pubchem.parse_name(body)


def test_not_json_is_unavailable(fake_time):
    _, names = client(fake_time, [(200, "<html>maintenance</html>")])
    with pytest.raises(Unavailable, match="not JSON"):
        run(names.name("s"))


def test_cid_zero_means_no_record():
    assert pubchem.parse_name(NOT_FOUND) is None


def test_a_record_without_names_keeps_its_cid():
    body = {"PropertyTable": {"Properties": [{"CID": 9}]}}
    assert pubchem.parse_name(body) == Record(cid=9, iupac=None, title=None)
