"""RDKit for the naming API: read the SMILES a student's drawing sent, canonicalize it, and
count its undefined stereo elements.

RDKit echoes bad input in its parse errors, so its logging goes off before anything is
parsed. The settings match server/scripts/gen_reference_expected.py, so the canonical SMILES
(the cache key, and what PubChem is asked) equals the fixtures' canonical_smiles.
"""

from rdkit import Chem, RDLogger

# Same as gen_reference_expected.SETTINGS["legacy_stereo_perception"] (a test compares them).
LEGACY_STEREO_PERCEPTION = False


def configure() -> None:
    RDLogger.DisableLog("rdApp.*")
    Chem.SetUseLegacyStereoPerception(LEGACY_STEREO_PERCEPTION)


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
