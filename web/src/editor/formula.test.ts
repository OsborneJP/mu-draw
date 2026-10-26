// The case table of docs/plans/v2-formula-text.md, row by row. Expected values are the
// plan's typing rules (what Jeff approved), not chemistry data.
import { describe, expect, it } from 'vitest';
import { formulaScripts, type Script } from './formula';

const SUB: Record<string, string> = { '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄', '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉' };
const SUP: Record<string, string> = {
  '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹',
  '+': '⁺', '-': '⁻',
};

/** The text as the plan writes it: subscripts and superscripts as Unicode characters, and
 * anything else raised or lowered marked as _{…} or ^{…}. */
function shown(text: string): string {
  const scripts = formulaScripts(text);
  return [...text]
    .map((char, i) => {
      if (scripts[i] === 'sub') return SUB[char] ?? `_{${char}}`;
      if (scripts[i] === 'sup') return SUP[char] ?? `^{${char}}`;
      return char;
    })
    .join('');
}

const TABLE: [rule: string, typed: string, shows: string][] = [
  ['1', 'H2SO4 C6H12O6 CDCl3 DMSO-d6 Et3N LiAlH4', 'H₂SO₄ C₆H₁₂O₆ CDCl₃ DMSO-d₆ Et₃N LiAlH₄'],
  ['1', '(NH4)2SO4 [Cu(NH3)4]SO4 Ca3(PO4)2', '(NH₄)₂SO₄ [Cu(NH₃)₄]SO₄ Ca₃(PO₄)₂'],
  ['2', 'CuSO4·5H2O CuSO4.5H2O 2H2 + O2', 'CuSO₄·5H₂O CuSO₄.5H₂O 2H₂ + O₂'],
  ['2', '2-butanol but-2-ene 25 °C 2 mL cm-1', '2-butanol but-2-ene 25 °C 2 mL cm-1'],
  ['3', 'Na+ Cl- H+ OH- NAD+ 2e- δ+', 'Na⁺ Cl⁻ H⁺ OH⁻ NAD⁺ 2e⁻ δ⁺'],
  ['3', 'cis- trans-', 'cis- trans-'],
  ['3', 'Cu2+(aq) Cl-.', 'Cu²⁺(aq) Cl⁻.'],
  ['4a', '[Fe(CN)6]3- [Cu(H2O)6]2+', '[Fe(CN)₆]³⁻ [Cu(H₂O)₆]²⁺'],
  ['4b', 'Cu2+ Fe3+ Al3+ S2-', 'Cu²⁺ Fe³⁺ Al³⁺ S²⁻'],
  ['4c', 'SO42- PO43- Cr2O72- Fe(CN)64- Hg22+ B12H122- C60-', 'SO₄²⁻ PO₄³⁻ Cr₂O₇²⁻ Fe(CN)₆⁴⁻ Hg₂²⁺ B₁₂H₁₂²⁻ C₆₀⁻'],
  ['4d', 'NH4+ H3O+ MnO4- CH3CO2- ArN2+ C5H5-', 'NH₄⁺ H₃O⁺ MnO₄⁻ CH₃CO₂⁻ ArN₂⁺ C₅H₅⁻'],
];

// The plan's "wrong on purpose" list: kept here so that a change to any of them is noticed.
const WRONG_ON_PURPOSE: [why: string, typed: string, shows: string][] = [
  ['superoxide, azide and triiodide read as one element and its charge (4b)', 'O2- N3- I3-', 'O²⁻ N³⁻ I³⁻'],
  ['a count ending in a digit before a 1- charge (4c)', 'C12H25-', 'C₁₂H₂⁵⁻'],
  ['isotopes stay on the line', '13CO2', '13CO₂'],
  ['a charge written sign first, or after a space, is not raised', 'Fe+2 SO4 2-', 'Fe+2 SO₄ 2-'],
  ['without a space, only the last charge is raised', 'Na+Cl-', 'Na+Cl⁻'],
  ['carbon numbers and names get subscripts, as in ChemDraw', 'C2 C1–C4 SN2', 'C₂ C₁–C₄ SN₂'],
  ['a capitalised word ending in a hyphen gets a raised minus', 'N- and O-alkylation', 'N⁻ and O-alkylation'],
];

describe('formulaScripts', () => {
  it.each(TABLE)('rule %s: %s', (_rule, typed, shows) => {
    expect(shown(typed)).toBe(shows);
  });

  it.each(WRONG_ON_PURPOSE)('wrong on purpose (%s)', (_why, typed, shows) => {
    expect(shown(typed)).toBe(shows);
  });

  it('raises the other minus signs a student may type or paste', () => {
    expect(formulaScripts('Cl− F–')).toEqual([null, null, 'sup', null, null, 'sup']);
  });

  it('reads each line of a text box on its own', () => {
    expect(shown('H2O\nCu2+')).toBe('H₂O\nCu²⁺');
  });

  it('keeps a leading multiplier before a charged element on the line', () => {
    expect(shown('2Cu2+ 3OH-')).toBe('2Cu²⁺ 3OH⁻');
  });

  it('gives one entry per UTF-16 code unit, and only sub, sup or null', () => {
    const typed = 'H2SO4 Cu2+ 🧪2 δ+ [Fe(CN)6]3-';
    const scripts = formulaScripts(typed);
    expect(scripts).toHaveLength(typed.length);
    expect(new Set<Script>(scripts)).toEqual(new Set<Script>([null, 'sub', 'sup']));
  });

  it('leaves text with nothing to format on the line', () => {
    expect(formulaScripts('')).toEqual([]);
    expect(formulaScripts('Add the acid dropwise.').every((s) => s === null)).toBe(true);
  });
});
