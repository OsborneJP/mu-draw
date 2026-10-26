// The biochem tools' own logic against Biopython (tests/fixtures/biochem_peptides_expected.json,
// from server/scripts/gen_biochem_expected.py): net charge at every recorded pH and the pI
// (bar A.4), and every input rule of decision 10 (bar A.5).
import { describe, expect, it } from 'vitest';
import { duplexHelm, isoelectricPoint, MAX_LENGTH, netCharge, parseSequence, problemMessage, RESIDUES, type Parsed } from './biochem';
import data from './biochemData.json';

interface Expected {
  pH: number[];
  pIBracket: [number, number];
  peptides: { name: string; sequence: string; charge: number[]; pI: number; pIAtBracketEdge: boolean }[];
}

const fixture = Object.values(
  import.meta.glob<Expected>('../../../tests/fixtures/biochem_peptides_expected.json', { eager: true, import: 'default' }),
)[0];

describe('net charge and pI, against Biopython (Bjellqvist)', () => {
  it.each(fixture.peptides.map((p) => [p.name, p] as const))('%s: the charge at every recorded pH', (_, peptide) => {
    fixture.pH.forEach((pH, i) => expect(Math.abs(netCharge(peptide.sequence, pH) - peptide.charge[i])).toBeLessThan(1e-9));
  });

  it.each(fixture.peptides.map((p) => [p.name, p] as const))('%s: the pI', (_, peptide) => {
    const pI = isoelectricPoint(peptide.sequence);
    if (peptide.pIAtBracketEdge) {
      // Biopython stops at its bracket's edge; the true pI lies beyond it, where the charge is zero.
      expect(Math.abs(netCharge(peptide.sequence, pI))).toBeLessThan(1e-3);
      // Biopython's answer is the edge nearer the true pI (to its own precision of 1e-4).
      const [low, high] = fixture.pIBracket;
      const atLow = Math.abs(peptide.pI - low) < Math.abs(peptide.pI - high);
      expect(atLow ? pI < low + 0.005 : pI > high - 0.005).toBe(true);
    } else {
      expect(Math.abs(pI - peptide.pI)).toBeLessThan(0.005);
    }
  });
});

