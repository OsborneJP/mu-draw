// Conformation and projection templates (docs/plans/v2-templates.md). The student picks one
// from the Templates menu and it is in their hand, as with Name to structure's Add: it follows
// the mouse over the canvas until a click places it (src/editor/placeInHand.ts). The drawings
// are made by server/scripts/gen_templates.py from PubChem and RDKit (templates.json).
// The menu's lab glassware (glassware.ts) goes into the same hand through pick().
import type { Ketcher } from 'ketcher-core';
import type { Placement } from '../editor/placeInHand';
import generated from '../editor/templates.json';

export interface Template {
  id: string;
  group: string;
  name: string;
  /** Ketcher's KET drawing: atoms and bonds, and for a Newman projection shapes and text. */
  ket: object;
}

export const TEMPLATES: readonly Template[] = generated.templates;

/** The menu's groups, in the order the generator lists them. */
export const GROUPS: readonly string[] = [...new Set(TEMPLATES.map((t) => t.group))];

/** Puts a structure (KET) in the student's hand: src/editor/placeInHand.ts, a stand-in in
 * tests. */
export type Placer = (
  ketcher: Ketcher,
  structure: string,
  dropping: (drop: () => void) => void,
) => Promise<Placement>;

/** Anything the Templates menu puts in the student's hand: a template or a piece of glassware. */
export interface Pickable {
  id: string;
  name: string;
}

/** Calls `listener` when Esc is pressed anywhere in the page; returns what stops it. */
export type EscWatch = (listener: () => void) => () => void;

function watchEsc(listener: () => void): () => void {
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') listener();
  };
  document.addEventListener('keydown', onKeyDown, true);
  return () => document.removeEventListener('keydown', onKeyDown, true);
}

/** Ketcher's tool now: a new object whenever the student (or Add) picks a tool. */
function currentTool(ketcher: Ketcher): unknown {
  return (ketcher.editor as unknown as { tool(): unknown }).tool();
}

let held: { item: Pickable; placement: Placement } | null = null;
let latest = 0; // each pick's number: an earlier pick that arrives late is put away
const listeners = new Set<() => void>();

function notify(): void {
  listeners.forEach((listener) => listener());
}

/** What the student holds from the menu (a template or a piece of glassware), if anything. */
export function heldTemplate(): Pickable | null {
  return held?.item ?? null;
}

export function subscribeTemplates(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Put what is in hand away, unplaced. */
export function putAwayTemplate(): void {
  const was = held;
  held = null;
  was?.placement.cancel();
  if (was) notify();
}

/** Puts `template` in the student's hand. True once a click has placed it; false if it was
 * put away (Esc, another tool, Add, a later pick) or Ketcher could not take it. */
export function pickTemplate(ketcher: Ketcher, template: Template, place: Placer): Promise<boolean> {
  return pick(ketcher, template, async () => JSON.stringify(template.ket), place);
}

/** Puts `item` in the student's hand once `structure` has made its KET. True once a click has
 * placed it; false if it was put away (Esc, another tool, Add, a later pick), if the student
 * moved on while its KET was being made, or if it could not be made or Ketcher could not
 * take it. */
export async function pick(
  ketcher: Ketcher,
  item: Pickable,
  structure: () => Promise<string>,
  place: Placer,
  escapes: EscWatch = watchEsc,
): Promise<boolean> {
  const mine = ++latest;
  putAwayTemplate();
  // While its KET is being made (a glassware file loading), the item isn't in hand yet, but the
  // student may move on: a later pick, Esc, another tool, or Add (which arms Ketcher's paste
  // tool). Arming the paste tool after that would take over from what they chose.
  const tool = currentTool(ketcher);
  let escaped = false;
  const stopWatching = escapes(() => (escaped = true));
  let placement: Placement;
  try {
    let ket: string;
    try {
      ket = await structure();
    } finally {
      stopWatching();
    }
    if (mine !== latest || escaped || currentTool(ketcher) !== tool) return false;
    placement = await place(ketcher, ket, (drop) => drop());
  } catch (error) {
    console.error(`Could not pick up ${item.name}:`, error);
    return false;
  }
  if (mine !== latest) {
    placement.cancel();
    return false;
  }
  held = { item, placement };
  notify();
  const placed = await placement.done;
  if (held?.placement === placement) {
    held = null;
    notify();
  }
  return placed;
}
