// A picture of each stereoisomer (docs/plans/v2-stereoisomers.md, bar B.2-B.3 and round 3),
// made in the RDKit worker: RDKit's SVG of exactly the stereoisomer's Molfile.
// - The Molfile's own wedges, the student's: without useMolBlockWedging RDKit wedges a bond
//   of its own choosing (measured: it hashed a different bond of (R)-2-butanol).
// - R/S is drawn by RDKit in place of its atom (Jeff, round 3): "(R)" at a carbon, and at a
//   heteroatom its symbol with the label after it, smaller (N₍R₎). RDKit stops the bonds short
//   of it as at any atom label, so a label can't be read as another atom's. Placing the app's
//   own text beside atoms took three rounds of fixes and still misled on estradiol.
// - E/Z stays the app's own text, beside the middle of its double bond: in the first spot on
//   either side that covers no atom symbol or label (RDKit's R/S included), no bond and no
//   other E/Z, read from the SVG's own shapes; failing that, no symbol or label. Always
//   nearer its own bond than any other labelled one (stereoisomers.test.ts checks every test
//   drawing).
import type { MainModule } from '@rdkit/rdkit';
import { elementSymbol } from './compute';
import type { Enumeration, Labels, Stereoisomer } from './stereoisomers';

export const PICTURE = { width: 220, height: 170 } as const;

export interface PlacedLabel {
  text: string;
  x: number;
  y: number;
  /** The double bond as "a-b" (a < b), by Molfile atom index. */
  bond: string;
}

export interface Picture {
  svg: string;
  /** What RDKit draws in place of each stereocentre, by Molfile atom index. */
  atomLabels: Record<string, string>;
  /** The E/Z labels, the app's own text over the picture. */
  labels: PlacedLabel[];
}

/** picture: null for a stereoisomer that can't be drawn flat as itself (molfile null). */
export type Pictured = Stereoisomer & { picture: Picture | null };

export type StereoResult =
  | Exclude<Enumeration, { outcome: 'listed' }>
  | (Omit<Extract<Enumeration, { outcome: 'listed' }>, 'stereoisomers'> & { stereoisomers: Pictured[] });

/** The worker's job: {kind: 'stereoisomers', id, molfile} in, {kind, id, result} out. */
export interface StereoRequest {
  kind: 'stereoisomers';
  id: number;
  molfile: string;
}

export type StereoReply =
  | { kind: 'stereoisomers'; id: number; result: StereoResult | null }
  | { kind: 'stereoisomers'; id: number; error: string };

interface JsonAtom {
  z: number;
  impHs: number;
  chg: number;
}

/** What RDKit draws in place of a stereocentre labelled `label`: "(R)" at a carbon; at any
 * other atom, its symbol (with its H and charge, as RDKit would write them) then "(R)",
 * smaller. */
export function atomLabel(rdkit: MainModule, atom: JsonAtom, label: string): string {
  if (atom.z === 6) return `(${label})`;
  const hydrogens = atom.impHs === 0 ? '' : atom.impHs === 1 ? 'H' : `H<sub>${atom.impHs}</sub>`;
  const size = Math.abs(atom.chg);
  const charge = atom.chg === 0 ? '' : `<sup>${size > 1 ? size : ''}${atom.chg > 0 ? '+' : '-'}</sup>`;
  return `${elementSymbol(rdkit, atom.z)}${hydrogens}${charge}<sub>(${label})</sub>`;
}

export function picture(rdkit: MainModule, molfile: string, labels: Labels): Picture {
  const mol = rdkit.get_mol(molfile, JSON.stringify({ removeHs: false }));
  if (!mol) throw new Error('RDKit could not read a stereoisomer to draw it');
  let svg: string;
  const atomLabels: Record<string, string> = {};
  try {
    const json = JSON.parse(mol.get_json()) as { defaults: { atom: JsonAtom }; molecules: { atoms: Partial<JsonAtom>[] }[] };
    for (const [atom, label] of Object.entries(labels.atoms)) {
      atomLabels[atom] = atomLabel(rdkit, { ...json.defaults.atom, ...json.molecules[0].atoms[Number(atom)] }, label);
    }
    svg = mol.get_svg_with_highlights(JSON.stringify({ ...PICTURE, useMolBlockWedging: true, atomLabels }));
  } finally {
    mol.delete();
  }
  return { svg, atomLabels, labels: placeLabels(svg, labels.bonds) };
}

/** Half the width and height of an E/Z label as the panel shows it (stereo.css: 11px bold,
 * one letter, 3px padding, 14px line). */
export const LABEL = { halfWidth: 7, halfHeight: 7 } as const;

export interface Point {
  x: number;
  y: number;
}

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export function boxAt({ x, y }: Point): Box {
  return { left: x - LABEL.halfWidth, top: y - LABEL.halfHeight, right: x + LABEL.halfWidth, bottom: y + LABEL.halfHeight };
}

