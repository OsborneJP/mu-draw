// A picture of each stereoisomer (docs/plans/v2-stereoisomers.md, bar B.2-B.3), made in the
// RDKit worker: RDKit's SVG of exactly the stereoisomer's Molfile, with its stereo atoms
// lightly highlighted, and where to put each R/S and E/Z label.
// - The Molfile's own wedges, the student's: without useMolBlockWedging RDKit wedges a bond
//   of its own choosing (measured: it hashed a different bond of (R)-2-butanol).
// - RDKit draws text as glyph outlines, and has no option that labels atoms for a test to
//   read, so the labels are the app's own text: each placed at the centre of its atom's
//   highlight ellipse in the SVG (a bond's at the middle of its two atoms').
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

export type Pictured = Stereoisomer & { picture: Picture };

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
  const centres = new Map<number, { x: number; y: number }>();
  for (const match of svg.matchAll(/<ellipse cx='([-\d.]+)' cy='([-\d.]+)'[^>]*class='atom-(\d+)'/g)) {
    centres.set(Number(match[3]), { x: Number(match[1]), y: Number(match[2]) });
  }
  const placed: PlacedLabel[] = [];
  for (const [atom, text] of Object.entries(labels.atoms)) {
    const at = centres.get(Number(atom));
    if (at) placed.push({ text, ...at, atom: Number(atom) });
  }
  for (const [bond, text] of Object.entries(labels.bonds)) {
    const [a, b] = bond.split('-').map((i) => centres.get(Number(i)));
    if (a && b) placed.push({ text, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, bond });
  }
  return { svg, labels: placed };
}

/** The enumeration, with a picture of each listed stereoisomer. */
export function withPictures(rdkit: MainModule, enumeration: Enumeration): StereoResult {
  if (enumeration.outcome !== 'listed') return enumeration;
  return {
    ...enumeration,
    stereoisomers: enumeration.stereoisomers.map((s) => ({ ...s, picture: picture(rdkit, s.molfile, s.labels) })),
  };
}
