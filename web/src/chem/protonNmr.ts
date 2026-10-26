// The ¹H NMR preview's prediction (docs/plans/v2-proton-nmr.md): one signal per set of
// topologically equivalent atoms carrying H, at the median shift NMRShiftDB2 records for the
// most specific environment of the atom carrying them (a code centred on that atom,
// src/chem/hose.ts), backing off one sphere at a time. A CH₂ whose two H can differ
// (diastereotopic) gives two signals, at the medians of the higher and of the lower shift
// recorded for CH₂ listed with both H (the code with HIGHER or LOWER after it); where the
// CH₂'s own code matches further out than that pair, the pair's gap is centred on its median
// instead (the review). Runs in the panels' RDKit worker and, in the tests and the table's
// build, in Node.
import type { MainModule, Mol } from '@rdkit/rdkit';
import type { BaseInfo } from './carbonTable.ts';
import { graphOf, hoseCodes, symmetryRanks, type Graph, type RdkitJson } from './hose.ts';
import { serialise, type RdkitJson as StereoJson } from './stereoElements.ts';

/** Matches this many bonds out from the atom carrying the H, or fewer, are "low confidence":
 * on NMRShiftDB2 compounds left out of the table, C–H predictions matched at 1 bond were off
 * by 0.72 ppm on average, at 2 by 0.36, at 3 by 0.21, at 4 by 0.11 (the plan). */
export const LOW_CONFIDENCE_SPHERES = 2;

/** After a code: the median of the higher, or the lower, of a CH₂'s two shifts. */
export const HIGHER = '|hi';
export const LOWER = '|lo';

/** H on these elements exchange (OH, NH, SH): their shifts depend on solvent, concentration
 * and temperature. */
const EXCHANGEABLE = new Set([7, 8, 16]);

export interface Signal {
  /** ppm, to 0.01; null when the table has nothing for these atoms at any sphere. */
  shift: number | null;
  /** How many bonds out the match reached (0 when there was none). */
  sphere: number;
  /** The equivalent atoms carrying these H, by Molfile atom index. */
  atoms: number[];
  /** The H in this signal: all those on its atoms, or one on each for a diastereotopic pair. */
  hydrogens: number;
  /** The atoms' element (atomic number) and how many H each carries: CH₃, OH, NH₂. */
  element: number;
  perAtom: number;
  exchangeable: boolean;
  /** One of a diastereotopic CH₂'s two signals, or null. */
  diastereotopic: 'higher' | 'lower' | null;
  /** A diastereotopic CH₂ in a bridged ring system, where the rule can be wrong (RDKit marks
   * bridgeheads as possible stereocentres; telling them apart needs 3D: the plan's limits). */
  bridged: boolean;
}

/** The ¹H table's header (web/scripts/build-proton-table.ts). */
export interface ProtonTableInfo extends BaseInfo {
  source: { file: string; sha256: string; records: number; spectra: number; atoms: number; calculated: number };
  /** Codes with a HIGHER and a LOWER entry. */
  pairs: number;
  /** Predictions for a fixed share of NMRShiftDB2's compounds (InChIKey hash), from a table
   * built without them: C–H signals, and exchangeable H apart. */
  heldOut: {
    every: number;
    compounds: number;
    signals: number;
    meanError: number;
    within03: number;
    within05: number;
    bySphere: { sphere: number; signals: number; meanError: number }[];
    exchangeable: { signals: number; meanError: number };
  };
  /** The diastereotopic rule against CH₂ that NMRShiftDB2 lists with both H: how many pairs
   * differ by more than 0.05 ppm where the rule says they can, and where it says not. */
  diastereotopic: { flagged: { pairs: number; differ: number }; unflagged: { pairs: number; differ: number } };
}

/** A prediction request to the panels' worker, and its answer: the signals (null when RDKit
 * can't read the drawing), or why there is no table. */
export interface ProtonRequest {
  kind: 'proton';
  id: number;
  molfile: string;
}

export type ProtonReply = { kind: 'proton'; id: number; signals: Signal[] | null } | { kind: 'proton'; id: number; unavailable: string };

