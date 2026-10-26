// Practice mode's verdicts (docs/plans/v2-practice-mode.md, bar B3), on the hint cases'
// drawings with the keys RDKit gives them; the browser tests check the same cases with
// Indigo's keys. Everything comes from the generated fixtures
// (server/scripts/build_practice_lists.py).
import { describe, expect, it } from 'vitest';
import { components, inchiFormula, judge, verdictText, type PracticeList, type Verdict } from './practice';

interface Case {
  case: string;
  asked: string;
  verdict: Verdict['kind'];
  molfile?: string;
  rxn?: string;
  rdkit?: { inchikey: string; inchi: string };
}

const first = <T>(files: Record<string, T>) => Object.values(files)[0];
const { lists } = first(
  import.meta.glob<{ lists: PracticeList[] }>('../../../tests/fixtures/practice_test_lists.json', {
    eager: true,
    import: 'default',
  }),
);
const { cases } = first(
  import.meta.glob<{ cases: Case[] }>('../../../tests/fixtures/practice_cases.json', { eager: true, import: 'default' }),
);
const asked = (name: string) => lists[0].names.find((n) => n.name === name)!;
// Cases a key decides; the others Check refuses before asking Indigo, or Indigo refuses
// (the browser tests cover those), or they need Indigo's own key (an AND-marked centre).
const keyed = cases.filter((c) => c.rdkit);

describe('judge', () => {
  it.each(keyed.map((c) => [c.case, c] as const))('%s', (_, c) => {
    expect(judge(asked(c.asked), c.rdkit!).kind).toBe(c.verdict);
  });

  it('covers every kind of key verdict', () => {
    expect(new Set(keyed.map((c) => c.verdict))).toEqual(
      new Set(['correct', 'stereo', 'protonation', 'isomer', 'formula', 'fragments']),
    );
  });

  it("notes that stereo isn't checked only when the name doesn't state it", () => {
    const answer = (name: string) => cases.find((c) => c.asked === name && c.verdict === 'correct')!;
    expect(judge(asked('pent-2-ene'), answer('pent-2-ene').rdkit!)).toEqual({ kind: 'correct', stereoUnchecked: true });
    expect(judge(asked('(R)-butan-2-ol'), answer('(R)-butan-2-ol').rdkit!)).toEqual({
      kind: 'correct',
      stereoUnchecked: false,
    });
  });

  it('says what the drawing is, never what the answer is', () => {
    const other = cases.find((c) => c.verdict === 'formula')!;
    const verdict = judge(asked(other.asked), other.rdkit!);
    expect(verdict).toEqual({ kind: 'formula', formula: inchiFormula(other.rdkit!.inchi) });
    expect(verdictText(verdict)).not.toContain(asked(other.asked).formula);
    const extra = cases.find((c) => c.verdict === 'fragments')!;
    expect(judge(asked(extra.asked), extra.rdkit!)).toEqual({ kind: 'fragments', drawn: 2, expected: 1 });
  });

  it('flags stereocentres marked & or "or" (a non-standard key) in the stereo hint', () => {
    const right = asked('(R)-butan-2-ol');
    const [key] = right.keys;
    // The same key with the standard flag (S) turned to N, as Indigo writes it for an AND group.
    const marked = `${key.slice(0, 23)}N${key.slice(24)}`;
    const inchi = cases.find((c) => c.case === 'the answer, drawn')!.rdkit!.inchi;
    expect(judge(right, { inchikey: marked, inchi })).toEqual({ kind: 'stereo', marked: true });
  });
});

describe('the InChI formula', () => {
  it('is the second layer, and its parts are counted with their multipliers', () => {
    const [extra] = cases.filter((c) => c.verdict === 'fragments');
    expect(components(inchiFormula(extra.rdkit!.inchi))).toBe(2);
    expect(components(asked('3-methylbutanal').formula)).toBe(1);
    // The format alone: dot-separated parts, each with an optional count in front.
    expect(components('2A.B')).toBe(3);
  });
});
