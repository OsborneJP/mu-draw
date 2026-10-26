// One panel below the canvas at a time: whichever opens closes every other one, and never
// itself (docs/plans/v2-proton-nmr.md, bar 11).
import { beforeEach, describe, expect, it, vi } from 'vitest';

const closed: string[] = [];
vi.mock('./practice', () => ({ closePractice: () => closed.push('practice') }));
vi.mock('./nmrStore', () => ({ closeNmr: () => closed.push('nmr') }));
vi.mock('./protonStore', () => ({ closeProton: () => closed.push('proton') }));
vi.mock('./stereoStore', () => ({ closeStereoisomers: () => closed.push('stereoisomers') }));

const { makeRoomFor } = await import('./belowCanvas');
const PANELS = ['practice', 'nmr', 'proton', 'stereoisomers'] as const;

beforeEach(() => {
  closed.length = 0;
});

describe('making room below the canvas', () => {
  it.each(PANELS)('for %s closes each of the others', (panel) => {
    makeRoomFor(panel);
    expect([...closed].sort()).toEqual(PANELS.filter((p) => p !== panel).sort());
  });
});
