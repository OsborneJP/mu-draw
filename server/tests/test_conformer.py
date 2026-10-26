"""POST /api/conformer, the 3D view's model (docs/plans/v2-3d-view.md, bar A). PubChem only
from recordings (server/scripts/record_conformers.py); RDKit runs for real, without its
timeout (it never changes a model that finishes), except where a stand-in embedder holds or
counts the embedding."""

import asyncio
import functools
import json
import logging
import threading

import httpx
import pytest
from fastapi.testclient import TestClient
from rdkit import Chem

import main
import record_conformers as rc
import threed
from cache import MAX_AGE_S
from fakes import FAKE_OPSIN, FakePubChem
from pubchem import MOLFILE_END, RateLimit, Unavailable, parse_conformer

COMPOUNDS = {c["name"]: c for c in rc.test_compounds()}
NO_TIMEOUT = functools.partial(threed.embed, timeout_s=0)
BUSY = (503, "Status: 503\nCode: PUGREST.ServerBusy\n")
STAND_IN = "stand-in model"


def smiles(name: str) -> str:
    return COMPOUNDS[name]["smiles"]


def canonical(name: str) -> str:
    return rc.canonical(COMPOUNDS[name])


def recorded(name: str) -> tuple[int, str]:
    recording = json.loads(rc.recording_path(name).read_text(encoding="utf-8"))
    return recording["status"], recording["text"]


def app_with(tmp_path, fake_time, answers, embed=NO_TIMEOUT):
    server = FakePubChem(fake_time, answers)
    app = main.create_app(
        state_dir=tmp_path,
        transport=server.transport,
        limit=RateLimit(clock=fake_time.clock, sleep=fake_time.sleep),
        sleep=fake_time.sleep,
        clock=fake_time.clock,
        opsin_command=FAKE_OPSIN,
        embed=embed,
    )
    return server, app


class Counting:
    """A stand-in embedder that notes each structure it is asked to build."""

    def __init__(self, answer: str | None = STAND_IN) -> None:
        self.answer = answer
        self.calls: list[str] = []

    def __call__(self, mol: Chem.Mol) -> str | None:
        self.calls.append(Chem.MolToSmiles(mol))
        return self.answer


def ask(client: TestClient, name: str) -> httpx.Response:
    return client.post("/api/conformer", json={"smiles": smiles(name)})


def drawn(name: str) -> Chem.Mol:
    return Chem.MolFromSmiles(smiles(name))


def model(molblock: str) -> Chem.Mol:
    return Chem.MolFromMolBlock(molblock, removeHs=False)


# A.1, A.2: PubChem's record first, unchanged.
def test_pubchems_record_is_shown(tmp_path, fake_time):
    status, text = recorded("aspirin")
    record = parse_conformer(text)
    server, app = app_with(tmp_path, fake_time, [(status, text)])
    with TestClient(app) as client:
        response = ask(client, "aspirin")
    assert response.status_code == 200
    assert response.json() == {
        "found": True,
        "pubchem": "found",
        "source": "pubchem",
        "cid": record.cid,
        "molblock": record.molblock,
        "reason": None,
        "undefined_stereo": 0,
    }
    # PubChem is asked once, with RDKit's canonical SMILES in the body.
    assert server.requests == [(0.0, {"smiles": canonical("aspirin")})]


def test_the_molfile_is_the_records_own_through_m_end():
    _, text = recorded("aspirin")
    record = parse_conformer(text)
    assert text.startswith(record.molblock)
    assert record.molblock.endswith(f"{MOLFILE_END}\n")
    assert "PUBCHEM_" not in record.molblock


@pytest.mark.parametrize(
    "text",
    [
        "no molfile here",
        recorded("aspirin")[1].replace("> <PUBCHEM_COMPOUND_CID>", "> <SOMETHING_ELSE>"),
    ],
    ids=["no M END", "no CID"],
)
def test_a_record_that_isnt_one_is_unavailable(text):
    with pytest.raises(Unavailable):
        parse_conformer(text)


