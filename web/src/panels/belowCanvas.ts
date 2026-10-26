// One panel below the canvas at a time (docs/plans/v2-practice-mode.md, "Merged with the
// stereoisomer panel"): Practice, the ¹³C NMR preview, the stereoisomers and the 3D view each
// dock there, so whichever opens closes the others. Every opener calls this first; closing Practice
// keeps its place, and closing an idle panel does nothing.
import { closeNmr } from './nmrStore';
import { closePractice } from './practice';
import { closeStereoisomers } from './stereoStore';
import { closeThreeD } from './threeDStore';

export type BelowCanvas = 'practice' | 'nmr' | 'stereoisomers' | 'threeD';

export function makeRoomFor(panel: BelowCanvas): void {
  if (panel !== 'practice') closePractice();
  if (panel !== 'nmr') closeNmr();
  if (panel !== 'stereoisomers') closeStereoisomers();
  if (panel !== 'threeD') closeThreeD();
}
