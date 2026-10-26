// A molecule as RDKit's JSON form holds it, for the ports of RDKit's tautomer enumerator and
// resonance structure supplier (tautomers.ts, resonance.ts), which RDKit.js lacks: each reads
// a drawing into this form, changes bond orders, H counts and charges in it, and has RDKit.js
// read it back with only the sanitization steps RDKit itself runs at that point.
// - RDKit writes a Kekulé form (Kekulize(mol, false): canonical, aromatic flags kept) with the
//   aromatic atoms and bonds listed apart; read back with setAromaticBonds false and only the
//   ring step, it is the form RDKit's enumerator matches its SMARTS against.
// - A sanitize-flags object turns on only the steps it lists ({} throws), so steps are always
//   named in full.
// - Whole-number coordinates are refused by RDKit's JSON reader, so they are written by hand.
import type { MainModule, Mol } from '@rdkit/rdkit';
import tables from './rdkitTables.json';

export interface FormAtom {
  z: number;
  /** Every H on the atom (RDKit's getTotalNumHs); read back as explicit, noImplicit. */
  impHs: number;
  chg: number;
  nRad: number;
  isotope: number;
  stereo: string;
}

export interface FormBond {
  atoms: [number, number];
  /** 1, 2 or 3 (Kekulé). */
  bo: number;
  stereo: string;
  stereoAtoms?: [number, number];
}

export interface Form {
  atoms: FormAtom[];
  bonds: FormBond[];
  aromaticAtoms: number[];
  aromaticBonds: number[];
  atomRings: number[][];
  coords: number[][] | null;
}

interface RawJson {
  defaults: { atom: Partial<FormAtom>; bond: Partial<FormBond> };
  molecules: {
    atoms: Partial<FormAtom>[];
    bonds?: Partial<FormBond>[];
    conformers?: { dim: number; coords: number[][] }[];
    extensions?: { name: string; aromaticAtoms?: number[]; aromaticBonds?: number[]; atomRings?: number[][] }[];
  }[];
}

const ATOM_DEFAULTS: FormAtom = { z: 6, impHs: 0, chg: 0, nRad: 0, isotope: 0, stereo: 'unspecified' };
const BOND_DEFAULTS = { bo: 1, stereo: 'unspecified' };

export function formOf(mol: Mol): Form {
  const json = JSON.parse(mol.get_json()) as RawJson;
  const molecule = json.molecules[0];
  const extension: Omit<NonNullable<RawJson['molecules'][0]['extensions']>[0], 'name'> =
    molecule.extensions?.find((e) => e.name === 'rdkitRepresentation') ?? {};
  return {
    atoms: molecule.atoms.map((a) => ({ ...ATOM_DEFAULTS, ...json.defaults.atom, ...a }) as FormAtom),
    bonds: (molecule.bonds ?? []).map((b) => ({ ...BOND_DEFAULTS, ...json.defaults.bond, ...b }) as FormBond),
    aromaticAtoms: extension.aromaticAtoms ?? [],
    aromaticBonds: extension.aromaticBonds ?? [],
    atomRings: extension.atomRings ?? [],
    coords: molecule.conformers?.[0]?.coords ?? null,
  };
}

export function copyForm(form: Form): Form {
  return structuredClone(form);
}

/** RDKit's JSON text of a form; with `aromatic`, its aromatic atoms and bonds are listed. */
export function jsonOf(form: Form, { aromatic = true, coords = false } = {}): string {
  const extension: Record<string, unknown> = { name: 'rdkitRepresentation', formatVersion: 2, toolkitVersion: tables.rdkit_version };
  if (aromatic) {
    extension.aromaticAtoms = form.aromaticAtoms;
    extension.aromaticBonds = form.aromaticBonds;
  }
  if (form.atomRings.length > 0) extension.atomRings = form.atomRings;
  const text = JSON.stringify({
    rdkitjson: { version: 12 },
    defaults: { atom: ATOM_DEFAULTS, bond: BOND_DEFAULTS },
    molecules: [{ atoms: form.atoms, bonds: form.bonds, extensions: [extension] }],
  });
  if (!coords || !form.coords) return text;
  const number = (v: number) => (Number.isInteger(v) ? v.toFixed(1) : String(v));
  const written = `{"dim":2,"coords":[${form.coords.map((p) => `[${p.map(number).join(',')}]`).join(',')}]}`;
  return text.replace(/\}\]\}$/, `,"conformers":[${written}]}]}`);
}