describe('reading a sequence (decision 10)', () => {
  const ok = (sequence: string, type: 'peptide' | 'dna' | 'rna' = 'peptide'): Parsed => ({ ok: true, type, sequence });

  it('takes any case, and ignores spaces, line breaks and digits', () => {
    expect(parseSequence('peptide', ' 1 acd\nEF 6\tgh')).toEqual(ok('ACDEFGH'));
    expect(parseSequence('dna', '1 acgt acgt\n9 TTGG')).toEqual(ok('ACGTACGTTTGG', 'dna'));
    expect(parseSequence('rna', 'acgu')).toEqual(ok('ACGU', 'rna'));
  });

  it('takes the 20 standard amino acids, one-letter and three-letter alike', () => {
    const one = Object.keys(RESIDUES).join('');
    expect(parseSequence('peptide', one)).toEqual(ok(one));
    expect(parseSequence('peptide3', Object.values(RESIDUES).join('-'))).toEqual(ok(one));
    expect(parseSequence('peptide3', Object.values(RESIDUES).join('').toUpperCase())).toEqual(ok(one));
    expect(parseSequence('peptide3', Object.values(RESIDUES).join(' ').toLowerCase())).toEqual(ok(one));
  });

  it('names the first character it cannot read and where it is', () => {
    expect(parseSequence('peptide', 'ACX DE')).toEqual({ ok: false, problem: 'character', character: 'X', position: 3 });
    expect(parseSequence('peptide', 'AC-DE')).toEqual({ ok: false, problem: 'character', character: '-', position: 3 });
    expect(parseSequence('dna', 'ACGU')).toEqual({ ok: false, problem: 'character', character: 'U', position: 4 });
    expect(parseSequence('rna', 'ACGT')).toEqual({ ok: false, problem: 'character', character: 'T', position: 4 });
    expect(parseSequence('dna', 'ACGN')).toEqual({ ok: false, problem: 'character', character: 'N', position: 4 });
    // Ambiguity codes and the two extra amino acids are rejected (decision 10).
    for (const letter of ['B', 'Z', 'J', 'U', 'O']) {
      expect(parseSequence('peptide', letter)).toMatchObject({ ok: false, problem: 'character' });
    }
    expect(parseSequence('peptide3', 'H-Ala-Gly-OH')).toEqual({ ok: false, problem: 'code', code: 'HAl', position: 1 });
    expect(parseSequence('peptide3', 'Ala-Xaa-Gly')).toEqual({ ok: false, problem: 'code', code: 'Xaa', position: 5 });
    expect(parseSequence('peptide3', 'Ala-Gl')).toEqual({ ok: false, problem: 'incomplete', position: 5 });
    expect(parseSequence('peptide3', 'Ala*Gly')).toEqual({ ok: false, problem: 'character', character: '*', position: 4 });
  });

  it(`stops at ${MAX_LENGTH} residues or bases`, () => {
    expect(parseSequence('peptide', 'A'.repeat(MAX_LENGTH))).toEqual(ok('A'.repeat(MAX_LENGTH)));
    expect(parseSequence('peptide', 'A'.repeat(MAX_LENGTH + 1))).toEqual({ ok: false, problem: 'long', length: MAX_LENGTH + 1 });
    expect(parseSequence('peptide3', 'Ala'.repeat(MAX_LENGTH + 1))).toMatchObject({ problem: 'long' });
    expect(parseSequence('dna', 'A'.repeat(MAX_LENGTH))).toMatchObject({ ok: true });
    expect(parseSequence('dna', 'A'.repeat(MAX_LENGTH + 1))).toMatchObject({ problem: 'long' });
  });

  it('treats a box of only spaces and digits as empty, with no message', () => {
    const empty = parseSequence('dna', ' 12\n ');
    expect(empty).toEqual({ ok: false, problem: 'empty' });
    expect(problemMessage('dna', empty as Extract<Parsed, { ok: false }>)).toBe('');
  });

  it('says what is wrong in words', () => {
    const message = (type: Parameters<typeof parseSequence>[0], text: string) =>
      problemMessage(type, parseSequence(type, text) as Extract<Parsed, { ok: false }>);
    expect(message('peptide', 'ACX')).toBe('"X" (character 3) is not one of the 20 standard amino acids.');
    expect(message('dna', 'ACGU')).toBe('"U" (character 4) is not A, C, G, T.');
    expect(message('rna', 'ACGT')).toBe('"T" (character 4) is not A, C, G, U.');
    expect(message('peptide3', 'Ala-Xaa')).toBe(
      '"Xaa" (character 5) is not the three-letter code of one of the 20 standard amino acids.',
    );
    expect(message('peptide3', 'AlaGl')).toBe('The code at character 4 has fewer than three letters.');
    expect(message('peptide', 'A'.repeat(1001))).toBe('1001 residues: the limit is 1000.');
    expect(message('dna', 'A'.repeat(1001))).toBe('1001 bases: the limit is 1000.');
  });
});

describe('the duplex for Tm', () => {
  it('pairs every base with its complement, antiparallel', () => {
    const helm = duplexHelm('dna', 'ACGTT');
    const [chains, pairs] = helm.split('$');
    const [top, bottom] = chains.split('|').map((c) => [...c.matchAll(/\((\w)\)/g)].map((m) => m[1]));
    expect(top.join('')).toBe('ACGTT');
    expect(bottom.join('')).toBe('AACGT');
    // HELM numbers monomers from 1: sugar, base, phosphate for each nucleotide.
    const monomers = (chain: string) => chain.replace(/^RNA\d\{|\}$/g, '').split(/\.|(?=\()|(?<=\))/);
    const top3 = monomers(chains.split('|')[0]);
    const bottom3 = monomers(chains.split('|')[1]);
    for (const pair of pairs.split('|')) {
      const [, a, b] = /^RNA1,RNA2,(\d+):pair-(\d+):pair$/.exec(pair)!;
      const x = top3[Number(a) - 1].replace(/[()]/g, '');
      const y = bottom3[Number(b) - 1].replace(/[()]/g, '');
      expect(data.complement.dna[x as 'A']).toBe(y);
    }
    expect(pairs.split('|')).toHaveLength(5);
  });

  it('uses ribose and U for RNA', () => {
    expect(duplexHelm('rna', 'AU')).toBe('RNA1{R(A)P.R(U)}|RNA2{R(A)P.R(U)}$RNA1,RNA2,2:pair-5:pair|RNA1,RNA2,5:pair-2:pair$$$V2.0');
  });
});
