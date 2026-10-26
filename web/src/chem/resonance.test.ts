// The browser's resonance structure generator (RDKit.js, the code the worker runs; a port of
// RDKit's ResonanceMolSupplier and its conjugation rules) against what server-side RDKit
// answered for the same drawings (tests/fixtures/resonance_expected.json) and for 303 molecules
// of RDKit's NCI set (forms_nci_expected.json): docs/plans/v2-tautomers-resonance.md, bar
// A.4-A.5. The same structures, the same conjugated bonds, and RDKit's order, except among
// structures RDKit ranks equal on every measure (there its order follows internal hashes).
import initRDKitModule, { type MainModule } from '@rdkit/rdkit';
import { beforeAll, describe, expect, it } from 'vitest';
import { configureRdkit } from './compute';
import { chiralFlagOf, formOf } from './rdkitForm';
import { listResonance, RESONANCE_LIMITS, resonanceOutcome, supply, type ResonanceList } from './resonance';

interface ExpectedStructure {
  bonds: number[];
  charges: number[];
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
  molecules: { smiles: string; resonance: Found & { structures?: [number[], number[]][] } }[];
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

/** RDKit's order, as far as it is defined: the browser's ranks, read in the fixture's order,
 * are the browser's ranks in its own order; and the two hold the same structures. */
function sameUpToTies(browser: { bonds: number[]; charges: number[]; rank: string }[], python: [number[], number[]][]): boolean {
  const rank = new Map(browser.map((s) => [key(s.bonds, s.charges), s.rank]));
  const theirs = python.map(([b, c]) => key(b, c));
  return (
    JSON.stringify([...theirs].sort()) === JSON.stringify(browser.map((s) => key(s.bonds, s.charges)).sort()) &&
    JSON.stringify(theirs.map((k) => rank.get(k))) === JSON.stringify(browser.map((s) => s.rank))
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
      const python = c.structures!.map((s) => [s.bonds, s.charges] as [number[], number[]]);
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
        expect({ bonds: form.bonds.map((b) => b.bo), charges: form.atoms.map((a) => a.chg) }, `${c.name} ${s.number}`).toEqual({
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

  it('tells ties from order: a swap RDKit’s ranks fix is caught, a swap among equal ranks is not', () => {
    const s = (n: number, rank: string) => ({ bonds: [n], charges: [0], rank });
    expect(sameUpToTies([s(1, 'a'), s(2, 'a')], [[[2], [0]], [[1], [0]]])).toBe(true);
    expect(sameUpToTies([s(1, 'a'), s(2, 'b')], [[[2], [0]], [[1], [0]]])).toBe(false);
    expect(sameUpToTies([s(1, 'a'), s(2, 'b')], [[[1], [0]]])).toBe(false);
  });
});
