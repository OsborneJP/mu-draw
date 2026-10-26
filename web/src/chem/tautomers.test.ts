// The browser's tautomer enumerator (RDKit.js, the code the worker runs; a port of RDKit's
// TautomerEnumerator) against what server-side RDKit answered for the same drawings
// (tests/fixtures/tautomers_expected.json) and for 303 molecules of RDKit's NCI set
// (forms_nci_expected.json): docs/plans/v2-tautomers-resonance.md, bar A.4-A.5. The panel's
// order is the drawing's own first, then RDKit's (decision 3).
import initRDKitModule, { type MainModule } from '@rdkit/rdkit';
import { beforeAll, describe, expect, it } from 'vitest';
import { configureRdkit } from './compute';
import { chiralFlagOf, formOf } from './rdkitForm';
import { enumerate, listTautomers, readDrawing, TAUTOMER_LIMITS, tautomerOutcome, type TautomerList } from './tautomers';

interface ExpectedTautomer {
  smiles: string;
  drawing: boolean;
  hydrogens: number[];
  changed_atoms: number[];
  changed_bonds: number[];
}

interface Expected {
  name: string;
  file: string;
  outcome: TautomerList['outcome'];
  status?: string;
  stereo_dropped?: boolean;
  tautomers?: ExpectedTautomer[];
}

interface Fixture {
  limits: { drawn: number; max_transforms: number };
  compounds: Expected[];
}

interface Nci {
  molecules: { smiles: string; tautomers: { status: string; smiles: string[] } }[];
}

const fixture = Object.values(
  import.meta.glob<Fixture>('../../../tests/fixtures/tautomers_expected.json', { eager: true, import: 'default' }),
)[0];
const nci = Object.values(import.meta.glob<Nci>('../../../tests/fixtures/forms_nci_expected.json', { eager: true, import: 'default' }))[0];
const molfiles = import.meta.glob<string>('../../../tests/fixtures/forms/*.mol', { eager: true, query: '?raw', import: 'default' });

/** Python's statuses as the port names them. */
const STATUS: Record<string, string> = {
  Completed: 'completed',
  MaxTautomersReached: 'max-tautomers',
  MaxTransformsReached: 'max-transforms',
};

function drawing(compound: Expected): string {
  const text = molfiles[`../../../tests/fixtures/${compound.file}`];
  if (text === undefined) throw new Error(`no fixture file ${compound.file}`);
  return text;
}

/** What the panel must show for a compound, from the fixture. */
function expected(compound: Expected) {
  if (compound.outcome === 'several') return { outcome: 'several' };
  if (compound.outcome === 'too-many') return { outcome: 'too-many', status: STATUS[compound.status!] };
  const listed = compound.tautomers!;
  const ordered = [...listed.filter((t) => t.drawing), ...listed.filter((t) => !t.drawing)];
  return {
    outcome: 'listed',
    stereoDropped: compound.stereo_dropped,
    tautomers: ordered.map((t, i) => ({
      number: i + 1,
      smiles: t.smiles,
      drawing: t.drawing,
      hydrogens: t.hydrogens,
      changedAtoms: t.changed_atoms,
      changedBonds: t.changed_bonds,
    })),
  };
}

/** The parts of a result the fixture records, without the Molfiles. */
function comparable(result: TautomerList) {
  if (result.outcome !== 'listed') return result;
  return {
    ...result,
    tautomers: result.tautomers.map(({ number, smiles, drawing, hydrogens, changedAtoms, changedBonds }) => ({
      number,
      smiles,
      drawing,
      hydrogens,
      changedAtoms,
      changedBonds,
    })),
  };
}

let rdkit: MainModule;
const results = new Map<string, TautomerList>();

beforeAll(async () => {
  rdkit = await initRDKitModule();
  configureRdkit(rdkit);
  for (const compound of fixture.compounds) results.set(compound.name, listTautomers(rdkit, drawing(compound))!);
});

describe('the test drawings', () => {
  it('lists what RDKit lists: the drawing’s own first, each with what differs from it', () => {
    expect(fixture.compounds.filter((c) => c.outcome === 'listed').length).toBeGreaterThan(25);
    for (const compound of fixture.compounds) {
      expect(comparable(results.get(compound.name)!), compound.name).toEqual(expected(compound));
    }
  });

  it('gives each tautomer a Molfile that reads back as it, in the drawing’s layout, with its chiral flag', () => {
    for (const compound of fixture.compounds) {
      const result = results.get(compound.name)!;
      if (result.outcome !== 'listed') continue;
      const read = readDrawing(rdkit, drawing(compound))!;
      const layout = formOf(read).coords!;
      read.delete();
      for (const t of result.tautomers) {
        const mol = rdkit.get_mol(t.molfile)!;
        expect(mol.get_smiles(), `${compound.name} ${t.number}`).toBe(t.smiles);
        formOf(mol).coords!.forEach((p, i) => {
          expect(p[0], `${compound.name} ${t.number} atom ${i}`).toBeCloseTo(layout[i][0], 3);
          expect(p[1], `${compound.name} ${t.number} atom ${i}`).toBeCloseTo(layout[i][1], 3);
        });
        mol.delete();
        expect(chiralFlagOf(t.molfile)).toBe(chiralFlagOf(drawing(compound)));
      }
    }
  });
});

describe('RDKit’s NCI sample', () => {
  it('gives Python’s tautomers, in its order, and its status, for every molecule', () => {
    expect(nci.molecules.length).toBe(303); // the first 300 single structures, and 3 witnesses of rarer rules
    for (const m of nci.molecules) {
      const mol = rdkit.get_mol(m.smiles)!;
      const found = enumerate(rdkit, mol);
      mol.delete();
      expect({ status: found.status, smiles: found.tautomers.map((t) => t.smiles) }, m.smiles).toEqual({
        status: STATUS[m.tautomers.status],
        smiles: m.tautomers.smiles,
      });
    }
  });
});

describe('the limit (decision 7)', () => {
  it('is the fixture’s', () => {
    expect(TAUTOMER_LIMITS).toEqual({ drawn: fixture.limits.drawn, maxTransforms: fixture.limits.max_transforms });
  });

  it('lists 32 and no more, and nothing RDKit stopped early', () => {
    expect(tautomerOutcome('completed', 1)).toBe('listed');
    expect(tautomerOutcome('completed', 32)).toBe('listed');
    expect(tautomerOutcome('completed', 33)).toBe('too-many');
    expect(tautomerOutcome('max-tautomers', 1)).toBe('too-many');
    expect(tautomerOutcome('max-transforms', 1)).toBe('too-many');
  });
});
