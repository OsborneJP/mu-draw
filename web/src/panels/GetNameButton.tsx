import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { getKetcher, subscribeKetcher } from '../editor/instance';
import { useOnline } from '../shell/useOnline';
import { closeName, getNameState, nameDrawing, subscribeNameState } from './naming';

// Get name (header): greyed while offline (it needs the server and PubChem), while the canvas
// has no atoms, and while a name is on its way. Any change to the drawing closes the panel.
export default function GetNameButton() {
  const ketcher = useSyncExternalStore(subscribeKetcher, getKetcher);
  const online = useOnline();
  const naming = useSyncExternalStore(subscribeNameState, getNameState).kind === 'naming';
  const subscribeDrawing = useCallback(
    (onChange: () => void) => {
      if (!ketcher) return () => {};
      ketcher.changeEvent.add(onChange);
      return () => ketcher.changeEvent.remove(onChange);
    },
    [ketcher],
  );
  const hasAtoms = useSyncExternalStore(subscribeDrawing, () =>
    ketcher ? ketcher.editor.struct().atoms.size > 0 : false,
  );

  useEffect(() => {
    if (!ketcher) return;
    ketcher.changeEvent.add(closeName);
    return () => ketcher.changeEvent.remove(closeName);
  }, [ketcher]);

  const reason = !online ? 'Needs an internet connection' : !hasAtoms ? 'Draw a structure to name it' : null;
  return (
    <button
      type="button"
      className="header-button"
      data-testid="app-get-name-button"
      disabled={!ketcher || reason !== null || naming}
      title={reason ?? "Look up this structure's name in PubChem"}
      onClick={() => ketcher && void nameDrawing(ketcher)}
    >
      {naming ? 'Naming…' : 'Get name'}
    </button>
  );
}
