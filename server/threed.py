"""The 3D view's models (docs/plans/v2-3d-view.md): PubChem's 3D conformer of the drawn
structure where PubChem has one, else one that RDKit builds here.

RDKit.js has no 3D embedding, so this runs on the server: ETKDGv3 with a fixed seed and a
time cap, then MMFF94 (UFF where MMFF has no parameters, else neither) for a capped number of
steps. Either model is shown only if it is the drawn structure with the drawing's
configuration at every stereo element the drawing defines (keeps_stereo); elements the
drawing leaves undefined may come out either way, and the panel says so.

Embedding is CPU work that anyone can ask for, so one runs at a time and at most MAX_WAITING
wait for it (EmbedQueue). RDKit releases Python's lock while it embeds, so names are answered
meanwhile. Nothing here logs or raises with the structure in the message.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Callable
from dataclasses import dataclass

from rdkit import Chem
from rdkit.Chem import rdDistGeom, rdForceFieldHelpers

import chem  # noqa: F401  (configures RDKit: logging off, non-legacy stereo perception)
from pubchem import Busy, PubChem, Unavailable

log = logging.getLogger("naming")

# docs/plans/v2-3d-view.md, decisions 3 and 11. The embedding's work grows with every atom it
# builds, H included (its memory with their square), and its timeout doesn't bound all of it,
# so both counts are capped (review round 1).
MAX_HEAVY_ATOMS = 100
MAX_ATOMS = 300  # with every H
EMBED_TIMEOUT_S = 2
FORCE_FIELD_STEPS = 200
SEED = 20261026
MAX_WAITING = 4

Embed = Callable[[Chem.Mol], str | None]


@dataclass(frozen=True)
class Model:
    """What the 3D view shows for a structure, as cached (server/cache.py).

    pubchem: what PubChem said: "found" (its record is shown), "none" (it has no 3D record),
    "unusable" (its record isn't the drawn structure as drawn), or "no_answer" (busy or
    unavailable; never cached). source: "pubchem", "rdkit", or None with a reason, "too_big"
    or "no_model"."""

    pubchem: str
    source: str | None
    cid: int | None
    molblock: str | None
    reason: str | None


class TooBusy(Exception):
    """An embedding is running and MAX_WAITING more are waiting."""


def elements_only(mol: Chem.Mol) -> bool:
    """No R-group or other dummy atom (atomic number 0): RDKit can't embed those, and the
    browser never sends them (src/editor/drawing.ts)."""
    return all(atom.GetAtomicNum() > 0 for atom in mol.GetAtoms())


def too_big(mol: Chem.Mol) -> bool:
    return (
        mol.GetNumHeavyAtoms() > MAX_HEAVY_ATOMS or mol.GetNumAtoms(onlyExplicit=False) > MAX_ATOMS
    )


def flat(mol: Chem.Mol) -> str:
    """Canonical SMILES without stereo: the structure, whatever its configuration."""
    copy = Chem.Mol(mol)
    Chem.RemoveStereochemistry(copy)
    return Chem.MolToSmiles(copy)


def keeps_stereo(drawn: Chem.Mol, model: Chem.Mol) -> bool:
    """Whether `model` (3D, with or without its H) is the drawn structure, with the drawing's
    configuration at every stereo element the drawing defines. The model's stereo is read
    from its coordinates; RDKit's chirality-aware match then finds a mapping that agrees at
    every element the drawing defines, and ignores those it leaves undefined."""
    if model.GetNumConformers() != 1 or not model.GetConformer().Is3D():
        return False
    heavy = Chem.RemoveHs(model)
    if flat(heavy) != flat(drawn):
        return False
    Chem.AssignStereochemistryFrom3D(heavy)
    return heavy.HasSubstructMatch(drawn, useChirality=True)


def embed_parameters(
    timeout_s: float = EMBED_TIMEOUT_S, random_start: bool = False
) -> rdDistGeom.EmbedParameters:
    params = rdDistGeom.ETKDGv3()
    params.randomSeed = SEED
    params.timeout = timeout_s  # 0: none (the fixture generator only)
    params.useRandomCoords = random_start
    return params


def embed(mol: Chem.Mol, timeout_s: float = EMBED_TIMEOUT_S) -> str | None:
    """RDKit's 3D model of `mol` as a Molfile with every H, or None if it builds none within
    the cap, or none that keeps the drawing's stereo."""
    model = Chem.AddHs(mol)
    # ETKDG's default start (from eigenvectors) fails every time on long chains (tristearin,
    # n-C80); a random start builds those, but is slower and misses the cap for some that
    # the default builds (ivermectin). So the default first, then one random start, each
    # capped (review rounds 1 and 2, measured).
    for random_start in (False, True):
        if rdDistGeom.EmbedMolecule(model, embed_parameters(timeout_s, random_start)) == 0:
            break
    else:
        return None
    if rdForceFieldHelpers.MMFFHasAllMoleculeParams(model):
        rdForceFieldHelpers.MMFFOptimizeMolecule(model, maxIters=FORCE_FIELD_STEPS)
    elif rdForceFieldHelpers.UFFHasAllMoleculeParams(model):
        rdForceFieldHelpers.UFFOptimizeMolecule(model, maxIters=FORCE_FIELD_STEPS)
    if not keeps_stereo(mol, model):
        return None
    return Chem.MolToMolBlock(model)


