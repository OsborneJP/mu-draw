// The tautomer enumerator (docs/plans/v2-tautomers-resonance.md): RDKit's own
// TautomerEnumerator::enumerate (Code/GraphMol/MolStandardize/Tautomer.cpp, RDKit 2026.09.1),
// run on RDKit.js, which doesn't have it. Each step moves one H along a match of one of
// RDKit's 37 transforms (rdkitTables.json, from its source): RDKit.js finds the matches on
// the Kekulé form and reads each product back with the sanitization steps RDKit runs there.
// tautomers.test.ts requires Python RDKit's Enumerate() answers for every test drawing and
// for 303 molecules of RDKit's NCI set. Measured (plan): the answer can depend on atom order
// (in Python too), so a drawing is read as drawn, never through SMILES.
//
// Kept as RDKit has it, so the two agree: its map of tautomers keyed by canonical SMILES and
// walked in key order while it grows; its limits (a stop at 33 tautomers here, decision 7;
// 1000 transforms applied); and its stereo rule, which takes the stereo off every atom an H
// moves to or from, and every bond that changes, in every tautomer, the drawing's included.
//
// Ported from the RDKit (www.rdkit.org): Tautomer.cpp, Copyright (C) 2018-2021 Susan H. Leung
// and other RDKit contributors, under RDKit's BSD licence (tests/fixtures/recorded/rdkit/
// license.txt; rdkitTables.json ships it with the app).
import type { MainModule, Mol } from '@rdkit/rdkit';
import {
  chiralFlagOf,
  copyForm,
  formOf,
  pieces,
  jsonOf,
  withChiralFlag,
  withForm,
  type Form,
  type Step,
} from './rdkitForm';
import tables from './rdkitTables.json';

/** Decision 7: up to 32 are drawn, so RDKit's enumeration stops at 33. RDKit's own limit on
 * the transforms applied is kept as it is. */
export const TAUTOMER_LIMITS = { drawn: 32, maxTransforms: 1000 } as const;

export type EnumerationStatus = 'completed' | 'max-tautomers' | 'max-transforms';

/** Decision 7: RDKit's tautomers are listed when it finished and found at most 32. */
export function tautomerOutcome(status: EnumerationStatus, count: number): 'listed' | 'too-many' {
  return status === 'completed' && count <= TAUTOMER_LIMITS.drawn ? 'listed' : 'too-many';
}

export interface Enumerated {
  status: EnumerationStatus;
  /** In RDKit's order (its map's: by canonical SMILES), each in RDKit's aromatic form. */
  tautomers: { smiles: string; form: Form }[];
  modifiedAtoms: number[];
  modifiedBonds: number[];
}

interface Transform {
  query: Mol;
  /** The query's bonds, by its atom indices, in its bond order. */
  bonds: [number, number][];
  /** Bond orders to set, in that order; none: swap single and double. */
  orders: number[];
  charges: number[];
}

const ORDERS: Record<string, number> = { '-': 1, '=': 2, '#': 3 };
const CHARGES: Record<string, number> = { '+': 1, '0': 0, '-': -1 };
const transformsFor = new WeakMap<MainModule, Transform[]>();

/** RDKit's transforms as queries, made once per RDKit module (they live as long as it does). */
function transforms(rdkit: MainModule): Transform[] {
  let made = transformsFor.get(rdkit);
  if (made) return made;
  made = tables.tautomer_transforms.map(({ smarts, bonds, charges }) => {
    const query = rdkit.get_qmol(smarts);
    if (!query) throw new Error(`RDKit could not read a tautomer transform: ${smarts}`);
    const json = JSON.parse(query.get_json()) as { molecules: { bonds?: { atoms: [number, number] }[] }[] };
    return {
      query,
      bonds: (json.molecules[0].bonds ?? []).map((b) => b.atoms),
      orders: [...bonds].map((c) => {
        if (!(c in ORDERS)) throw new Error(`a tautomer transform's bond "${c}" is not supported`);
        return ORDERS[c];
      }),
      charges: [...charges].map((c) => CHARGES[c]),
    };
  });
  transformsFor.set(rdkit, made);
  return made;
}