/** Where shifts are looked up: the shipped table, or (at build time) one held in memory. */
export interface Shifts {
  spheres: number;
  find(code: string): number | null;
}

/** The atoms of a rank class whose two H can differ, asked once per class (equivalent atoms
 * give the same answer):
 * - an sp³ CH₂ that becomes a possible stereocentre when one of its H is made deuterium, in
 *   a molecule that then has another possible stereocentre (RDKit's stereo tags). A double
 *   bond alone doesn't count: a reflection keeps E and Z, so the two deuterated molecules are
 *   mirror images and the H enantiotopic (the review, docs/plans/v2-proton-nmr.md);
 * - an =CH₂ whose double bond's other end carries two different groups, or one and an H.
 * Measured on NMRShiftDB2 (the plan): about 80% of the CH₂ flagged so are listed with two
 * different shifts, 2% of the others. Checked against server-side RDKit on every fixture,
 * and against a person's judgement on the rule's own drawings. */
export function diastereotopic(rdkit: MainModule, mol: Mol, g: Graph, ranks: number[], classes: number[][]): Set<number> {
  const flagged = new Set<number>();
  let withHs: StereoJson | null = null;
  for (const members of classes) {
    const i = members[0];
    const atom = g.atoms[i];
    if (atom.z !== 6 || atom.hs !== 2 || atom.aromatic) continue;
    const double = g.neighbours[i].find(([, bond]) => bond === '=');
    if (double) {
      const other = double[0];
      const sides = g.neighbours[other].filter(([n]) => n !== i).map(([n]) => n);
      if ((sides.length === 1 && g.atoms[other].hs === 1) || (sides.length === 2 && ranks[sides[0]] !== ranks[sides[1]])) {
        members.forEach((m) => flagged.add(m));
      }
      continue;
    }
    if (g.neighbours[i].some(([, bond]) => bond !== '')) continue; // a triple or an odd bond
    withHs ??= readWithHs(rdkit, mol);
    if (withHs && deuteriumMakesCentre(rdkit, withHs, atom.index)) members.forEach((m) => flagged.add(m));
  }
  return flagged;
}

/** The drawing with every H as an atom (RDKit keeps the other atoms' indices). */
function readWithHs(rdkit: MainModule, mol: Mol): StereoJson | null {
  const all = rdkit.get_mol(mol.add_hs(), JSON.stringify({ removeHs: false }));
  if (!all) return null;
  try {
    return JSON.parse(all.get_json()) as StereoJson;
  } finally {
    all.delete();
  }
}

interface JsonAtoms {
  defaults: { atom: { z: number; isotope: number } };
  molecules: [{ atoms: { z?: number; isotope?: number }[]; bonds?: { atoms: [number, number] }[] }];
}

function deuteriumMakesCentre(rdkit: MainModule, withHs: StereoJson, carbon: number): boolean {
  const json = structuredClone(withHs) as unknown as JsonAtoms;
  const { atoms, bonds = [] } = json.molecules[0];
  const isH = (a: number) => (atoms[a].z ?? json.defaults.atom.z) === 1 && (atoms[a].isotope ?? json.defaults.atom.isotope) === 0;
  const h = bonds.map((b) => (b.atoms[0] === carbon ? b.atoms[1] : b.atoms[1] === carbon ? b.atoms[0] : -1)).find((a) => a >= 0 && isH(a));
  if (h === undefined) return false;
  atoms[h].isotope = 2;
  const labelled = rdkit.get_mol(serialise(json as unknown as StereoJson, true), JSON.stringify({ removeHs: false }));
  if (!labelled) return false;
  try {
    // Possible stereocentres, defined or not.
    const centres = (JSON.parse(labelled.get_stereo_tags()) as { CIP_atoms: [number, string][] }).CIP_atoms.map(([atom]) => atom);
    return centres.includes(carbon) && centres.length > 1;
  } finally {
    labelled.delete();
  }
}

