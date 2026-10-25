// What the properties panel needs from RDKit for one drawing, as plain data: RDKit's own
// descriptors, the atoms counted by element, the stereo elements and the functional groups.
// Runs in the RDKit worker (rdkitWorker.ts) and, in the unit tests, in Node with the same
// RDKit.js. Nothing here rounds or decides what is shown; properties.ts does that.
import type { MainModule, Mol } from '@rdkit/rdkit';
import { findGroups, type GroupsResult, type Patterns } from './functionalGroups';

// The rdMolDescriptors.Properties values the panel shows. Lipinski's own counts (NH + OH;
// N + O), not RDKit's pharmacophore NumHBD/NumHBA (Jeff, Oct 24, 2026).
export const DESCRIPTORS = [
  'amw',
  'exactmw',
  'lipinskiHBD',
  'lipinskiHBA',
  'NumRotatableBonds',
  'tpsa',
  'CrippenClogP',
] as const;

export type Descriptors = Record<(typeof DESCRIPTORS)[number], number>;

/** A stereocentre (one atom) or a stereogenic double bond (its two atoms), by Molfile atom
 * index; `defined` when the drawing fixes it (a wedge or hash, a drawn geometry). */
export interface StereoElement {
  atoms: number[];
  defined: boolean;
}

export interface Computed {
  descriptors: Descriptors;
  /** Atoms by element symbol, hydrogens (implicit and drawn) included. */
  elements: Record<string, number>;
  charge: number;
  radicals: number;
  fragments: number;
  centres: StereoElement[];
  doubleBonds: StereoElement[];
  groups: GroupsResult;
}

/** The functional-group patterns, or why there are none (functionalGroups.ts). */
export type PatternsOrReason = Patterns | { unavailable: string };

interface JsonAtom {
  z: number;
  impHs: number;
  chg: number;
  nRad: number;
  stereo: string;
}

interface JsonBond {
  atoms: [number, number];
  bo: number;
  stereo: string;
  stereoAtoms?: [number, number];
}

interface RdkitJson {
  defaults: { atom: JsonAtom; bond: Omit<JsonBond, 'atoms'> };
  molecules: { atoms: Partial<JsonAtom>[]; bonds?: (Partial<JsonBond> & { atoms: [number, number] })[] }[];
}

// Atom stereo in RDKit's JSON is cw/ccw once a wedge fixes it; a double bond's is cis/trans
// once its geometry is fixed (unspecified, or "either" for a crossed bond, otherwise).
const DEFINED_ATOM = new Set(['cw', 'ccw']);
const DEFINED_BOND = new Set(['cis', 'trans']);

/** The element symbol for an atomic number, as RDKit writes it (no table in this code). */
function symbolFor(rdkit: MainModule, z: number, cache: Map<number, string>): string {
  let symbol = cache.get(z);
  if (symbol === undefined) {
    const atom = rdkit.get_mol(`[#${z}]`);
    if (!atom) throw new Error(`RDKit has no element ${z}`);
    symbol = atom.get_smiles().replace(/^\[|\]$/g, ''); // "[Na]" -> "Na"
    atom.delete();
    cache.set(z, symbol);
  }
  return symbol;
}

const symbols = new Map<number, string>();

interface StereoTags {
  CIP_atoms: [number, string][];
  CIP_bonds: [number, number, string][];
}

/** The double bonds that can have E/Z, by their two atoms, in bond order. get_stereo_tags
 * lists a double bond only once its geometry is fixed: one drawn crossed (E/Z undefined)
 * comes through as "either" and is left out, so the panel used to miss it. So every double
 * bond not yet fixed is set to cis and RDKit is asked again: it keeps stereo only where it
 * can be, which gives Python's FindPotentialStereo (stereoisomers.test.ts checks every test
 * drawing). Cumulated double bonds (allenes) stay out, as RDKit.js leaves them. */
