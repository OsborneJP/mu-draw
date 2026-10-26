// The group rules (groups.ts) on small made-up canvases: atom ids and bonds, no chemistry.
import { describe, expect, it } from 'vitest';
import { grouped, molecules, offer, pruned, restored, saved, selectionOf, ungrouped, widened, type Canvas, type Group } from './groups';

const none = { texts: [], rxnArrows: [], rxnPluses: [], simpleObjects: [], images: [], multitailArrows: [] };

/** Two molecules (atoms 0-2 bonded in a chain; atoms 3-4), a text 0 and an arrow 0. */
const CANVAS: Canvas = {
  atoms: [0, 1, 2, 3, 4],
  bonds: [
    { id: 0, begin: 0, end: 1 },
    { id: 1, begin: 1, end: 2 },
    { id: 2, begin: 3, end: 4 },
  ],
  objects: { ...none, texts: [0], rxnArrows: [0] },
};

/** The first molecule and the text, grouped. */
const GROUP: Group = { atoms: [0, 1, 2], objects: { ...none, texts: [0] } };

describe('molecules', () => {
  it('names each atom by the smallest atom it is joined to', () => {
    expect([...molecules(CANVAS)]).toEqual([
      [0, 0],
      [1, 0],
      [2, 0],
      [3, 3],
      [4, 3],
    ]);
  });
});

describe('a click on one member picks up the group', () => {
  it('widens the selection to all of every group it touches', () => {
    expect(widened([GROUP], { atoms: [1] }, CANVAS)).toEqual({ atoms: [0, 1, 2], bonds: [0, 1], texts: [0] });
    expect(widened([GROUP], { texts: [0] }, CANVAS)).toEqual({ atoms: [0, 1, 2], bonds: [0, 1], texts: [0] });
    // A bond counts as its molecule.
    expect(widened([GROUP], { bonds: [1] }, CANVAS)).toEqual({ atoms: [0, 1, 2], bonds: [0, 1], texts: [0] });
  });

  it('keeps what else is selected, and leaves a selection outside every group alone', () => {
    expect(widened([GROUP], { atoms: [0, 3] }, CANVAS)).toEqual({ atoms: [0, 1, 2, 3], bonds: [0, 1], texts: [0] });
    expect(widened([GROUP], { atoms: [3, 4], rxnArrows: [0] }, CANVAS)).toBeNull();
    expect(widened([], { atoms: [1] }, CANVAS)).toBeNull();
  });

  it('is done once the whole group is selected, so setting it does not go round again', () => {
    expect(widened([GROUP], { atoms: [0, 1, 2], bonds: [0, 1], texts: [0] }, CANVAS)).toBeNull();
  });

  it('takes in an atom drawn onto a grouped molecule', () => {
    const grown: Canvas = { ...CANVAS, atoms: [...CANVAS.atoms, 5], bonds: [...CANVAS.bonds, { id: 3, begin: 2, end: 5 }] };
    expect(selectionOf(GROUP, grown)).toEqual({ atoms: [0, 1, 2, 5], bonds: [0, 1, 3], texts: [0], rxnArrows: [], rxnPluses: [], simpleObjects: [], images: [], multitailArrows: [] });
  });
});

describe('the button', () => {
  it('offers Group for two or more items, Ungroup for one whole group, nothing for one item', () => {
    expect(offer([], { atoms: [0] }, CANVAS)).toBeNull();
    expect(offer([], { atoms: [0, 1, 2], bonds: [0, 1] }, CANVAS)).toBeNull(); // one molecule
    expect(offer([], { atoms: [0, 3] }, CANVAS)).toBe('group');
    expect(offer([], { texts: [0], rxnArrows: [0] }, CANVAS)).toBe('group');
    expect(offer([GROUP], { atoms: [0, 1, 2], bonds: [0, 1], texts: [0] }, CANVAS)).toBe('ungroup');
    expect(offer([GROUP], { atoms: [0, 1, 2, 3], bonds: [0, 1], texts: [0] }, CANVAS)).toBe('group');
  });
});

