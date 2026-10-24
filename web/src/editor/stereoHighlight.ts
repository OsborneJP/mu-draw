// Highlights the drawing's stereo elements on the canvas, and takes away exactly those
// highlights again. Ketcher keeps one list of highlights, shared with any the student made
// with Ketcher's own Highlight menu, so this never clears the list: creating highlights
// returns the action that deletes those same ones (by id), and removing performs it.
// Neither step enters the undo history or fires a change event, and highlights are not part
// of the drawing that autosave stores.
import { fromHighlightCreate, type Action, type Ketcher } from 'ketcher-core';
import type { StereoAtoms } from '../chem/tracker';

export const DEFINED_COLOR = '#9ecbff';
export const UNDEFINED_COLOR = '#ffc94d';

/** Highlight these stereo elements (Ketcher atom ids): defined ones blue, undefined ones
 * amber. A double bond is highlighted as its bond. Returns what `removeHighlight` needs. */
export function addHighlight(ketcher: Ketcher, elements: StereoAtoms[]): Action {
  const struct = ketcher.editor.struct();
  const group = (defined: boolean, color: string) => {
    const atoms: number[] = [];
    const bonds: number[] = [];
    for (const e of elements.filter((x) => x.defined === defined)) {
      if (e.atoms.length === 1) atoms.push(e.atoms[0]);
      else {
        const bond = struct.findBondId(e.atoms[0], e.atoms[1]);
        if (bond !== null) bonds.push(bond);
      }
    }
    return { atoms, bonds, rgroupAttachmentPoints: [], color };
  };
  const groups = [group(true, DEFINED_COLOR), group(false, UNDEFINED_COLOR)].filter(
    (g) => g.atoms.length > 0 || g.bonds.length > 0,
  );
  const restruct = ketcher.editor.render.ctab;
  const removal = fromHighlightCreate(restruct, groups);
  ketcher.editor.update(removal, true); // redraw only: no history, no change event
  return removal;
}

/** Remove the highlights `addHighlight` made (any already gone are skipped). */
export function removeHighlight(ketcher: Ketcher, removal: Action): void {
  const restruct = ketcher.editor.render.ctab;
  ketcher.editor.update(removal.perform(restruct), true);
}
