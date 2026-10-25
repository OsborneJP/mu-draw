// RDKit.js (the same package and wasm the worker loads) against the fixtures that the
// server's RDKit wrote: for every reference compound, what the panel would show, and the
// stereo elements. Runs in Node, so no browser and no network: the fixtures come in through
// Vite's import.meta.glob and RDKit reads its wasm from node_modules.
import initRDKitModule, { type MainModule } from '@rdkit/rdkit';
import { beforeAll, describe, expect, it } from 'vitest';
import { computeProperties, configureRdkit, type Computed } from './compute';
import { panelValues } from './properties';
import { stereoElements } from './stereoElements';

interface FixtureCompound {
  typed_name?: string;
  name?: string;
  files: string[];
  formula: string;
  stereo: { possible: { type: string; specified: string; centered_on: number }[] };
  panel?: {
    formula: string;
    fragments: string;
    average_mw: string;
    exact_mass: string;
    degree_of_unsaturation: string;
    hbd: string;
    hba: string;
    rotatable_bonds: string;
    tpsa: string;
    logp: string;
    lipinski: Record<string, boolean>;
    stereo: { centres: string; double_bonds: string; undefined: string; max_stereoisomers: string };
  };
}

const expected = Object.values(
  import.meta.glob<{ compounds: FixtureCompound[]; invented: FixtureCompound[] }>(
    '../../../tests/fixtures/reference_expected.json',
    { eager: true, import: 'default' },
  ),
)[0];
const molfiles = import.meta.glob<string>('../../../tests/fixtures/molfiles/*.mol', {
  eager: true,
  query: '?raw',
  import: 'default',
});

function molfile(compound: FixtureCompound): string {
  const [rel] = compound.files;
  const text = molfiles[`../../../tests/fixtures/${rel}`];
  if (text === undefined) throw new Error(`no fixture file ${rel}`);
  return text;
}

const WASM = new URL('../../node_modules/@rdkit/rdkit/dist/RDKit_minimal.wasm', import.meta.url).pathname;
let rdkit: MainModule;

beforeAll(async () => {
  rdkit = await initRDKitModule({ locateFile: () => WASM });
  configureRdkit(rdkit);
});

function compute(compound: FixtureCompound): Computed {
  const computed = computeProperties(rdkit, molfile(compound));
  if (!computed) throw new Error(`RDKit could not read ${compound.typed_name ?? compound.name}`);
  return computed;
}

/** The two atoms of each bond in a fixture Molfile, in RDKit's bond order. */
function bondAtoms(compound: FixtureCompound): [number, number][] {
  const mol = rdkit.get_mol(molfile(compound), JSON.stringify({ removeHs: false }))!;
  const json = JSON.parse(mol.get_json()) as { molecules: { bonds: { atoms: [number, number] }[] }[] };
  mol.delete();
  return json.molecules[0].bonds.map((b) => b.atoms);
}

const sorted = (atoms: number[]) => [...atoms].sort((a, b) => a - b);

describe('every reference compound', () => {
  it('is in the fixtures, with the cases the spec names', () => {
    expect(expected.compounds.length).toBeGreaterThanOrEqual(27);
    expect(Object.keys(molfiles).length).toBeGreaterThanOrEqual(expected.compounds.length);
  });

  it.each(expected.compounds.map((c) => [c.typed_name!, c] as const))(
    '%s: the panel shows what the server says',
    (_name, compound) => {
      const values = panelValues(compute(compound));
      const panel = compound.panel!;
      expect({
        formula: values.formula,
        fragments: String(values.fragments),
        average_mw: values.averageMw,
        exact_mass: values.exactMass,
        degree_of_unsaturation: values.degreeOfUnsaturation,
        hbd: values.hbd,
        hba: values.hba,
        rotatable_bonds: values.rotatableBonds,
        tpsa: values.tpsa,
        logp: values.logp,
        lipinski: Object.fromEntries(values.lipinski.map((row) => [row.rule, row.pass])),
        stereo: {
          centres: String(values.stereo.centres),
          double_bonds: String(values.stereo.doubleBonds),
          undefined: String(values.stereo.undefined),
          max_stereoisomers: values.stereo.maxStereoisomers,
        },
      }).toEqual(panel);
      expect(values.formula).toBe(compound.formula);
    },
  );
});

