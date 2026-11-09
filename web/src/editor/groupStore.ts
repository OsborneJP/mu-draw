// Groups on the canvas (docs/plans/v2-grouping.md), connected to Ketcher. The rules are in
// groups.ts; this reads Ketcher's drawing and selection into them and writes back:
// - When the student selects part of a group (a press with the select tool), the selection is
//   widened to the whole group in Ketcher's selectionChange event, before the drag begins, so
//   one drag moves it all (measured: Ketcher's drag takes the widened selection).
// - On every change the groups are saved beside the autosaved drawing, by where their items
//   are. A group keeps members that have gone, for Undo (groups.ts).
// - Many of Ketcher's actions put a new struct object in place of the drawing: Open, Clear
//   Canvas and setMolecule (Name to structure's Replace, Practice), but also Aromatize, Clean
//   Up, Layout, Calculate CIP, explicit H and Settings. Undo and Redo put the earlier object
//   back. So each struct keeps the groups it had, for Undo and Redo, and a new one gets the
//   groups of the last whose items it still has where they were (groups.ts carried()).
// - A double-click on an atom or bond of a group edits that one only: Ketcher's double-click
//   edits every selected atom or bond, and the press before it selected the group.
// - The Group / Ungroup button sits beside Ketcher's own floating tools (flip, delete) when they
//   show, which they do over a selection; groupButton.css anchors it there.
import type { Ketcher } from 'ketcher-core';
import { carried, grouped, OBJECT_KINDS, offer, restored, saved, selectionOf, ungrouped, widened, type Canvas, type Drawing, type Group, type ObjectKind, type Point, type Selection } from './groups';

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
  findItem(event: MouseEvent, maps: string[]): { map: string; id: number } | null;
  render: { clientArea: { contains(node: Node): boolean; clientWidth: number; clientHeight: number } };
  rotateController?: { rerender(): void };
  event: {
    selectionChange: { add(handler: (value: unknown) => unknown): void };
    updateFloatingTools: { add(handler: (payload: { visible?: boolean; rotateHandlePosition?: Point }) => void): void };
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
  /** Ketcher's floating tools show on the canvas (the button sits beside them). */
  anchored: boolean;
}

let state: GroupState = { offer: null, anchored: false };
let toolsShown = false; // Ketcher's floating tools are drawn (over a selection)
let handle: Point | null = null; // where Ketcher's rotate handle is, on the canvas
const listeners = new Set<() => void>();
let groups: Group[] = [];
let editor: Editor | null = null;
let drawing: Struct | null = null; // the struct the groups are of
let others = new WeakMap<Struct, Group[]>(); // earlier structs' groups, for Undo and Redo
let quiet = false; // setting a selection that must not be widened
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

function drawingOf(struct: Struct): Drawing {
  return { canvas: canvasOf(struct), where: whereIn(struct) };
}

function selectionChanged(): void {
  if (!editor) return;
  const selection = editor.selection() ?? {};
  const canvas = canvasOf(editor.struct());
  const wide = quiet ? null : widened(groups, selection, canvas);
  // Setting it fires this event again, with nothing left to widen.
  if (wide) editor.selection(wide);
  else set({ offer: offer(groups, selection, canvas) });
}

function drawingChanged(): void {
  if (!editor) return;
  const struct = editor.struct();
  if (struct !== drawing) {
    if (drawing) others.set(drawing, groups);
    groups = others.get(struct) ?? (drawing ? carried(groups, drawingOf(drawing), drawingOf(struct)) : []);
    drawing = struct;
  }
  persist(groups, struct);
  set({ offer: offer(groups, editor.selection() ?? {}, canvasOf(struct)) });
}

/** Ketcher's floating tools are 108 × 36 px, centred 40 px above its rotate handle (measured);
 * the button takes up to 96 px beside them. Ketcher draws them above the selection, so off
 * the canvas when the selection reaches its top or an edge: then the button stays in its own
 * place on the canvas, where it can be clicked. */
function toolsOnCanvas(): boolean {
  if (!editor || !handle) return false;
  const { clientWidth, clientHeight } = editor.render.clientArea;
  return handle.x - 54 >= 0 && handle.x + 54 + 96 <= clientWidth && handle.y - 58 >= 0 && handle.y - 22 <= clientHeight;
}

/** A double-click on an atom or bond of a group: select only it first (see the top). */
function editOne(event: Event): void {
  const target = event.target as Node | null;
  if (!editor || !target || !editor.render.clientArea.contains(target)) return;
  const item = editor.findItem(event as MouseEvent, ['atoms', 'bonds']);
  if (!item || (item.map !== 'atoms' && item.map !== 'bonds')) return;
  // Only a selection the select tool's press made holds the item; a drawing tool's press
  // clears the selection, and a selection left behind would take that tool's next pick.
  const current = editor.selection() as Partial<Record<string, number[]>> | null;
  if (!current?.[item.map]?.includes(item.id)) return;
  const one = { [item.map]: [item.id] };
  if (!widened(groups, one, canvasOf(editor.struct()))) return; // not in a group
  quiet = true;
  try {
    editor.selection(one);
  } finally {
    quiet = false;
  }
  // Ketcher drew its rotate frame and floating tools round the group at the press; redrawn
  // for the one item, they go, so no handle is left to turn that item on its own.
  editor.rotateController?.rerender();
}

/** Restore the saved groups onto the restored drawing, then keep them: call once the
 * autosave has put the drawing back. `storage` is a getter, as for the autosave; `events` is
 * where double-clicks are heard first (the window, capturing). */
export function startGroups(ketcher: Ketcher, storage: () => Storage, key: string, events: EventTarget): void {
  editor = ketcher.editor as unknown as Editor;
  drawing = editor.struct();
  others = new WeakMap();
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
    if (payload.visible !== undefined) toolsShown = payload.visible;
    if (payload.rotateHandlePosition) handle = { x: payload.rotateHandlePosition.x, y: payload.rotateHandlePosition.y };
    set({ anchored: toolsShown && toolsOnCanvas() });
  });
  ketcher.changeEvent.add(drawingChanged);
  events.addEventListener('dblclick', editOne, true);
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
  // Ketcher redraws its rotate frame (and floating tools) only for its own selections.
  editor.rotateController?.rerender();
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