// Python: Kekulize, setAromaticity, setConjugation, setHybridization, adjustHs on a product.
const PRODUCT_STEPS: Step[] = [
  'SANITIZE_KEKULIZE',
  'SANITIZE_SYMMRINGS',
  'SANITIZE_SETAROMATICITY',
  'SANITIZE_SETCONJUGATION',
  'SANITIZE_SETHYBRIDIZATION',
  'SANITIZE_ADJUSTHS',
];

/** Each bond as RDKit's aromatic form types it: "a", or its order. */
export function bondKinds(form: Form): string[] {
  const aromatic = new Set(form.aromaticBonds);
  return form.bonds.map((b, i) => (aromatic.has(i) ? 'a' : String(b.bo)));
}

function between(form: Form, a: number, b: number): number {
  const i = form.bonds.findIndex(({ atoms: [p, q] }) => (p === a && q === b) || (p === b && q === a));
  if (i < 0) throw new Error('a transform matched atoms that are not bonded');
  return i;
}

/** setTautomerStereoAndIsoHs: no stereo at a modified atom; a modified bond "either" if it is
 * a double bond not between two ring atoms, else none. Whether anything changed. */
function clearStereo(form: Form, atoms: Set<number>, bonds: Set<number>): boolean {
  let modified = false;
  for (const a of atoms) {
    if (form.atoms[a].stereo !== 'unspecified') modified = true;
    form.atoms[a].stereo = 'unspecified';
  }
  const ringAtoms = new Set(form.atomRings.flat());
  const aromatic = new Set(form.aromaticBonds);
  for (const i of bonds) {
    const bond = form.bonds[i];
    const double = bond.bo === 2 && !aromatic.has(i);
    const target = double && !(ringAtoms.has(bond.atoms[0]) && ringAtoms.has(bond.atoms[1])) ? 'either' : 'unspecified';
    if (bond.stereo !== target) modified = true;
    bond.stereo = target;
    delete bond.stereoAtoms;
  }
  return modified;
}

/** RDKit reassigns stereo, then sets the modified bonds' again. The canonical SMILES and the
 * form, or null if RDKit refuses it. */
function settle(rdkit: MainModule, form: Form, bonds: Set<number>): { smiles: string; form: Form } | null {
  const read = withForm(rdkit, form, { steps: PRODUCT_STEPS, setAromaticBonds: true, aromatic: true, assignStereo: true }, (mol) => ({
    smiles: mol.get_smiles(),
    form: formOf(mol),
  }));
  if (!read) return null;
  clearStereo(read.form, new Set(), bonds);
  return read;
}

/** Python's TautomerEnumerator().Enumerate(mol), with maxTautomers set. `mol` is RDKit's
 * reading of the drawing; it is not changed. */