describe('Group and Ungroup', () => {
  it('groups two or more items, and not one', () => {
    expect(grouped([], { atoms: [1], texts: [0] }, CANVAS)).toEqual([GROUP]);
    expect(grouped([], { atoms: [1] }, CANVAS)).toEqual([]);
  });

  it('makes one flat group of a selection that holds a group: no nesting', () => {
    const groups = grouped([GROUP], { atoms: [0, 1, 2, 3], bonds: [0, 1], texts: [0] }, CANVAS);
    expect(groups).toEqual([{ atoms: [0, 1, 2, 3, 4], objects: { ...none, texts: [0] } }]);
  });

  it('ungroups every group the selection touches, and only those', () => {
    const other: Group = { atoms: [3, 4], objects: { ...none, rxnArrows: [0] } };
    expect(ungrouped([GROUP, other], { atoms: [1] }, CANVAS)).toEqual([other]);
  });
});

describe('a group with fewer than two items left', () => {
  const noText: Canvas = { ...CANVAS, objects: { ...none, rxnArrows: [0] } };

  it('does nothing, and is not saved', () => {
    expect(widened([GROUP], { atoms: [1] }, noText)).toBeNull();
    expect(offer([GROUP], { atoms: [0, 1, 2], bonds: [0, 1] }, noText)).toBeNull();
    expect(ungrouped([GROUP], { atoms: [1] }, noText)).toEqual([GROUP]);
    expect(grouped([GROUP], { atoms: [1, 3] }, noText)).toEqual([GROUP, { atoms: [0, 1, 2, 3, 4], objects: none }]);
    expect(saved([GROUP], noText, () => ({ x: 0, y: 0 })).groups).toEqual([]);
  });

  it('works again when its items come back (Undo of a delete, under the same ids)', () => {
    expect(widened([GROUP], { atoms: [1] }, CANVAS)).toEqual({ atoms: [0, 1, 2], bonds: [0, 1], texts: [0] });
  });
});

describe('pruned', () => {
  it('takes out what has gone, and ends a group left with one item', () => {
    const withArrow: Group = { atoms: [0, 1, 2], objects: { ...none, texts: [0], rxnArrows: [0] } };
    const noText: Canvas = { ...CANVAS, objects: { ...none, rxnArrows: [0] } };
    expect(pruned([withArrow], noText)).toEqual([{ atoms: [0, 1, 2], objects: { ...none, rxnArrows: [0] } }]);
    const noMolecule: Canvas = { atoms: [3, 4], bonds: [{ id: 2, begin: 3, end: 4 }], objects: { ...none, texts: [0] } };
    expect(pruned([GROUP], noMolecule)).toEqual([]);
  });

  it('keeps a molecule while any of its atoms is there', () => {
    const lessOne: Canvas = { ...CANVAS, atoms: [1, 2, 3, 4], bonds: CANVAS.bonds.slice(1) };
    expect(pruned([GROUP], lessOne)).toEqual([{ atoms: [1, 2], objects: { ...none, texts: [0] } }]);
  });
});

