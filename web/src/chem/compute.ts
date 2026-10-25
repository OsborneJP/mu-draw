// What the properties panel needs from RDKit for one drawing, as plain data: RDKit's own
// descriptors, the atoms counted by element, the stereo elements and the functional groups.
// Runs in the RDKit worker (rdkitWorker.ts) and, in the unit tests, in Node with the same
// RDKit.js. Nothing here rounds or decides what is shown; properties.ts does that.
import type { MainModule } from '@rdkit/rdkit';
import { findGroups, type GroupsResult, type Patterns } from './functionalGroups';
import { hasAxis, stereoElements } from './stereoElements';

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
  /** It may be chiral about an axis (an allene, a biaryl), which RDKit can't judge. */
  axis: boolean;
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

    // As Python's FindPotentialStereo (flagPossible) finds them on the drawing as drawn,
    // under the non-legacy perception rdkitWorker.ts switches on (stereoElements.ts).
    const found = stereoElements(rdkit, mol);
    const centres = found.centres.map((index) => ({ atoms: [index], defined: DEFINED_ATOM.has(atoms[index].stereo) }));
    const doubleBonds = found.doubles.map((index) => ({
      atoms: [...bonds[index].atoms],
      defined: DEFINED_BOND.has(bonds[index].stereo),
    }));

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
      axis: hasAxis(rdkit, mol),
      groups,
    };
  } finally {
    mol.delete();
    heavy?.delete();
  }
}