# A.3: no 3D record (404) or no record at all (501): RDKit's model.
@pytest.mark.parametrize(
    "name", ["erythromycin", "invented: cholesterol + caffeine"], ids=["404", "501"]
)
def test_no_pubchem_model_gives_rdkits(tmp_path, fake_time, name):
    status, text = recorded(name)
    assert status in (404, 501)
    _, app = app_with(tmp_path, fake_time, [(status, text)])
    with TestClient(app) as client:
        answer = ask(client, name).json()
    assert {k: answer[k] for k in ("found", "pubchem", "source", "cid", "reason")} == {
        "found": True,
        "pubchem": "none",
        "source": "rdkit",
        "cid": None,
        "reason": None,
    }
    built = model(answer["molblock"])
    assert built.GetConformer().Is3D()
    assert built.GetNumAtoms() == Chem.AddHs(drawn(name)).GetNumAtoms()
    assert threed.keeps_stereo(drawn(name), built)


def test_too_big_is_never_embedded(tmp_path, fake_time):
    embed = Counting()
    _, app = app_with(tmp_path, fake_time, [recorded("vancomycin")], embed=embed)
    with TestClient(app) as client:
        answer = ask(client, "vancomycin").json()
    assert drawn("vancomycin").GetNumHeavyAtoms() > threed.MAX_HEAVY_ATOMS
    assert (answer["found"], answer["reason"], answer["molblock"]) == (False, "too_big", None)
    assert embed.calls == []


def many_hydrogens() -> str:
    """Ten platinum atoms in a chain, each with 40 H: 10 heavy atoms, 410 with the H (built
    here, not typed)."""
    chain = Chem.RWMol()
    for i in range(10):
        atom = Chem.Atom("Pt")
        atom.SetNumExplicitHs(40)
        chain.AddAtom(atom)
        if i:
            chain.AddBond(i - 1, i, Chem.BondType.SINGLE)
    mol = chain.GetMol()
    mol.UpdatePropertyCache(strict=False)
    return Chem.MolToSmiles(mol)


def test_hydrogens_count_toward_the_size_cap(tmp_path, fake_time):
    """Review round 1 (high): the cap counted heavy atoms only, so a short SMILES with large
    H counts was embedded with hundreds of atoms (memory grows with their square)."""
    embed = Counting()
    smiles_in = many_hydrogens()
    mol = Chem.MolFromSmiles(smiles_in)
    assert mol.GetNumHeavyAtoms() <= threed.MAX_HEAVY_ATOMS
    assert mol.GetNumAtoms(onlyExplicit=False) > threed.MAX_ATOMS
    _, app = app_with(
        tmp_path, fake_time, [(400, "Status: 400\nCode: PUGREST.BadRequest\n")], embed=embed
    )
    with TestClient(app) as client:
        answer = client.post("/api/conformer", json={"smiles": smiles_in}).json()
    assert (answer["found"], answer["reason"]) == (False, "too_big")
    assert embed.calls == []


def test_atoms_that_are_not_elements_are_refused(tmp_path, fake_time):
    """Review round 1: R-groups (atomic number 0) crashed the embedding or slipped past the
    cap; the browser never sends them (src/editor/drawing.ts), so the server refuses them."""
    mol = Chem.RWMol(drawn("aspirin"))
    mol.GetAtomWithIdx(0).SetAtomicNum(0)
    embed = Counting()
    server, app = app_with(tmp_path, fake_time, [recorded("aspirin")], embed=embed)
    with TestClient(app) as client:
        response = client.post("/api/conformer", json={"smiles": Chem.MolToSmiles(mol)})
    assert (response.status_code, response.json()) == (400, {"error": "invalid_structure"})
    assert (server.requests, embed.calls) == ([], [])


# A.5: what can't exist gets no model, and production's embedding is capped.
def test_an_impossible_stereoisomer_has_no_model(tmp_path, fake_time):
    name = "camphor, a stereoisomer that can't exist"
    _, app = app_with(tmp_path, fake_time, [recorded(name)])
    with TestClient(app) as client:
        answer = ask(client, name).json()
    assert (answer["found"], answer["source"], answer["reason"]) == (False, None, "no_model")