describe('saved and restored by where items are', () => {
  // Each item's point; after a relaunch the same points come back under new ids.
  const points: Record<string, { x: number; y: number }> = {
    'atoms 0': { x: 0, y: 0 },
    'atoms 1': { x: 1, y: 0 },
    'atoms 2': { x: 2, y: 0 },
    'atoms 3': { x: 0, y: 5 },
    'atoms 4': { x: 1, y: 5 },
    'texts 0': { x: 4, y: 4 },
    'rxnArrows 0': { x: 3, y: 1 },
  };
  const where = (kind: string, id: number) => points[`${kind} ${id}`] ?? null;

  it('finds the same items again under new ids, and not a neighbour', () => {
    // A second text sits just below the grouped one.
    const before: Canvas = { ...CANVAS, objects: { ...CANVAS.objects, texts: [0, 1] } };
    const at: Record<string, { x: number; y: number }> = { ...points, 'texts 1': { x: 4, y: 4.01 } };
    const kept = saved([GROUP], before, (kind, id) => at[`${kind} ${id}`] ?? null);
    expect(kept.groups).toEqual([{ molecules: [{ x: 0, y: 0 }], objects: [{ kind: 'texts', at: { x: 4, y: 4 } }] }]);
    // Reloaded, the molecules and the texts come back in the other order.
    const reloaded: Canvas = {
      atoms: [0, 1, 2, 3, 4],
      bonds: [
        { id: 0, begin: 0, end: 1 },
        { id: 1, begin: 2, end: 3 },
        { id: 2, begin: 3, end: 4 },
      ],
      objects: { ...none, texts: [0, 1], rxnArrows: [0] },
    };
    const after: Record<string, { x: number; y: number }> = {
      'atoms 0': { x: 0, y: 5 },
      'atoms 1': { x: 1, y: 5 },
      'atoms 2': { x: 0, y: 0 },
      'atoms 3': { x: 1, y: 0 },
      'atoms 4': { x: 2, y: 0 },
      'texts 0': { x: 4, y: 4.01 },
      'texts 1': { x: 4, y: 4 },
      'rxnArrows 0': { x: 3, y: 1 },
    };
    const groups = restored(kept, reloaded, (kind, id) => after[`${kind} ${id}`] ?? null);
    expect(groups).toEqual([{ atoms: [2], objects: { ...none, texts: [1] } }]);
    expect(selectionOf(groups[0], reloaded).atoms).toEqual([2, 3, 4]);
  });

  it('finds them after Ketcher scales the drawing and moves it, and images, which move unscaled', () => {
    const withImage: Canvas = { ...CANVAS, objects: { ...CANVAS.objects, images: [0] } };
    const at: Record<string, { x: number; y: number }> = { ...points, 'images 0': { x: 6, y: 2 } };
    const group: Group = { atoms: [0], objects: { ...none, images: [0], rxnArrows: [0] } };
    const kept = JSON.parse(JSON.stringify(saved([group], withImage, (kind, id) => at[`${kind} ${id}`] ?? null)));
    // Loaded: everything scaled by 1.25 about the origin, then moved by (7, -3); the image
    // only moved. Ids as before.
    const loaded = (kind: string, id: number) => {
      const p = at[`${kind} ${id}`];
      if (!p) return null;
      const s = kind === 'images' ? 1 : 1.25;
      return { x: s * p.x + 7, y: s * p.y - 3 };
    };
    expect(restored(kept, withImage, loaded)).toEqual([group]);
    // Moved any other way, nothing is found.
    const nudged = (kind: string, id: number) => {
      const p = loaded(kind, id);
      return p && (kind === 'atoms' ? p : { x: p.x + 0.01, y: p.y });
    };
    expect(restored(kept, withImage, nudged)).toEqual([]);
  });

  it('finds images in a drawing of images alone, after Ketcher moves it', () => {
    const images: Canvas = { atoms: [], bonds: [], objects: { ...none, images: [0, 1] } };
    const group: Group = { atoms: [], objects: { ...none, images: [0, 1] } };
    const at = (moved: number) => (_kind: string, id: number) => ({ x: 2 * id + moved, y: moved });
    expect(restored(saved([group], images, at(0)), images, at(5))).toEqual([group]);
  });

  it('leaves out what is not found, and a group left with one item', () => {
    const kept = saved([GROUP], CANVAS, where);
    expect(restored(kept, { atoms: [], bonds: [], objects: { ...none, texts: [0] } }, () => ({ x: 4, y: 4 }))).toEqual([]);
  });

  it('gives no groups for anything unreadable', () => {
    const frame = { bond: 1, centre: null, imageCentre: null };
    const unreadable = [null, 3, 'x', [], [{ molecules: [{ x: 0, y: 0 }], objects: [] }], { frame: {}, groups: [] }, { frame, groups: [{ molecules: [{ x: 'a', y: 0 }], objects: [] }] }, { frame, groups: [{ molecules: [], objects: [{ kind: 'atoms', at: { x: 0, y: 0 } }] }] }];
    for (const kept of unreadable) expect(restored(kept, CANVAS, where)).toEqual([]);
  });
});
