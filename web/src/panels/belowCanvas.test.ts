import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeRoomFor, type BelowCanvas } from './belowCanvas';
import { closeNmr } from './nmrStore';
import { closePractice } from './practice';
import { closeSafety } from './safety';
import { closeStereoisomers } from './stereoStore';

// One panel below the canvas at a time: whichever opens closes every other, in every direction.
vi.mock('./nmrStore', () => ({ closeNmr: vi.fn() }));
vi.mock('./practice', () => ({ closePractice: vi.fn() }));
vi.mock('./safety', () => ({ closeSafety: vi.fn() }));
vi.mock('./stereoStore', () => ({ closeStereoisomers: vi.fn() }));

const CLOSERS: Record<BelowCanvas, () => void> = {
  practice: closePractice,
  nmr: closeNmr,
  stereoisomers: closeStereoisomers,
  safety: closeSafety,
};

describe('makeRoomFor', () => {
  afterEach(() => vi.clearAllMocks());

  it.each(Object.keys(CLOSERS) as BelowCanvas[])('opening %s closes each of the others, and not itself', (panel) => {
    makeRoomFor(panel);
    for (const [other, close] of Object.entries(CLOSERS)) {
      expect(close, other).toHaveBeenCalledTimes(other === panel ? 0 : 1);
    }
  });
});
