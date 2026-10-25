// A picture of each stereoisomer (docs/plans/v2-stereoisomers.md, bar B.2-B.3), made in the
// RDKit worker: RDKit's SVG of exactly the stereoisomer's Molfile, with its stereo atoms
// lightly highlighted, and where to put each R/S and E/Z label.
// - The Molfile's own wedges, the student's: without useMolBlockWedging RDKit wedges a bond
//   of its own choosing (measured: it hashed a different bond of (R)-2-butanol).
// - RDKit draws text as glyph outlines, and has no option that labels atoms for a test to
//   read, so the labels are the app's own text, placed beside their atoms (a bond's beside
//   its middle): in the first spot round the atom that covers no atom symbol, no bond and no
//   other label, read from the SVG's own shapes; where there is none, the first that covers
//   no symbol or label (stereoisomers.test.ts checks every test drawing).
import type { MainModule } from '@rdkit/rdkit';
import type { Enumeration, Labels, Stereoisomer } from './stereoisomers';

export const PICTURE = { width: 220, height: 170 } as const;

/** The canvas's highlight for a defined stereo element (DEFINED_COLOR in
 * src/editor/stereoHighlight.ts; stereoPictures.test.ts keeps them the same). */
export const HIGHLIGHT = '#9ecbff';

export interface PlacedLabel {
  text: string;
  x: number;
  y: number;
  /** The Molfile atom index, or the bond as "a-b" (a < b). */
  atom?: number;
  bond?: string;
}

export interface Picture {
  svg: string;
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

const fraction = (hex: string, at: number) => Number.parseInt(hex.slice(at, at + 2), 16) / 255;

export function picture(rdkit: MainModule, molfile: string, labels: Labels): Picture {
  const bondAtoms = Object.keys(labels.bonds).flatMap((k) => k.split('-').map(Number));
  const atoms = [...new Set([...Object.keys(labels.atoms).map(Number), ...bondAtoms])].sort((a, b) => a - b);
  const mol = rdkit.get_mol(molfile, JSON.stringify({ removeHs: false }));
  if (!mol) throw new Error('RDKit could not read a stereoisomer to draw it');
  let svg: string;
  try {
    svg = mol.get_svg_with_highlights(
      JSON.stringify({
        ...PICTURE,
        atoms,
        useMolBlockWedging: true,
        highlightColour: [fraction(HIGHLIGHT, 1), fraction(HIGHLIGHT, 3), fraction(HIGHLIGHT, 5)],
      }),
    );
  } finally {
    mol.delete();
  }
  return { svg, labels: placeLabels(svg, labels) };
}

/** Half the width and height of a label as the panel shows it (stereo.css: 11px bold, one
 * letter, 3px padding, 14px line). */
export const LABEL = { halfWidth: 7, halfHeight: 7 } as const;

interface Point {
  x: number;
  y: number;
}

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

function boxAt({ x, y }: Point): Box {
  return { left: x - LABEL.halfWidth, top: y - LABEL.halfHeight, right: x + LABEL.halfWidth, bottom: y + LABEL.halfHeight };
}

function points(d: string): Point[] {
  const numbers = (d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
  return Array.from({ length: Math.floor(numbers.length / 2) }, (_, i) => ({ x: numbers[2 * i], y: numbers[2 * i + 1] }));
}

/** What a label must not cover, read from RDKit's SVG: each atom symbol's outline (a path of
 * class "atom-N"), as a box, and each bond's lines (paths of class "bond-N atom-a atom-b"). */
export function obstacles(svg: string): { symbols: Box[]; bonds: [Point, Point][] } {
  const symbols: Box[] = [];
  const bonds: [Point, Point][] = [];
  for (const match of svg.matchAll(/<path class='([^']*)' d='([^']*)'/g)) {
    const corners = points(match[2]);
    if (/^atom-\d+$/.test(match[1])) {
      const xs = corners.map((c) => c.x);
      const ys = corners.map((c) => c.y);
      symbols.push({ left: Math.min(...xs), top: Math.min(...ys), right: Math.max(...xs), bottom: Math.max(...ys) });
    } else if (match[1].startsWith('bond-')) {
      for (let i = 1; i < corners.length; i++) bonds.push([corners[i - 1], corners[i]]);
    }
  }
  return { symbols, bonds };
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

// The order to try spots round a point, in sixteenths of a turn from the first direction.
const ROUND = [0, 2, -2, 4, -4, 6, -6, 8, 1, -1, 3, -3, 5, -5, 7, -7];
const EITHER_SIDE = [0, 8, 1, 7, -1, -7, 2, 6, -2, -6, 3, 5, -3, -5, 4, -4];

/** Where to try a label around a point, nearest first. */
function around(at: Point, distances: number[], first: number, turns: number[]): Point[] {
  return distances.flatMap((d) =>
    turns.map((t) => ({ x: at.x + d * Math.cos(first + (t * Math.PI) / 8), y: at.y + d * Math.sin(first + (t * Math.PI) / 8) })),
  );
}

/** Where each label goes over an RDKit SVG drawn with its stereo atoms highlighted. */
export function placeLabels(svg: string, labels: Labels): PlacedLabel[] {
  const atoms = new Map<number, Point & { r: number }>();
  for (const match of svg.matchAll(/<ellipse cx='([-\d.]+)' cy='([-\d.]+)' rx='([-\d.]+)'[^>]*class='atom-(\d+)'/g)) {
    atoms.set(Number(match[4]), { x: Number(match[1]), y: Number(match[2]), r: Number(match[3]) });
  }
  const { symbols, bonds } = obstacles(svg);
  const taken: Box[] = [];
  const inside = (b: Box) => b.left >= 0 && b.top >= 0 && b.right <= PICTURE.width && b.bottom <= PICTURE.height;
  const noSymbol = (b: Box) => !symbols.some((s) => overlaps(b, s));
  const noLabel = (b: Box) => !taken.some((t) => overlaps(b, t));
  const noBond = (b: Box) => !bonds.some((line) => crosses(b, line));
  // The first spot inside the picture that covers nothing; failing that, no symbol or label;
  // then no symbol; then any spot inside.
  const tiers = [[noSymbol, noLabel, noBond], [noSymbol, noLabel], [noSymbol], []];
  const place = (spots: Point[]) => {
    const fits = (rules: ((b: Box) => boolean)[]) => spots.find((p) => inside(boxAt(p)) && rules.every((rule) => rule(boxAt(p))));
    const spot = tiers.reduce<Point | undefined>((found, rules) => found ?? fits(rules), undefined) ?? spots[0];
    taken.push(boxAt(spot));
    return spot;
  };

  const placed: PlacedLabel[] = [];
  for (const [atom, text] of Object.entries(labels.atoms)) {
    const at = atoms.get(Number(atom));
    if (!at) continue;
    // Up and to the right first, then round; never nearer than a label's half diagonal, so
    // it never covers its own atom, however small RDKit draws a big molecule.
    const near = Math.max(at.r + 3, Math.hypot(LABEL.halfWidth, LABEL.halfHeight) + 1);
    placed.push({ text, ...place(around(at, [near, near + 6, near + 12], -Math.PI / 4, ROUND)), atom: Number(atom) });
  }
  for (const [bond, text] of Object.entries(labels.bonds)) {
    const [a, b] = bond.split('-').map((i) => atoms.get(Number(i)));
    if (!a || !b) continue;
    const middle = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    // Square to the bond first, on either side.
    const square = Math.atan2(b.y - a.y, b.x - a.x) - Math.PI / 2;
    placed.push({ text, ...place(around(middle, [11, 16], square, EITHER_SIDE)), bond });
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
