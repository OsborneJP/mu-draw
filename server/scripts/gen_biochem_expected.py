"""Generate the biochem tools' pKa table and peptide reference values (docs/plans/v2-biochem.md).

    python server/scripts/gen_biochem_expected.py

Reads tests/fixtures/biochem_sequences.json (sequences only) and writes:
  web/src/chem/biochemData.json                 imported by the app: the 20 standard amino
                                                acids' codes, the base pairs, and Bjellqvist's
                                                pKa values, all as Biopython has them
  tests/fixtures/biochem_peptides_expected.json what Biopython answers for each test peptide:
                                                charge by pH, pI, both extinction coefficients,
                                                and the Black & Mould value of each residue

Every value comes from Biopython (Bio.SeqUtils, Bio.Data.IUPACData); nothing is typed in.
Output is deterministic; tests/test_biochem_fixtures.py regenerates it and compares bytes.
"""

from __future__ import annotations

import inspect
import json
from pathlib import Path

import Bio
from Bio.Data import IUPACData
from Bio.SeqUtils import IsoelectricPoint as bjellqvist
from Bio.SeqUtils.ProtParam import ProteinAnalysis
from Bio.SeqUtils.ProtParamData import gravy_scales

ROOT = Path(__file__).resolve().parents[2]
FIXTURES = ROOT / "tests" / "fixtures"
INPUTS = FIXTURES / "biochem_sequences.json"
DATA_FILE = ROOT / "web" / "src" / "chem" / "biochemData.json"
EXPECTED_FILE = FIXTURES / "biochem_peptides_expected.json"
GENERATOR = "server/scripts/gen_biochem_expected.py"

# The pH values each test peptide's charge is recorded at: every whole number, and 7.4.
PH_VALUES = [*range(15), 7.4]

# Bjellqvist's two papers, as Biopython's module docstring gives them.
CITATIONS = [
    "Bjellqvist B, Hughes GJ, Pasquali Ch, Paquet N, Ravier F, Sanchez J-Ch, Frutiger S, "
    "Hochstrasser DF. The focusing positions of polypeptides in immobilized pH gradients can "
    "be predicted from their amino acid sequences. Electrophoresis 1993, 14, 1023-1031.",
    "Bjellqvist B, Basse B, Olsen E, Celis JE. Reference points for comparisons of "
    "two-dimensional maps of proteins from different human cell types defined in a pH scale "
    "where isoelectric points correlate with polypeptide compositions. Electrophoresis 1994, "
    "15, 529-539.",
]


def read_inputs() -> dict:
    return json.loads(INPUTS.read_text(encoding="utf-8"))


def expand(entry: dict) -> str:
    """A test sequence: written out, or a unit repeated."""
    return entry["sequence"] if "sequence" in entry else entry["repeat"] * entry["times"]


def test_peptides(inputs: dict) -> list[dict]:
    """The listed peptides, then every residue alone, first (XG) and last (GX)."""
    three = IUPACData.protein_letters_1to3
    named = [{"name": e["name"], "sequence": expand(e)} for e in inputs["peptides"]]
    for r in IUPACData.protein_letters:
        named.append({"name": f"{three[r]} alone", "sequence": r})
    for r in IUPACData.protein_letters:
        named.append({"name": f"{three[r]} first", "sequence": f"{r}G"})
    for r in IUPACData.protein_letters:
        named.append({"name": f"{three[r]} last", "sequence": f"G{r}"})
    return named


def pi_bracket() -> tuple[float, float]:
    """Biopython's pI search starts inside [min_, max_] and never leaves it."""
    params = inspect.signature(bjellqvist.IsoelectricPoint.pi).parameters
    return params["min_"].default, params["max_"].default


def pairs(letters: str, complement: dict[str, str]) -> dict[str, str]:
    """Each unambiguous base and the base it pairs with, in alphabetical order."""
    return {b: complement[b] for b in sorted(letters)}


def app_data() -> dict:
    residues = IUPACData.protein_letters
    return {
        "_generated": f"{GENERATOR} from Biopython {Bio.__version__}; do not edit",
        "biopython": Bio.__version__,
        "residues": {r: IUPACData.protein_letters_1to3[r] for r in residues},
        "complement": {
            "dna": pairs(IUPACData.unambiguous_dna_letters, IUPACData.ambiguous_dna_complement),
            "rna": pairs(IUPACData.unambiguous_rna_letters, IUPACData.ambiguous_rna_complement),
        },
        "pKa": {
            "citations": CITATIONS,
            "positive": dict(bjellqvist.positive_pKs),
            "negative": dict(bjellqvist.negative_pKs),
            "nTerminal": dict(bjellqvist.pKnterminal),
            "cTerminal": dict(bjellqvist.pKcterminal),
        },
    }


def expected_peptide(peptide: dict, bracket: tuple[float, float]) -> dict:
    sequence = peptide["sequence"]
    point = bjellqvist.IsoelectricPoint(sequence)
    pi = point.pi()
    reduced, cystines = ProteinAnalysis(sequence).molar_extinction_coefficient()
    scale = gravy_scales["BlackMould"]
    return {
        "name": peptide["name"],
        "sequence": sequence,
        "charge": [point.charge_at_pH(ph) for ph in PH_VALUES],
        "pI": pi,
        # Biopython's answer is only the bracket's edge when the true pI lies beyond it.
        "pIAtBracketEdge": min(abs(pi - edge) for edge in bracket) < 1e-3,
        "extinction": {"reduced": reduced, "cystines": cystines},
        "blackMould": [scale[r] for r in sequence],
    }


def dumped(data: dict) -> str:
    return json.dumps(data, indent=2, ensure_ascii=False) + "\n"


def generate() -> dict[Path, str]:
    inputs = read_inputs()
    bracket = pi_bracket()
    expected = {
        "_generated": f"{GENERATOR} from Biopython {Bio.__version__}; do not edit",
        "biopython": Bio.__version__,
        "pH": PH_VALUES,
        "pIBracket": list(bracket),
        "peptides": [expected_peptide(p, bracket) for p in test_peptides(inputs)],
    }
    return {DATA_FILE: dumped(app_data()), EXPECTED_FILE: dumped(expected)}


def main() -> int:
    for path, text in generate().items():
        path.write_text(text, encoding="utf-8")
        print(f"wrote {path.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
