import type { Ketcher } from 'ketcher-core';
import { afterEach, describe, expect, it } from 'vitest';
import type { Placement } from '../editor/placeInHand';
import { GLASSWARE, GLASSWARE_CREDIT, GLASSWARE_GROUPS, loadPiece, pickGlassware, pieceKet, pieceUrl, type Piece } from './glassware';
import { heldTemplate, pickTemplate, putAwayTemplate, subscribeTemplates, TEMPLATES, type Placer } from './templates';

// The menu touches Ketcher only through the placer, and reads which tool it has.
let tool: object = {};
const KETCHER = { editor: { tool: () => tool } } as unknown as Ketcher;
// Unit tests run in Node: a stand-in for the page, where pick() listens for Esc.
(globalThis as { document?: EventTarget }).document ??= new EventTarget();
const [FIRST, SECOND] = GLASSWARE;

/** A placer whose picks are in hand at once, each with its own placement to settle. */
function placer() {
  const placed: { structure: string; settle: (placed: boolean) => void; cancels: number }[] = [];
  const place: Placer = async (_ketcher, structure) => {
    let settle: (placed: boolean) => void = () => {};
    const done = new Promise<boolean>((r) => (settle = r));
    const entry = { structure, settle, cancels: 0 };
    placed.push(entry);
    const placement: Placement = {
      done,
      cancel: () => {
        entry.cancels += 1;
        settle(false);
      },
    };
    return placement;
  };
  return { place, placed };
}

/** A loader whose answers are held until the test releases them, in any order. */
function heldLoader() {
  const waiting = new Map<string, (ket: string) => void>();
  const load = (piece: Piece) => new Promise<string>((resolve) => waiting.set(piece.id, resolve));
  const release = (piece: Piece) => waiting.get(piece.id)!(`ket of ${piece.id}`);
  return { load, release, asked: (piece: Piece) => waiting.has(piece.id) };
}

/** Resolves once what is in hand is `item` (null: nothing). */
function holding(item: object | null): Promise<void> {
  return new Promise((resolve) => {
    if (heldTemplate() === item) return resolve();
    const stop = subscribeTemplates(() => {
      if (heldTemplate() !== item) return;
      stop();
      resolve();
    });
  });
}

/** An Esc watcher the test presses; it counts the listeners still watching. */
function escKey() {
  const listeners = new Set<() => void>();
  const escapes = (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };
  return { escapes, press: () => listeners.forEach((listener) => listener()), watching: () => listeners.size };
}

afterEach(() => {
  putAwayTemplate();
  tool = {};
});

describe('the generated glassware', () => {
  it('comes in the groups the plan names, every piece in one of them, ids unique', () => {
    expect(GLASSWARE_GROUPS).toEqual([
      'Flasks',
      'Condensers and adapters',
      'Funnels',
      'Measuring',
      'Heating and cooling',
      'Chromatography',
    ]);
    expect(new Set(GLASSWARE.map((p) => p.id)).size).toBe(GLASSWARE.length);
    for (const piece of GLASSWARE) {
      expect(GLASSWARE_GROUPS).toContain(piece.group);
      expect(piece.file).toBe(`glassware/${piece.id}.svg`);
      expect(piece.width).toBeGreaterThan(0);
      expect(piece.height).toBeGreaterThan(0);
    }
  });

  it('carries its credit as plain text', () => {
    expect(GLASSWARE_CREDIT).toMatch(/^Drawings from Wikimedia Commons and Openclipart by .+; public domain and CC0\.$/);
    expect(GLASSWARE_CREDIT).not.toMatch(/https?:|www\./);
  });
});

describe("a piece's KET", () => {
  it('is one SVG image of the placed size, holding the file byte for byte', () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255, ...new TextEncoder().encode('<svg/>')]);
    const ket = JSON.parse(pieceKet(FIRST, bytes));
    expect(ket.root.nodes).toHaveLength(1);
    const [image] = ket.root.nodes;
    expect(image).toMatchObject({
      type: 'image',
      format: 'image/svg+xml',
      boundingBox: { width: FIRST.width, height: FIRST.height },
    });
    expect(Uint8Array.from(atob(image.data), (c) => c.charCodeAt(0))).toEqual(bytes);
  });

  it('encodes a file larger than one slice', () => {
    const bytes = Uint8Array.from({ length: 0x8000 * 2 + 5 }, (_, i) => i % 256);
    const data = JSON.parse(pieceKet(FIRST, bytes)).root.nodes[0].data;
    expect(Uint8Array.from(atob(data), (c) => c.charCodeAt(0))).toEqual(bytes);
  });

  it("is loaded from the piece's file under the app's base path", async () => {
    const asked: string[] = [];
    const ket = await loadPiece(FIRST, async (url) => {
      asked.push(url);
      return new Response('<svg xmlns="http://www.w3.org/2000/svg"/>');
    });
    expect(asked).toEqual([pieceUrl(FIRST)]);
    expect(pieceUrl(FIRST)).toBe(`${import.meta.env.BASE_URL}glassware/${FIRST.id}.svg`);
    expect(JSON.parse(ket).root.nodes[0].format).toBe('image/svg+xml');
  });

  it('a file that is not there is an error, not a picture', async () => {
    await expect(loadPiece(FIRST, async () => new Response('missing', { status: 404 }))).rejects.toThrow(
      `${FIRST.file}: HTTP 404`,
    );
  });
});