describe('stereo elements', () => {
  const all = [...expected.compounds, ...expected.invented];

  it.each(all.map((c) => [c.typed_name ?? c.name!, c] as const))(
    "%s: the same atoms and bonds as RDKit's FindPotentialStereo, defined or not",
    (_name, compound) => {
      const c = compute(compound);
      const defined = (e: { specified: string }) => e.specified === 'Specified';
      const centres = compound.stereo.possible
        .filter((e) => e.type.startsWith('Atom_'))
        .map((e) => ({ atoms: [e.centered_on], defined: defined(e) }));
      expect(c.centres).toEqual(centres);
      // The fixture names a double bond by its bond index, compute.ts by its two atoms.
      const bonds = bondAtoms(compound);
      const doubleBonds = compound.stereo.possible
        .filter((e) => e.type.startsWith('Bond_'))
        .map((e) => ({ atoms: sorted(bonds[e.centered_on]), defined: defined(e) }));
      expect(c.doubleBonds.map((b) => ({ ...b, atoms: sorted(b.atoms) }))).toEqual(doubleBonds);
    },
  );

  // The stereoisomer test drawings include double bonds drawn crossed (E/Z undefined), which
  // RDKit.js's get_stereo_tags leaves out; the panel used to miss them.
  const stereoSet = Object.values(
    import.meta.glob<{ compounds: { name: string; file: string; elements: number }[] }>(
      '../../../tests/fixtures/stereoisomers_expected.json',
      { eager: true, import: 'default' },
    ),
  )[0].compounds;
  const stereoDrawings = import.meta.glob<string>('../../../tests/fixtures/stereoisomers/*.mol', {
    eager: true,
    query: '?raw',
    import: 'default',
  });

  it.each(stereoSet.map((c) => [c.name, c] as const))(
    '%s: as many stereo elements as Python RDKit finds, crossed double bonds included',
    (_name, compound) => {
      const c = computeProperties(rdkit, stereoDrawings[`../../../tests/fixtures/${compound.file}`])!;
      expect(c.centres.length + c.doubleBonds.length).toBe(compound.elements);
    },
  );

  // A double bond is tried against every setting of the elements around it only where both
  // branches at one end hold one: =CH2 with its H drawn never is, so limonene with every H
  // drawn is read once more than the drawing (the cis probe), not 2^n times. That search
  // took about 1 s per properties update on sugars with an allyl group drawn with its H.
  it('tries no double bond that cannot be stereogenic', () => {
    const compound = stereoSet.find((c) => c.name === 'limonene, all H drawn')!;
    const drawing = rdkit.get_mol(stereoDrawings[`../../../tests/fixtures/${compound.file}`], JSON.stringify({ removeHs: false }))!;
    let reads = 0;
    const counting = new Proxy(rdkit, {
      get: (target, name) =>
        name === 'get_mol'
          ? (...args: Parameters<MainModule['get_mol']>) => {
              reads += 1;
              return target.get_mol(...args);
            }
          : Reflect.get(target, name),
    });
    const found = stereoElements(counting, drawing);
    drawing.delete();
    expect(found.centres.length + found.doubles.length).toBe(compound.elements);
    expect(reads).toBe(1);
  });

  it("needs RDKit's current stereo perception: the legacy one misses ring cis/trans centres", () => {
    const ring = expected.compounds.find((c) => c.typed_name === '1,4-dimethylcyclohexane')!;
    expect(compute(ring).centres.length).toBe(Number(ring.panel!.stereo.centres));
    rdkit.use_legacy_stereo_perception(true);
    try {
      expect(compute(ring).centres.length).not.toBe(Number(ring.panel!.stereo.centres));
    } finally {
      configureRdkit(rdkit);
    }
  });
});

describe('drawings RDKit cannot use', () => {
  it('returns null for text RDKit cannot read', () => {
    expect(computeProperties(rdkit, 'not a structure')).toBeNull();
  });
});
