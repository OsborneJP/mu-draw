import { prepareStructToRender, type Ketcher, type Struct } from 'ketcher-core';
import { KETCHER_ROOT_NODE_CSS_SELECTOR } from 'ketcher-react';

// Name to structure's Add puts the compound in the student's hand: it follows the mouse over
// the canvas until a click puts it down there. This is Ketcher's own paste tool, the one its
// "Add to canvas" uses, so the click is one change and one Undo. Ketcher says nothing when
// its paste tool is done, so the tool armed here is watched: its click puts the compound
// down; its cancel, when another tool takes over (a toolbar tool), puts it away.

/** Ketcher's paste tool (ketcher-react), as far as this file uses it. */
interface PasteTool {
  mouseup(event: MouseEvent): void;
  cancel(): void;
}

interface Tools {
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

/** Puts `molfile` in the student's hand. `dropping` runs the click that puts it down: the
 * drawing's change event fires inside it, so the caller can tell that change is its own. */
export async function placeInHand(
  ketcher: Ketcher,
  molfile: string,
  dropping: (drop: () => void) => void,
): Promise<Placement> {
  // The parse addFragment uses (stereo and the chiral flag read the same way), then scaled
  // to the canvas's bond length.
  const struct = await prepareStructToRender(molfile, ketcher.structService, ketcher);
  struct.rescale();
  const editor = ketcher.editor as unknown as Tools;
  const tool = editor.tool('paste', struct);
  if (!tool) throw new Error('Ketcher did not arm its paste tool');
  // Ketcher shows it at once where the mouse last was on the canvas; the mouse is on the Add
  // button. Shown only once the mouse is over the canvas, the drawing is never more than
  // what is on it while the student is elsewhere (Export, Copy image, the next autosave).
  tool.cancel();

  let settle: (placed: boolean) => void = () => {};
  const done = new Promise<boolean>((resolve) => (settle = resolve));
  let settled = false;
  const finish = (placed: boolean) => {
    if (settled) return;
    settled = true;
    document.removeEventListener('keydown', onKeyDown, true);
    settle(placed);
  };

  const mouseup = tool.mouseup.bind(tool);
  tool.mouseup = (event) => {
    let changed = false;
    const notice = () => (changed = true);
    ketcher.changeEvent.add(notice);
    try {
      dropping(() => mouseup(event));
    } finally {
      ketcher.changeEvent.remove(notice);
    }
    if (!changed) return;
    finish(true);
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
