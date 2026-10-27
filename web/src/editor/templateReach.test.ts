import { FunctionalGroup, Vec2, type Ketcher } from 'ketcher-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { nearestInReach, REACH_PX, widenTemplateReach, type Point } from './templateReach';

// Two atoms 20 px apart on screen, joined by one bond.
const A: Point = { x: 0, y: 0 };
const B: Point = { x: 20, y: 0 };
const ATOMS = [[0, A] as const, [1, B] as const];
const BONDS = [[5, A, B] as const];

function at(x: number, y: number) {
  return nearestInReach({ x, y }, ATOMS, BONDS, REACH_PX);
}

describe('nearestInReach', () => {
  it('an atom within reach, beyond the end of its bond; one step further, nothing', () => {
    expect(at(-REACH_PX, 0)).toEqual({ map: 'atoms', id: 0, dist: REACH_PX });
    expect(at(-REACH_PX - 0.5, 0)).toBeNull();
  });

  it("beside a bond's middle within reach: the bond; one step further, nothing", () => {
    expect(at(10, REACH_PX)).toEqual({ map: 'bonds', id: 5, dist: REACH_PX });
    expect(at(10, -REACH_PX - 0.5)).toBeNull();
  });

  it("along a bond, its ends are its atoms' and its middle half the bond's", () => {
    expect(at(4, 0)?.map).toBe('atoms');
    expect(at(4, 0)?.id).toBe(0);
    expect(at(6, 0)?.map).toBe('bonds');
    expect(at(14, 0)?.map).toBe('bonds');
    expect(at(16, 0)?.id).toBe(1);
    expect(at(16, 0)?.map).toBe('atoms');
  });

  it('a bond is in reach only beside it, never beyond its ends', () => {
    expect(nearestInReach({ x: 25, y: 3 }, [], BONDS, REACH_PX)).toBeNull();
    expect(nearestInReach({ x: -1, y: 0 }, [], BONDS, REACH_PX)).toBeNull();
  });

  it('the nearer of two atoms in reach; a bond of no length is passed over', () => {
    expect(nearestInReach({ x: 11, y: 0 }, ATOMS, [], REACH_PX)?.id).toBe(1);
    expect(nearestInReach({ x: 9, y: 0 }, ATOMS, [], REACH_PX)?.id).toBe(0);
    expect(nearestInReach({ x: 0, y: 1 }, [], [[7, A, A] as const], REACH_PX)).toBeNull();
  });
});

/** Ketcher's template tool with a ring in hand: it joins it to atoms and bonds. */
const RING_IN_HAND = { templatePreview: {}, findItems: ['atoms', 'bonds'] };

/** A stand-in for Ketcher's editor: its render as CoordinateTransformation reads it, with
 * bonds 20 model px long (20 screen px at zoom 1), and the drawing's atoms 0 and 1 and bond
 * 5 as above. */
function fakeEditor(
  options: { tool?: unknown; ketcherFinds?: unknown; previewAtom?: boolean; previewBond?: boolean; zoom?: number } = {},
) {
  const zoom = options.zoom ?? 1;
  const atoms = [new Vec2(0, 0), new Vec2(1, 0)].map((pp, i) => ({
    pp,
    sgs: new Set<number>(),
    isPreview: i === 1 && Boolean(options.previewAtom),
  }));
  const render = {
    clientArea: { getBoundingClientRect: () => ({ left: 100, top: 50 }) },
    viewBox: { minX: -100, minY: -100 },
    options: { microModeScale: 20, zoom },
    ctab: {
      visibleAtoms: new Map(atoms.map((a, id) => [id, { a }])),
      visibleBonds: new Map([[5, { b: { begin: 0, end: 1, isPreview: Boolean(options.previewBond) } }]]),
      sgroups: new Map(),
      molecule: { atoms: new Map(atoms.map((a, id) => [id, a])), functionalGroups: new Map() },
    },
  };
  const ketcherFind = vi.fn<(event: unknown, maps: string[] | null, skip?: unknown) => unknown>(() => options.ketcherFinds ?? null);
  const editor = {
    render,
    tool: () => ('tool' in options ? options.tool : RING_IN_HAND),
    findItem: ketcherFind as (event: unknown, maps: string[] | null, skip?: unknown) => unknown,
  };
  widenTemplateReach({ editor } as unknown as Ketcher);
  // A page point `dx`, `dy` screen pixels from atom 0 (at the model origin).
  const page = (dx: number, dy: number) => ({ clientX: 100 + 100 * zoom + dx, clientY: 50 + 100 * zoom + dy });
  return { editor, ketcherFind, page, atoms };
}

