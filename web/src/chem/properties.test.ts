// The display rules on cases the PubChem fixtures don't reach (compute.test.ts checks every
// fixture compound end to end). Element counts here are made up to exercise a rule; they
// are not claims about any compound.
import { describe, expect, it } from 'vitest';
import type { Computed } from './compute';
import { degreeOfUnsaturation, formula, lipinskiSummary, NO_VALUE, panelValues, shown } from './properties';

describe('formula', () => {
  it('writes C, then H, then the rest alphabetically, with counts above one', () => {
    expect(formula({ O: 2, Br: 1, H: 3, C: 2, N: 1 }, 0)).toBe('C2H3BrNO2');
  });

  it('keeps H second without carbon, as RDKit does', () => {
    expect(formula({ Cl: 1, H: 1 }, 0)).toBe('HCl');
  });

  it('writes the charge after the elements, like RDKit', () => {
    expect(formula({ C: 1, O: 2 }, 1)).toBe('CO2+');
    expect(formula({ C: 1, O: 2 }, 2)).toBe('CO2+2');
    expect(formula({ C: 1, O: 2 }, -1)).toBe('CO2-');
    expect(formula({ C: 1, O: 2 }, -2)).toBe('CO2-2');
  });
});

describe('degree of unsaturation', () => {
  it('is C - H/2 - X/2 + N/2 + 1', () => {
    expect(degreeOfUnsaturation({ C: 2, H: 2, N: 1, Cl: 1 }, 0, 0)).toBe('2'); // 2 - 1 - 0.5 + 0.5 + 1
  });

  it('has no value for a charged drawing, even when the formula gives a whole number', () => {
    expect(degreeOfUnsaturation({ C: 2, H: 4 }, 2, 0)).toBe(NO_VALUE);
  });

  it('has no value for a radical, even when the formula gives a whole number', () => {
    expect(degreeOfUnsaturation({ C: 2, H: 4 }, 0, 2)).toBe(NO_VALUE);
  });

  it('has no value with an element other than C, H, N, O, S and halogens', () => {
    expect(degreeOfUnsaturation({ C: 2, H: 4, P: 1 }, 0, 0)).toBe(NO_VALUE);
  });

  it('has no value when the formula gives a half', () => {
    expect(degreeOfUnsaturation({ C: 2, H: 5 }, 0, 0)).toBe(NO_VALUE);
  });
});

describe('shown', () => {
  it('rounds to the given places, and a value that rounds to zero has no sign', () => {
    expect(shown(180.15899999999996, 2)).toBe('180.16');
    expect(shown(-0.0014, 2)).toBe('0.00');
    expect(shown(-0.005, 2)).toBe('-0.01');
  });
});

describe('Lipinski', () => {
  it('summarises 0, 1 and several broken rules', () => {
    expect(lipinskiSummary(0)).toBe('Meets all 4 rules');
    expect(lipinskiSummary(1)).toBe('Breaks 1 rule (Lipinski allows one)');
    expect(lipinskiSummary(3)).toBe('Breaks 3 rules: poor oral absorption is more likely');
  });

  const computed = (amw: number, logp: number): Computed => ({
    descriptors: {
      amw,
      exactmw: amw,
      lipinskiHBD: 6,
      lipinskiHBA: 10,
      NumRotatableBonds: 0,
      tpsa: 0,
      CrippenClogP: logp,
    },
    elements: { C: 1 },
    charge: 0,
    radicals: 0,
    fragments: 1,
    centres: [],
    doubleBonds: [],
    axis: false,
    groups: { kind: 'found', groups: [], problems: [] },
  });

  it('judges each rule on the value as displayed, limits included', () => {
    const values = panelValues(computed(500.004, 5.004));
    const rows = Object.fromEntries(values.lipinski.map((r) => [r.rule, [r.value, r.pass]]));
    expect(rows).toEqual({
      mw: ['500.00', true],
      logp: ['5.00', true],
      hbd: ['6', false],
      hba: ['10', true],
    });
    expect(values.lipinskiSummary).toBe(lipinskiSummary(1));
    const over = panelValues(computed(500.006, 5.006)).lipinski.filter((r) => !r.pass).map((r) => r.rule);
    expect(over).toEqual(['mw', 'logp', 'hbd']);
  });
});

describe('stereoisomers', () => {
  it('is 2 to the number of stereo elements, exactly, however many', () => {
    const element = { atoms: [0], defined: false };
    const values = panelValues({
      descriptors: { amw: 0, exactmw: 0, lipinskiHBD: 0, lipinskiHBA: 0, NumRotatableBonds: 0, tpsa: 0, CrippenClogP: 0 },
      elements: { C: 1 },
      charge: 0,
      radicals: 0,
      fragments: 1,
      centres: Array.from({ length: 60 }, () => element),
      doubleBonds: [{ atoms: [0, 1], defined: true }],
      axis: true,
      groups: { kind: 'found', groups: [], problems: [] },
    });
    expect(values.stereo).toEqual({
      centres: 60,
      doubleBonds: 1,
      undefined: 60,
      maxStereoisomers: (2n ** 61n).toString(),
      axis: true,
    });
  });
});
