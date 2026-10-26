// Groups (docs/plans/v2-grouping.md): items on the canvas the student has grouped, so a click
// on any of them picks up all of them. Pure logic on a plain picture of the canvas, so every
// rule is unit-tested (groups.test.ts); groupStore.ts connects it to Ketcher.
// - A group holds whole molecules and other items (text, arrows, + signs, shapes, images). A
//   molecule is a connected set of atoms, found afresh each time, so an atom drawn onto a
//   grouped molecule belongs to the group and a molecule always joins whole.
// - A group keeps the ids of members that have gone: Ketcher never gives an id to another item
//   in the same drawing, and its Undo brings a deleted item back under its old id, so Undo of
//   a delete brings the group back too. Until then a group with fewer than two items left
//   does nothing (a click picks up only what it is on).
// - Ketcher's ids last while the drawing does; a drawing loaded afresh (a relaunch) numbers
//   its items anew, and Ketcher may scale and move it as it loads it. So groups are saved by
//   where their items are, with where the drawing was, and found again after the same change.

export const OBJECT_KINDS = ['texts', 'rxnArrows', 'rxnPluses', 'simpleObjects', 'images', 'multitailArrows'] as const;
export type ObjectKind = (typeof OBJECT_KINDS)[number];

/** The canvas as groups need it: atoms, bonds between them, and the other items by kind. */
export interface Canvas {
  atoms: number[];
  bonds: { id: number; begin: number; end: number }[];
  objects: Record<ObjectKind, number[]>;
}

/** Ketcher's selection, as far as groups read and write it. */
export type Selection = Partial<Record<'atoms' | 'bonds' | ObjectKind, number[]>>;

export interface Group {
  /** Atoms of its molecules when grouped; any one still there stands for its molecule. */
  atoms: number[];
  objects: Record<ObjectKind, number[]>;
}

function noObjects(): Record<ObjectKind, number[]> {
  return { texts: [], rxnArrows: [], rxnPluses: [], simpleObjects: [], images: [], multitailArrows: [] };
}

/** Each atom's molecule, named by its smallest atom id. */
export function molecules(canvas: Canvas): Map<number, number> {
  const parent = new Map(canvas.atoms.map((a) => [a, a]));
  const root = (a: number): number => {
    let r = a;
    while (parent.get(r) !== r) r = parent.get(r)!;
    parent.set(a, r);
    return r;
  };
  for (const { begin, end } of canvas.bonds) {
    if (!parent.has(begin) || !parent.has(end)) continue;
    const [a, b] = [root(begin), root(end)];
    if (a !== b) parent.set(Math.max(a, b), Math.min(a, b));
  }
  return new Map(canvas.atoms.map((a) => [a, root(a)]));
}

/** What a selection or a group holds: molecules (by name) and other items. */
interface Items {
  molecules: Set<number>;
  objects: Record<ObjectKind, Set<number>>;
}

function count(items: Items): number {
  return items.molecules.size + OBJECT_KINDS.reduce((n, k) => n + items.objects[k].size, 0);
}

function selected(selection: Selection, canvas: Canvas, of: Map<number, number>): Items {
  const atoms = new Set(selection.atoms ?? []);
  for (const bond of canvas.bonds) if (selection.bonds?.includes(bond.id)) atoms.add(bond.begin).add(bond.end);
  const present = (kind: ObjectKind) => new Set((selection[kind] ?? []).filter((id) => canvas.objects[kind].includes(id)));
  return {
    molecules: new Set([...atoms].flatMap((a) => (of.has(a) ? [of.get(a)!] : []))),
    objects: Object.fromEntries(OBJECT_KINDS.map((k) => [k, present(k)])) as Items['objects'],
  };
}

function held(group: Group, canvas: Canvas, of: Map<number, number>): Items {
  return selected({ atoms: group.atoms, ...group.objects }, canvas, of);
}

/** The groups with two or more of their items on the canvas: the others do nothing. */
function live(groups: Group[], canvas: Canvas, of: Map<number, number>): Group[] {
  return groups.filter((g) => count(held(g, canvas, of)) >= 2);
}

