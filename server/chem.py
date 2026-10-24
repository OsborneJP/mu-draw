"""RDKit for the naming API: read the SMILES a student's drawing sent, canonicalize it, count
its undefined stereo elements, and write the Molfile that Name to structure draws.

RDKit echoes bad input in its parse errors, so its logging goes off before anything is
parsed. The settings match server/scripts/gen_reference_expected.py, so the canonical SMILES
(the cache key, and what PubChem is asked) equals the fixtures' canonical_smiles.
"""

from rdkit import Chem, RDLogger
from rdkit.Chem import rdDepictor

# Same as gen_reference_expected.SETTINGS (a test compares them).
LEGACY_STEREO_PERCEPTION = False
PREFER_COORDGEN = False


def configure() -> None:
    RDLogger.DisableLog("rdApp.*")
    Chem.SetUseLegacyStereoPerception(LEGACY_STEREO_PERCEPTION)
    rdDepictor.SetPreferCoordGen(PREFER_COORDGEN)


configure()


def parse(smiles: str) -> Chem.Mol | None:
    """The molecule, or None if RDKit can't read it (bad syntax, wrong valence) or it is empty."""
    mol = Chem.MolFromSmiles(smiles)
    if mol is None or mol.GetNumAtoms() == 0:
        return None
    return mol


def canonical(mol: Chem.Mol) -> str:
    """RDKit's canonical isomeric SMILES."""
    return Chem.MolToSmiles(mol)


def undefined_stereo(mol: Chem.Mol) -> int:
    """Stereocentres and stereogenic double bonds left undefined, counted as the properties
    panel counts them (every potential element: FindPotentialStereo with flagPossible)."""
    found = Chem.FindPotentialStereo(Chem.Mol(mol), cleanIt=False, flagPossible=True)
    return sum(1 for element in found if element.specified == Chem.StereoSpecified.Unspecified)


def same_connectivity(one: Chem.Mol, other: Chem.Mol) -> bool:
    """The same compound but for stereo (and isotopes): the InChIKeys' first block."""
    return Chem.MolToInchiKey(one)[:14] == Chem.MolToInchiKey(other)[:14]


def molfile(mol: Chem.Mol) -> str:
    """A 2D Molfile drawn as the fixtures are (gen_reference_expected.molfile). Chiral flag 1
    when a tetrahedral centre is specified: Ketcher reads flag 0 as an AND (relative) group."""
    drawn = Chem.Mol(mol)
    rdDepictor.Compute2DCoords(drawn, canonOrient=True)
    found = Chem.FindPotentialStereo(Chem.Mol(mol), cleanIt=False, flagPossible=False)
    specified = any(
        e.type == Chem.StereoType.Atom_Tetrahedral and e.specified == Chem.StereoSpecified.Specified
        for e in found
    )
    drawn.SetIntProp("_MolFileChiralFlag", int(specified))
    return Chem.MolToMolBlock(drawn)
