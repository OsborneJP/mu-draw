import { useSyncExternalStore } from 'react';
import { useOnline } from '../shell/useOnline';
import { makeRoomFor } from './belowCanvas';
import { OFFLINE } from './threeD';
import { getThreeDState, openThreeD, subscribeThreeDState } from './threeDStore';

// The properties panel's "Show in 3D" (docs/plans/v2-3d-view.md): the model comes from the
// server (PubChem's, or RDKit's), so it is greyed offline, with the reason in view. The model
// shows in ThreeDPanel, docked below the canvas.
export default function ThreeDButton() {
  const online = useOnline();
  const loading = useSyncExternalStore(subscribeThreeDState, getThreeDState).kind === 'loading';
  return (
    <section className="threed-section" aria-label="3D view">
      <h3>3D view</h3>
      <button
        type="button"
        className="threed-open"
        data-testid="threed-open"
        disabled={!online || loading}
        onClick={() => {
          makeRoomFor('threeD'); // one panel below the canvas at a time
          openThreeD();
        }}
      >
        Show in 3D
      </button>
      {!online && (
        <p className="threed-offline" data-testid="threed-offline">
          {OFFLINE}
        </p>
      )}
    </section>
  );
}
