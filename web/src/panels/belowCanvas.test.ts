// One panel below the canvas at a time: whichever opens closes every other one, and never
// itself (docs/plans/v2-proton-nmr.md, bar 11; v2-safety-snapshot.md; v2-3d-view.md).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BelowCanvas } from './belowCanvas';

const closed: string[] = [];
vi.mock('./practice', () => ({ closePractice: () => closed.push('practice') }));
vi.mock('./nmrStore', () => ({ closeNmr: () => closed.push('nmr') }));
vi.mock('./protonStore', () => ({ closeProton: () => closed.push('proton') }));
vi.mock('./stereoStore', () => ({ closeStereoisomers: () => closed.push('stereoisomers') }));
vi.mock('./formsStore', () => ({ closeForms: (kind: string) => closed.push(kind) }));
vi.mock('./safety', () => ({ closeSafety: () => closed.push('safety') }));
vi.mock('./threeDStore', () => ({ closeThreeD: () => closed.push('threeD') }));

const { makeRoomFor } = await import('./belowCanvas');
// Every kind of panel, checked against BelowCanvas by tsc: a new kind needs its line here, and
// its closer mocked above, or this test fails.
const KINDS: Record<BelowCanvas, true> = {
  practice: true,
  nmr: true,
  proton: true,
  stereoisomers: true,
  tautomers: true,
  resonance: true,
  safety: true,
  threeD: true,
};
const PANELS = Object.keys(KINDS) as BelowCanvas[];

beforeEach(() => {
  closed.length = 0;
});

describe('making room below the canvas', () => {
  it.each(PANELS)('for %s closes each of the others', (panel) => {
    makeRoomFor(panel);
    expect([...closed].sort()).toEqual(PANELS.filter((p) => p !== panel).sort());
  });
});