function touches(group: Group, items: Items, canvas: Canvas, of: Map<number, number>): boolean {
  const mine = held(group, canvas, of);
  return [...mine.molecules].some((m) => items.molecules.has(m)) || OBJECT_KINDS.some((k) => [...mine.objects[k]].some((id) => items.objects[k].has(id)));
}

/** All of a group as a selection: every atom of its molecules, their bonds, its items. */
export function selectionOf(group: Group, canvas: Canvas, of: Map<number, number> = molecules(canvas)): Selection {
  const mine = held(group, canvas, of);
  const atoms = canvas.atoms.filter((a) => mine.molecules.has(of.get(a)!));
  const inside = new Set(atoms);
  const bonds = canvas.bonds.filter((b) => inside.has(b.begin) && inside.has(b.end)).map((b) => b.id);
  return { atoms, bonds, ...Object.fromEntries(OBJECT_KINDS.map((k) => [k, [...mine.objects[k]]])) };
}

function covers(selection: Selection, whole: Selection): boolean {
  return (['atoms', 'bonds', ...OBJECT_KINDS] as const).every((k) => (whole[k] ?? []).every((id) => selection[k]?.includes(id)));
}

function union(a: Selection, b: Selection): Selection {
  const out: Selection = {};
  for (const k of ['atoms', 'bonds', ...OBJECT_KINDS] as const) {
    const ids = [...new Set([...(a[k] ?? []), ...(b[k] ?? [])])].sort((x, y) => x - y);
    if (ids.length > 0) out[k] = ids;
  }
  return out;
}

/** The selection widened to every group it touches, or null when it already holds them. */
export function widened(groups: Group[], selection: Selection, canvas: Canvas): Selection | null {
  const of = molecules(canvas);
  const items = selected(selection, canvas, of);
  let wide = selection;
  for (const group of live(groups, canvas, of)) if (touches(group, items, canvas, of)) wide = union(wide, selectionOf(group, canvas, of));
  return covers(selection, wide) ? null : wide;
}

/** What the button offers for this selection: Group (two or more items, not just one whole
 * group), Ungroup (one group and nothing else), or nothing. */
export function offer(groups: Group[], selection: Selection, canvas: Canvas): 'group' | 'ungroup' | null {
  const of = molecules(canvas);
  const items = selected(selection, canvas, of);
  const touched = live(groups, canvas, of).filter((g) => touches(g, items, canvas, of));
  if (touched.length === 1) {
    const mine = held(touched[0], canvas, of);
    const extra =
      [...items.molecules].some((m) => !mine.molecules.has(m)) || OBJECT_KINDS.some((k) => [...items.objects[k]].some((id) => !mine.objects[k].has(id)));
    if (!extra) return 'ungroup';
  }
  return count(items) >= 2 ? 'group' : null;
}

/** The groups with the selection grouped: one flat group of everything it holds and every
 * group it touches (a group doing nothing, too: it ends, so no item is in two groups).
 * Unchanged for fewer than two items. */
export function grouped(groups: Group[], selection: Selection, canvas: Canvas): Group[] {
  const of = molecules(canvas);
  const items = selected(selection, canvas, of);
  const touched = groups.filter((g) => touches(g, items, canvas, of));
  const all = selected(touched.reduce((s, g) => union(s, selectionOf(g, canvas, of)), selection), canvas, of);
  if (count(all) < 2) return groups;
  const group: Group = {
    atoms: canvas.atoms.filter((a) => all.molecules.has(of.get(a)!)),
    objects: Object.fromEntries(OBJECT_KINDS.map((k) => [k, [...all.objects[k]].sort((x, y) => x - y)])) as Group['objects'],
  };
  return [...groups.filter((g) => !touched.includes(g)), group];
}

/** The groups without those the selection touches. */
export function ungrouped(groups: Group[], selection: Selection, canvas: Canvas): Group[] {
  const of = molecules(canvas);
  const items = selected(selection, canvas, of);
  const touched = live(groups, canvas, of).filter((g) => touches(g, items, canvas, of));
  return groups.filter((g) => !touched.includes(g));
}

