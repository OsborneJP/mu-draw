import { useSyncExternalStore } from 'react';
import { makeRoomFor } from './belowCanvas';
import { getPracticeState, subscribePractice, togglePractice } from './practice';

// Practice (header): opens and closes the practice panel below the canvas (closing the NMR
// preview or the stereoisomers, belowCanvas.ts). It works offline:
// the lists ship with the app and the checking happens on the device.
export default function PracticeButton() {
  const open = useSyncExternalStore(subscribePractice, getPracticeState).open;
  return (
    <button
      type="button"
      className="header-button"
      data-testid="app-practice-button"
      aria-pressed={open}
      title="Draw a structure from its name, then check it"
      onClick={() => {
        if (!open) makeRoomFor('practice'); // one panel below the canvas at a time
        togglePractice();
      }}
    >
      Practice
    </button>
  );
}
