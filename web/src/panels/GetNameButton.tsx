import { useEffect, useSyncExternalStore } from 'react';
import { getKetcher, subscribeKetcher } from '../editor/instance';
import { useOnline } from '../shell/useOnline';
import { drawingChanged, getNameState, isBusy, nameDrawing, subscribeNameState } from './naming';
import { useHasAtoms } from './useHasAtoms';

// Get name (header): greyed while offline (it needs the server and PubChem), while the canvas
// has no atoms, and while a request is on its way. Any change to the drawing closes the panel
// (src/panels/naming.ts).
export default function GetNameButton() {
  const ketcher = useSyncExternalStore(subscribeKetcher, getKetcher);
  const online = useOnline();
  const naming = useSyncExternalStore(subscribeNameState, getNameState).kind === 'naming';
  const busy = useSyncExternalStore(subscribeNameState, isBusy);
  const hasAtoms = useHasAtoms(ketcher);

  useEffect(() => {
    if (!ketcher) return;
    ketcher.changeEvent.add(drawingChanged);
    return () => ketcher.changeEvent.remove(drawingChanged);
  }, [ketcher]);

  const reason = !online ? 'Needs an internet connection' : !hasAtoms ? 'Draw a structure to name it' : null;
  return (
    <button
      type="button"
      className="header-button"
      data-testid="app-get-name-button"
      disabled={!ketcher || reason !== null || busy}
      title={reason ?? "Look up this structure's name in PubChem"}
      onClick={() => ketcher && void nameDrawing(ketcher)}
    >
      {naming ? 'Naming…' : 'Get name'}
    </button>
  );
}
