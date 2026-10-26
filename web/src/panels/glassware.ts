// Lab glassware (docs/plans/v2-glassware.md). The student picks a piece from the Templates
// menu's Glassware tab and it is in their hand, exactly as a template is (templates.ts): it
// follows the mouse over the canvas until a click places it. On the canvas it is a Ketcher
// image of the piece's SVG, which ships with the app (web/public/glassware/, cut from
// public-domain and CC0 drawings by scripts/build_glassware.py) and is precached, so picking
// works offline.
import type { Ketcher } from 'ketcher-core';
import generated from '../editor/glassware.json';
import { pick, type Placer } from './templates';

export interface Piece {
  id: string;
  name: string;
  group: string;
  /** The SVG, under the app's base path. */
  file: string;
  /** Its placed size, in model units (bond lengths). */
  width: number;
  height: number;
}

export const GLASSWARE: readonly Piece[] = generated.pieces;
export const GLASSWARE_GROUPS: readonly string[] = generated.groups;
/** Who drew the pieces, in plain text (decision 4). */
export const GLASSWARE_CREDIT: string = generated.credit;

export function pieceUrl(piece: Piece): string {
  return `${import.meta.env.BASE_URL}${piece.file}`;
}

/** Ketcher's KET for the piece: one image of its placed size. Where it sits doesn't matter:
 * Ketcher's paste tool centres what is in hand on the mouse. */
export function pieceKet(piece: Piece, svg: Uint8Array): string {
  const image = {
    type: 'image',
    format: 'image/svg+xml',
    boundingBox: { x: 0, y: 0, width: piece.width, height: piece.height },
    data: base64(svg),
  };
  return JSON.stringify({ root: { nodes: [image] } });
}

function base64(bytes: Uint8Array): string {
  let binary = '';
  // In slices: String.fromCharCode takes its arguments on the stack.
  for (let at = 0; at < bytes.length; at += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  }
  return btoa(binary);
}

export type Fetcher = (url: string) => Promise<Response>;

/** The piece's KET, from its SVG file (from the precache when offline). */
export async function loadPiece(piece: Piece, fetcher: Fetcher = (url) => fetch(url)): Promise<string> {
  const response = await fetcher(pieceUrl(piece));
  if (!response.ok) throw new Error(`${piece.file}: HTTP ${response.status}`);
  return pieceKet(piece, new Uint8Array(await response.arrayBuffer()));
}

/** Puts `piece` in the student's hand (see templates.ts's pick). */
export function pickGlassware(
  ketcher: Ketcher,
  piece: Piece,
  place: Placer,
  load: (piece: Piece) => Promise<string> = loadPiece,
): Promise<boolean> {
  return pick(ketcher, piece, () => load(piece), place);
}
