import { useEffect, useSyncExternalStore } from 'react';
import { getKetcher, subscribeKetcher } from '../editor/instance';
import { useOnline } from '../shell/useOnline';
import { makeRoomFor } from './belowCanvas';
import { drawingChanged, getSafetyState, isAsking, lookUpSafety, subscribeSafetyState } from './safety';
import { useHasAtoms } from './useHasAtoms';

// Safety (header, after Get name): greyed while offline (it needs the server and PubChem),
// while the canvas has no atoms, and while a lookup is on its way. The drawing goes to the
// server only on a click. Any change to the drawing closes the panel (src/panels/safety.ts).
export default function SafetyButton() {
  const ketcher = useSyncExternalStore(subscribeKetcher, getKetcher);
  const online = useOnline();
  const asking = useSyncExternalStore(subscribeSafetyState, getSafetyState).kind === 'asking';
  const busy = useSyncExternalStore(subscribeSafetyState, isAsking);
  const hasAtoms = useHasAtoms(ketcher);

  useEffect(() => {
    if (!ketcher) return;
    ketcher.changeEvent.add(drawingChanged);
    return () => ketcher.changeEvent.remove(drawingChanged);
  }, [ketcher]);

  const reason = !online ? 'Needs an internet connection' : !hasAtoms ? 'Draw a structure to look up its hazards' : null;
  return (
    <button
      type="button"
      className="header-button"
      data-testid="app-safety-button"
      disabled={!ketcher || reason !== null || busy}
      title={reason ?? 'Look up GHS hazards for this structure in PubChem'}
      onClick={() => {
        if (!ketcher) return;
        makeRoomFor('safety'); // one panel below the canvas at a time
        void lookUpSafety(ketcher);
      }}
    >
      {asking ? 'Looking up…' : 'Safety'}
    </button>
  );
}