class EmbedQueue:
    """Runs one embedding at a time, in a worker thread. At most `max_waiting` wait their
    turn; one more is refused (TooBusy) instead of queued. `load` is how many are running or
    waiting, and `until_load` lets a test wait until a given number have arrived."""

    def __init__(self, embed: Embed = embed, max_waiting: int = MAX_WAITING) -> None:
        self._embed = embed
        self._max_waiting = max_waiting
        self._turn = asyncio.Lock()
        self._changed = asyncio.Condition()
        self.load = 0

    async def _notify(self) -> None:
        async with self._changed:
            self._changed.notify_all()

    async def until_load(self, load: int) -> None:
        async with self._changed:
            await self._changed.wait_for(lambda: self.load == load)

    async def run(self, mol: Chem.Mol) -> str | None:
        if self.load > self._max_waiting:
            raise TooBusy()
        self.load += 1  # no await between the check and this, so two can't both pass
        try:
            await self._notify()
            async with self._turn:
                return await asyncio.to_thread(self._embed, mol)
        finally:
            self.load -= 1
            await self._notify()


def from_pubchem(drawn: Chem.Mol, molblock: str) -> bool:
    """Whether PubChem's 3D record is the drawn structure, keeping the drawing's stereo."""
    model = Chem.MolFromMolBlock(molblock, removeHs=False)
    return model is not None and keeps_stereo(drawn, model)


async def model_for(mol: Chem.Mol, smiles: str, pubchem: PubChem, queue: EmbedQueue) -> Model:
    """The model for one structure (`smiles` is its canonical SMILES). PubChem's 3D record
    first; RDKit's where PubChem has none, has one that isn't this structure, or doesn't
    answer. Raises TooBusy when the embedding queue is full."""
    try:
        record = await pubchem.conformer(smiles)
        said = "none" if record is None else "found"
    except (Busy, Unavailable) as error:
        log.warning("PubChem 3D lookup failed: %s", type(error).__name__)
        record, said = None, "no_answer"
    if record is not None:
        if from_pubchem(mol, record.molblock):
            return Model("found", "pubchem", record.cid, record.molblock, None)
        said = "unusable"
    if too_big(mol):
        return Model(said, None, None, None, "too_big")
    molblock = await queue.run(mol)
    if molblock is None:
        return Model(said, None, None, None, "no_model")
    return Model(said, "rdkit", None, molblock, None)


def cacheable(model: Model) -> bool:
    """PubChem's answers are kept; when it didn't answer, the next request asks again. RDKit's
    failures aren't kept either: its time cap is wall-clock, so a busy machine can cause one."""
    return model.pubchem != "no_answer" and model.reason != "no_model"
