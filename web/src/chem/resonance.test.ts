// The browser's resonance structure generator (RDKit.js, the code the worker runs; a port of
// RDKit's ResonanceMolSupplier and its conjugation rules) against what server-side RDKit
// answered for the same drawings (tests/fixtures/resonance_expected.json) and for 303 molecules
// of RDKit's NCI set (forms_nci_expected.json): docs/plans/v2-tautomers-resonance.md, bar
// A.4-A.5. The same structures, the same conjugated bonds, each structure's rank as the
// generator works it out (a Python test checks RDKit's own order follows those ranks), and
// RDKit's order except among structures of equal rank (there it follows internal hashes).
import initRDKitModule, { type MainModule } from '@rdkit/rdkit';
import { beforeAll, describe, expect, it } from 'vitest';
import { configureRdkit } from './compute';
import { chiralFlagOf, formOf, orderOf } from './rdkitForm';
import { listResonance, RESONANCE_LIMITS, resonanceOutcome, supply, type ResonanceList } from './resonance';

interface ExpectedStructure {
  bonds: number[];
  charges: number[];
  rank: string;
  drawing: boolean;
  changed_atoms: number[];
  changed_bonds: number[];
}

interface Found {
  conjugated: number[];
  largest_group: number;
  outcome: 'listed' | 'counted' | 'too-large';
  count?: number;
}

type Expected = { name: string; file: string; outcome: ResonanceList['outcome'] } & Partial<Found> & {
    structures?: ExpectedStructure[];
  };

interface Fixture {
  limits: { drawn: number; group_bonds: number; max_structs: number };
  compounds: Expected[];
}

interface Nci {
  molecules: { smiles: string; resonance: Found & { structures?: [number[], number[], string][] } }[];
}

const fixture = Object.values(
  import.meta.glob<Fixture>('../../../tests/fixtures/resonance_expected.json', { eager: true, import: 'default' }),
)[0];
const nci = Object.values(import.meta.glob<Nci>('../../../tests/fixtures/forms_nci_expected.json', { eager: true, import: 'default' }))[0];
const molfiles = import.meta.glob<string>('../../../tests/fixtures/forms/*.mol', { eager: true, query: '?raw', import: 'default' });

function drawing(compound: Expected): string {
  const text = molfiles[`../../../tests/fixtures/${compound.file}`];
  if (text === undefined) throw new Error(`no fixture file ${compound.file}`);
  return text;
}

const key = (bonds: number[], charges: number[]) => JSON.stringify([bonds, charges]);

/** The same structures with the same ranks, in RDKit's order as far as it is defined: the
 * fixture's ranks, read along the browser's order, are the fixture's ranks along its own. */
function sameUpToTies(browser: { bonds: number[]; charges: number[]; rank: string }[], python: [number[], number[], string][]): boolean {
  const rank = new Map(python.map(([b, c, r]) => [key(b, c), r]));
  return (
    JSON.stringify(python.map(([b, c, r]) => key(b, c) + r).sort()) ===
      JSON.stringify(browser.map((s) => key(s.bonds, s.charges) + s.rank).sort()) &&
    JSON.stringify(browser.map((s) => rank.get(key(s.bonds, s.charges)))) === JSON.stringify(python.map(([, , r]) => r))
  );
}

let rdkit: MainModule;
const results = new Map<string, ResonanceList>();

beforeAll(async () => {
  rdkit = await initRDKitModule();
  configureRdkit(rdkit);
  for (const compound of fixture.compounds) results.set(compound.name, listResonance(rdkit, drawing(compound))!);
});

describe('the test drawings', () => {
  it('lists what RDKit lists, in its order, each with what differs from the drawing', () => {
    expect(fixture.compounds.filter((c) => c.outcome === 'listed').length).toBeGreaterThan(30);
    for (const c of fixture.compounds) {
      const result = results.get(c.name)!;
      expect(result.outcome, c.name).toBe(c.outcome);
      if (result.outcome === 'too-large') expect(result.largestGroup, c.name).toBe(c.largest_group);
      if (result.outcome === 'counted') expect(result.count, c.name).toBe(c.count);
      if (result.outcome !== 'listed') continue;
      const python = c.structures!.map((s) => [s.bonds, s.charges, s.rank] as [number[], number[], string]);
      expect(sameUpToTies(result.structures, python), c.name).toBe(true);
      const byKey = new Map(c.structures!.map((s) => [key(s.bonds, s.charges), s]));
      for (const s of result.structures) {
        const e = byKey.get(key(s.bonds, s.charges))!;
        expect({ drawing: s.drawing, changedAtoms: s.changedAtoms, changedBonds: s.changedBonds }, `${c.name} ${s.number}`).toEqual({
          drawing: e.drawing,
          changedAtoms: e.changed_atoms,
          changedBonds: e.changed_bonds,
        });
      }
      expect(result.structures.map((s) => s.number)).toEqual(result.structures.map((_, i) => i + 1));
    }
  });

  it('marks the bonds RDKit marks conjugated', () => {
    for (const c of fixture.compounds) {
      if (c.conjugated === undefined) continue;
      const mol = rdkit.get_mol(drawing(c), JSON.stringify({ removeHs: true }))!;
      const found = supply(formOf(mol));
      mol.delete();
      expect(found.conjugated.flatMap((x, i) => (x ? [i] : [])), c.name).toEqual(c.conjugated);
      expect(found.largestGroup, c.name).toBe(c.largest_group);
    }
  });

  it('gives each structure a Molfile with its own bonds and charges, in the drawing’s layout and chiral flag', () => {
    for (const c of fixture.compounds) {
      const result = results.get(c.name)!;
      if (result.outcome !== 'listed') continue;
      const layout = formOf(rdkit.get_mol(drawing(c), JSON.stringify({ removeHs: true }))!).coords!;
      for (const s of result.structures) {
        const mol = rdkit.get_mol(s.molfile, JSON.stringify({ kekulize: false, setAromaticity: false }))!;
        const form = formOf(mol);
        mol.delete();
        expect({ bonds: form.bonds.map(orderOf), charges: form.atoms.map((a) => a.chg) }, `${c.name} ${s.number}`).toEqual({
          bonds: s.bonds,
          charges: s.charges,
        });
        form.coords!.forEach((p, i) => {
          expect(p[0]).toBeCloseTo(layout[i][0], 3);
          expect(p[1]).toBeCloseTo(layout[i][1], 3);
        });
        expect(chiralFlagOf(s.molfile)).toBe(chiralFlagOf(drawing(c)));
      }
    }
  });
});

