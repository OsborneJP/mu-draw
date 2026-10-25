// A drawing's stereo elements as Python RDKit's FindPotentialStereo (flagPossible) finds
// them, from RDKit.js, which doesn't have it. Used by the properties panel on the drawing as
// drawn, and by the stereoisomer enumerator on the drawing with its stereo taken off (so an
// element that depends on others the drawing defines is still varied). Checked against
// Python for every stereoisomer test drawing (compute.test.ts, stereoisomers.test.ts).
// - Stereocentres: get_stereo_tags lists them, defined or not.
// - Double bonds: get_stereo_tags lists one only once its geometry is fixed; one left open
//   (drawn crossed, or with no coordinates) is missed. So every open double bond is set to
//   cis and RDKit asked again: it keeps stereo only where it can be.
// - A double bond whose two sides are the same but for stereo (=C(CH(OH)CH3)2) is
//   stereogenic only for some settings of the centres in them, which the cis probe can't
//   see with those centres open. Such bonds are tried: every setting of the open elements
//   is written into RDKit's JSON, and the bond counts if setting it differently changes the
//   InChI for any of them.
import type { MainModule, Mol } from '@rdkit/rdkit';

interface JsonBond {
  atoms: [number, number];
  bo?: number;
  stereo?: string;
  stereoAtoms?: [number, number];
}

export interface JsonMolecule {
  atoms: { stereo?: string }[];
  bonds?: JsonBond[];
  conformers?: { dim: number; coords: number[][] }[];
  extensions?: { atomRings?: number[][] }[];
}

export interface RdkitJson {
  molecules: [JsonMolecule];
}

interface Tags {
  CIP_atoms: [number, string][];
  CIP_bonds: [number, number, string][];
}

export interface StereoElements {
  /** Stereocentres, by atom index, ascending. */
  centres: number[];
  /** Stereogenic double bonds, by their index in the JSON's bonds, ascending. */
  doubles: number[];
}

/** At most this many open elements are tried for the rare bonds above (2^10 readings). */
const TRY_AT_MOST = 10;

// An axis RDKit can't judge: an allene (C=C=C; not S(=O)=O, azides or ketenes), or one
// between two aromatic rings with a substituent beside it on each (X-a:a-a:a-Y, the middle
// bond outside any ring). The same SMARTS as gen_stereoisomers_expected.py.
export const AXES = ['C=C=C', '[!#1]!@a:a!@a:a!@[!#1]'];

/** Whether the drawing may be chiral about an axis, which RDKit can't judge. */
export function hasAxis(rdkit: MainModule, mol: Mol): boolean {
  return AXES.some((smarts) => {
    const query = rdkit.get_qmol(smarts);
    if (!query) throw new Error(`RDKit could not read the SMARTS ${smarts}`);
    try {
      return mol.get_substruct_match(query) !== '{}';
    } finally {
      query.delete();
    }
  });
}

/** RDKit's JSON reader rejects whole-number coordinates (0 for 0.0), which JSON.stringify
 * writes; so coordinates are written by hand, each with a decimal point. */
export function serialise(json: RdkitJson, withCoords: boolean): string {
  const { conformers, ...molecule } = json.molecules[0];
  const text = JSON.stringify({ ...json, molecules: [molecule] });
  if (!withCoords || !conformers) return text;
  const number = (v: number) => (Number.isInteger(v) ? v.toFixed(1) : String(v));
  const written = conformers
    .map((c) => `{"dim":${c.dim},"coords":[${c.coords.map((p) => `[${p.map(number).join(',')}]`).join(',')}]}`)
    .join(',');
  return text.replace(/\}\]\}$/, `,"conformers":[${written}]}]}`);
}

/** The JSON with no stereo and no coordinates. */
export function withoutStereo(json: RdkitJson): RdkitJson {
  const copy = structuredClone(json);
  const molecule = copy.molecules[0];
  delete molecule.conformers;
  for (const atom of molecule.atoms) delete atom.stereo;
  for (const bond of molecule.bonds ?? []) {
    delete bond.stereo;
    delete bond.stereoAtoms;
  }
  return copy;
}

function key(a: number, b: number): string {
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}

/** A neighbour of `end` other than `not`, by bond order; undefined if it has none. */
function neighbour(bonds: JsonBond[], end: number, not: number): number | undefined {
  for (const { atoms: [p, q] } of bonds) {
    if (p === end && q !== not) return q;
    if (q === end && p !== not) return p;
  }
  return undefined;
}

/** `json` with double bond `index` set to `geometry`, relative to each end's first other
 * neighbour. */
export function setGeometry(json: RdkitJson, index: number, geometry: 'cis' | 'trans'): void {
  const bonds = json.molecules[0].bonds!;
  const [a, b] = bonds[index].atoms;
  bonds[index] = { ...bonds[index], stereo: geometry, stereoAtoms: [neighbour(bonds, a, b)!, neighbour(bonds, b, a)!] };
}