/** The sanitization steps by RDKit's names; only these run. */
export type Step =
  | 'SANITIZE_CLEANUP'
  | 'SANITIZE_PROPERTIES'
  | 'SANITIZE_SYMMRINGS'
  | 'SANITIZE_KEKULIZE'
  | 'SANITIZE_FINDRADICALS'
  | 'SANITIZE_SETAROMATICITY'
  | 'SANITIZE_SETCONJUGATION'
  | 'SANITIZE_SETHYBRIDIZATION'
  | 'SANITIZE_CLEANUPCHIRALITY'
  | 'SANITIZE_ADJUSTHS';

export interface ReadOptions {
  steps: Step[];
  /** Bonds listed aromatic become aromatic bonds; else they keep their Kekulé order and are
   * only flagged aromatic. */
  setAromaticBonds: boolean;
  /** List the form's aromatic atoms and bonds (else it is read as plain Kekulé). */
  aromatic: boolean;
  assignStereo: boolean;
  coords?: boolean;
}

/** Read a form into RDKit.js, run `work` on it, and free it. Null when RDKit refuses it. */
export function withForm<T>(rdkit: MainModule, form: Form, options: ReadOptions, work: (mol: Mol) => T): T | null {
  const details = {
    setAromaticBonds: options.setAromaticBonds,
    assignStereo: options.assignStereo,
    sanitize: Object.fromEntries(options.steps.map((s) => [s, true])),
  };
  const mol = rdkit.get_mol(jsonOf(form, { aromatic: options.aromatic, coords: options.coords ?? false }), JSON.stringify(details));
  if (!mol) return null;
  try {
    return work(mol);
  } finally {
    mol.delete();
  }
}

// RDKit's JSON bond orders beyond 1 to 4 (MolInterchange): 0 is a zero-order bond, 17 a dative
// one. RDKit's sanitizing makes a bond from a ligand to a metal dative.
export const ZERO_BOND = 0;
export const DATIVE_BOND = 17;

/** Whether every bond is single, double, triple or dative once RDKit has read the drawing: its
 * JSON has no number for an aromatic bond it can't make Kekulé (one outside a ring), a hydrogen
 * bond or a query bond, and writes 0. */
export function plainBonds(form: Form): boolean {
  return !form.bonds.some((b) => b.bo === ZERO_BOND);
}

/** A bond's order as Python's GetBondTypeAsDouble gives it in a Kekulé form (dative: 1). */
export function orderOf(bond: FormBond): number {
  return bond.bo === DATIVE_BOND ? 1 : bond.bo;
}

/** The drawing as drawn: its own bond orders and charges, with the same atoms as RDKit's
 * reading of it, or null. A bond drawn aromatic (Ketcher's aromatic bond, Molfile type 4) is
 * listed among aromaticBonds. RDKit's JSON lists such a bond only where its atoms are aromatic,
 * which read without aromaticity they are not, so they are found by RDKit's SMARTS, whose ":"
 * is that type. */
export function readAsDrawn(rdkit: MainModule, molfile: string, reading: Form): Form | null {
  const mol = rdkit.get_mol(molfile, JSON.stringify({ removeHs: true, kekulize: false, setAromaticity: false }));
  if (!mol) return null;
  const query = rdkit.get_qmol('*:*');
  try {
    const drawn = formOf(mol);
    const found = JSON.parse(query ? mol.get_substruct_matches(query) : '[]') as { bonds: number[] }[] | Record<string, never>;
    drawn.aromaticBonds = [...new Set((Array.isArray(found) ? found : []).flatMap((m) => m.bonds))];
    const same = drawn.atoms.length === reading.atoms.length && drawn.atoms.every((a, i) => a.z === reading.atoms[i].z);
    return same && drawn.bonds.length === reading.bonds.length ? drawn : null;
  } finally {
    query?.delete();
    mol.delete();
  }
}

