// The stereoisomer enumerator (docs/plans/v2-stereoisomers.md): every stereoisomer of a
// drawing, how they relate, which ones the drawing matches, and a Molfile of each drawn like
// the student's drawing. Runs in an RDKit worker and, in the unit tests, in Node against what
// server-side RDKit's own EnumerateStereoisomers answered for the same drawings
// (server/scripts/gen_stereoisomers_expected.py): the two must agree exactly.
//
// RDKit.js has no enumerator. RDKit's JSON form of a molecule carries each atom's stereo
// (cw/ccw) and each double bond's (cis/trans), so every combination of the drawing's
// potential stereo elements is written into it and read back (measured to give Python's set).
// Two combinations are the same stereoisomer when their InChIs, taken without coordinates,
// are equal: canonical SMILES leaves duplicates in symmetric rings, an RDKit SMILES round trip
// can change a stereoisomer, and with coordinates InChI reads E/Z from the drawn geometry.
import type { MainModule, Mol } from '@rdkit/rdkit';
import { stereoDoubleBonds } from './compute';

/** Decision 7: enumerate up to this many stereo elements, draw up to this many. */
export const LIMITS = { elements: 8, drawn: 32 } as const;

/** Notes beside the list (decisions 5 and 6). */
export type Note = 'bridged' | 'axial-planar';

export type Relation =
  | { kind: 'enantiomer'; of: number }
  | { kind: 'achiral' }
  | { kind: 'meso' }
  /** Achiral as far as RDKit can tell, but the drawing has chirality RDKit can't see. */
  | { kind: 'unjudged' };

export interface Labels {
  /** CIP label by Molfile atom index: R, S, r or s. */
  atoms: Record<string, string>;
  /** CIP label by bond, "a-b" with a < b: E, Z, e or z. */
  bonds: Record<string, string>;
}

export interface Stereoisomer {
  number: number;
  inchikey: string;
  labels: Labels;
  relation: Relation;
  matches: boolean;
  /** In the drawing's layout with the student's wedges, or laid out afresh where a double
   * bond's geometry has to change; chiral flag 1. It reads back as this stereoisomer. */
  molfile: string;
}

export type Enumeration =
  | { outcome: 'no-elements' }
  | { outcome: 'too-many'; elements: number }
  | { outcome: 'counted'; elements: number; count: number; notes: Note[] }
  | { outcome: 'listed'; elements: number; notes: Note[]; stereoisomers: Stereoisomer[] };

/** Before enumerating: whether there is anything to list, and whether it is too much. */
export function sizeOutcome(elements: number): 'no-elements' | 'too-many' | 'enumerate' {
  if (elements === 0) return 'no-elements';
  return elements > LIMITS.elements ? 'too-many' : 'enumerate';
}

/** After enumerating: whether the stereoisomers are drawn, or only counted. */
export function listOutcome(count: number): 'listed' | 'counted' {
  return count > LIMITS.drawn ? 'counted' : 'listed';
}

interface JsonBond {
  atoms: [number, number];
  bo?: number;
  stereo?: string;
  stereoAtoms?: [number, number];
}

interface JsonMolecule {
  atoms: { stereo?: string }[];
  bonds?: JsonBond[];
  conformers?: { dim: number; coords: number[][] }[];
  extensions?: { atomRings?: number[][] }[];
}

interface Json {
  molecules: [JsonMolecule];
}

interface Tags {
  CIP_atoms: [number, string][];
  CIP_bonds: [number, number, string][];
}

type Spin = 'cw' | 'ccw';
type Geometry = 'cis' | 'trans';

/** One way of setting every stereo element: centres in atom order, then double bonds. */
interface Combination {
  spins: Spin[];
  geometries: Geometry[];
}

interface Elements {
  centres: number[];
  /** Index into the JSON's bonds. */
  doubles: number[];
}

const BIARYL_AXIS = '[!#1]!@a:a!@a:a!@[!#1]'; // as in gen_stereoisomers_expected.py

