// The functional-group highlighter against its 25-molecule test set (spec "3. Functional
// group highlighter"): the shipped web/public/functional-groups.json, run by RDKit.js in
// Node on the fixture Molfiles (structures from PubChem), must list exactly the groups in
// tests/fixtures/functional_groups_expected.json. Those were written by judgement, not by
// running these patterns (the file says so and is marked provisional for Jeff).
import initRDKitModule, { type MainModule, type Mol } from '@rdkit/rdkit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { computeProperties, configureRdkit } from './compute';
import { deletePatterns, findGroups, readPatterns, type GroupPattern, type Patterns } from './functionalGroups';

interface Expected {
  status: string;
  molecules: { name: string; checks: string; groups: Record<string, number> }[];
}

interface Index {
  compounds: { typed_name: string; heavy_atoms: number; file: string }[];
}

const one = <T>(found: Record<string, T>): T => {
  const values = Object.values(found);
  if (values.length !== 1) throw new Error(`expected one file, found ${values.length}`);
  return values[0];
};
const EXPECTED = one(
  import.meta.glob<Expected>('../../../tests/fixtures/functional_groups_expected.json', { eager: true, import: 'default' }),
);
const INDEX = one(
  import.meta.glob<Index>('../../../tests/fixtures/functional_groups/compounds.json', { eager: true, import: 'default' }),
);
const FILE = one(
  import.meta.glob<{ groups: GroupPattern[] }>('../../public/functional-groups.json', { eager: true, import: 'default' }),
);
const MOLFILES = import.meta.glob<string>('../../../tests/fixtures/functional_groups/*.mol', {
  eager: true,
  query: '?raw',
  import: 'default',
});

// The spec's starter list, as the pattern file names its groups.
const STARTER = [
  'Alkene', 'Alkyne', 'Arene', 'Alcohol (1°)', 'Alcohol (2°)', 'Alcohol (3°)', 'Phenol', 'Ether',
  'Aldehyde', 'Ketone', 'Carboxylic acid', 'Ester', 'Amide', 'Acid chloride', 'Anhydride', 'Nitrile',
  'Amine (1°)', 'Amine (2°)', 'Amine (3°)', 'Thiol', 'Alkyl halide', 'Epoxide',
];

const WASM = new URL('../../node_modules/@rdkit/rdkit/dist/RDKit_minimal.wasm', import.meta.url).pathname;
let rdkit: MainModule;
let shipped: Patterns;
const made: Patterns[] = [];

beforeAll(async () => {
  rdkit = await initRDKitModule({ locateFile: () => WASM });
  configureRdkit(rdkit);
  shipped = readPatterns(rdkit, FILE);
});

afterAll(() => {
  deletePatterns(shipped);
  made.forEach(deletePatterns);
});

function patterns(file: unknown): Patterns {
  const p = readPatterns(rdkit, file);
  made.push(p);
  return p;
}

/** Only the shipped groups with these names (to see what one pattern matches on its own). */
function only(...names: string[]): Patterns {
  return patterns({ groups: FILE.groups.filter((g) => names.includes(g.name)) });
}

function molfile(name: string): string {
  const entry = INDEX.compounds.find((c) => c.typed_name === name);
  if (!entry) throw new Error(`${name} is not in functional_groups/compounds.json`);
  const text = MOLFILES[`../../../tests/fixtures/${entry.file}`];
  if (text === undefined) throw new Error(`no fixture file ${entry.file}`);
  return text;
}

function withMol<T>(text: string, run: (mol: Mol, bonds: [number, number][]) => T): T {
  const mol = rdkit.get_mol(text, JSON.stringify({ removeHs: false }));
  if (!mol) throw new Error('RDKit could not read the Molfile');
  try {
    const parsed = JSON.parse(mol.get_json()) as { molecules: { bonds?: { atoms: [number, number] }[] }[] };
    return run(mol, (parsed.molecules[0].bonds ?? []).map((b) => b.atoms));
  } finally {
    mol.delete();
  }
}

function found(text: string, p: Patterns = shipped) {
  return withMol(text, (mol, bonds) => findGroups(mol, bonds, p));
}