/** A molecule in RDKit's canonical atom order (as its canonical SMILES lists the atoms), with,
 * for each of the molecule's own atoms and bonds, the canonical one. */
export interface Canonical {
  /** The caller deletes it. */
  mol: Mol;
  form: Form;
  atoms: number[];
  bonds: number[];
}

/** RDKit's tautomer and resonance lists depend on the atom order, so the panels run RDKit on
 * the drawing in its canonical atom order (Jeff's decision, 2026-10-26) and map each answer
 * back to the drawing's atoms and bonds. Null if RDKit can't read its SMILES back. As the
 * generator's canonical(). */
export function canonical(rdkit: MainModule, mol: Mol, own: Form): Canonical | null {
  const smiles = mol.get_smiles();
  // Set by get_smiles(): position k of the SMILES holds the molecule's atom order[k].
  const order = JSON.parse(mol.get_prop('_smilesAtomOutputOrder')) as number[];
  const canon = rdkit.get_mol(smiles);
  if (!canon) return null;
  const form = formOf(canon);
  const atoms: number[] = [];
  order.forEach((atom, k) => (atoms[atom] = k));
  const pair = (a: number, b: number) => `${Math.min(a, b)} ${Math.max(a, b)}`;
  const index = new Map(form.bonds.map((b, j) => [pair(b.atoms[0], b.atoms[1]), j]));
  const bonds = own.bonds.map((b) => index.get(pair(atoms[b.atoms[0]], atoms[b.atoms[1]]))!);
  return { mol: canon, form, atoms, bonds };
}

/** The number of separate structures (connected pieces) in a form. */
export function pieces(form: Form): number {
  const parent = form.atoms.map((_, i) => i);
  const root = (i: number): number => (parent[i] === i ? i : (parent[i] = root(parent[i])));
  for (const { atoms: [a, b] } of form.bonds) parent[root(a)] = root(b);
  return new Set(form.atoms.map((_, i) => root(i))).size;
}

/** Each atom's bonds, by bond index, in RDKit's order (the order the bonds were added). */
export function atomBonds(form: Form): number[][] {
  const out: number[][] = form.atoms.map(() => []);
  form.bonds.forEach((b, i) => {
    out[b.atoms[0]].push(i);
    out[b.atoms[1]].push(i);
  });
  return out;
}

export function otherAtom(bond: FormBond, atom: number): number {
  return bond.atoms[0] === atom ? bond.atoms[1] : bond.atoms[0];
}

// A version 3 Molfile's counts: "M  V30 COUNTS atoms bonds sgroups 3d chiral" (RDKit writes
// version 3 where version 2 can't hold a bond, a dative one say).
const VERSION3_COUNTS = /^(M {2}V30 COUNTS \d+ \d+ \d+ \d+ )(\d+)/;

/** The Molfile's chiral flag (its counts line), so a structure placed from the panel keeps
 * the drawing's: Ketcher reads flag 0 as an AND (racemic) group. */
export function chiralFlagOf(molfile: string): boolean {
  const lines = molfile.split('\n');
  const version3 = lines.map((l) => VERSION3_COUNTS.exec(l)).find((m) => m !== null);
  if (version3) return version3[2] === '1';
  return (lines[3] ?? '').slice(12, 15).trim() === '1';
}

export function withChiralFlag(molfile: string, flag: boolean): string {
  const lines = molfile.split('\n');
  const at = lines.findIndex((l) => VERSION3_COUNTS.test(l));
  if (at >= 0) lines[at] = lines[at].replace(VERSION3_COUNTS, `$1${flag ? 1 : 0}`);
  else lines[3] = `${lines[3].slice(0, 12)}${flag ? '  1' : '  0'}${lines[3].slice(15)}`;
  return lines.join('\n');
}
