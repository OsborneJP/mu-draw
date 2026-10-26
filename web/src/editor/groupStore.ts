// Groups on the canvas (docs/plans/v2-grouping.md), connected to Ketcher. The rules are in
// groups.ts; this reads Ketcher's drawing and selection into them and writes back:
// - When the student selects part of a group (a press with the select tool), the selection is
//   widened to the whole group in Ketcher's selectionChange event, before the drag begins, so
//   one drag moves it all (measured: Ketcher's drag takes the widened selection).
// - On every change the groups are saved beside the autosaved drawing, by where their items
//   are. A group keeps members that have gone, for Undo (groups.ts). A drawing loaded afresh
//   (Open, Name to structure's Replace) is a new Ketcher struct: its groups start empty.
// - The Group / Ungroup button sits beside Ketcher's own floating tools (flip, delete) when they
//   show, which they do over a selection; groupButton.css anchors it there.
import type { Ketcher } from 'ketcher-core';
import { grouped, OBJECT_KINDS, offer, restored, saved, selectionOf, ungrouped, widened, type Canvas, type Group, type ObjectKind, type Point, type Selection } from './groups';

export function groupsKey(base: string): string {
  return `groups:${base}`;
}

type Pool<T> = Map<number, T>;

/** The parts of Ketcher's struct the groups read. */
interface Struct {
  atoms: Pool<{ pp: Point }>;
  bonds: Pool<{ begin: number; end: number }>;
  texts: Pool<{ position?: Point }>;
  rxnArrows: Pool<{ pos?: Point[] }>;
  rxnPluses: Pool<{ pp?: Point }>;
  simpleObjects: Pool<{ pos?: Point[] }>;
  images: Pool<{ center(): Point }>;
  multitailArrows: Pool<{ getReferencePositions?(): { head?: Point } }>;
}

interface Editor {
  struct(): Struct;
  selection(selection?: Selection | null): Selection | null;
  event: {
    selectionChange: { add(handler: (value: unknown) => unknown): void };
    updateFloatingTools: { add(handler: (payload: { visible?: boolean }) => void): void };
  };
}

function canvasOf(struct: Struct): Canvas {
  return {
    atoms: [...struct.atoms.keys()],
    bonds: [...struct.bonds].map(([id, b]) => ({ id, begin: b.begin, end: b.end })),
    objects: Object.fromEntries(OBJECT_KINDS.map((k) => [k, [...(struct[k]?.keys() ?? [])]])) as Canvas['objects'],
  };
}

/** Where an item is, to find it again after a relaunch: an atom's position, a text's, an
 * arrow's or shape's first point, a + sign's, an image's centre (Ketcher's center() method),
 * a multi-tail arrow's head. */
function whereIn(struct: Struct): (kind: 'atoms' | ObjectKind, id: number) => Point | null {
  return (kind, id) => {
    const point = (p: Point | undefined | null) => (p ? { x: p.x, y: p.y } : null);
    switch (kind) {
      case 'atoms':
        return point(struct.atoms.get(id)?.pp);
      case 'texts':
        return point(struct.texts.get(id)?.position);
      case 'rxnArrows':
        return point(struct.rxnArrows.get(id)?.pos?.[0]);
      case 'simpleObjects':
        return point(struct.simpleObjects.get(id)?.pos?.[0]);
      case 'rxnPluses':
        return point(struct.rxnPluses.get(id)?.pp);
      case 'images':
        return point(struct.images.get(id)?.center());
      case 'multitailArrows':
        return point(struct.multitailArrows.get(id)?.getReferencePositions?.().head);
    }
  };
}

export interface GroupState {
  /** What the button offers for the selection now, if anything. */
  offer: 'group' | 'ungroup' | null;
  /** Ketcher's floating tools show (the button sits beside them). */
  anchored: boolean;
}

let state: GroupState = { offer: null, anchored: false };
const listeners = new Set<() => void>();
let groups: Group[] = [];
let editor: Editor | null = null;
let drawing: Struct | null = null; // the struct the groups are of
let persist: (groups: Group[], struct: Struct) => void = () => {};

function set(next: Partial<GroupState>): void {
  const merged = { ...state, ...next };
  if (merged.offer === state.offer && merged.anchored === state.anchored) return;
  state = merged;
  listeners.forEach((listener) => listener());
}

export function getGroupState(): GroupState {
  return state;
}

export function subscribeGroups(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function selectionChanged(): void {
  if (!editor) return;
  const selection = editor.selection() ?? {};
  const canvas = canvasOf(editor.struct());
  const wide = widened(groups, selection, canvas);
  // Setting it fires this event again, with nothing left to widen.
  if (wide) editor.selection(wide);
  else set({ offer: offer(groups, selection, canvas) });
}

function drawingChanged(): void {
  if (!editor) return;
  const struct = editor.struct();
  if (struct !== drawing) groups = [];
  drawing = struct;
  persist(groups, struct);
  set({ offer: offer(groups, editor.selection() ?? {}, canvasOf(struct)) });
}

/** Restore the saved groups onto the restored drawing, then keep them: call once the
 * autosave has put the drawing back. `storage` is a getter, as for the autosave. */
export function startGroups(ketcher: Ketcher, storage: () => Storage, key: string): void {
  editor = ketcher.editor as unknown as Editor;
  drawing = editor.struct();
  persist = (current, struct) => {
    try {
      // Nothing is kept while there are no groups (Practice, for one, stores nothing).
      const kept = saved(current, canvasOf(struct), whereIn(struct));
      if (kept.groups.length > 0) storage().setItem(key, JSON.stringify(kept));
      else storage().removeItem(key);
    } catch {
      // Storage off or full: the groups last until the page closes. The drawing's own
      // autosave reports storage trouble in the header.
    }
  };
  try {
    const kept = storage().getItem(key);
    groups = kept ? restored(JSON.parse(kept), canvasOf(drawing), whereIn(drawing)) : [];
  } catch {
    groups = [];
  }
  // A pipeline event: each handler must hand on what it was given.
  editor.event.selectionChange.add((value) => {
    selectionChanged();
    return value;
  });
  editor.event.updateFloatingTools.add((payload) => {
    if (payload.visible !== undefined) set({ anchored: payload.visible });
  });
  ketcher.changeEvent.add(drawingChanged);
  // Ketcher puts back the selection saved with the drawing: widen it, and offer the button.
  selectionChanged();
}

/** The button's Group: the selection becomes one group, and stays selected. */
export function groupSelection(): void {
  if (!editor) return;
  const canvas = canvasOf(editor.struct());
  const next = grouped(groups, editor.selection() ?? {}, canvas);
  if (next === groups) return;
  groups = next;
  persist(groups, editor.struct());
  editor.selection(selectionOf(groups[groups.length - 1], canvas));
}

/** The button's Ungroup: every group the selection touches ends; the selection stays. */
export function ungroupSelection(): void {
  if (!editor) return;
  const canvas = canvasOf(editor.struct());
  const selection = editor.selection() ?? {};
  groups = ungrouped(groups, selection, canvas);
  persist(groups, editor.struct());
  set({ offer: offer(groups, selection, canvas) });
}
