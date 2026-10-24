// What the properties panel needs from RDKit for one drawing, as plain data: RDKit's own
// descriptors, the atoms counted by element, and the stereo elements. Runs in the RDKit
// worker (rdkitWorker.ts) and, in the unit tests, in Node with the same RDKit.js.
// Nothing here rounds or decides what is shown; properties.ts does that.
import type { MainModule } from '@rdkit/rdkit';

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
}

interface JsonAtom {
  z: number;
  impHs: number;
  chg: number;
  nRad: number;
  stereo: string;
}

interface JsonBond {
  atoms: [number, number];
  stereo: string;
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
export function computeProperties(rdkit: MainModule, molfile: string): Computed | null {
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
    const tags = JSON.parse(mol.get_stereo_tags()) as {
      CIP_atoms: [number, string][];
      CIP_bonds: [number, number, string][];
    };
    const centres = tags.CIP_atoms.map(([index]) => ({
      atoms: [index],
      defined: DEFINED_ATOM.has(atoms[index].stereo),
    }));
    const doubleBonds = tags.CIP_bonds.map(([a, b]) => {
      const bond = bonds.find((x) => (x.atoms[0] === a && x.atoms[1] === b) || (x.atoms[0] === b && x.atoms[1] === a));
      return { atoms: [a, b], defined: bond !== undefined && DEFINED_BOND.has(bond.stereo) };
    });

    const frags = mol.get_frags() as { molList: { size(): number; delete(): void }; mappings: string };
    const fragments = frags.molList.size();
    frags.molList.delete();

    return {
      descriptors,
      elements,
      charge: atoms.reduce((sum, a) => sum + a.chg, 0),
      radicals: atoms.reduce((sum, a) => sum + a.nRad, 0),
      fragments,
      centres,
      doubleBonds,
    };
  } finally {
    mol.delete();
    heavy?.delete();
  }
}