export function enumerate(rdkit: MainModule, mol: Mol, maxTautomers: number = TAUTOMER_LIMITS.drawn + 1): Enumerated {
  const input = formOf(mol);
  input.coords = null;
  const inputKinds = bondKinds(input);
  interface Entry {
    form: Form;
    done: boolean;
    atoms: number;
    bonds: number;
  }
  const map = new Map<string, Entry>([[mol.get_smiles(), { form: input, done: false, atoms: 0, bonds: 0 }]]);
  // std::map's walk: the least key after the current one, so keys added behind it wait for the
  // next pass, as in RDKit.
  const after = (key: string | null): string | undefined => {
    let best: string | undefined;
    for (const k of map.keys()) if ((key === null || k > key) && (best === undefined || k < best)) best = k;
    return best;
  };
  const modifiedAtoms = new Set<number>();
  const modifiedBonds = new Set<number>();
  const rules = transforms(rdkit);
  let status: EnumerationStatus = 'completed';
  let completed = false;
  let bailOut = false;
  let applied = 0;

  while (!completed && !bailOut) {
    for (let key = after(null); key !== undefined; key = after(key)) {
      const entry = map.get(key)!;
      if (entry.done) continue;
      // The Kekulé form with its aromatic flags, as RDKit's getKekulized() leaves it.
      const kekule = rdkit.get_mol(
        jsonOf(entry.form),
        JSON.stringify({ setAromaticBonds: false, assignStereo: false, sanitize: { SANITIZE_SYMMRINGS: true } }),
      );
      if (!kekule) throw new Error('RDKit could not read a tautomer back');
      try {
        for (const rule of rules) {
          if (bailOut) break;
          const found = JSON.parse(kekule.get_substruct_matches(rule.query)) as { atoms: number[] }[] | Record<string, never>;
          const matches = Array.isArray(found) ? found.map((m) => m.atoms) : [];
          if (matches.length === 0) continue;
          applied += 1;
          for (const match of matches) {
            if (applied >= TAUTOMER_LIMITS.maxTransforms) {
              status = 'max-transforms';
              bailOut = true;
            } else if (map.size >= maxTautomers) {
              status = 'max-tautomers';
              bailOut = true;
            }
            if (bailOut) break;
            const product = copyForm(entry.form);
            const first = match[0];
            const last = match[match.length - 1];
            modifiedAtoms.add(first);
            modifiedAtoms.add(last);
            product.atoms[first].impHs = Math.max(0, product.atoms[first].impHs - 1);
            product.atoms[last].impHs += 1;
            rule.bonds.forEach(([p, q], n) => {
              const i = between(product, match[p], match[q]);
              const bond = product.bonds[i];
              if (rule.orders.length > 0) bond.bo = rule.orders[n];
              else if (bond.bo === 1) bond.bo = 2;
              else if (bond.bo === 2) bond.bo = 1;
              modifiedBonds.add(i);
            });
            if (rule.charges.length > 0) match.forEach((a, n) => (product.atoms[a].chg += rule.charges[n]));
            // Kekulize(product) as RDKit does it (aromatic flags still on), which may fail:
            // then this match gives nothing.
            const kekulized = withForm(rdkit, product, { steps: ['SANITIZE_SYMMRINGS'], setAromaticBonds: false, aromatic: true, assignStereo: false }, (m) => {
              try {
                m.convert_to_kekule_form();
              } catch {
                return null;
              }
              return formOf(m);
            });
            if (!kekulized) continue;
            const sanitized = withForm(rdkit, kekulized, { steps: PRODUCT_STEPS, setAromaticBonds: false, aromatic: false, assignStereo: false }, formOf);
            if (!sanitized) continue;
            clearStereo(sanitized, modifiedAtoms, modifiedBonds);
            const settled = settle(rdkit, sanitized, modifiedBonds);
            if (!settled || map.has(settled.smiles)) continue;
            // Sanitizing can change other bonds too (RDKit's example: Cc1nc2ccccc2[nH]1).
            bondKinds(settled.form).forEach((kind, i) => {
              if (kind !== inputKinds[i]) modifiedBonds.add(i);
            });
            map.set(settled.smiles, { form: settled.form, done: false, atoms: modifiedAtoms.size, bonds: modifiedBonds.size });
          }
        }
      } finally {
        kekule.delete();
      }
      entry.done = true;
    }

    // Tautomers made before the last modifications lose their stereo there too; those that
    // become the same as another are merged. RDKit's walk, erasing and re-inserting as it goes.
    completed = true;
    let key = after(null);
    while (key !== undefined) {
      const entry = map.get(key)!;
      if (!entry.done) completed = false;
      const stale = entry.atoms < modifiedAtoms.size || entry.bonds < modifiedBonds.size;
      const form = copyForm(entry.form);
      if (stale && clearStereo(form, modifiedAtoms, modifiedBonds)) {
        const next = after(key);
        map.delete(key);
        const settled = settle(rdkit, form, modifiedBonds);
        if (settled && !map.has(settled.smiles)) {
          map.set(settled.smiles, { ...entry, form: settled.form, atoms: modifiedAtoms.size, bonds: modifiedBonds.size });
          key = settled.smiles;
        } else {
          key = next;
        }
        continue;
      }
      key = after(key);
    }
    if (bailOut && map.size < maxTautomers && status === 'max-tautomers') {
      status = 'completed';
      bailOut = false;
    }
  }

  const keys = [...map.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return {
    status,
    tautomers: keys.map((smiles) => ({ smiles, form: map.get(smiles)!.form })),
    modifiedAtoms: [...modifiedAtoms].sort((a, b) => a - b),
    modifiedBonds: [...modifiedBonds].sort((a, b) => a - b),
  };
}

export interface Tautomer {
  /** Its place in the panel: the drawing's own first, then RDKit's order (decision 3). */
  number: number;
  smiles: string;
  /** The drawing's own form: the same H on every atom, the same charges and bonds. */
  drawing: boolean;
  /** Every H on each atom, by atom index. */
  hydrogens: number[];
  /** What differs from the drawing: atoms with another number of H or another charge, bonds of another kind
   * (aromatic counted as a kind of its own). */
  changedAtoms: number[];
  changedBonds: number[];
  /** In the drawing's layout, with the drawing's chiral flag. A changed double bond RDKit
   * sees as stereogenic is crossed: its E/Z is not known. */
  molfile: string;
}

export type TautomerList =
  /** More than one structure: one at a time (decision 8). */
  | { outcome: 'several' }
  /** More than 32, or RDKit's own limit on transforms reached (decision 7). */
  | { outcome: 'too-many'; status: EnumerationStatus }
  | { outcome: 'listed'; stereoDropped: boolean; tautomers: Tautomer[] };

/** The drawing as Python's MolFromMolBlock reads it (Hs drawn as atoms folded in), or null. */
export function readDrawing(rdkit: MainModule, molfile: string): Mol | null {
  return rdkit.get_mol(molfile, JSON.stringify({ removeHs: true }));
}

function molfileOf(rdkit: MainModule, form: Form, coords: number[][] | null, chiralFlag: boolean): string {
  const drawn = { ...copyForm(form), coords };
  const text = withForm(rdkit, drawn, { steps: PRODUCT_STEPS, setAromaticBonds: true, aromatic: true, assignStereo: true, coords: true }, (m) =>
    m.get_molblock(),
  );
  if (text === null) throw new Error('RDKit could not write a tautomer');
  return withChiralFlag(text, chiralFlag);
}

/** The panel's list for a drawing, or null when RDKit can't read it. */
export function listTautomers(rdkit: MainModule, molfile: string): TautomerList | null {
  const mol = readDrawing(rdkit, molfile);
  if (!mol) return null;
  try {
    const drawing = formOf(mol);
    if (pieces(drawing) > 1) return { outcome: 'several' };
    const found = enumerate(rdkit, mol);
    if (tautomerOutcome(found.status, found.tautomers.length) === 'too-many') return { outcome: 'too-many', status: found.status };
    const kinds = bondKinds(drawing);
    const changes = (form: Form) => ({
      changedAtoms: form.atoms.flatMap((a, i) => (a.impHs !== drawing.atoms[i].impHs || a.chg !== drawing.atoms[i].chg ? [i] : [])),
      changedBonds: bondKinds(form).flatMap((kind, i) => (kind !== kinds[i] ? [i] : [])),
    });
    // The drawing's own tautomer is the one RDKit keys by the drawing's SMILES once its stereo
    // is cleared as everyone's is. RDKit may have kept it in a form of the same SMILES with an H
    // elsewhere (histidine's acid H on its other O), so it is shown as drawn.
    const own = { ...copyForm(drawing), coords: null };
    clearStereo(own, new Set(found.modifiedAtoms), new Set(found.modifiedBonds));
    const settled = settle(rdkit, own, new Set(found.modifiedBonds));
    const at = found.tautomers.findIndex((t) => t.smiles === settled?.smiles);
    if (!settled || at < 0) throw new Error('RDKit did not list the drawing among its own tautomers');
    const shown = found.tautomers.map((t, i) => (i === at ? { ...t, form: settled.form } : t));
    const ordered = [shown[at], ...shown.filter((_, i) => i !== at)];
    const flag = chiralFlagOf(molfile);
    const stereoDropped =
      found.modifiedAtoms.some((a) => drawing.atoms[a].stereo === 'cw' || drawing.atoms[a].stereo === 'ccw') ||
      found.modifiedBonds.some((b) => drawing.bonds[b].stereo === 'cis' || drawing.bonds[b].stereo === 'trans');
    return {
      outcome: 'listed',
      stereoDropped,
      tautomers: ordered.map((t, n) => ({
        number: n + 1,
        smiles: t.smiles,
        drawing: n === 0,
        hydrogens: t.form.atoms.map((a) => a.impHs),
        ...changes(t.form),
        molfile: molfileOf(rdkit, t.form, drawing.coords, flag),
      })),
    };
  } finally {
    mol.delete();
  }
}