/** Atoms of a ring that shares three or more atoms with another: a bridged ring system. */
function bridgedAtoms(json: { molecules: { extensions?: { atomRings?: number[][] }[] }[] }): Set<number> {
  const rings = (json.molecules[0].extensions ?? []).flatMap((e) => e.atomRings ?? []);
  const shared = (a: number[], b: number[]) => a.filter((x) => b.includes(x)).length;
  return new Set(rings.filter((r, i) => rings.some((o, j) => j !== i && shared(r, o) >= 3)).flat());
}

const hundredths = (ppm: number) => Math.round(ppm * 100) / 100;

/** The shift for a set of equivalent atoms: each looked up at its most specific code (they
 * have the same codes; each is looked up anyway, and averaged). */
function match(g: Graph, ranks: number[], members: number[], shifts: Shifts, suffix: string): { shift: number | null; sphere: number } {
  let sum = 0;
  let found = 0;
  let sphere = Infinity;
  for (const atom of members) {
    const codes = hoseCodes(g, ranks, atom, shifts.spheres);
    for (let k = codes.length; k >= 1; k -= 1) {
      const shift = shifts.find(codes[k - 1] + suffix);
      if (shift !== null) {
        sum += shift;
        found += 1;
        sphere = Math.min(sphere, k);
        break;
      }
    }
  }
  return found === members.length ? { shift: hundredths(sum / found), sphere } : { shift: null, sphere: 0 };
}

/** Signals from the highest shift down (as a spectrum is read), or null when RDKit can't
 * read the drawing. */
export function predictProton(rdkit: MainModule, molfile: string, shifts: Shifts): Signal[] | null {
  const mol = rdkit.get_mol(molfile, JSON.stringify({ removeHs: false }));
  if (!mol) return null;
  try {
    const json = JSON.parse(mol.get_json()) as RdkitJson & { molecules: { extensions?: { atomRings?: number[][] }[] }[] };
    const g = graphOf(json);
    const bridged = bridgedAtoms(json);
    const ranks = symmetryRanks(g);
    const byRank = new Map<number, number[]>();
    g.atoms.forEach((a, i) => {
      if (a.hs > 0) byRank.set(ranks[i], [...(byRank.get(ranks[i]) ?? []), i]);
    });
    const classes = [...byRank.values()];
    const pairs = diastereotopic(rdkit, mol, g, ranks, classes);
    const signals: Signal[] = [];
    for (const members of classes) {
      const first = g.atoms[members[0]];
      const base = {
        atoms: members.map((i) => g.atoms[i].index),
        element: first.z,
        perAtom: first.hs,
        exchangeable: EXCHANGEABLE.has(first.z),
      };
      const plain = match(g, ranks, members, shifts, '');
      if (pairs.has(members[0])) {
        let higher = match(g, ranks, members, shifts, HIGHER);
        let lower = match(g, ranks, members, shifts, LOWER);
        if (higher.shift !== null && lower.shift !== null) {
          // Pairs come only from CH₂ listed with both H; the CH₂'s own median comes from every
          // spectrum. Where it matched further out, it places the pair: half the gap either side.
          if (plain.shift !== null && plain.sphere > Math.min(higher.sphere, lower.sphere)) {
            const half = (higher.shift - lower.shift) / 2;
            higher = { shift: hundredths(plain.shift + half), sphere: plain.sphere };
            lower = { shift: hundredths(plain.shift - half), sphere: plain.sphere };
          }
          const inBridged = members.some((i) => bridged.has(g.atoms[i].index));
          signals.push(
            { ...base, ...higher, hydrogens: members.length, diastereotopic: 'higher', bridged: inBridged },
            { ...base, ...lower, hydrogens: members.length, diastereotopic: 'lower', bridged: inBridged },
          );
          continue;
        }
      }
      const hydrogens = members.reduce((n, i) => n + g.atoms[i].hs, 0);
      signals.push({ ...base, ...plain, hydrogens, diastereotopic: null, bridged: false });
    }
    const order = (s: Signal) => (s.diastereotopic === 'lower' ? 1 : 0);
    return signals.sort(
      (a, b) => (b.shift ?? -Infinity) - (a.shift ?? -Infinity) || a.atoms[0] - b.atoms[0] || order(a) - order(b),
    );
  } finally {
    mol.delete();
  }
}