describe('widenTemplateReach', () => {
  afterEach(() => vi.restoreAllMocks());

  it('with the template tool, where Ketcher finds nothing: the atom or bond within reach, its distance in bond lengths', () => {
    const { editor, page } = fakeEditor();
    expect(editor.findItem(page(-10, 0), ['atoms', 'bonds'])).toEqual({ map: 'atoms', id: 0, dist: 0.5 });
    expect(editor.findItem(page(10, 10), ['atoms', 'bonds'])).toEqual({ map: 'bonds', id: 5, dist: 0.5 });
    expect(editor.findItem(page(-REACH_PX - 1, 0), ['atoms', 'bonds'])).toBeNull();
  });

  it("Ketcher's own answer stands when it has one, and is asked with the same arguments", () => {
    const own = { map: 'functionalGroups', id: 3, dist: 0.1 };
    const { editor, ketcherFind, page } = fakeEditor({ ketcherFinds: own });
    expect(editor.findItem(page(-10, 0), ['atoms', 'bonds', 'functionalGroups'])).toBe(own);
    expect(ketcherFind).toHaveBeenCalledWith(page(-10, 0), ['atoms', 'bonds', 'functionalGroups'], null);
  });

  it('reach is in screen pixels at any zoom; the distance stays in bond lengths', () => {
    const { editor, page } = fakeEditor({ zoom: 2 });
    expect(editor.findItem(page(-REACH_PX, 0), ['atoms', 'bonds'])).toEqual({ map: 'atoms', id: 0, dist: REACH_PX / 40 });
    expect(editor.findItem(page(20, REACH_PX), ['atoms', 'bonds'])).toEqual({ map: 'bonds', id: 5, dist: REACH_PX / 40 });
    expect(editor.findItem(page(-REACH_PX - 0.5, 0), ['atoms', 'bonds'])).toBeNull();
    expect(editor.findItem(page(20, REACH_PX + 0.5), ['atoms', 'bonds'])).toBeNull();
  });

  it('only what the tool joins a template to: with a functional group in hand, atoms but never bonds', () => {
    const { editor, page } = fakeEditor({ tool: { templatePreview: {}, findItems: ['atoms', 'functionalGroups'] } });
    expect(editor.findItem(page(10, 10), ['atoms', 'bonds'])).toBeNull();
    expect(editor.findItem(page(-10, 0), ['atoms', 'bonds'])).toEqual({ map: 'atoms', id: 0, dist: 0.5 });
  });

  it("any other tool, or a search that skips an item: Ketcher's answer alone", () => {
    for (const tool of [{}, null, undefined, { templatePreview: {} }, { findItems: ['atoms', 'bonds'] }]) {
      expect(fakeEditor({ tool }).editor.findItem(fakeEditor().page(-10, 0), ['atoms', 'bonds'])).toBeNull();
    }
    const { editor, page } = fakeEditor();
    expect(editor.findItem(page(-10, 0), ['atoms', 'bonds'], { map: 'atoms', id: 0 })).toBeNull();
  });

  it('only the kinds asked for', () => {
    const { editor, page } = fakeEditor();
    expect(editor.findItem(page(10, 10), ['atoms'])).toBeNull();
    expect(editor.findItem(page(-10, 0), ['bonds'])).toBeNull();
    expect(editor.findItem(page(-10, 0), null)).toBeNull();
  });

  it("never the template's own preview, nor an atom inside a contracted abbreviation, nor a bond into one", () => {
    expect(fakeEditor({ previewAtom: true }).editor.findItem(fakeEditor().page(30, 0), ['atoms'])).toBeNull();
    expect(fakeEditor({ previewBond: true }).editor.findItem(fakeEditor().page(10, 10), ['bonds'])).toBeNull();
    // Atom 1 is the hidden attachment atom of an abbreviation's label ("Ph", say).
    const { editor, page, atoms } = fakeEditor();
    vi.spyOn(FunctionalGroup, 'isAtomInContractedFunctionalGroup').mockImplementation((atom) => atom === atoms[1]);
    expect(editor.findItem(page(30, 0), ['atoms'])).toBeNull();
    expect(editor.findItem(page(10, 10), ['bonds'])).toBeNull();
    expect(editor.findItem(page(-10, 0), ['atoms'])).toEqual({ map: 'atoms', id: 0, dist: 0.5 });
  });
});