/** RDKit's JSON reader rejects whole-number coordinates (0 for 0.0), which JSON.stringify
 * writes; so the coordinates are written by hand, each with a decimal point. */
function serialise(json: Json, withCoords: boolean): string {
  const { conformers, ...molecule } = json.molecules[0];
  const text = JSON.stringify({ ...json, molecules: [molecule] });
  if (!withCoords || !conformers) return text;
  const number = (v: number) => (Number.isInteger(v) ? v.toFixed(1) : String(v));
  const written = conformers
    .map((c) => `{"dim":${c.dim},"coords":[${c.coords.map((p) => `[${p.map(number).join(',')}]`).join(',')}]}`)
    .join(',');
  return text.replace(/\}\]\}$/, `,"conformers":[${written}]}]}`);
}

function bondKey(a: number, b: number): string {
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}

function labelsOf(tags: Tags): Labels {
  const strip = (label: string) => label.replace(/^\(|\)$/g, '');
  const atoms: Record<string, string> = {};
  for (const [atom, label] of tags.CIP_atoms) if (label !== '(?)') atoms[String(atom)] = strip(label);
  const bonds: Record<string, string> = {};
  for (const [a, b, label] of tags.CIP_bonds) if (label !== '(?)') bonds[bondKey(a, b)] = strip(label);
  return { atoms, bonds };
}

/** A copy of the drawing's JSON with a combination written in. */
function withCombination(json: Json, elements: Elements, combination: Combination): Json {
  const copy = structuredClone(json);
  const molecule = copy.molecules[0];
  const bonds = molecule.bonds ?? [];
  elements.centres.forEach((atom, i) => (molecule.atoms[atom] = { ...molecule.atoms[atom], stereo: combination.spins[i] }));
  elements.doubles.forEach((index, i) => {
    const bond = bonds[index];
    const [a, b] = bond.atoms;
    const other = (end: number, not: number) =>
      bonds.map((x) => x.atoms).find(([p, q]) => (p === end && q !== not) || (q === end && p !== not))!;
    const nextTo = (end: number, not: number) => {
      const [p, q] = other(end, not);
      return p === end ? q : p;
    };
    bonds[index] = { ...bond, stereo: combination.geometries[i], stereoAtoms: [nextTo(a, b), nextTo(b, a)] };
  });
  return copy;
}

function mirrored(combination: Combination): Combination {
  return { spins: combination.spins.map((s) => (s === 'cw' ? 'ccw' : 'cw')), geometries: combination.geometries };
}

class Reader {
  constructor(private readonly rdkit: MainModule) {}

  /** Read text into RDKit, use it, and free it. */
  with<T>(text: string, work: (mol: Mol) => T, details: object = { removeHs: false }): T {
    const mol = this.rdkit.get_mol(text, JSON.stringify(details));
    if (!mol) throw new Error('RDKit could not read a stereoisomer');
    try {
      return work(mol);
    } finally {
      mol.delete();
    }
  }
}

interface Read {
  inchi: string;
  labels: Labels;
}

const NO_LABELS: Labels = { atoms: {}, bonds: {} };

