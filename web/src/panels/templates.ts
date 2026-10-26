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
 * placed it; false if it was put away (Esc, another tool, Add, a later pick), if a later pick
 * came while its KET was being made, or if it could not be made or Ketcher could not take it. */
export async function pick(
  ketcher: Ketcher,
  item: Pickable,
  structure: () => Promise<string>,
  place: Placer,
): Promise<boolean> {
  const mine = ++latest;
  putAwayTemplate();
  let placement: Placement;
  try {
    const ket = await structure();
    // A later pick came meanwhile: arming Ketcher's paste tool now would put that one away.
    if (mine !== latest) return false;
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
