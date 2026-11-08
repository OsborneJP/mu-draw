// readableMolfile (aromaticHydrogens.ts) on drawings written as Ketcher writes an aromatized
// one: every ring bond type 4 and no H on any atom, the H counts noted in the comment line.
// RDKit.js (the worker's package and wasm) makes those from the generated fixtures, so no
// structure here is typed by hand.
import initRDKitModule, { type MainModule } from '@rdkit/rdkit';
import { beforeAll, describe, expect, it } from 'vitest';
import { configureRdkit } from './compute';
import { noteHydrogens, readableMolfile, type AromaticHydrogens } from './aromaticHydrogens';

const forms = import.meta.glob<string>('../../../tests/fixtures/forms/*.mol', { eager: true, query: '?raw', import: 'default' });
const form = (name: string) => {
  const text = forms[`../../../tests/fixtures/forms/${name}.mol`];
  if (text === undefined) throw new Error(`no fixture forms/${name}.mol`);
  return text;
};

// Each has an aromatic N-H (or, last, a charged ring carbon); guanine and allopurinol are the
// two RDKit read as other compounds, two H short, before the fix.
const NEEDS_HYDROGENS = ['imidazole', 'histidine', 'adenine', 'guanine', 'allopurinol', 'uracil', 'thymine', 'cytosine', 'tetrazole', '1-2-4-triazole', '2-pyridone', 'cyclopentadienide'];

const WASM = new URL('../../node_modules/@rdkit/rdkit/dist/RDKit_minimal.wasm', import.meta.url).pathname;
let rdkit: MainModule;
beforeAll(async () => {
  rdkit = await initRDKitModule({ locateFile: () => WASM });
  configureRdkit(rdkit);
});

function smiles(molfile: string): string | null {
  const mol = rdkit.get_mol(molfile);
  if (!mol) return null;
  try {
    return mol.get_smiles();
  } finally {
    mol.delete();
  }
}

/** The fixture as Ketcher writes it once aromatized, and the H count of each aromatic atom. */
function asKetcherWritesIt(name: string): { molfile: string; hydrogens: AromaticHydrogens } {
  const mol = rdkit.get_mol(form(name), JSON.stringify({ removeHs: true }))!;
  try {
    const molfile = mol.get_aromatic_form();
    const json = JSON.parse(mol.get_json()) as { molecules: { atoms: { impHs?: number }[] }[] };
    const aromatic = new Set<number>();
    const bonds = molfile.split('\n');
    const atoms = Number.parseInt(bonds[3].slice(0, 3), 10);
    for (const line of bonds.slice(4 + atoms, 4 + atoms + Number.parseInt(bonds[3].slice(3, 6), 10))) {
      if (Number.parseInt(line.slice(6, 9), 10) === 4) {
        aromatic.add(Number.parseInt(line.slice(0, 3), 10) - 1);
        aromatic.add(Number.parseInt(line.slice(3, 6), 10) - 1);
      }
    }
    const hydrogens = json.molecules[0].atoms.flatMap((atom, i): AromaticHydrogens => (aromatic.has(i) && (atom.impHs ?? 0) > 0 ? [[i, atom.impHs!]] : []));
    return { molfile, hydrogens };
  } finally {
    mol.delete();
  }
}

describe('readableMolfile', () => {
  it.each(NEEDS_HYDROGENS)('%s, aromatized, reads as the compound it is', (name) => {
    const { molfile, hydrogens } = asKetcherWritesIt(name);
    expect(hydrogens.length).toBeGreaterThan(0);
    const want = smiles(form(name));
    // Without its hydrogens RDKit can't read it, or reads another compound.
    expect(smiles(molfile)).not.toBe(want);
    expect(smiles(readableMolfile(rdkit, noteHydrogens(molfile, hydrogens)))).toBe(want);
  });

  it('changes only the type of aromatic bonds: atoms, coordinates, wedges and the rest stay', () => {
    const { molfile, hydrogens } = asKetcherWritesIt('histidine');
    const read = readableMolfile(rdkit, noteHydrogens(molfile, hydrogens)).split('\n');
    const plain = molfile.split('\n');
    expect(read).toHaveLength(plain.length);
    const atoms = Number.parseInt(plain[3].slice(0, 3), 10);
    const bonds = Number.parseInt(plain[3].slice(3, 6), 10);
    read.forEach((line, i) => {
      const isBond = i >= 4 + atoms && i < 4 + atoms + bonds;
      if (!isBond) expect(line).toBe(plain[i]);
      else if (plain[i].slice(6, 9) !== '  4') expect(line).toBe(plain[i]);
      else expect([line.slice(0, 6), line.slice(9)]).toEqual([plain[i].slice(0, 6), plain[i].slice(9)]);
    });
    expect(read.slice(4 + atoms, 4 + atoms + bonds).some((line) => line.slice(6, 9) === '  4')).toBe(false);
  });

  it('leaves a Molfile with nothing noted exactly as it is (benzene, pyridine N-oxide)', () => {
    for (const name of ['benzene-drawn-with-aromatic-bonds', 'pyridine-n-oxide']) {
      const text = form(name);
      expect(readableMolfile(rdkit, text)).toBe(text);
      expect(noteHydrogens(text, [])).toBe(text);
    }
  });

  it('takes the note away and leaves the rest when the counts make no compound RDKit can read', () => {
    const { molfile } = asKetcherWritesIt('imidazole');
    // Two hydrogens on every ring atom: more than any valence allows.
    const atoms = Number.parseInt(molfile.split('\n')[3].slice(0, 3), 10);
    const wrong: AromaticHydrogens = Array.from({ length: atoms }, (_, i) => [i, 2]);
    expect(readableMolfile(rdkit, noteHydrogens(molfile, wrong))).toBe(molfile);
  });

  it('ignores a note naming an atom the Molfile does not have', () => {
    const { molfile } = asKetcherWritesIt('imidazole');
    expect(readableMolfile(rdkit, noteHydrogens(molfile, [[99, 1]]))).toBe(molfile);
  });
});