/** A version 2 Molfile with its first double bond retyped (Molfile bond types: 4 aromatic, 5 to 8
 * query bonds, 10 a hydrogen bond), as Ketcher writes them. */
function withDoubleBondTyped(molfile: string, type: number): string {
  const lines = molfile.split('\n');
  const first = 4 + Number(lines[3].slice(0, 3));
  const bonds = Number(lines[3].slice(3, 6));
  const at = lines.slice(first, first + bonds).findIndex((line) => line.slice(6, 9).trim() === '2');
  if (at < 0) throw new Error('no double bond to retype');
  lines[first + at] = `${lines[first + at].slice(0, 6)}${String(type).padStart(3)}${lines[first + at].slice(9)}`;
  return lines.join('\n');
}

describe('a bond RDKit reads as none of single, double or triple (review finding)', () => {
  const acetate = () => drawing(fixture.compounds.find((c) => c.name === 'acetate')!);

  it('is refused: aromatic outside a ring (acetate drawn as its hybrid), a query bond, a hydrogen bond', () => {
    for (const type of [4, 5, 6, 7, 8, 10]) expect(listResonance(rdkit, withDoubleBondTyped(acetate(), type)), `type ${type}`).toEqual({ outcome: 'bonds' });
  });

  it('is not refused when single or double', () => {
    for (const type of [1, 2]) expect(listResonance(rdkit, withDoubleBondTyped(acetate(), type))?.outcome, `type ${type}`).toBe('listed');
  });
});

describe('RDKit’s NCI sample', () => {
  it('gives Python’s structures, conjugated bonds and limits for every molecule', () => {
    expect(nci.molecules.length).toBe(303); // the first 300 single structures, and 3 witnesses of rarer rules
    for (const m of nci.molecules) {
      const mol = rdkit.get_mol(m.smiles)!;
      const found = supply(formOf(mol));
      mol.delete();
      const expected = m.resonance;
      expect(found.conjugated.flatMap((x, i) => (x ? [i] : [])), m.smiles).toEqual(expected.conjugated);
      expect(found.largestGroup, m.smiles).toBe(expected.largest_group);
      expect(resonanceOutcome(found.largestGroup, found.count), m.smiles).toBe(expected.outcome);
      if (expected.outcome === 'too-large') continue;
      expect(found.count, m.smiles).toBe(expected.count);
      if (expected.outcome === 'listed') expect(sameUpToTies(found.structures!, expected.structures!), m.smiles).toBe(true);
    }
  });
});

describe('the limits (decision 7)', () => {
  it('are the fixture’s', () => {
    expect(RESONANCE_LIMITS).toEqual({
      drawn: fixture.limits.drawn,
      groupBonds: fixture.limits.group_bonds,
      maxStructs: fixture.limits.max_structs,
    });
  });

  it('list 32 and count 33; run on a group of 60 bonds and not 61', () => {
    expect(resonanceOutcome(60, 32)).toBe('listed');
    expect(resonanceOutcome(60, 33)).toBe('counted');
    expect(resonanceOutcome(61, 1)).toBe('too-large');
    expect(resonanceOutcome(0, 1)).toBe('listed');
  });

  it('tells ties from order: a swap the ranks fix is caught, one among equal ranks is not, nor is a rank of its own', () => {
    const s = (n: number, rank: string) => ({ bonds: [n], charges: [0], rank });
    expect(sameUpToTies([s(1, 'a'), s(2, 'a')], [[[2], [0], 'a'], [[1], [0], 'a']])).toBe(true);
    expect(sameUpToTies([s(1, 'a'), s(2, 'b')], [[[2], [0], 'b'], [[1], [0], 'a']])).toBe(false);
    expect(sameUpToTies([s(1, 'a'), s(2, 'a')], [[[1], [0], 'a'], [[2], [0], 'b']])).toBe(false);
    expect(sameUpToTies([s(1, 'a'), s(2, 'b')], [[[1], [0], 'a']])).toBe(false);
  });
});
