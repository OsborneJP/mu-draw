// The stereoisomer enumerator (docs/plans/v2-stereoisomers.md): every stereoisomer of a
// drawing, how they relate, which ones the drawing matches, and a Molfile of each drawn like
// the student's drawing. Runs in an RDKit worker and, in the unit tests, in Node against what
// server-side RDKit's own FindPotentialStereo and EnumerateStereoisomers answered for the same
// drawings (server/scripts/gen_stereoisomers_expected.py): the two must agree exactly.
//
// RDKit.js has no enumerator. RDKit's JSON form of a molecule carries each atom's stereo
// (cw/ccw) and each double bond's (cis/trans), so every combination of the stereo elements is
// written into it and read back (measured to give Python's set).
// - The elements are those of the drawing with its stereo taken off: one that depends on
//   others the drawing defines (C3 of pentane-2,3,4-triol drawn (2R,4R)) is still varied.
// - Two combinations are the same stereoisomer when their InChIs, taken without coordinates,
//   are equal: canonical SMILES leaves duplicates in symmetric rings, an RDKit SMILES round
//   trip can change a stereoisomer, and with coordinates InChI reads E/Z from the layout.
import type { MainModule, Mol } from '@rdkit/rdkit';
import { hasAxis, neighbour, serialise, setGeometry, stereoElements, withoutStereo, type RdkitJson } from './stereoElements';

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
   * bond's geometry has to change; chiral flag 1. It reads back as this stereoisomer. Null
   * when no flat drawing does: some settings of the double bonds in a ring of 8 to 11 atoms
   * (cyclooctatetraene with one or three E) can't be drawn flat as themselves. */
  molfile: string | null;
}

export type Enumeration =
  /** More than one structure: the panel works on one at a time (bar B.1). */
  | { outcome: 'several' }
  | { outcome: 'no-elements'; notes: Note[] }
  | { outcome: 'too-many'; elements: number; notes: Note[] }
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

interface Tags {
  CIP_atoms: [number, string][];
  CIP_bonds: [number, number, string][];
}

type Spin = 'cw' | 'ccw';

/** One way of setting every element: centres in atom order, then double bonds. */
interface Combination {
  spins: Spin[];
  geometries: ('cis' | 'trans')[];
}

interface Member {
  combination: Combination;
  labels: Labels;
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

class Reader {
  constructor(readonly rdkit: MainModule) {}

  /** Read text into RDKit, use it, and free it. */
  with<T>(text: string, work: (mol: Mol) => T): T {
    const mol = this.rdkit.get_mol(text, JSON.stringify({ removeHs: false }));
    if (!mol) throw new Error('RDKit could not read a stereoisomer');
    try {
      return work(mol);
    } finally {
      mol.delete();
    }
  }