def test_the_embedding_is_capped(monkeypatch):
    """Each attempt is capped; the default start first, then one random start only if that
    fails (review round 2: random starts alone failed ivermectin within the cap)."""
    given = []

    def spy(mol, params):
        given.append((params.timeout, params.randomSeed, params.useRandomCoords))
        return -1

    monkeypatch.setattr(threed.rdDistGeom, "EmbedMolecule", spy)
    assert threed.embed(drawn("aspirin")) is None
    cap, seed = threed.EMBED_TIMEOUT_S, threed.SEED
    assert given == [(cap, seed, False), (cap, seed, True)]
    assert threed.EMBED_TIMEOUT_S == 2
    assert main.create_app.__kwdefaults__["embed"] is threed.embed


def test_a_model_from_the_default_start_needs_no_random_one(monkeypatch):
    real = threed.rdDistGeom.EmbedMolecule
    starts = []

    def spy(mol, params):
        starts.append(params.useRandomCoords)
        return real(mol, params)

    monkeypatch.setattr(threed.rdDistGeom, "EmbedMolecule", spy)
    assert threed.embed(drawn("aspirin"), timeout_s=0) is not None
    assert starts == [False]


def test_rdkits_model_must_keep_the_drawn_stereo(monkeypatch):
    """RDKit's embedding mirrored (every z negated): the force field can't undo that."""
    real = threed.rdDistGeom.EmbedMolecule

    def mirrored(mol, params):
        result = real(mol, params)
        conformer = mol.GetConformer()
        for i in range(mol.GetNumAtoms()):
            x, y, z = conformer.GetAtomPosition(i)
            conformer.SetAtomPosition(i, (x, y, -z))
        return result

    monkeypatch.setattr(threed.rdDistGeom, "EmbedMolecule", mirrored)
    assert threed.embed(drawn("(R)-2-butanol"), timeout_s=0) is None
    assert threed.embed(drawn("aspirin"), timeout_s=0) is not None  # no stereo to keep


@pytest.mark.parametrize(
    "mmff, uff, used",
    [(True, True, "MMFF"), (False, True, "UFF"), (False, False, None)],
    ids=["MMFF", "UFF where MMFF has no parameters", "neither"],
)
def test_the_force_field_and_its_cap(monkeypatch, mmff, uff, used):
    """Bar A.3: MMFF94, else UFF, else neither, each for at most FORCE_FIELD_STEPS steps."""
    ran = []
    monkeypatch.setattr(threed.rdForceFieldHelpers, "MMFFHasAllMoleculeParams", lambda mol: mmff)
    monkeypatch.setattr(threed.rdForceFieldHelpers, "UFFHasAllMoleculeParams", lambda mol: uff)
    monkeypatch.setattr(
        threed.rdForceFieldHelpers,
        "MMFFOptimizeMolecule",
        lambda mol, maxIters: ran.append(("MMFF", maxIters)),
    )
    monkeypatch.setattr(
        threed.rdForceFieldHelpers,
        "UFFOptimizeMolecule",
        lambda mol, maxIters: ran.append(("UFF", maxIters)),
    )
    assert threed.embed(drawn("aspirin"), timeout_s=0) is not None
    assert ran == ([] if used is None else [(used, threed.FORCE_FIELD_STEPS)])
    assert threed.FORCE_FIELD_STEPS == 200


# A.2, A.4: a record that isn't the drawing as drawn is not shown.
@pytest.mark.parametrize(
    "asked, answered",
    [
        ("(R)-2-butanol", "(S)-2-butanol"),  # its enantiomer
        ("trans-2-butene", "cis-2-butene"),  # the other double bond
        ("cholesterol", "aspirin"),  # another compound
    ],
)
def test_a_record_of_something_else_gives_rdkits_model(tmp_path, fake_time, asked, answered):
    _, app = app_with(tmp_path, fake_time, [recorded(answered)])
    with TestClient(app) as client:
        answer = ask(client, asked).json()
    assert (answer["pubchem"], answer["source"], answer["cid"]) == ("unusable", "rdkit", None)
    assert threed.keeps_stereo(drawn(asked), model(answer["molblock"]))


