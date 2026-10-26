// The tautomer and resonance panels' answers with their pictures (docs/plans/v2-tautomers-
// resonance.md, "What a student sees"), made in the panels' RDKit worker: RDKit's SVG of
// exactly the Molfile Add places, in the drawing's layout, with what differs from the drawing
// highlighted. The Molfile is read without aromaticity, so each picture keeps the Kekulé
// bonds it was given: a resonance structure's are the point of it.
import type { MainModule } from '@rdkit/rdkit';
import { listResonance, type ResonanceList, type ResonanceStructure } from './resonance';
import { PICTURE } from './stereoPictures';
import { listTautomers, type Tautomer, type TautomerList } from './tautomers';

/** What differs from the drawing, in RDKit's highlight: a soft amber (#FFCC66; each part a whole 255th, so RDKit writes it exactly). */
export const HIGHLIGHT = [1, 0.8, 0.4] as const;

export type FormsKind = 'tautomers' | 'resonance';

type Pictured<T> = T & { svg: string };

export type TautomerResult =
  | Exclude<TautomerList, { outcome: 'listed' }>
  | (Omit<Extract<TautomerList, { outcome: 'listed' }>, 'tautomers'> & { tautomers: Pictured<Tautomer>[] });

export type ResonanceResult =
  | Exclude<ResonanceList, { outcome: 'listed' }>
  | (Omit<Extract<ResonanceList, { outcome: 'listed' }>, 'structures'> & { structures: Pictured<ResonanceStructure>[] });

/** The worker's job: {kind, id, molfile} in, {kind, id, result} out. */
export interface FormsRequest {
  kind: FormsKind;
  id: number;
  molfile: string;
}

export type FormsReply =
  | { kind: 'tautomers'; id: number; result: TautomerResult | null }
  | { kind: 'resonance'; id: number; result: ResonanceResult | null }
  | { kind: FormsKind; id: number; error: string };

/** RDKit's picture of a Molfile, its bonds as written, the given atoms and bonds highlighted. */
export function picture(rdkit: MainModule, molfile: string, atoms: number[], bonds: number[]): string {
  const mol = rdkit.get_mol(molfile, JSON.stringify({ removeHs: false, kekulize: false, setAromaticity: false }));
  if (!mol) throw new Error('RDKit could not read a structure to draw it');
  try {
    return mol.get_svg_with_highlights(
      JSON.stringify({ ...PICTURE, useMolBlockWedging: true, atoms, bonds, highlightColour: HIGHLIGHT }),
    );
  } finally {
    mol.delete();
  }
}

/** The worker's answer to a request. */
export function answer(rdkit: MainModule, { kind, id, molfile }: FormsRequest): FormsReply {
  if (kind === 'tautomers') {
    const list = listTautomers(rdkit, molfile);
    if (list === null || list.outcome !== 'listed') return { kind, id, result: list };
    const tautomers = list.tautomers.map((t) => ({ ...t, svg: picture(rdkit, t.molfile, t.changedAtoms, t.changedBonds) }));
    return { kind, id, result: { ...list, tautomers } };
  }
  const list = listResonance(rdkit, molfile);
  if (list === null || list.outcome !== 'listed') return { kind, id, result: list };
  const structures = list.structures.map((s) => ({ ...s, svg: picture(rdkit, s.molfile, s.changedAtoms, s.changedBonds) }));
  return { kind, id, result: { ...list, structures } };
}