  /** The InChI of a Molfile, read the same way as the combinations' (without coordinates,
   * once its wedges and layout have set the stereo). */
  inchiOf(molfile: string): string {
    const json = this.with(molfile, (mol) => JSON.parse(mol.get_json()) as RdkitJson);
    return this.with(serialise(json, false), (mol) => mol.get_inchi());
  }
}

interface Drawing {
  json: RdkitJson;
  /** The same with no stereo at all (its layout kept): each combination is written into it,
   * so nothing else drawn (a wedged biaryl axis, read as atropisomer stereo) carries over. */
  bare: RdkitJson;
  /** Its stereo elements, with its stereo taken off. */
  centres: number[];
  doubles: number[];
  /** What it defines: the spin of each defined centre, and for each double bond it fixes,
   * its geometry as RDKit reads it (cis when the first other neighbours of its two ends,
   * those setGeometry uses, are on the same side). Not E/Z: a double bond's label can turn
   * with a centre the drawing leaves open. */
  spins: Map<number, Spin>;
  geometries: Map<number, 'cis' | 'trans'>;
  racemic: boolean;
  notes: Note[];
}

function readDrawing(rdkit: MainModule, molfile: string): Drawing | 'several' | null {
  const mol = rdkit.get_mol(molfile, JSON.stringify({ removeHs: false }));
  if (!mol) return null;
  try {
    const frags = mol.get_frags() as { molList: { size(): number; delete(): void } };
    const several = frags.molList.size() > 1;
    frags.molList.delete();
    if (several) return 'several';
    const json = JSON.parse(mol.get_json()) as RdkitJson;
    const bare = withoutStereo(json, true);
    const stripped = rdkit.get_mol(serialise(bare, false), JSON.stringify({ removeHs: false }));
    if (!stripped) return null;
    let elements;
    try {
      elements = stereoElements(rdkit, stripped);
    } finally {
      stripped.delete();
    }
    const atoms = json.molecules[0].atoms;
    const spins = new Map(
      elements.centres.flatMap((atom) => {
        const spin = atoms[atom].stereo;
        return spin === 'cw' || spin === 'ccw' ? [[atom, spin] as const] : [];
      }),
    );
    const bonds = json.molecules[0].bonds ?? [];
    const geometries = new Map(
      elements.doubles.flatMap((index) => {
        const fixed = bonds[index].stereo === 'cis' || bonds[index].stereo === 'trans';
        return fixed ? [[index, drawnGeometry(json, index)] as const] : [];
      }),
    );
    const flag = mol.has_prop('_MolFileChiralFlag') ? mol.get_prop('_MolFileChiralFlag') : '0';
    return {
      json,
      bare,
      ...elements,
      spins,
      geometries,
      // Chiral flag 0 with a defined centre: Ketcher reads it as an AND (racemic) group.
      racemic: flag === '0' && spins.size > 0,
      notes: notesFor(json, elements.doubles, hasAxis(rdkit, mol)),
    };
  } finally {
    mol.delete();
  }
}

/** The geometry RDKit reads for double bond `index` of the drawing (its cis or trans, to its
 * own stereo atoms), turned to the first other neighbour of each end, as setGeometry writes
 * one. RDKit's reading, not the app's: a neighbour drawn in line with the bond is on
 * neither side, and RDKit then reads the end's other neighbour. */
function drawnGeometry(json: RdkitJson, index: number): 'cis' | 'trans' {
  const bonds = json.molecules[0].bonds ?? [];
  const {
    atoms: [a, b],
    stereo,
    stereoAtoms,
  } = bonds[index];
  let same = stereo === 'cis';
  if (stereoAtoms![0] !== neighbour(bonds, a, b)) same = !same;
  if (stereoAtoms![1] !== neighbour(bonds, b, a)) same = !same;
  return same ? 'cis' : 'trans';
}

function notesFor(json: RdkitJson, doubles: number[], axial: boolean): Note[] {
  const molecule = json.molecules[0];
  const rings = (molecule.extensions ?? []).flatMap((e) => e.atomRings ?? []).map((r) => new Set(r));
  const bonds = molecule.bonds ?? [];
  const notes: Note[] = [];
  const shared = (a: Set<number>, b: Set<number>) => [...a].filter((x) => b.has(x)).length;
  if (rings.some((a, i) => rings.slice(i + 1).some((b) => shared(a, b) >= 3))) notes.push('bridged');
  const inRing = (index: number) => rings.some((r) => bonds[index].atoms.every((x) => r.has(x)));
  if (axial || doubles.some(inRing)) notes.push('axial-planar');
  return notes;
}

/** The drawing with no stereo but a combination's (coordinates kept or not). */
function withCombination(drawing: Drawing, combination: Combination, withCoords: boolean): string {
  const copy = structuredClone(drawing.bare);
  const molecule = copy.molecules[0];
  drawing.centres.forEach((atom, i) => (molecule.atoms[atom] = { ...molecule.atoms[atom], stereo: combination.spins[i] }));
  drawing.doubles.forEach((index, i) => setGeometry(copy, index, combination.geometries[i]));
  return serialise(copy, withCoords);
}

function mirrored(combination: Combination): Combination {
  return { spins: combination.spins.map((s) => (s === 'cw' ? 'ccw' : 'cw')), geometries: combination.geometries };
}

/** Plain code-point order, as Python sorts strings. */
function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Every stereoisomer of a Molfile, or null when RDKit can't read it. */
export function enumerateStereoisomers(rdkit: MainModule, molfile: string): Enumeration | null {
  const drawing = readDrawing(rdkit, molfile);
  if (drawing === null) return null;
  if (drawing === 'several') return { outcome: 'several' };
  const { centres, doubles, notes } = drawing;
  const count = centres.length + doubles.length;
  const size = sizeOutcome(count);
  if (size === 'no-elements') return { outcome: 'no-elements', notes };
  if (size === 'too-many') return { outcome: 'too-many', elements: count, notes };

  const reader = new Reader(rdkit);
  const bonds = drawing.json.molecules[0].bonds ?? [];
  const doubleKeys = doubles.map((i) => bondKey(...bonds[i].atoms));
  // CIP labels are slow on a big molecule: every combination needs them only to compare
  // double bonds; the stereoisomers shown always (for their pictures).
  const read = (combination: Combination, labelled: boolean) =>
    reader.with(withCombination(drawing, combination, false), (mol) => ({
      inchi: mol.get_inchi(),
      labels: labelled ? labelsOf(JSON.parse(mol.get_stereo_tags()) as Tags) : { atoms: {}, bonds: {} },
    }));

  // Every combination, grouped by InChI.
  const classes = new Map<string, Member[]>();
  for (let mask = 0; mask < 1 << count; mask++) {
    const bit = (i: number) => (mask >> i) & 1;
    const combination: Combination = {
      spins: centres.map((_, i) => (bit(i) ? 'ccw' : 'cw')),
      geometries: doubles.map((_, i) => (bit(centres.length + i) ? 'cis' : 'trans')),
    };
    const { inchi, labels } = read(combination, doubles.length > 0);
    classes.set(inchi, [...(classes.get(inchi) ?? []), { combination, labels }]);
  }
  if (listOutcome(classes.size) === 'counted') return { outcome: 'counted', elements: count, count: classes.size, notes };

  // Which stereoisomers agree with all the drawing defines; a racemic drawing (an AND
  // group) matches the mirror images too.
  const defined = drawing.spins.size > 0 || drawing.geometries.size > 0;
  const agrees = ({ combination }: Member) =>
    centres.every((atom, i) => !drawing.spins.has(atom) || drawing.spins.get(atom) === combination.spins[i]) &&
    doubles.every((index, i) => !drawing.geometries.has(index) || drawing.geometries.get(index) === combination.geometries[i]);
  const agreeing = new Map([...classes].map(([inchi, members]) => [inchi, defined ? members.filter(agrees) : []]));

  // Which combination stands for each stereoisomer: for one the drawing matches, the one that
  // agrees with it (so it is drawn as drawn); else the smallest signature. The generator uses
  // the same rule (centres CW 0 / CCW 1 in atom order, then double bonds Z 1 / else 0).
  const signature = ({ combination, labels }: Member) =>
    combination.spins.map((s) => (s === 'ccw' ? '1' : '0')).join('') +
    doubleKeys.map((k) => (labels.bonds[k] === 'Z' || labels.bonds[k] === 'z' ? '1' : '0')).join('');
  const smallest = (members: Member[]) => members.reduce((best, m) => (signature(m) < signature(best) ? m : best));
  const reps = new Map(
    [...classes].map(([inchi, members]) => [inchi, smallest(agreeing.get(inchi)!.length > 0 ? agreeing.get(inchi)! : members)]),
  );

  const mirrors = new Map([...reps].map(([inchi, rep]) => [inchi, read(mirrored(rep.combination), false).inchi]));
  const matching = new Set([...agreeing].filter(([, members]) => members.length > 0).map(([inchi]) => inchi));
  if (drawing.racemic) for (const inchi of [...matching]) matching.add(mirrors.get(inchi)!);
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
  const number = new Map(order.map((inchi, i) => [inchi, i + 1]));
  const judged = !notes.includes('axial-planar');

  const stereoisomers = order.map((inchi): Stereoisomer => {
    const rep = reps.get(inchi)!;
    const labels = read(rep.combination, true).labels;
    const relation: Relation = chiral.has(inchi)
      ? { kind: 'enantiomer', of: number.get(mirrors.get(inchi)!)! }
      : !judged
        ? { kind: 'unjudged' }
        : { kind: chiral.size > 0 ? 'meso' : 'achiral' };
    return {
      number: number.get(inchi)!,
      inchikey: key(inchi),
      labels,
      relation,
      matches: matching.has(inchi),
      molfile: drawnLike(reader, molfile, drawing, rep.combination, inchi),
    };
  });
  return { outcome: 'listed', elements: count, notes, stereoisomers };
}

/** The V2000 Molfile's bond lines: [first atom, second atom, stereo], 0-based atoms. */ // chem-literal-ok: format name
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

/** A Molfile of one stereoisomer, drawn like the drawing: its coordinates, with the
 * student's wedges and hashes at each centre the drawing defines, kept where this
 * stereoisomer has the drawing's setting and all swapped (wedge for hash) where it has the
 * other (decision 3); else its coordinates with RDKit's wedges. Where the coordinates show a
 * double bond the other way, neither reads back, and the molecule is laid out afresh. Each
 * route must read back as the stereoisomer, or the next is taken; null when none does. */
function drawnLike(reader: Reader, molfile: string, drawing: Drawing, combination: Combination, inchi: string): string | null {
  const text = withCombination(drawing, combination, true);
  const flagged = (m: string) => (drawing.centres.length > 0 ? withChiralFlag(m) : m);
  const readsBack = (m: string) => reader.inchiOf(m) === inchi;
  const rdkitDrawn = reader.with(text, (mol) => mol.get_molblock());
  const student = withStudentWedges(molfile, rdkitDrawn, drawing, combination);
  for (const candidate of [student, rdkitDrawn]) {
    if (candidate !== null && readsBack(flagged(candidate))) return flagged(candidate);
  }
  const fresh = reader.with(text, (mol) => {
    mol.set_new_coords();
    return mol.get_molblock();
  });
  return readsBack(flagged(fresh)) ? flagged(fresh) : null;
}

/** RDKit's Molfile of a stereoisomer, with RDKit's wedges taken off each centre the student
 * wedged, and the student's wedges and hashes there instead: as drawn where this
 * stereoisomer's setting is the drawing's, every one swapped where it is the other. */
function withStudentWedges(drawn: string, rdkitDrawn: string, drawing: Drawing, combination: Combination): string | null {
  const student = bondLines(drawn);
  const ours = bondLines(rdkitDrawn);
  if (!student || !ours || student.bonds.length !== ours.bonds.length) return null;
  const spinOf = new Map(drawing.centres.map((atom, i) => [atom, combination.spins[i]]));
  const marked = student.bonds.flatMap(([first, second, stereo], index) =>
    (stereo === 1 || stereo === 6) && drawing.spins.has(first) ? [{ index, first, second, stereo }] : [],
  );
  if (marked.length === 0) return null;
  const centres = new Set(marked.map((m) => m.first));
  const lines = [...ours.lines];
  const write = (index: number, first: number, second: number, stereo: number) => {
    const old = lines[ours.start + index];
    const pad = (n: number) => String(n).padStart(3, ' ');
    lines[ours.start + index] = `${pad(first + 1)}${pad(second + 1)}${old.slice(6, 9)}${pad(stereo)}${old.slice(12)}`;
  };
  // First RDKit's wedges off those centres, then the student's on.
  ours.bonds.forEach(([a, b, s], i) => {
    if (centres.has(a) && (s === 1 || s === 6)) write(i, a, b, 0);
  });
  for (const { index, first, second, stereo } of marked) {
    const same = spinOf.get(first) === drawing.spins.get(first);
    write(index, first, second, same ? stereo : 7 - stereo);
  }
  return lines.join('\n');
}