def test_a_flat_record_is_not_shown(tmp_path, fake_time):
    """PubChem's aspirin record with every z set to 0, as a 2D record."""
    status, text = recorded("aspirin")
    record = parse_conformer(text)
    mol = model(record.molblock)
    conformer = mol.GetConformer()
    for i in range(mol.GetNumAtoms()):
        x, y, _ = conformer.GetAtomPosition(i)
        conformer.SetAtomPosition(i, (x, y, 0.0))
    conformer.Set3D(False)
    flat = f"{Chem.MolToMolBlock(mol)}> <PUBCHEM_COMPOUND_CID>\n{record.cid}\n\n$$$$\n"
    assert parse_conformer(flat).cid == record.cid
    _, app = app_with(tmp_path, fake_time, [(status, flat)], embed=Counting())
    with TestClient(app) as client:
        answer = ask(client, "aspirin").json()
    assert (answer["pubchem"], answer["source"], answer["molblock"]) == (
        "unusable",
        "rdkit",
        STAND_IN,
    )


@pytest.mark.parametrize(
    "drawing, record, keeps",
    [
        ("(R)-2-butanol", "(R)-2-butanol", True),
        ("(R)-2-butanol", "(S)-2-butanol", False),
        ("(R)-2-butanol, stereo not drawn", "(S)-2-butanol", True),
        ("trans-2-butene", "cis-2-butene", False),
        ("adamantane", "adamantane", True),
        ("camphor", "camphor", True),
        ("cholesterol", "cholesterol", True),
        # A ring of the record matches the drawing: only the same-structure check rejects it.
        ("cyclohexane", "cholesterol", False),
    ],
)
def test_keeps_stereo(drawing, record, keeps):
    molblock = parse_conformer(recorded(record)[1]).molblock
    assert threed.keeps_stereo(drawn(drawing), model(molblock)) is keeps


# A.1: what the server refuses before asking PubChem.
def test_one_structure_at_a_time(tmp_path, fake_time):
    server, app = app_with(tmp_path, fake_time, [recorded("aspirin")])
    with TestClient(app) as client:
        response = ask(client, "sodium acetate")
    assert (response.status_code, response.json()) == (400, {"error": "one_structure"})
    assert server.requests == []


def test_an_unreadable_structure(tmp_path, fake_time):
    server, app = app_with(tmp_path, fake_time, [recorded("aspirin")])
    with TestClient(app) as client:
        response = client.post("/api/conformer", json={"smiles": smiles("aspirin") + "("})
    assert (response.status_code, response.json()) == (400, {"error": "invalid_structure"})
    assert server.requests == []


# A.6: the cache.
@pytest.mark.parametrize("name", ["aspirin", "erythromycin"], ids=["found", "none"])
def test_answers_are_cached_for_30_days(tmp_path, fake_time, name):
    embed = Counting()
    server, app = app_with(tmp_path, fake_time, [recorded(name)], embed=embed)
    with TestClient(app) as client:
        first = ask(client, name).json()
        assert ask(client, name).json() == first
        assert len(server.requests) == 1
        fake_time.now += MAX_AGE_S
        assert ask(client, name).json() == first
    assert len(server.requests) == 2
    assert len(embed.calls) == (2 if name == "erythromycin" else 0)


@pytest.mark.parametrize(
    "answers",
    [[BUSY, BUSY], [(500, "Status: 500\n")], [(200, "not a record")]],
    ids=["busy", "error", "not a record"],
)
def test_no_answer_from_pubchem_gives_rdkits_model_uncached(tmp_path, fake_time, answers):
    embed = Counting()
    server, app = app_with(tmp_path, fake_time, answers, embed=embed)
    with TestClient(app) as client:
        answer = ask(client, "aspirin").json()
        asked = len(server.requests)
        ask(client, "aspirin")
    assert (answer["pubchem"], answer["source"], answer["molblock"]) == (
        "no_answer",
        "rdkit",
        STAND_IN,
    )
    assert len(server.requests) == 2 * asked  # asked again: nothing was cached
    assert len(embed.calls) == 2


def test_no_model_is_never_cached(tmp_path, fake_time):
    """Review round 1: RDKit's time cap is wall-clock, so a failure can be the machine's, not
    the structure's: it is never kept, even when PubChem answered."""
    embed = Counting(answer=None)
    server, app = app_with(tmp_path, fake_time, [recorded("erythromycin")], embed=embed)
    with TestClient(app) as client:
        first = ask(client, "erythromycin").json()
        assert ask(client, "erythromycin").json() == first
    assert (first["found"], first["reason"]) == (False, "no_model")
    assert (len(server.requests), len(embed.calls)) == (2, 2)