function points(d: string): Point[] {
  const numbers = (d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
  return Array.from({ length: Math.floor(numbers.length / 2) }, (_, i) => ({ x: numbers[2 * i], y: numbers[2 * i + 1] }));
}

export interface DrawnBond {
  /** "a-b" (a < b), by Molfile atom index. */
  atoms: string;
  line: [Point, Point];
}

/** What an E/Z label must not cover, read from RDKit's SVG: each atom's symbol or label (paths
 * of class "atom-N", R/S included) as a box, and each bond's lines (paths of class "bond-N
 * atom-a atom-b"), with the bond's two atoms. */
export function obstacles(svg: string): { symbols: Box[]; bonds: DrawnBond[] } {
  const symbols: Box[] = [];
  const bonds: DrawnBond[] = [];
  for (const match of svg.matchAll(/<path class='([^']*)' d='([^']*)'/g)) {
    const corners = points(match[2]);
    if (/^atom-\d+$/.test(match[1])) {
      const xs = corners.map((c) => c.x);
      const ys = corners.map((c) => c.y);
      symbols.push({ left: Math.min(...xs), top: Math.min(...ys), right: Math.max(...xs), bottom: Math.max(...ys) });
    } else if (match[1].startsWith('bond-')) {
      const [a, b] = [...match[1].matchAll(/atom-(\d+)/g)].map((m) => Number(m[1]));
      const atoms = a < b ? `${a}-${b}` : `${b}-${a}`;
      for (let i = 1; i < corners.length; i++) bonds.push({ atoms, line: [corners[i - 1], corners[i]] });
    }
  }
  return { symbols, bonds };
}

/** The middle of a bond as drawn: the mean of the ends of its lines. */
export function middleOf(bonds: DrawnBond[], atoms: string): Point | null {
  const ends = bonds.filter((b) => b.atoms === atoms).flatMap((b) => b.line);
  if (ends.length === 0) return null;
  return { x: ends.reduce((sum, p) => sum + p.x, 0) / ends.length, y: ends.reduce((sum, p) => sum + p.y, 0) / ends.length };
}

export function overlaps(a: Box, b: Box): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

/** Whether the line from p to q passes through the box (Liang-Barsky clipping). */
export function crosses(box: Box, [p, q]: [Point, Point]): boolean {
  const dx = q.x - p.x;
  const dy = q.y - p.y;
  let enter = 0;
  let leave = 1;
  for (const [step, room] of [
    [-dx, p.x - box.left],
    [dx, box.right - p.x],
    [-dy, p.y - box.top],
    [dy, box.bottom - p.y],
  ]) {
    if (step === 0) {
      if (room < 0) return false;
      continue;
    }
    const t = room / step;
    if (step < 0) enter = Math.max(enter, t);
    else leave = Math.min(leave, t);
    if (enter > leave) return false;
  }
  return true;
}

// Square to the bond first, on either side; then round, in sixteenths of a turn.
const EITHER_SIDE = [0, 8, 1, 7, -1, -7, 2, 6, -2, -6, 3, 5, -3, -5, 4, -4];

/** Where each E/Z label goes over an RDKit SVG. */
export function placeLabels(svg: string, bondLabels: Record<string, string>): PlacedLabel[] {
  const { symbols, bonds } = obstacles(svg);
  const middles = new Map(Object.keys(bondLabels).map((bond) => [bond, middleOf(bonds, bond)]));
  const taken: Box[] = [];
  const inside = (b: Box) => b.left >= 0 && b.top >= 0 && b.right <= PICTURE.width && b.bottom <= PICTURE.height;
  const distance = (p: Point, q: Point) => Math.hypot(p.x - q.x, p.y - q.y);
  const placed: PlacedLabel[] = [];
  for (const [bond, text] of Object.entries(bondLabels)) {
    const middle = middles.get(bond);
    if (!middle) continue;
    const others = [...middles].flatMap(([key, p]) => (key !== bond && p ? [p] : []));
    const ownNearest = (p: Point) => others.every((o) => distance(p, middle) < distance(p, o));
    const noSymbol = (p: Point) => !symbols.some((s) => overlaps(boxAt(p), s));
    const noLabel = (p: Point) => !taken.some((t) => overlaps(boxAt(p), t));
    const noBond = (p: Point) => !bonds.some((b) => crosses(boxAt(p), b.line));
    const [start, end] = bonds.find((b) => b.atoms === bond)!.line;
    const along = Math.atan2(end.y - start.y, end.x - start.x);
    const spots = [11, 16, 21].flatMap((d) =>
      EITHER_SIDE.map((t) => {
        const angle = along - Math.PI / 2 + (t * Math.PI) / 8;
        return { x: middle.x + d * Math.cos(angle), y: middle.y + d * Math.sin(angle) };
      }),
    );
    const usable = spots.filter((p) => inside(boxAt(p)) && ownNearest(p));
    const spot =
      usable.find((p) => noSymbol(p) && noLabel(p) && noBond(p)) ?? usable.find((p) => noSymbol(p) && noLabel(p)) ?? usable[0] ?? spots[0];
    taken.push(boxAt(spot));
    placed.push({ text, ...spot, bond });
  }
  return placed;
}

/** The enumeration, with a picture of each listed stereoisomer. */
export function withPictures(rdkit: MainModule, enumeration: Enumeration): StereoResult {
  if (enumeration.outcome !== 'listed') return enumeration;
  return {
    ...enumeration,
    stereoisomers: enumeration.stereoisomers.map((s) => ({ ...s, picture: s.molfile === null ? null : picture(rdkit, s.molfile, s.labels) })),
  };
}