export function stereoDoubleBonds(rdkit: MainModule, mol: Mol): [number, number][] {
  const json = JSON.parse(mol.get_json()) as RdkitJson;
  const tags = JSON.parse(mol.get_stereo_tags()) as StereoTags;
  const molecule = json.molecules[0];
  const bonds = (molecule.bonds ?? []).map((b) => ({ ...json.defaults.bond, ...b }));
  const same = (b: { atoms: [number, number] }, x: number, y: number) =>
    (b.atoms[0] === x && b.atoms[1] === y) || (b.atoms[0] === y && b.atoms[1] === x);
  const fixed = new Set(tags.CIP_bonds.map(([a, b]) => bonds.findIndex((x) => same(x, a, b))));
  const doubles = bonds.flatMap((b, i) => (b.bo === 2 ? [i] : []));
  const cumulated = (i: number) => doubles.some((j) => j !== i && bonds[j].atoms.some((x) => bonds[i].atoms.includes(x)));
  const neighbour = (end: number, not: number) =>
    bonds.map((b) => b.atoms).find(([p, q]) => (p === end && q !== not) || (q === end && p !== not));
  const open = doubles.filter((i) => !fixed.has(i) && !cumulated(i) && bonds[i].atoms.every((end, k) => neighbour(end, bonds[i].atoms[1 - k])));
  const found = new Set(fixed);
  if (open.length > 0) {
    const probe = structuredClone(json);
    const probed = probe.molecules[0];
    delete (probed as { conformers?: unknown }).conformers;
    for (const i of open) {
      const [a, b] = bonds[i].atoms;
      const other = (end: number, not: number) => {
        const [p, q] = neighbour(end, not)!;
        return p === end ? q : p;
      };
      probed.bonds![i] = { ...probed.bonds![i], stereo: 'cis', stereoAtoms: [other(a, b), other(b, a)] };
    }
    const settled = rdkit.get_mol(JSON.stringify(probe), JSON.stringify({ removeHs: false }));
    if (settled) {
      try {
        const kept = JSON.parse(settled.get_stereo_tags()) as StereoTags;
        for (const [a, b] of kept.CIP_bonds) found.add(bonds.findIndex((x) => same(x, a, b)));
      } finally {
        settled.delete();
      }
    }
  }
  return [...found].sort((x, y) => x - y).map((i) => bonds[i].atoms);
}

/** RDKit settings the fixtures were made with (gen_reference_expected.py). RDKit.js
 * defaults to the legacy stereo perception, which misses ring cis/trans centres
 * (1,4-dimethylcyclohexane). */
export function configureRdkit(rdkit: MainModule): void {
  rdkit.use_legacy_stereo_perception(false);
}

/** RDKit's view of a Molfile, or null when RDKit can't read it (e.g. a ring it can't
 * kekulize) or it has an atom that isn't an element. */
export function computeProperties(
  rdkit: MainModule,
  molfile: string,
  patterns: PatternsOrReason = { unavailable: 'no patterns were given' },
): Computed | null {
  // Drawn hydrogens stay atoms here, so atom indices are the Molfile's (and so map back to
  // Ketcher's atoms). Descriptors come from a copy with them folded into their heavy atoms:
  // with explicit hydrogens, RDKit counts the bond to a methyl as rotatable.
  const mol = rdkit.get_mol(molfile, JSON.stringify({ removeHs: false }));
  if (!mol) return null;
  const heavy = rdkit.get_mol(molfile, JSON.stringify({ removeHs: true }));
  try {
    if (!heavy) return null;
    const json = JSON.parse(mol.get_json()) as RdkitJson;
    const atoms = json.molecules[0].atoms.map((a) => ({ ...json.defaults.atom, ...a }));
    const bonds = (json.molecules[0].bonds ?? []).map((b) => ({ ...json.defaults.bond, ...b }));
    if (atoms.some((a) => a.z === 0)) return null;

    const elements: Record<string, number> = {};
    for (const atom of atoms) {
      const symbol = symbolFor(rdkit, atom.z, symbols);
      elements[symbol] = (elements[symbol] ?? 0) + 1;
      if (atom.impHs > 0) elements.H = (elements.H ?? 0) + atom.impHs;
    }

    const all = JSON.parse(heavy.get_descriptors()) as Record<string, number>;
    const descriptors = Object.fromEntries(DESCRIPTORS.map((name) => [name, all[name]])) as Descriptors;

    // get_stereo_tags lists every potential stereo element (RDKit's FindPotentialStereo
    // with flagPossible, under the non-legacy perception rdkitWorker.ts switches on).
    const tags = JSON.parse(mol.get_stereo_tags()) as StereoTags;
    const centres = tags.CIP_atoms.map(([index]) => ({
      atoms: [index],
      defined: DEFINED_ATOM.has(atoms[index].stereo),
    }));
    const doubleBonds = stereoDoubleBonds(rdkit, mol).map(([a, b]) => {
      const bond = bonds.find((x) => (x.atoms[0] === a && x.atoms[1] === b) || (x.atoms[0] === b && x.atoms[1] === a));
      return { atoms: [a, b], defined: bond !== undefined && DEFINED_BOND.has(bond.stereo) };
    });

    const frags = mol.get_frags() as { molList: { size(): number; delete(): void }; mappings: string };
    const fragments = frags.molList.size();
    frags.molList.delete();

    // Matched on the Molfile's own atoms (drawn hydrogens included), so indices map to
    // Ketcher's atoms; the patterns' H counts and connectivities include drawn hydrogens.
    const groups: GroupsResult =
      'unavailable' in patterns
        ? { kind: 'unavailable', reason: patterns.unavailable }
        : { kind: 'found', groups: findGroups(mol, bonds.map((b) => b.atoms), patterns), problems: patterns.problems };

    return {
      descriptors,
      elements,
      charge: atoms.reduce((sum, a) => sum + a.chg, 0),
      radicals: atoms.reduce((sum, a) => sum + a.nRad, 0),
      fragments,
      centres,
      doubleBonds,
      groups,
    };
  } finally {
    mol.delete();
    heavy?.delete();
  }
}
