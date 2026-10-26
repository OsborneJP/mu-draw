// The group rules (groups.ts) on small made-up canvases: atom ids and bonds, no chemistry.
import { describe, expect, it } from 'vitest';
import { carried, grouped, molecules, offer, pruned, restored, saved, selectionOf, ungrouped, widened, type Canvas, type Group } from './groups';

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
    // Group takes it in (it ends), so no item is ever in two groups.
    expect(grouped([GROUP], { atoms: [1, 3] }, noText)).toEqual([{ atoms: [0, 1, 2, 3, 4], objects: none }]);
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
    // Every atom of the molecule, as Group makes it.
    expect(groups).toEqual([{ atoms: [2, 3, 4], objects: { ...none, texts: [1] } }]);
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
    expect(restored(kept, withImage, loaded)).toEqual([{ ...group, atoms: [0, 1, 2] }]);
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

  it('keeps every atom of a restored molecule, so erasing one or splitting it keeps the rest', () => {
    const chain: Canvas = { ...CANVAS, objects: { ...none, texts: [0] } };
    const kept = saved([GROUP], chain, where);
    const back = restored(kept, chain, where);
    // Atom 0 (the one saved for the molecule) erased, and the bond 1-2 deleted.
    const edited: Canvas = { atoms: [1, 2, 3, 4], bonds: [{ id: 2, begin: 3, end: 4 }], objects: { ...none, texts: [0] } };
    expect(widened(back, { texts: [0] }, edited)).toEqual({ atoms: [1, 2], texts: [0] });
  });

  it('finds images when the groups were saved from a drawing moved since its last save', () => {
    // Saved at K + t (Ketcher moved the drawing by t after the file was written); loaded from
    // the file K, scaled by 1.25 and moved by v, the image moved by v only.
    const withImage: Canvas = { ...CANVAS, objects: { ...CANVAS.objects, images: [0] } };
    const file: Record<string, { x: number; y: number }> = { ...points, 'images 0': { x: 6, y: 2 } };
    const t = { x: 3, y: -2 };
    const v = { x: 7, y: 1 };
    const group: Group = { atoms: [0, 1, 2], objects: { ...none, images: [0] } };
    const kept = saved([group], withImage, (kind, id) => {
      const p = file[`${kind} ${id}`];
      return p ? { x: p.x + t.x, y: p.y + t.y } : null;
    });
    const loaded = (kind: string, id: number) => {
      const p = file[`${kind} ${id}`];
      if (!p) return null;
      const s = kind === 'images' ? 1 : 1.25;
      return { x: s * p.x + v.x, y: s * p.y + v.y };
    };
    expect(restored(kept, withImage, loaded)).toEqual([group]);
  });

  it('leaves out what is not found, and a group left with one item', () => {
    // A text and an image grouped; the image is gone (images don't count in the frame's centre,
    // so the text is found where it was).
    const withImage: Canvas = { ...CANVAS, objects: { ...CANVAS.objects, images: [0] } };
    const at = (kind: string, id: number) => (kind === 'images' ? { x: 6, y: 2 } : where(kind, id));
    const group: Group = { atoms: [], objects: { ...none, texts: [0], images: [0] } };
    const kept = saved([group], withImage, at);
    expect(restored(kept, withImage, at)).toEqual([group]);
    expect(restored(kept, CANVAS, where)).toEqual([]);
  });

  it('gives no groups for anything unreadable', () => {
    // Each would give a group (or throw) if it were read: a text and an arrow, where they were.
    const items = [{ kind: 'texts', at: { x: 4, y: 4 } }, { kind: 'rxnArrows', at: { x: 3, y: 1 } }];
    const kept = saved([{ atoms: [], objects: { ...none, texts: [0], rxnArrows: [0] } }], CANVAS, where);
    expect(restored(kept, CANVAS, where)).toHaveLength(1);
    const unreadable = [
      null,
      3,
      [],
      { ...kept, frame: {} },
      // Numbers as text: JavaScript would read them, so only the check refuses them.
      { ...kept, frame: { ...kept.frame, bond: String(kept.frame.bond) } },
      { ...kept, frame: { ...kept.frame, centre: { x: String(kept.frame.centre!.x), y: String(kept.frame.centre!.y) } } },
      { ...kept, groups: [{ molecules: [{ x: 'a', y: 0 }], objects: items }] },
      { ...kept, groups: [{ molecules: [], objects: [...items, { kind: 'atoms', at: { x: 0, y: 0 } }] }] },
      { ...kept, groups: [{ molecules: [], objects: [...items, { kind: 'texts' }] }] },
    ];
    for (const bad of unreadable) expect(restored(bad, CANVAS, where)).toEqual([]);
    // An image's centre as text, likewise.
    const withImage: Canvas = { ...CANVAS, objects: { ...CANVAS.objects, images: [0] } };
    const at = (kind: string, id: number) => (kind === 'images' ? { x: 6, y: 2 } : where(kind, id));
    const image = saved([{ atoms: [], objects: { ...none, texts: [0], images: [0] } }], withImage, at);
    expect(restored(image, withImage, at)).toHaveLength(1);
    const centre = image.frame.imageCentre!;
    expect(restored({ ...image, frame: { ...image.frame, imageCentre: { x: String(centre.x), y: String(centre.y) } } }, withImage, at)).toEqual([]);
  });

  it('carries groups onto a drawing Ketcher made from this one, and not onto another', () => {
    const from = { canvas: CANVAS, where };
    const scaled = { canvas: CANVAS, where: (kind: string, id: number) => {
      const p = where(kind, id);
      return p && { x: 2 * p.x - 1, y: 2 * p.y + 3 };
    } };
    expect(carried([GROUP], from, scaled)).toEqual([GROUP]);
    const other = { canvas: CANVAS, where: (kind: string, id: number) => {
      const p = where(kind, id);
      return p && { x: p.y, y: p.x * 3 };
    } };
    expect(carried([GROUP], from, other)).toEqual([]);
  });

  it('carries only groups found whole (Layout moves items one by one)', () => {
    // Both molecules and the text grouped; the text moves down and another text up, so the
    // drawing's centre stays and the molecules are found where they were.
    const two: Canvas = { ...CANVAS, objects: { ...CANVAS.objects, texts: [0, 1] } };
    const at: Record<string, { x: number; y: number }> = { ...points, 'texts 1': { x: 9, y: 9 } };
    const before = (kind: string, id: number) => at[`${kind} ${id}`] ?? null;
    const after = (kind: string, id: number) => {
      const p = before(kind, id);
      return p && kind === 'texts' ? { x: p.x, y: p.y + (id === 0 ? 1 : -1) } : p;
    };
    const group: Group = { atoms: [0, 1, 2, 3, 4], objects: { ...none, texts: [0] } };
    expect(restored(saved([group], two, before), two, after)).toEqual([{ ...group, objects: none }]);
    expect(carried([group], { canvas: two, where: before }, { canvas: two, where: after })).toEqual([]);
  });
});