describe('picking a piece', () => {
  it('puts it in hand once its file is loaded; a click places it', async () => {
    const { place, placed } = placer();
    const { load, release } = heldLoader();
    const picked = pickGlassware(KETCHER, FIRST, place, load);
    expect(heldTemplate()).toBeNull(); // still loading
    release(FIRST);
    await holding(FIRST);
    expect(placed.map((p) => p.structure)).toEqual([`ket of ${FIRST.id}`]);
    placed[0].settle(true);
    expect(await picked).toBe(true);
    expect(heldTemplate()).toBeNull();
  });

  it('a piece whose file arrives after a later pick is never placed, and the later one stays', async () => {
    const { place, placed } = placer();
    const { load, release, asked } = heldLoader();
    const first = pickGlassware(KETCHER, FIRST, place, load);
    expect(asked(FIRST)).toBe(true);
    const second = pickGlassware(KETCHER, SECOND, place, load);
    release(SECOND);
    await holding(SECOND);
    release(FIRST); // the late one
    expect(await first).toBe(false);
    // Never handed to Ketcher: arming its paste tool would have put the second one away.
    expect(placed.map((p) => p.structure)).toEqual([`ket of ${SECOND.id}`]);
    expect(heldTemplate()).toBe(SECOND);
    expect(placed[0].cancels).toBe(0);
    placed[0].settle(true);
    expect(await second).toBe(true);
  });

  it('shares the hand with templates: each puts the other away', async () => {
    const { place, placed } = placer();
    const template = pickTemplate(KETCHER, TEMPLATES[0], place);
    await holding(TEMPLATES[0]);
    const piece = pickGlassware(KETCHER, FIRST, place, async (p) => `ket of ${p.id}`);
    expect(await template).toBe(false);
    expect(placed[0].cancels).toBe(1);
    await holding(FIRST);
    const again = pickTemplate(KETCHER, TEMPLATES[1], place);
    expect(await piece).toBe(false);
    await holding(TEMPLATES[1]);
    putAwayTemplate();
    expect(await again).toBe(false);
  });

  it('Esc while a piece loads: it is never placed, and Esc is no longer watched', async () => {
    const { place, placed } = placer();
    const { load, release } = heldLoader();
    const esc = escKey();
    const picked = pickGlassware(KETCHER, FIRST, place, load, esc.escapes);
    expect(esc.watching()).toBe(1);
    esc.press();
    release(FIRST);
    expect(await picked).toBe(false);
    expect(placed).toEqual([]);
    expect(heldTemplate()).toBeNull();
    expect(esc.watching()).toBe(0);
  });

  it('another tool, or Add arming its own, while a piece loads: it is never placed', async () => {
    const { place, placed } = placer();
    const { load, release } = heldLoader();
    const picked = pickGlassware(KETCHER, FIRST, place, load, escKey().escapes);
    tool = {}; // the bond tool, or Add's paste tool
    release(FIRST);
    expect(await picked).toBe(false);
    expect(placed).toEqual([]);
  });

  it('Esc after a piece has loaded is left to the placement (placeInHand handles it)', async () => {
    const { place, placed } = placer();
    const esc = escKey();
    const picked = pickGlassware(KETCHER, FIRST, place, async (p) => `ket of ${p.id}`, esc.escapes);
    await holding(FIRST);
    expect(esc.watching()).toBe(0);
    placed[0].settle(true);
    expect(await picked).toBe(true);
  });

  it('a piece that could not be loaded leaves the hand empty', async () => {
    const { place, placed } = placer();
    const picked = pickGlassware(KETCHER, FIRST, place, async () => {
      throw new Error('glassware/x.svg: HTTP 404');
    });
    expect(await picked).toBe(false);
    expect(placed).toEqual([]);
    expect(heldTemplate()).toBeNull();
  });
});