/** The groups with what is not on the canvas taken out, and any group left with fewer than
 * two items ended (for groups found again after a relaunch, when Undo can't bring anything
 * back). Atoms are kept as they are: any one still there keeps its molecule. */
export function pruned(groups: Group[], canvas: Canvas): Group[] {
  const of = molecules(canvas);
  return groups.flatMap((g) => {
    const objects = Object.fromEntries(OBJECT_KINDS.map((k) => [k, g.objects[k].filter((id) => canvas.objects[k].includes(id))])) as Group['objects'];
    const group = { atoms: g.atoms.filter((a) => of.has(a)), objects };
    return count(held(group, canvas, of)) >= 2 ? [group] : [];
  });
}

export interface Point {
  x: number;
  y: number;
}

type Where = (kind: 'atoms' | ObjectKind, id: number) => Point | null;

/** A group as saved beside the drawing: where its items are. */
export interface SavedGroup {
  molecules: Point[];
  objects: { kind: ObjectKind; at: Point }[];
}

/** Where the drawing as a whole is: its average bond length (null without bonds), the mean of
 * its items' points other than images' (null without any), and the mean of its images'. */
export interface Frame {
  bond: number | null;
  centre: Point | null;
  imageCentre: Point | null;
}

/** The groups as saved: by where their items are, and where the drawing was. */
export interface SavedGroups {
  frame: Frame;
  groups: SavedGroup[];
}

const mean = (points: Point[]): Point | null =>
  points.length === 0 ? null : { x: points.reduce((s, p) => s + p.x, 0) / points.length, y: points.reduce((s, p) => s + p.y, 0) / points.length };

function pointsOf(kinds: readonly ('atoms' | ObjectKind)[], canvas: Canvas, where: Where): Point[] {
  return kinds.flatMap((kind) => (kind === 'atoms' ? canvas.atoms : canvas.objects[kind]).flatMap((id) => where(kind, id) ?? []));
}

const SCALED = ['atoms', ...OBJECT_KINDS.filter((k) => k !== 'images')] as const;

function frameOf(canvas: Canvas, where: Where): Frame {
  const lengths = canvas.bonds.flatMap(({ begin, end }) => {
    const [a, b] = [where('atoms', begin), where('atoms', end)];
    return a && b ? [Math.hypot(a.x - b.x, a.y - b.y)] : [];
  });
  return {
    bond: lengths.length > 0 ? lengths.reduce((s, l) => s + l, 0) / lengths.length : null,
    centre: mean(pointsOf(SCALED, canvas, where)),
    imageCentre: mean(pointsOf(['images'], canvas, where)),
  };
}

/** The groups by where their items are: one atom for each molecule, and each item's point.
 * `where` gives an item's point (an atom's position, a text's, an arrow's start). */
export function saved(groups: Group[], canvas: Canvas, where: Where): SavedGroups {
  const of = molecules(canvas);
  return {
    frame: frameOf(canvas, where),
    groups: live(groups, canvas, of).map((g) => {
      const mine = held(g, canvas, of);
      const molecules = [...mine.molecules].flatMap((m) => where('atoms', m) ?? []);
      const objects = OBJECT_KINDS.flatMap((kind) => [...mine.objects[kind]].flatMap((id) => {
        const at = where(kind, id);
        return at ? [{ kind, at }] : [];
      }));
      return { molecules, objects };
    }),
  };
}

/** How far apart (a bond is about 1) a saved point and an item may be and still match. */
const NEAR = 1e-3;

/** The saved groups found again on the canvas. Ketcher may have scaled the drawing as it
 * loaded it (its bonds to length 1, about the origin) and moved it (to the middle of the
 * view), and images move but don't scale; so the saved points are first moved the same way,
 * worked out from the two frames. Anything not found is left out, and a group with fewer than
 * two items found is dropped. Anything unreadable gives no groups. */
export function restored(kept: unknown, canvas: Canvas, where: Where): Group[] {
  if (!isSaved(kept)) return [];
  return pruned(located(kept, canvas, where).map((l) => l.group), canvas);
}