# A.8: PubChem's rate limit and retry are the naming ones.
def test_the_rate_limit_is_shared_with_names(tmp_path, fake_time):
    name_answer = (200, {"PropertyTable": {"Properties": [{"CID": 0}]}})
    server, app = app_with(tmp_path, fake_time, [name_answer] * 5 + [recorded("aspirin")])
    with TestClient(app) as client:
        for name in list(COMPOUNDS)[:5]:  # five structures, so none is a cached name
            client.post("/api/name", json={"smiles": smiles(name)})
        assert ask(client, "aspirin").json()["source"] == "pubchem"
    assert [t for t, _ in server.requests] == [0.0] * 5 + [1.0]


def test_a_busy_pubchem_is_asked_twice(tmp_path, fake_time):
    server, app = app_with(tmp_path, fake_time, [BUSY, recorded("aspirin")])
    with TestClient(app) as client:
        assert ask(client, "aspirin").json()["source"] == "pubchem"
    assert [t for t, _ in server.requests] == [0.0, 1.0]
    assert fake_time.sleeps == [1.0]


# A.7: one embedding at a time, at most MAX_WAITING more waiting.
class Held:
    """A stand-in embedder that waits until released, counting how many run at once."""

    def __init__(self) -> None:
        self.release = threading.Event()
        self._lock = threading.Lock()
        self.running = 0
        self.most = 0

    def __call__(self, mol: Chem.Mol) -> str:
        with self._lock:
            self.running += 1
            self.most = max(self.most, self.running)
        self.release.wait()
        with self._lock:
            self.running -= 1
        return STAND_IN


def test_one_embedding_at_a_time(tmp_path, fake_time):
    held = Held()
    _, app = app_with(tmp_path, fake_time, [recorded("erythromycin")], embed=held)
    body = {"smiles": smiles("erythromycin")}

    async def scenario():
        async with app.router.lifespan_context(app):
            transport = httpx.ASGITransport(app=app)
            async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
                queue: threed.EmbedQueue = app.state.embedding
                waiting = [
                    asyncio.create_task(client.post("/api/conformer", json=body))
                    for _ in range(1 + threed.MAX_WAITING)
                ]
                try:
                    await queue.until_load(1 + threed.MAX_WAITING)
                    # The sixth is either answered at once or joins the queue: whichever
                    # comes first decides, so a queue without a limit fails, not hangs.
                    sixth = asyncio.create_task(client.post("/api/conformer", json=body))
                    queued = asyncio.create_task(queue.until_load(2 + threed.MAX_WAITING))
                    await asyncio.wait({sixth, queued}, return_when=asyncio.FIRST_COMPLETED)
                    was_queued = queued.done()
                    queued.cancel()
                finally:
                    held.release.set()  # a failure above must not leave a thread waiting
                answered = await asyncio.gather(*waiting)
                return was_queued, await sixth, answered

    was_queued, refused, answered = asyncio.run(scenario())
    assert not was_queued
    assert (refused.status_code, refused.json()) == (503, {"error": "busy"})
    assert [r.json()["molblock"] for r in answered] == [STAND_IN] * (1 + threed.MAX_WAITING)
    assert held.most == 1


# A.9: the structure never reaches a log line or an error message.
@pytest.mark.parametrize(
    "name, answers, embed",
    [
        ("aspirin", [recorded("aspirin")], NO_TIMEOUT),
        ("erythromycin", [recorded("erythromycin")], Counting()),
        ("aspirin", [BUSY, BUSY], Counting()),
        ("aspirin", [(500, "Status: 500\n")], Counting(answer=None)),
        ("(R)-2-butanol", [recorded("(S)-2-butanol")], NO_TIMEOUT),
        ("vancomycin", [recorded("vancomycin")], Counting()),
        ("sodium acetate", [recorded("aspirin")], Counting()),
    ],
    ids=["found", "none", "busy", "no model", "unusable", "too big", "one structure"],
)
def test_structures_never_reach_logs(tmp_path, fake_time, caplog, capfd, name, answers, embed):
    caplog.set_level(logging.DEBUG)
    _, app = app_with(tmp_path, fake_time, answers, embed=embed)
    with TestClient(app) as client:
        ask(client, name)
    out, err = capfd.readouterr()
    for text in {smiles(name), canonical(name)}:
        assert text not in caplog.text
        assert text not in out + err
