// The biochem tools' own logic (docs/plans/v2-biochem.md): reading a typed sequence, the net
// charge and isoelectric point from Bjellqvist's pKa values, ε280 as ExPASy gives it, and the
// HELM for a DNA strand paired with its complement (Indigo's Tm needs a double strand).
// Every table comes from biochemData.json, generated from Biopython
// (server/scripts/gen_biochem_expected.py); Indigo's values come from indigoBiochem.ts.
import data from './biochemData.json';

/** What the student says the sequence is. */
export type SequenceType = 'peptide' | 'peptide3' | 'dna' | 'rna';
/** The chain itself: one-letter codes, upper case. */
export type ChainType = 'peptide' | 'dna' | 'rna';

/** Decision 10: up to 1000 residues or bases. */
export const MAX_LENGTH = 1000;
/** Decision 8: Khandelwal and Bhyravabhotla fitted 15-mers upward. */
export const TM_MIN_BASES = 15;

/** One-letter code → three-letter code, the 20 standard amino acids. */
export const RESIDUES: Readonly<Record<string, string>> = data.residues;
const BASES: Record<'dna' | 'rna', Record<string, string>> = data.complement;

export type Parsed =
  | { ok: true; type: ChainType; sequence: string }
  | { ok: false; problem: 'empty' }
  | { ok: false; problem: 'character'; character: string; position: number }
  | { ok: false; problem: 'code'; code: string; position: number }
  | { ok: false; problem: 'incomplete'; position: number }
  | { ok: false; problem: 'long'; length: number };

/** Spaces, line breaks and digits (pasted position numbers) are never part of a sequence. */
const IGNORED = /[\s\d]/;

/** Read what the student typed. Positions count from 1 in `text` as typed. */
export function parseSequence(type: SequenceType, text: string): Parsed {
  if (type === 'peptide3') return parseThreeLetter(text);
  const allowed = type === 'peptide' ? RESIDUES : BASES[type];
  let sequence = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (IGNORED.test(c)) continue;
    const upper = c.toUpperCase();
    if (!(upper in allowed)) return { ok: false, problem: 'character', character: c, position: i + 1 };
    sequence += upper;
  }
  return finished(type, sequence);
}

const BY_THREE = new Map(Object.entries(RESIDUES).map(([one, three]) => [three.toLowerCase(), one]));

function parseThreeLetter(text: string): Parsed {
  const letters: { c: string; position: number }[] = [];
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (IGNORED.test(c) || c === '-') continue;
    if (!/[A-Za-z]/.test(c)) return { ok: false, problem: 'character', character: c, position: i + 1 };
    letters.push({ c, position: i + 1 });
  }
  let sequence = '';
  for (let i = 0; i < letters.length; i += 3) {
    const code = letters.slice(i, i + 3);
    if (code.length < 3) return { ok: false, problem: 'incomplete', position: code[0].position };
    const written = code.map((l) => l.c).join('');
    const one = BY_THREE.get(written.toLowerCase());
    if (!one) return { ok: false, problem: 'code', code: written, position: code[0].position };
    sequence += one;
  }
  return finished('peptide', sequence);
}

function finished(type: SequenceType, sequence: string): Parsed {
  if (sequence.length === 0) return { ok: false, problem: 'empty' };
  if (sequence.length > MAX_LENGTH) return { ok: false, problem: 'long', length: sequence.length };
  return { ok: true, type: type === 'peptide3' ? 'peptide' : type, sequence };
}

/** The message for a sequence that can't be read; empty for an empty box. */
export function problemMessage(type: SequenceType, parsed: Extract<Parsed, { ok: false }>): string {
  const unit = type === 'peptide' || type === 'peptide3' ? 'residues' : 'bases';
  switch (parsed.problem) {
    case 'empty':
      return '';
    case 'long':
      return `${parsed.length} ${unit}: the limit is ${MAX_LENGTH}.`;
    case 'incomplete':
      return `The code at character ${parsed.position} has fewer than three letters.`;
    case 'code':
      return `"${parsed.code}" (character ${parsed.position}) is not the three-letter code of one of the 20 standard amino acids.`;
    case 'character': {
      const { character: c, position } = parsed;
      const allowed =
        type === 'peptide'
          ? 'one of the 20 standard amino acids'
          : type === 'peptide3'
            ? 'part of a three-letter code'
            : Object.keys(BASES[type]).join(', ');
      return `"${c}" (character ${position}) is not ${allowed}.`;
    }
  }
}

const PKA: Record<'positive' | 'negative' | 'nTerminal' | 'cTerminal', Record<string, number>> = data.pKa;

/** Biopython's IsoelectricPoint.charge_at_pH, for a peptide with free termini: Henderson-
 * Hasselbalch over each ionisable group, with the N- and C-terminal pKa of the end residues
 * where Bjellqvist gives one. */
export function netCharge(sequence: string, pH: number): number {
  const ends: Record<string, number | undefined> = {
    Nterm: PKA.nTerminal[sequence[0]],
    Cterm: PKA.cTerminal[sequence[sequence.length - 1]],
  };
  const count = (key: string) => (key in ends ? 1 : [...sequence].filter((r) => r === key).length);
  let positive = 0;
  for (const [key, table] of Object.entries(PKA.positive)) {
    positive += count(key) * (1 / (10 ** (pH - (ends[key] ?? table)) + 1));
  }
  let negative = 0;
  for (const [key, table] of Object.entries(PKA.negative)) {
    negative += count(key) * (1 / (10 ** ((ends[key] ?? table) - pH) + 1));
  }
  return positive - negative;
}

/** The pH where the net charge is zero, by bisection over the whole scale (Biopython's own
 * search never leaves pH 4.05 to 12). The charge falls as the pH rises. */
export function isoelectricPoint(sequence: string): number {
  let low = 0;
  let high = 14;
  while (high - low > 1e-7) {
    const middle = (low + high) / 2;
    if (netCharge(sequence, middle) > 0) low = middle;
    else high = middle;
  }
  return (low + high) / 2;
}

/** ExPASy's two ε280 values, from Indigo's figure: Indigo adds `perCysteine` for every Cys,
 * where Pace's value is per cystine (two Cys joined). */
export function extinction(indigo: number, sequence: string, perCysteine: number): { reduced: number; cystines: number } {
  const cysteines = [...sequence].filter((r) => r === 'C').length;
  const reduced = indigo - cysteines * perCysteine;
  return { reduced, cystines: reduced + Math.floor(cysteines / 2) * perCysteine };
}

/** HELM for the strand paired base by base with its exact complement (antiparallel), for
 * Indigo's Tm. In HELM each nucleotide is sugar(base)phosphate, so in a chain of n the k-th
 * base (from 0) is monomer 3k + 2; the last nucleotide has no phosphate. */
export function duplexHelm(type: 'dna' | 'rna', sequence: string): string {
  const sugar = type === 'dna' ? '[dR]' : 'R';
  const strand = (bases: string) => [...bases].map((b) => `${sugar}(${b})`).join('P.');
  const complement = [...sequence]
    .reverse()
    .map((b) => BASES[type][b])
    .join('');
  const n = sequence.length;
  const pairs = [...sequence].map((_, k) => `RNA1,RNA2,${3 * k + 2}:pair-${3 * (n - 1 - k) + 2}:pair`);
  return `RNA1{${strand(sequence)}}|RNA2{${strand(complement)}}$${pairs.join('|')}$$$V2.0`;
}
