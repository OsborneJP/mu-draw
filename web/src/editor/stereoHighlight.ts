// Highlights on the canvas: the drawing's stereo elements and its functional groups, and
// taking away exactly those highlights again. Ketcher keeps one list of highlights, shared
// with any the student made with Ketcher's own Highlight menu, so this never clears the
// list: creating highlights returns the action that deletes those same ones (by id), and
// removing performs it. Neither step enters the undo history or fires a change event, and
// highlights are not part of the drawing that autosave stores.
import { fromHighlightCreate, type Action, type Ketcher } from 'ketcher-core';
import type { StereoAtoms } from '../chem/tracker';

export const DEFINED_COLOR = '#9ecbff';
export const UNDEFINED_COLOR = '#ffc94d';

/** Atoms and bonds (each bond as its two atoms) in Ketcher atom ids, in one colour. */
export interface Coloured {
  atoms: number[];
  bonds: [number, number][];
  color: string;
}

/** Colour these atoms and bonds; parts with nothing in them are skipped. Returns what
 * `removeHighlight` needs. */
export function addColoured(ketcher: Ketcher, parts: Coloured[]): Action {
  const struct = ketcher.editor.struct();
  const groups = parts
    .map(({ atoms, bonds, color }) => ({
      atoms,
      bonds: bonds.map(([a, b]) => struct.findBondId(a, b)).filter((id): id is number => id !== null),
      rgroupAttachmentPoints: [],
      color,
    }))
    .filter((g) => g.atoms.length > 0 || g.bonds.length > 0);
  const restruct = ketcher.editor.render.ctab;
  const removal = fromHighlightCreate(restruct, groups);
  ketcher.editor.update(removal, true); // redraw only: no history, no change event
  return removal;
}

/** Highlight these stereo elements (Ketcher atom ids): defined ones blue, undefined ones
 * amber. A double bond is highlighted as its bond. Returns what `removeHighlight` needs. */
export function addHighlight(ketcher: Ketcher, elements: StereoAtoms[]): Action {
  const part = (defined: boolean, color: string): Coloured => {
    const chosen = elements.filter((x) => x.defined === defined);
    return {
      atoms: chosen.filter((e) => e.atoms.length === 1).map((e) => e.atoms[0]),
      bonds: chosen.filter((e) => e.atoms.length === 2).map((e) => [e.atoms[0], e.atoms[1]]),
      color,
    };
  };
  return addColoured(ketcher, [part(true, DEFINED_COLOR), part(false, UNDEFINED_COLOR)]);
}

/** Remove the highlights `addHighlight` or `addColoured` made (any already gone are skipped). */
export function removeHighlight(ketcher: Ketcher, removal: Action): void {
  const restruct = ketcher.editor.render.ctab;
  ketcher.editor.update(removal.perform(restruct), true);
}