/** Group name -> number of instances, as the panel lists them. */
function counts(text: string, p: Patterns = shipped): Record<string, number> {
  return Object.fromEntries(found(text, p).map((g) => [g.name, g.instances.length]));
}

describe('the shipped pattern file', () => {
  it('has no entry RDKit or the format rejects, and names every starter group once', () => {
    expect(shipped.problems).toEqual([]);
    expect(shipped.groups.map((g) => g.name).sort()).toEqual([...STARTER].sort());
    expect(shipped.groups.length).toBe(FILE.groups.length);
  });

  it('is applied from the highest priority down', () => {
    const priorities = shipped.groups.map((g) => g.priority);
    expect(priorities).toEqual([...priorities].sort((a, b) => b - a));
    // The order in the file doesn't matter.
    const reversed = patterns({ groups: [...FILE.groups].reverse() });
    expect(reversed.groups.map((g) => g.name)).toEqual(shipped.groups.map((g) => g.name));
  });
});

describe('the 25-molecule test set', () => {
  it('is provisional, 25 molecules, each with a structure, covering every starter group', () => {
    expect(EXPECTED.status).toBe('provisional');
    expect(EXPECTED.molecules.length).toBe(25);
    expect(EXPECTED.molecules.map((m) => m.name).sort()).toEqual(INDEX.compounds.map((c) => c.typed_name).sort());
    const covered = new Set(EXPECTED.molecules.flatMap((m) => Object.keys(m.groups)));
    expect([...covered].sort()).toEqual([...STARTER].sort());
  });

  it.each(EXPECTED.molecules.map((m) => [m.name, m] as const))('%s', (name, m) => {
    expect(counts(molfile(name)), m.checks).toEqual(m.groups);
  });

  it('gives the same groups with every hydrogen drawn as an atom', () => {
    for (const m of EXPECTED.molecules) {
      const heavy = INDEX.compounds.find((c) => c.typed_name === m.name)!.heavy_atoms;
      const withHs = withMol(molfile(m.name), (mol) => mol.add_hs());
      const groups = found(withHs);
      expect(Object.fromEntries(groups.map((g) => [g.name, g.instances.length])), m.name).toEqual(m.groups);
      // Hydrogen atoms come after the heavy atoms, and no group claims one.
      for (const g of groups) for (const i of g.instances) expect(Math.max(...i.atoms)).toBeLessThan(heavy);
    }
  });
});

describe('the overlap rule', () => {
  // Each pattern below matches atoms that a higher-priority group owns. Shown alone, so
  // the rule (not a stricter SMARTS) is what keeps them out of the lists above.
  it.each([
    ['ethyl acetate', 'Ether', "the ester's single-bonded O"],
    ['epichlorohydrin', 'Ether', "the epoxide's O"],
    ['acetic anhydride', 'Ester', 'the anhydride'],
    ['acetic anhydride', 'Ether', "the anhydride's central O"],
    ['paracetamol', 'Amine (2°)', "the amide's N"],
    ['N,N-dimethylformamide', 'Amine (3°)', "the amide's N"],
    ['procaine', 'Ether', "the ester's single-bonded O"],
  ])('%s: on its own, the %s pattern matches %s', (name, group) => {
    expect(counts(molfile(name), only(group))[group]).toBeGreaterThan(0);
    expect(counts(molfile(name))[group]).toBeUndefined();
  });

  it('colours each atom for one group only', () => {
    for (const m of EXPECTED.molecules) {
      const atoms = found(molfile(m.name)).flatMap((g) => g.instances.flatMap((i) => i.atoms));
      expect(new Set(atoms).size, m.name).toBe(atoms.length);
    }
  });

  it("merges one group's matches that share atoms, and keeps apart those that don't", () => {
    // Ethyl acetate's C-O and C=O bonds all touch the ester's carbonyl carbon or its O;
    // its two C-C bonds share nothing.
    const touching = patterns({ groups: [{ name: 'CO', smarts: '[#6]~[#8]', color: '#000000', priority: 1 }] });
    const apart = patterns({ groups: [{ name: 'CC', smarts: '[#6]~[#6]', color: '#000000', priority: 1 }] });
    const ester = molfile('ethyl acetate');
    const [co] = found(ester, touching);
    expect(co.instances.length).toBe(1);
    expect(co.instances[0].atoms.length).toBe(4); // two carbons, two oxygens
    expect(counts(ester, apart)).toEqual({ CC: 2 });
  });

  it('lists the bonds between the atoms of each instance', () => {
    const [arene] = found(molfile('acetophenone'), only('Arene'));
    const { atoms, bonds } = arene.instances[0];
    expect(atoms.length).toBe(6);
    expect(bonds.length).toBe(6); // the ring
    for (const [a, b] of bonds) expect(atoms.includes(a) && atoms.includes(b)).toBe(true);
    const [alcohol] = found(molfile('2-butanol'));
    expect(alcohol.instances[0]).toEqual({ atoms: alcohol.instances[0].atoms, bonds: [] });
    expect(alcohol.instances[0].atoms.length).toBe(1); // the O; its carbon is only context
  });
});