class Reader {
  constructor(readonly rdkit: MainModule) {}

  read<T>(text: string, work: (mol: Mol) => T): T | null {
    const mol = this.rdkit.get_mol(text, JSON.stringify({ removeHs: false }));
    if (!mol) return null;
    try {
      return work(mol);
    } finally {
      mol.delete();
    }
  }
}

export function stereoElements(rdkit: MainModule, mol: Mol): StereoElements {
  const json = JSON.parse(mol.get_json()) as RdkitJson;
  const tags = JSON.parse(mol.get_stereo_tags()) as Tags;
  const molecule = json.molecules[0];
  const bonds = molecule.bonds ?? [];
  const rings = (molecule.extensions ?? []).flatMap((e) => e.atomRings ?? []);
  const indexOf = (a: number, b: number) => bonds.findIndex((x) => key(x.atoms[0], x.atoms[1]) === key(a, b));
  const centres = tags.CIP_atoms.map(([atom]) => atom).sort((a, b) => a - b);
  const fixed = new Set(tags.CIP_bonds.map(([a, b]) => indexOf(a, b)));

  // Double bonds that could have E/Z: not cumulated, not in a ring of fewer than 8 atoms,
  // another neighbour at each end.
  const isDouble = (i: number) => bonds[i].bo === 2;
  const cumulated = (i: number) =>
    bonds.some((b, j) => j !== i && isDouble(j) && b.atoms.some((x) => bonds[i].atoms.includes(x)));
  const smallRing = (i: number) => rings.some((r) => r.length < 8 && bonds[i].atoms.every((x) => r.includes(x)));
  const candidate = (i: number) =>
    isDouble(i) &&
    !cumulated(i) &&
    !smallRing(i) &&
    bonds[i].atoms.every((end, k) => neighbour(bonds, end, bonds[i].atoms[1 - k]) !== undefined);
  const open = bonds.flatMap((_, i) => (candidate(i) && !fixed.has(i) ? [i] : []));

  const reader = new Reader(rdkit);
  const stereoBondsOf = (text: string) =>
    new Set(reader.read(text, (m) => (JSON.parse(m.get_stereo_tags()) as Tags).CIP_bonds.map(([a, b]) => indexOf(a, b))) ?? []);

  // Every open candidate set to cis: RDKit keeps stereo only where it can be.
  const probe = withoutCoords(json);
  open.forEach((i) => setGeometry(probe, i, 'cis'));
  const kept = open.length > 0 ? stereoBondsOf(JSON.stringify(probe)) : new Set<number>();
  const doubles = new Set([...fixed, ...open.filter((i) => kept.has(i))]);

  // The rest of the open candidates with two substituents at one end: stereogenic only for
  // some settings of the elements around them, so tried against every setting.
  const unsure = open.filter((i) => !kept.has(i) && bonds[i].atoms.some((end) => degree(bonds, end) === 3));
  const openCentres = centres.filter((atom) => molecule.atoms[atom].stereo !== 'cw' && molecule.atoms[atom].stereo !== 'ccw');
  const openDoubles = [...doubles].filter((i) => !fixed.has(i));
  if (unsure.length > 0 && openCentres.length + openDoubles.length + unsure.length <= TRY_AT_MOST) {
    for (const i of decisive(reader, json, openCentres, [...openDoubles, ...unsure], unsure)) doubles.add(i);
  }
  return { centres, doubles: [...doubles].sort((a, b) => a - b) };
}

function degree(bonds: JsonBond[], atom: number): number {
  return bonds.filter((b) => b.atoms.includes(atom)).length;
}

function withoutCoords(json: RdkitJson): RdkitJson {
  const copy = structuredClone(json);
  delete copy.molecules[0].conformers;
  return copy;
}

/** Of `tried`, the double bonds whose setting changes the InChI for some setting of the
 * open centres and double bonds. */
function decisive(reader: Reader, json: RdkitJson, centres: number[], doubles: number[], tried: number[]): number[] {
  const base = withoutCoords(json);
  const count = centres.length + doubles.length;
  const inchi: (string | null)[] = [];
  for (let mask = 0; mask < 1 << count; mask++) {
    const copy = structuredClone(base);
    centres.forEach((atom, i) => (copy.molecules[0].atoms[atom] = { ...copy.molecules[0].atoms[atom], stereo: (mask >> i) & 1 ? 'ccw' : 'cw' }));
    doubles.forEach((index, i) => setGeometry(copy, index, (mask >> (centres.length + i)) & 1 ? 'cis' : 'trans'));
    inchi.push(reader.read(JSON.stringify(copy), (m) => m.get_inchi()));
  }
  return tried.filter((index) => {
    const bit = 1 << (centres.length + doubles.indexOf(index));
    return inchi.some((value, mask) => value !== inchi[mask ^ bit]);
  });
}
