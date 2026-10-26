// Indigo's side of the biochem tools, run in Node exactly as the worker runs it (the same glue,
// wasm and Ketcher monomer library), against what the generators recorded (bar A.2-A.4):
// tests/fixtures/biochem_indigo_expected.json (Indigo, each duplex built a second way) and
// tests/fixtures/biochem_peptides_expected.json (Biopython).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Module from 'indigo-ketcher/binaryWasm';
import library from 'ketcher-core/dist/application/editor/data/monomers.modern.js';
import { beforeAll, describe, expect, it } from 'vitest';
import { TM_MAX_BASES, TM_MIN_BASES } from './biochem';
import { createEngine, type BiochemRequest, type BiochemValues, type Engine } from './indigoBiochem';

interface IndigoExpected {
  concentrations: { sodium_mM: number; strand_uM: number }[];
  peptides: { name: string; sequence: string; formula: string; mass: number; extinction: number; hydrophobicity: number[] }[];
  nucleic: {
    name: string;
    sequence: string;
    dna: { formula: string; mass: number; tm: number[] | null };
    rna: { formula: string; mass: number };
  }[];
}
interface BiopythonExpected {
  peptides: { sequence: string; extinction: { reduced: number; cystines: number }; blackMould: number[] }[];
}

const load = <T>(glob: Record<string, T>) => Object.values(glob)[0];
const indigoFixture = load(
  import.meta.glob<IndigoExpected>('../../../tests/fixtures/biochem_indigo_expected.json', { eager: true, import: 'default' }),
);
const biopython = load(
  import.meta.glob<BiopythonExpected>('../../../tests/fixtures/biochem_peptides_expected.json', { eager: true, import: 'default' }),
);
const fromBiopython = new Map(biopython.peptides.map((p) => [p.sequence, p]));

let engine: Engine;
let id = 0;

beforeAll(async () => {
  const wasm = readFileSync(fileURLToPath(new URL('../../node_modules/indigo-ketcher/indigo-ketcher-1.46.0.wasm', import.meta.url)));
  engine = createEngine(await Module({ wasmBinary: wasm }), library);
}, 30_000);

function compute(request: Omit<BiochemRequest, 'id'>): BiochemValues {
  const reply = engine.compute({ ...request, id: ++id });
  if (!('values' in reply)) throw new Error(JSON.stringify(reply));
  return reply.values;
}

describe('peptides', () => {
  it("Indigo's fixture covers every test peptide Biopython's does (decision 11: alone, first, last)", () => {
    const fromIndigo = new Set(indigoFixture.peptides.map((p) => p.sequence));
    expect(biopython.peptides.map((p) => p.sequence).filter((s) => !fromIndigo.has(s))).toEqual([]);
  });

  it.each(indigoFixture.peptides.map((p) => [p.name, p] as const))('%s: Indigo\'s values, and ε as ExPASy gives it', (_, expected) => {
    const values = compute({ type: 'peptide', sequence: expected.sequence, tm: null });
    if (values.kind !== 'peptide') throw new Error(values.kind);
    expect(values.formula).toBe(expected.formula);
    expect(values.mass).toBe(expected.mass);
    expect(values.hydrophobicity).toEqual(expected.hydrophobicity);
    expect(values.extinction).toEqual(fromBiopython.get(expected.sequence)!.extinction);
  });

  it("Indigo's hydrophobicity is Biopython's Black & Mould scale, residue by residue", () => {
    for (const p of indigoFixture.peptides) expect(p.hydrophobicity, p.name).toEqual(fromBiopython.get(p.sequence)!.blackMould);
  });

  it("Indigo's ε is the sum of its ε for each residue alone (what the ExPASy values are built from)", () => {
    const alone = new Map(indigoFixture.peptides.filter((p) => p.sequence.length === 1).map((p) => [p.sequence, p.extinction]));
    for (const p of indigoFixture.peptides) {
      const sum = [...p.sequence].reduce((total, r) => total + alone.get(r)!, 0);
      expect(p.extinction, p.name).toBe(sum);
    }
  });
});

describe('nucleic acids', () => {
  const molar = (c: IndigoExpected['concentrations'][number]) => ({ sodium: c.sodium_mM / 1e3, strand: c.strand_uM / 1e6 });

  it.each(indigoFixture.nucleic.map((n) => [n.name, n] as const))(
    '%s: the strand as DNA (with Tm at each concentration) and as RNA',
    (_, expected) => {
      const { length } = expected.sequence;
      const long = length >= TM_MIN_BASES && length <= TM_MAX_BASES; // long enough, and not too long
      expect(expected.dna.tm !== null).toBe(long);
      indigoFixture.concentrations.forEach((c, i) => {
        const dna = compute({ type: 'dna', sequence: expected.sequence, tm: long ? molar(c) : null });
        if (dna.kind !== 'nucleic') throw new Error(dna.kind);
        expect(dna.formula).toBe(expected.dna.formula);
        expect(dna.mass).toBe(expected.dna.mass);
        if (long) expect(Math.abs(dna.tm! - expected.dna.tm![i])).toBeLessThan(0.005);
        else expect(dna.tm).toBeNull();
      });
      const rna = compute({ type: 'rna', sequence: expected.sequence.replaceAll('T', 'U'), tm: null });
      expect(rna).toEqual({ kind: 'nucleic', formula: expected.rna.formula, mass: expected.rna.mass, tm: null });
    },
    20_000,
  );
});

it('a sequence Indigo cannot read is an error reply, not a crash', () => {
  const reply = engine.compute({ id: 1, type: 'dna', sequence: 'ACG1', tm: null });
  expect(reply).toMatchObject({ id: 1, error: expect.stringMatching(/Invalid symbols/) });
  // The engine still answers afterwards.
  expect(compute({ type: 'peptide', sequence: 'G', tm: null }).kind).toBe('peptide');
});
