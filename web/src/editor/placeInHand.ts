import { prepareStructToRender, type Ketcher, type Struct } from 'ketcher-core';
import { KETCHER_ROOT_NODE_CSS_SELECTOR } from 'ketcher-react';

// Name to structure's Add, and the Templates menu, put a structure in the student's hand: it
// follows the mouse over the canvas until a click puts it down there. This is Ketcher's own
// paste tool, the one its "Add to canvas" uses, so the click is one change and one Undo.
// Ketcher says nothing when its paste tool is done, so the tool armed here is watched: its
// click puts the compound down; its cancel, when another tool takes over (a toolbar tool),
// puts it away.

/** Ketcher's paste tool (ketcher-react), as far as this file uses it. */
interface PasteTool {
  action?: unknown; // the compound as shown under the mouse; none while it is hidden
  mousedown(event: MouseEvent): void;
  mousemove(event: MouseEvent): void;
  mouseup(event: MouseEvent): void;
  cancel(): void;
}

interface Tools {
  render: { clientArea: HTMLElement };
  tool(): unknown;
  tool(name: 'paste', struct: Struct): PasteTool | null;
  tool(name: 'select'): unknown;
}

export interface Placement {
  /** True once a click has put it down; false if it was put away unplaced. */
  done: Promise<boolean>;
  /** Put it away unplaced (nothing changes). */
  cancel(): void;
}

/** Puts `structure` (a Molfile, or KET with shapes and text) in the student's hand.
 * `dropping` runs the click that puts it down: the drawing's change event fires inside it, so
 * the caller can tell that change is its own. */
export async function placeInHand(
  ketcher: Ketcher,
  structure: string,
  dropping: (drop: () => void) => void,
): Promise<Placement> {
  // The parse addFragment uses (stereo and the chiral flag read the same way), then scaled
  // to the canvas's bond length.
  const struct = await prepareStructToRender(structure, ketcher.structService, ketcher);
  struct.rescale();
  // Ketcher works out a fragment's stereo flag (ABS, AND, OR) when a wedge is drawn or a
  // Molfile's chiral flag is read, but not for KET (the templates): their atoms come in
  // labelled "abs" with no flag, the drawing is then written with chiral flag 0, and the
  // stereoisomer panel reads that as racemic. So the flag is worked out here from the atoms'
  // labels, as Ketcher does for a drawn wedge. (Its addStereoAtom pushes onto a copy of the
  // list and does nothing; updateStereoAtom adds the atom and works the flag out again.)
  struct.frags.forEach((fragment, id) => {
    if (!fragment) return;
    struct.atoms.forEach((atom, aid) => {
      if (atom.fragment === id && atom.stereoLabel) fragment.updateStereoAtom(struct, aid, id, true);
    });
  });
  const editor = ketcher.editor as unknown as Tools;
  const tool = editor.tool('paste', struct);
  if (!tool) throw new Error('Ketcher did not arm its paste tool');
  // Ketcher shows it at once where the mouse last was. Over the canvas, that is where the
  // mouse is now. Anywhere else (the Add button, say) it is hidden until the mouse comes over
  // the canvas, so the drawing is never more than what is on it while the student is
  // elsewhere (Export, Copy image, the next autosave).
  if (!editor.render.clientArea.matches(':hover')) tool.cancel();

  let settle: (placed: boolean) => void = () => {};
  const done = new Promise<boolean>((resolve) => (settle = resolve));
  let settled = false;
  const finish = (placed: boolean) => {
    if (settled) return;
    settled = true;
    document.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('mouseup', released);
    settle(placed);
  };

  // A release is a click only after a press on the canvas with the compound in hand: the
  // release that ends a drag begun before it arrived is not.
  let pressed = false;
  const mousedown = tool.mousedown.bind(tool);
  tool.mousedown = (event) => {
    pressed = true;
    mousedown(event);
  };
  // Any release ends the press, also one off the canvas, which Ketcher doesn't pass on. On
  // the window, so it runs after Ketcher's own listener (on the document) has used it.
  const released = () => (pressed = false);
  window.addEventListener('mouseup', released);

  const mousemove = tool.mousemove.bind(tool);
  const mouseup = tool.mouseup.bind(tool);
  tool.mouseup = (event) => {
    if (!pressed) return;
    pressed = false;
    // Nothing shown yet (a click with no move since it was hidden, a trackpad tap): show it
    // at the click, so the click puts it down there.
    if (!tool.action) mousemove(event);
    let changed = false;
    const notice = () => (changed = true);
    ketcher.changeEvent.add(notice);
    try {
      dropping(() => mouseup(event));
    } finally {
      ketcher.changeEvent.remove(notice);
    }
    if (changed) finish(true);
    else if (editor.tool() !== tool) finish(false); // Ketcher ended its tool, adding nothing
    else return;
    queueMicrotask(backToSelection); // once Ketcher is done with this click
  };

  // Ketcher cancels the old tool before it sets the new one, and also cancels on mouse leave
  // (the compound leaves the canvas but stays in hand). So once the tool switch is over,
  // the compound is put away only if this tool is no longer Ketcher's.
  const cancel = tool.cancel.bind(tool);
  tool.cancel = () => {
    cancel();
    queueMicrotask(() => {
      if (editor.tool() !== tool) finish(false);
    });
  };

  // Esc puts it away wherever the focus is (Ketcher hears keys only inside the editor).
  function onKeyDown(event: KeyboardEvent) {
    if (event.key === 'Escape') putAway();
  }
  document.addEventListener('keydown', onKeyDown, true);

  function putAway() {
    if (settled) return;
    finish(false);
    if (editor.tool() === tool) backToSelection();
  }

  // Ketcher's toolbar follows only its own actions. Its paste tool hands over to the select
  // tool directly, and the toolbar went on showing the tool from before Add (measured: the
  // bond tool, while a click drew nothing). Esc inside the editor is Ketcher's own way back
  // to the selection tool, toolbar included.
  function backToSelection() {
    const root = document.querySelector(KETCHER_ROOT_NODE_CSS_SELECTOR);
    root?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape' }));
    if (editor.tool() === tool) editor.tool('select'); // Ketcher ignored it (a dialog is open)
  }

  return { done, cancel: putAway };
}
