// Topological symmetry (which carbons share a ¹³C peak) against server-side RDKit's
// CanonicalRankAtoms(breakTies=False) on every NMR and functional-group fixture compound,
// and the HOSE-style codes' independence from the order atoms were drawn in.
import initRDKitModule, { type MainModule } from '@rdkit/rdkit';
import { beforeAll, describe, expect, it } from 'vitest';
import { configureRdkit } from './compute';
import { graphOf, hoseCodes, symmetryRanks, type RdkitJson } from './hose';

interface Index {
  compounds: { typed_name: string; file: string; carbon_classes: number[][] }[];
}

const indexes = import.meta.glob<Index>(
  ['../../../tests/fixtures/nmr/compounds.json', '../../../tests/fixtures/functional_groups/compounds.json'],
  { eager: true, import: 'default' },
);
const molfiles = import.meta.glob<string>(['../../../tests/fixtures/nmr/*.mol', '../../../tests/fixtures/functional_groups/*.mol'], {
  eager: true,
  query: '?raw',
  import: 'default',
});
const COMPOUNDS = Object.values(indexes).flatMap((index) => index.compounds);

const WASM = new URL('../../node_modules/@rdkit/rdkit/dist/RDKit_minimal.wasm', import.meta.url).pathname;
let rdkit: MainModule;

beforeAll(async () => {
  rdkit = await initRDKitModule({ locateFile: () => WASM });
  configureRdkit(rdkit);
});

function graph(text: string, details: object = { removeHs: false }) {
  const mol = rdkit.get_mol(text, JSON.stringify(details));
  if (!mol) throw new Error('RDKit could not read it');
  try {
    return graphOf(JSON.parse(mol.get_json()) as RdkitJson);
  } finally {
    mol.delete();
  }
}

function molfile(rel: string): string {
  const text = molfiles[`../../../tests/fixtures/${rel}`];
  if (text === undefined) throw new Error(`no fixture ${rel}`);
  return text;
}

/** Carbons grouped by rank, as Molfile indices, sorted like the fixture's classes. */
function carbonClasses(g: ReturnType<typeof graph>): number[][] {
  const ranks = symmetryRanks(g);
  const classes = new Map<number, number[]>();
  g.atoms.forEach((a, i) => {
    if (a.z === 6) classes.set(ranks[i], [...(classes.get(ranks[i]) ?? []), a.index]);
  });
  return [...classes.values()].map((c) => c.sort((a, b) => a - b)).sort((a, b) => a[0] - b[0]);
}

describe('topological symmetry', () => {
  it('covers every NMR and functional-group fixture compound', () => {
    expect(COMPOUNDS.length).toBe(41);
  });

  it.each(COMPOUNDS.map((c) => [c.typed_name, c] as const))('%s: the carbon classes server-side RDKit gives', (_name, c) => {
    expect(carbonClasses(graph(molfile(c.file)))).toEqual(c.carbon_classes);
  });

  it('is the same with every hydrogen drawn as an atom', () => {
    for (const c of COMPOUNDS) {
      const mol = rdkit.get_mol(molfile(c.file))!;
      const withHs = mol.add_hs();
      mol.delete();
      expect(carbonClasses(graph(withHs)), c.typed_name).toEqual(c.carbon_classes);
    }
  });
});

describe('HOSE-style codes', () => {
  /** Each carbon's codes, as a sorted list (equivalent carbons repeat). */
  function codes(text: string): string[] {
    const g = graph(text);
    const ranks = symmetryRanks(g);
    return g.atoms.flatMap((a, i) => (a.z === 6 ? [hoseCodes(g, ranks, i, 4).join('|')] : [])).sort();
  }

  it("don't depend on the order the atoms were drawn in", () => {
    for (const c of COMPOUNDS) {
      const mol = rdkit.get_mol(molfile(c.file))!;
      const atoms = mol.get_num_atoms();
      const reference = codes(molfile(c.file));
      // The same structure written from three other starting atoms: other atom orders.
      for (const root of [atoms - 1, Math.floor(atoms / 2), 1]) {
        const smiles = mol.get_smiles(JSON.stringify({ rootedAtAtom: root, canonical: false }));
        const other = rdkit.get_mol(smiles)!;
        expect(codes(other.get_molblock()), `${c.typed_name} from atom ${root}`).toEqual(reference);
        other.delete();
      }
      mol.delete();
    }
  });

  it('give equivalent carbons the same codes, and grow one sphere at a time', () => {
    for (const c of COMPOUNDS) {
      const g = graph(molfile(c.file));
      const ranks = symmetryRanks(g);
      const byIndex = new Map(g.atoms.map((a, i) => [a.index, i]));
      for (const members of c.carbon_classes) {
        const all = members.map((m) => hoseCodes(g, ranks, byIndex.get(m)!, 4).join('|'));
        expect(new Set(all).size, `${c.typed_name} ${members.join(',')}`).toBe(1);
        const levels = hoseCodes(g, ranks, byIndex.get(members[0])!, 4);
        levels.forEach((code, k) => expect(code.split('/').length).toBe(k + 1));
      }
    }
  });
});
