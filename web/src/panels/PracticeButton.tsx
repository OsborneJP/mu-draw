import { useSyncExternalStore } from 'react';
import { getPracticeState, subscribePractice, togglePractice } from './practice';

// Practice (header): opens and closes the practice panel below the canvas. It works offline:
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
      onClick={togglePractice}
    >
      Practice
    </button>
  );
}