describe('with the properties', () => {
  it('computeProperties reports the groups, or why there are none', () => {
    const text = molfile('aspirin');
    const groups = computeProperties(rdkit, text, shipped)!.groups;
    expect(groups).toEqual({ kind: 'found', groups: found(text), problems: [] });
    expect(computeProperties(rdkit, text, { unavailable: 'HTTP 404' })!.groups).toEqual({
      kind: 'unavailable',
      reason: 'HTTP 404',
    });
  });
});

describe('a pattern file with mistakes', () => {
  const good = (name: string) => FILE.groups.find((g) => g.name === name)!;

  it('leaves out each unusable entry, says why, and still uses the others', () => {
    const p = patterns({
      groups: [
        good('Ester'),
        { ...good('Ether'), smarts: '[O' },
        { ...good('Arene'), color: 'grey' },
        { ...good('Ketone'), priority: 'high' },
        { ...good('Phenol'), name: '' },
        { ...good('Ester'), smarts: '[#6]' },
        { ...good('Amide'), smarts: '' },
        null,
      ],
    });
    expect(p.problems).toEqual([
      `"Ether": RDKit can't read its SMARTS`,
      '"Arene": its color is not #rrggbb',
      '"Ketone": its priority is not a number',
      'entry 5: it has no name',
      '"Ester": another group has the same name',
      '"Amide": it has no SMARTS',
      'entry 8: it has no name',
    ]);
    expect(p.groups.map((g) => g.name)).toEqual(['Ester']);
    expect(counts(molfile('ethyl acetate'), p)).toEqual({ Ester: 1 });
  });

  it('takes an optional id, its key in the IR table: lowercase letters, digits and _, one per group', () => {
    const amide = good('Amide');
    const p = patterns({
      groups: [
        good('Ester'),
        { ...good('Ether'), id: 'Ether' },
        { ...good('Arene'), id: 3 },
        { ...good('Ketone'), id: good('Ester').id },
        { name: amide.name, smarts: amide.smarts, color: amide.color, priority: amide.priority },
      ],
    });
    expect(p.problems).toEqual([
      '"Ether": its id is not lowercase letters, digits and _',
      '"Arene": its id is not lowercase letters, digits and _',
      '"Ketone": another group has the same id',
    ]);
    expect(p.groups.map((g) => [g.name, g.id])).toEqual([
      ['Ester', good('Ester').id],
      ['Amide', undefined],
    ]);
    // The groups found carry it to the panel.
    expect(found(molfile('ethyl acetate'), p).map((g) => g.id)).toEqual([good('Ester').id]);
    expect(found(molfile('N,N-dimethylformamide'), p).map((g) => [g.name, g.id])).toEqual([['Amide', undefined]]);
  });

  it('says so when there is no list of groups', () => {
    for (const file of [null, {}, { groups: 'Ester' }, []]) {
      expect(patterns(file)).toEqual({ groups: [], problems: ['it has no "groups" list'] });
    }
  });
});
