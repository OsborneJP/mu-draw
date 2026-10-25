// What the properties panel shows, as text, from RDKit's values (compute.ts). The rules are
// Jeff's (docs/SPEC.md, "2. Properties panel + Lipinski card", decided Oct 24, 2026); the
// fixture generator (server/scripts/gen_reference_expected.py) applies the same rules in
// Python, and the tests compare the two.
import type { Computed, Descriptors } from './compute';

export const NO_VALUE = '—';

// Displayed precision; counts are whole numbers.
const DECIMALS = { amw: 2, exactmw: 4, CrippenClogP: 2, tpsa: 1 } as const;

// Degree of unsaturation only for neutral molecules made of these elements.
const HALOGENS = ['F', 'Cl', 'Br', 'I'];
const DOU_ELEMENTS = new Set(['C', 'H', 'N', 'O', 'S', ...HALOGENS]);

export type LipinskiRule = 'mw' | 'logp' | 'hbd' | 'hba';

// Lipinski's rule of 5, each judged on the value as displayed so a row never contradicts
// the number next to it.
export const LIPINSKI: { rule: LipinskiRule; label: string; limit: number }[] = [
  { rule: 'mw', label: 'Molecular weight ≤ 500', limit: 500 },
  { rule: 'logp', label: 'logP ≤ 5', limit: 5 },
  { rule: 'hbd', label: 'H-bond donors ≤ 5', limit: 5 },
  { rule: 'hba', label: 'H-bond acceptors ≤ 10', limit: 10 },
];

export interface PanelValues {
  formula: string;
  fragments: number;
  averageMw: string;
  exactMass: string;
  degreeOfUnsaturation: string;
  hbd: string;
  hba: string;
  rotatableBonds: string;
  tpsa: string;
  logp: string;
  lipinski: { rule: LipinskiRule; label: string; value: string; pass: boolean }[];
  lipinskiSummary: string;
  stereo: { centres: number; doubleBonds: number; undefined: number; maxStereoisomers: string; axis: boolean };
}

/** Rounded for display; a value that rounds to zero has no sign (ethanol's logP). */
export function shown(value: number, decimals: number): string {
  const text = value.toFixed(decimals);
  return Number(text) === 0 ? text.replace(/^-/, '') : text;
}

/** The molecular formula in RDKit's order: C, then H, then the rest alphabetically (H stays
 * second without carbon, as RDKit writes HCl), then the charge: +, +2, -, -2. */
export function formula(elements: Record<string, number>, charge: number): string {
  const rank = (symbol: string) => (symbol === 'C' ? 0 : symbol === 'H' ? 1 : 2);
  const symbols = Object.keys(elements).sort((a, b) => rank(a) - rank(b) || (a < b ? -1 : a > b ? 1 : 0));
  const body = symbols.map((s) => (elements[s] > 1 ? `${s}${elements[s]}` : s)).join('');
  if (charge === 0) return body;
  const sign = charge > 0 ? '+' : '-';
  return `${body}${sign}${Math.abs(charge) > 1 ? Math.abs(charge) : ''}`;
}

/** C - H/2 - X/2 + N/2 + 1 from the formula, for a neutral, closed-shell molecule of C, H,
 * N, O, S and halogens; otherwise NO_VALUE. */
export function degreeOfUnsaturation(elements: Record<string, number>, charge: number, radicals: number): string {
  if (charge !== 0 || radicals !== 0) return NO_VALUE;
  if (Object.keys(elements).some((symbol) => !DOU_ELEMENTS.has(symbol))) return NO_VALUE;
  const count = (symbol: string) => elements[symbol] ?? 0;
  const halogens = HALOGENS.reduce((sum, x) => sum + count(x), 0);
  const doubled = 2 * count('C') - count('H') - halogens + count('N') + 2;
  return doubled % 2 === 0 ? String(doubled / 2) : NO_VALUE;
}

export function lipinskiSummary(breaks: number): string {
  if (breaks === 0) return 'Meets all 4 rules';
  if (breaks === 1) return 'Breaks 1 rule (Lipinski allows one)';
  return `Breaks ${breaks} rules: poor oral absorption is more likely`;
}

function counted(d: Descriptors, name: 'lipinskiHBD' | 'lipinskiHBA' | 'NumRotatableBonds'): string {
  return String(Math.round(d[name]));
}

export function panelValues(c: Computed): PanelValues {
  const d = c.descriptors;
  const values = {
    averageMw: shown(d.amw, DECIMALS.amw),
    exactMass: shown(d.exactmw, DECIMALS.exactmw),
    logp: shown(d.CrippenClogP, DECIMALS.CrippenClogP),
    tpsa: shown(d.tpsa, DECIMALS.tpsa),
    hbd: counted(d, 'lipinskiHBD'),
    hba: counted(d, 'lipinskiHBA'),
    rotatableBonds: counted(d, 'NumRotatableBonds'),
  };
  const ruleValue: Record<LipinskiRule, string> = {
    mw: values.averageMw,
    logp: values.logp,
    hbd: values.hbd,
    hba: values.hba,
  };
  const lipinski = LIPINSKI.map(({ rule, label, limit }) => ({
    rule,
    label,
    value: ruleValue[rule],
    pass: Number(ruleValue[rule]) <= limit,
  }));
  const elements = [...c.centres, ...c.doubleBonds];
  return {
    ...values,
    formula: formula(c.elements, c.charge),
    fragments: c.fragments,
    degreeOfUnsaturation: degreeOfUnsaturation(c.elements, c.charge, c.radicals),
    lipinski,
    lipinskiSummary: lipinskiSummary(lipinski.filter((row) => !row.pass).length),
    stereo: {
      centres: c.centres.length,
      doubleBonds: c.doubleBonds.length,
      undefined: elements.filter((e) => !e.defined).length,
      // Exact, like Python's 2**n: a drawing can have more than 53 stereo elements.
      maxStereoisomers: (2n ** BigInt(elements.length)).toString(),
      axis: c.axis,
    },
  };
}