/** Every stereoisomer of a Molfile, or null when RDKit can't read it. */
export function enumerateStereoisomers(rdkit: MainModule, molfile: string): Enumeration | null {
  const drawingMol = rdkit.get_mol(molfile, JSON.stringify({ removeHs: false }));
  if (!drawingMol) return null;
  let json: Json, drawnTags: Tags, doublePairs: [number, number][], chiralFlag: string, biaryl: boolean;
  try {
    json = JSON.parse(drawingMol.get_json()) as Json;
    drawnTags = JSON.parse(drawingMol.get_stereo_tags()) as Tags;
    doublePairs = stereoDoubleBonds(rdkit, drawingMol);
    chiralFlag = drawingMol.has_prop('_MolFileChiralFlag') ? drawingMol.get_prop('_MolFileChiralFlag') : '0';
    const query = rdkit.get_qmol(BIARYL_AXIS);
    biaryl = query !== null && drawingMol.get_substruct_match(query) !== '{}';
    query?.delete();
  } finally {
    drawingMol.delete();
  }
  const molecule = json.molecules[0];
  const bonds = molecule.bonds ?? [];
  const elements: Elements = {
    centres: drawnTags.CIP_atoms.map(([atom]) => atom).sort((a, b) => a - b),
    doubles: doublePairs
      .map(([a, b]) => bonds.findIndex((x) => bondKey(x.atoms[0], x.atoms[1]) === bondKey(a, b)))
      .sort((a, b) => a - b),
  };
  const count = elements.centres.length + elements.doubles.length;
  const size = sizeOutcome(count);
  if (size === 'no-elements') return { outcome: 'no-elements' };
  if (size === 'too-many') return { outcome: 'too-many', elements: count };

  const reader = new Reader(rdkit);
  // CIP labels are slow on a big molecule; every combination needs them only to compare
  // double bonds, the representatives always (for their pictures).
  const read = (combination: Combination, labelled: boolean): Read =>
    reader.with(serialise(withCombination(json, elements, combination), false), (mol) => ({
      inchi: mol.get_inchi(),
      labels: labelled ? labelsOf(JSON.parse(mol.get_stereo_tags()) as Tags) : NO_LABELS,
    }));

  // Every combination, grouped by InChI.
  const classes = new Map<string, { combination: Combination; labels: Labels }[]>();
  for (let mask = 0; mask < 1 << count; mask++) {
    const bit = (i: number) => (mask >> i) & 1;
    const combination: Combination = {
      spins: elements.centres.map((_, i) => (bit(i) ? 'ccw' : 'cw')),
      geometries: elements.doubles.map((_, i) => (bit(elements.centres.length + i) ? 'cis' : 'trans')),
    };
    const { inchi, labels } = read(combination, elements.doubles.length > 0);
    classes.set(inchi, [...(classes.get(inchi) ?? []), { combination, labels }]);
  }
  const notes = notesFor(molecule, elements, biaryl);
  if (listOutcome(classes.size) === 'counted') return { outcome: 'counted', elements: count, count: classes.size, notes };

  // Which combination stands for each stereoisomer: the smallest signature, the same rule
  // the generator uses (centres CW 0 / CCW 1 in atom order, then double bonds Z 1 / else 0).
  const doubleKeys = elements.doubles.map((i) => bondKey(...bonds[i].atoms));
  const signature = ({ combination, labels }: { combination: Combination; labels: Labels }) =>
    combination.spins.map((s) => (s === 'ccw' ? '1' : '0')).join('') +
    doubleKeys.map((k) => (labels.bonds[k] === 'Z' || labels.bonds[k] === 'z' ? '1' : '0')).join('');
  const reps = new Map(
    [...classes].map(([inchi, members]) => [
      inchi,
      members.reduce((best, m) => (signature(m) < signature(best) ? m : best)),
    ]),
  );

  // What the drawing defines, and which stereoisomers agree with all of it.
  const drawnSpins = new Map(elements.centres.flatMap((atom) => {
    const spin = molecule.atoms[atom].stereo;
    return spin === 'cw' || spin === 'ccw' ? [[atom, spin] as const] : [];
  }));
  const drawnLabels = labelsOf(drawnTags);
  const drawnBonds = doubleKeys.filter((k) => k in drawnLabels.bonds);
  const defined = drawnSpins.size > 0 || drawnBonds.length > 0;
  const agrees = ({ combination, labels }: { combination: Combination; labels: Labels }) =>
    elements.centres.every((atom, i) => !drawnSpins.has(atom) || drawnSpins.get(atom) === combination.spins[i]) &&
    drawnBonds.every((k) => labels.bonds[k] === drawnLabels.bonds[k]);

  const mirrors = new Map([...reps].map(([inchi, rep]) => [inchi, read(mirrored(rep.combination), false).inchi]));
  const matching = new Set(defined ? [...classes].filter(([, members]) => members.some(agrees)).map(([inchi]) => inchi) : []);
  if (chiralFlag === '0' && drawnSpins.size > 0) for (const inchi of [...matching]) matching.add(mirrors.get(inchi)!);
  const chiral = new Set([...classes.keys()].filter((inchi) => mirrors.get(inchi) !== inchi));
  const inchikey = new Map([...classes.keys()].map((inchi) => [inchi, rdkit.get_inchikey_for_inchi(inchi)]));
  const key = (inchi: string) => inchikey.get(inchi)!;

  // Each chiral stereoisomer beside its mirror image; groups with a match to the drawing first.
  const groups: string[][] = [];
  const seen = new Set<string>();
  for (const inchi of [...classes.keys()].sort((a, b) => compare(key(a), key(b)))) {
    if (seen.has(inchi)) continue;
    const group = !chiral.has(inchi)
      ? [inchi]
      : [inchi, mirrors.get(inchi)!].sort(
          (a, b) => Number(!matching.has(a)) - Number(!matching.has(b)) || compare(key(a), key(b)),
        );
    group.forEach((g) => seen.add(g));
    groups.push(group);
  }
  const firstKey = (group: string[]) => group.map(key).sort(compare)[0];
  groups.sort(
    (a, b) =>
      Number(!a.some((g) => matching.has(g))) - Number(!b.some((g) => matching.has(g))) ||
      compare(firstKey(a), firstKey(b)),
  );
  const order = groups.flat();
  const repLabels = new Map(order.map((inchi) => [inchi, read(reps.get(inchi)!.combination, true).labels]));
  const number = new Map(order.map((inchi, i) => [inchi, i + 1]));
  const judged = !notes.includes('axial-planar');

  const stereoisomers = order.map((inchi): Stereoisomer => {
    const rep = reps.get(inchi)!;
    const relation: Relation = chiral.has(inchi)
      ? { kind: 'enantiomer', of: number.get(mirrors.get(inchi)!)! }
      : !judged
        ? { kind: 'unjudged' }
        : { kind: chiral.size > 0 ? 'meso' : 'achiral' };
    return {
      number: number.get(inchi)!,
      inchikey: key(inchi),
      labels: repLabels.get(inchi)!,
      relation,
      matches: matching.has(inchi),
      molfile: drawnLike(reader, molfile, json, elements, rep.combination, repLabels.get(inchi)!, drawnLabels, inchi),
    };
  });
  return { outcome: 'listed', elements: count, notes, stereoisomers };
}

