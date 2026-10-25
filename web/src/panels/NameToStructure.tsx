import { useState, useSyncExternalStore } from 'react';
import { getKetcher, subscribeKetcher } from '../editor/instance';
import { placeInHand } from '../editor/placeInHand';
import { useOnline } from '../shell/useOnline';
import { drawName, isBusy, subscribeNameState } from './naming';
import { useHasAtoms } from './useHasAtoms';

const OFFLINE = 'Needs an internet connection';

// Name to structure (header): type a name, then Add (the compound follows the mouse until a
// click places it) or Replace. Enter does Add while the canvas has atoms, else Replace. The
// answer and its round trip show in the naming panel (src/panels/naming.ts). Greyed offline
// and while a request is on its way or a compound is in hand.
export default function NameToStructure() {
  const ketcher = useSyncExternalStore(subscribeKetcher, getKetcher);
  const online = useOnline();
  const busy = useSyncExternalStore(subscribeNameState, isBusy);
  const hasAtoms = useHasAtoms(ketcher);
  const [name, setName] = useState('');
  const typed = name.trim();
  const usable = Boolean(ketcher) && online && !busy;
  const canDraw = usable && typed !== '';

  function draw(mode: 'add' | 'replace') {
    if (ketcher && canDraw) void drawName(ketcher, typed, mode, placeInHand);
  }

  return (
    <span className="name-to-structure">
      <input
        type="text"
        className="name-to-structure-input"
        data-testid="name-to-structure-input"
        aria-label="Name to structure"
        placeholder="Name to structure"
        maxLength={300}
        spellCheck={false}
        autoComplete="off"
        value={name}
        disabled={!usable}
        title={online ? 'Type a chemical name, then Add or Replace (Enter adds when there is a drawing)' : OFFLINE}
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') draw(hasAtoms ? 'add' : 'replace');
        }}
      />
      <button
        type="button"
        className="header-button"
        data-testid="name-to-structure-add"
        disabled={!canDraw}
        title={online ? 'Pick up the structure, then click on the canvas to place it' : OFFLINE}
        onClick={() => draw('add')}
      >
        Add
      </button>
      <button
        type="button"
        className="header-button"
        data-testid="name-to-structure-replace"
        disabled={!canDraw}
        title={online ? 'Clear the drawing, then draw the structure' : OFFLINE}
        onClick={() => draw('replace')}
      >
        Replace
      </button>
    </span>
  );
}