/** Each saved group as found on the canvas, and whether every item of it was found. */
function located(kept: SavedGroups, canvas: Canvas, where: Where): { group: Group; whole: boolean }[] {
  const now = frameOf(canvas, where);
  const was = kept.frame;
  const scale = was.bond && now.bond ? now.bond / was.bond : 1;
  const imageShift = was.imageCentre && now.imageCentre ? { x: now.imageCentre.x - was.imageCentre.x, y: now.imageCentre.y - was.imageCentre.y } : null;
  const shift = was.centre && now.centre ? { x: now.centre.x - scale * was.centre.x, y: now.centre.y - scale * was.centre.y } : (imageShift ?? { x: 0, y: 0 });
  const moved = (kind: 'atoms' | ObjectKind, p: Point): Point => {
    if (kind === 'images') {
      const by = imageShift ?? shift;
      return { x: p.x + by.x, y: p.y + by.y };
    }
    return { x: scale * p.x + shift.x, y: scale * p.y + shift.y };
  };
  const find = (kind: 'atoms' | ObjectKind, at: Point): number[] => {
    const target = moved(kind, at);
    let best: { id: number; d: number } | null = null;
    for (const id of kind === 'atoms' ? canvas.atoms : canvas.objects[kind]) {
      const p = where(kind, id);
      const d = p ? Math.hypot(p.x - target.x, p.y - target.y) : Infinity;
      if (d <= NEAR && (!best || d < best.d)) best = { id, d };
    }
    return best ? [best.id] : [];
  };
  const of = molecules(canvas);
  return kept.groups.map((s) => {
    // Every atom of each molecule found, as Group makes it.
    const atoms = s.molecules.flatMap((at) => find('atoms', at));
    const named = new Set(atoms.map((a) => of.get(a)));
    const group: Group = { atoms: canvas.atoms.filter((a) => named.has(of.get(a))), objects: noObjects() };
    let objects = 0;
    for (const { kind, at } of s.objects) {
      const ids = find(kind, at);
      group.objects[kind].push(...ids);
      objects += ids.length;
    }
    return { group, whole: atoms.length === s.molecules.length && objects === s.objects.length };
  });
}

/** A drawing as carrying groups needs it: its items and where they are. */
export interface Drawing {
  canvas: Canvas;
  where: Where;
}

/** The groups of one drawing found on another that Ketcher made from it in one step: an edit
 * that scales or moves the whole drawing (Aromatize, Calculate CIP, Settings) keeps them, as a
 * relaunch does. A group not found whole ends: after a drawing put in its place (Open, Clear
 * Canvas, Replace), or an edit that moves its items apart (Clean Up or Layout may). */
export function carried(groups: Group[], from: Drawing, to: Drawing): Group[] {
  const kept = saved(groups, from.canvas, from.where);
  return pruned(located(kept, to.canvas, to.where).flatMap((l) => (l.whole ? [l.group] : [])), to.canvas);
}

const isPoint = (p: unknown): p is Point =>
  typeof p === 'object' && p !== null && Number.isFinite((p as Point).x) && Number.isFinite((p as Point).y);

function isSaved(kept: unknown): kept is SavedGroups {
  if (typeof kept !== 'object' || kept === null) return false;
  const { frame, groups } = kept as SavedGroups;
  const orNull = (v: unknown, test: (v: unknown) => boolean) => v === null || test(v);
  return (
    typeof frame === 'object' &&
    frame !== null &&
    orNull(frame.bond, (b) => Number.isFinite(b)) &&
    orNull(frame.centre, isPoint) &&
    orNull(frame.imageCentre, isPoint) &&
    Array.isArray(groups) &&
    groups.every(
      (g) =>
        Array.isArray(g?.molecules) &&
        g.molecules.every(isPoint) &&
        Array.isArray(g.objects) &&
        g.objects.every((o) => (OBJECT_KINDS as readonly string[]).includes(o?.kind) && isPoint(o.at)),
    )
  );
}