/** Plain code-point order, as Python sorts strings. */
function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function notesFor(molecule: JsonMolecule, elements: Elements, biaryl: boolean): Note[] {
  const rings = (molecule.extensions ?? []).flatMap((e) => e.atomRings ?? []).map((r) => new Set(r));
  const bonds = molecule.bonds ?? [];
  const notes: Note[] = [];
  const shared = (a: Set<number>, b: Set<number>) => [...a].filter((x) => b.has(x)).length;
  if (rings.some((a, i) => rings.slice(i + 1).some((b) => shared(a, b) >= 3))) notes.push('bridged');
  const doubles = bonds.filter((b) => b.bo === 2);
  const allene = doubles.some((b, i) => doubles.some((c, j) => i !== j && c.atoms.some((x) => b.atoms.includes(x))));
  const inRing = (bond: JsonBond) => rings.some((r) => bond.atoms.every((x) => r.has(x)));
  const ringDouble = elements.doubles.some((i) => inRing(bonds[i]));
  if (allene || ringDouble || biaryl) notes.push('axial-planar');
  return notes;
}

/** A V2000 Molfile's bond lines: [first atom, second atom, stereo], 0-based atoms. */ // chem-literal-ok: format name
function bondLines(molfile: string): { lines: string[]; start: number; bonds: [number, number, number][] } | null {
  const lines = molfile.split('\n');
  const counts = lines[3] ?? '';
  if (!counts.includes('V2000')) return null; // chem-literal-ok: format marker
  const atoms = Number(counts.slice(0, 3));
  const bondCount = Number(counts.slice(3, 6));
  const start = 4 + atoms;
  const bonds = lines
    .slice(start, start + bondCount)
    .map((l) => [Number(l.slice(0, 3)) - 1, Number(l.slice(3, 6)) - 1, Number(l.slice(9, 12))] as [number, number, number]);
  return { lines, start, bonds };
}

function withChiralFlag(molfile: string): string {
  const lines = molfile.split('\n');
  lines[3] = `${lines[3].slice(0, 12)}  1${lines[3].slice(15)}`;
  return lines.join('\n');
}

/** A Molfile of one stereoisomer, drawn like the drawing: its coordinates, and the bonds the
 * student wedged at each centre, wedge or hash as this stereoisomer needs (decision 3). A
 * double bond whose geometry must change can't keep the coordinates, so then the molecule
 * is laid out afresh, with RDKit's wedges. Whatever the route, it must read back as the
 * stereoisomer, or the next route is taken. */
function drawnLike(
  reader: Reader,
  drawing: string,
  json: Json,
  elements: Elements,
  combination: Combination,
  labels: Labels,
  drawnLabels: Labels,
  inchi: string,
): string {
  const text = serialise(withCombination(json, elements, combination), true);
  const flagged = (molfile: string) => (elements.centres.length > 0 ? withChiralFlag(molfile) : molfile);
  const readsBack = (molfile: string) => reader.with(molfile, (mol) => mol.get_inchi()) === inchi;
  const bondsMatchDrawing = Object.keys(labels.bonds).every((k) => drawnLabels.bonds[k] === labels.bonds[k]);

  if (bondsMatchDrawing) {
    const rdkitDrawn = reader.with(text, (mol) => mol.get_molblock());
    const student = withStudentWedges(reader, drawing, rdkitDrawn, elements, combination);
    for (const candidate of [student, rdkitDrawn]) {
      if (candidate !== null && readsBack(flagged(candidate))) return flagged(candidate);
    }
  }
  const fresh = reader.with(text, (mol) => {
    mol.set_new_coords();
    return mol.get_molblock();
  });
  if (readsBack(flagged(fresh))) return flagged(fresh);
  throw new Error('a stereoisomer could not be drawn as itself');
}

/** RDKit's Molfile of a stereoisomer, with each centre the student wedged wedged on the same
 * bond again: wedge or hash, whichever reads back as this stereoisomer's setting. */
function withStudentWedges(
  reader: Reader,
  drawing: string,
  rdkitDrawn: string,
  elements: Elements,
  combination: Combination,
): string | null {
  const drawn = bondLines(drawing);
  const ours = bondLines(rdkitDrawn);
  if (!drawn || !ours || drawn.bonds.length !== ours.bonds.length) return null;
  const centres = new Map(elements.centres.map((atom, i) => [atom, combination.spins[i]]));
  const lines = [...ours.lines];
  const write = (index: number, first: number, second: number, stereo: number) => {
    const old = lines[ours.start + index];
    const pad = (n: number) => String(n).padStart(3, ' ');
    lines[ours.start + index] = `${pad(first + 1)}${pad(second + 1)}${old.slice(6, 9)}${pad(stereo)}${old.slice(12)}`;
  };
  const spinOf = (molfile: string, atom: number) =>
    reader.with(molfile, (mol) => (JSON.parse(mol.get_json()) as Json).molecules[0].atoms[atom].stereo);
  let changed = false;
  for (const [index, [first, , stereo]] of drawn.bonds.entries()) {
    const spin = centres.get(first);
    if (spin === undefined || (stereo !== 1 && stereo !== 6)) continue;
    // Take RDKit's wedges off this centre, then wedge the student's bond.
    ours.bonds.forEach(([a, b, s], i) => {
      if (a === first && (s === 1 || s === 6)) write(i, a, b, 0);
    });
    const second = drawn.bonds[index][1];
    write(index, first, second, 1);
    if (spinOf(lines.join('\n'), first) !== spin) write(index, first, second, 6);
    changed = true;
  }
  return changed ? lines.join('\n') : null;
}
