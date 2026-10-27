import { useSyncExternalStore } from 'react';
import { makeRoomFor } from './belowCanvas';
import { getProtonState, predictProtonNmr, subscribeProtonState } from './protonStore';
import { countUse } from '../usage/start';

// The properties panel's "Predict ¹H NMR" button, tagged as a preview, beside the ¹³C one
// (docs/plans/v2-proton-nmr.md). The result shows in ProtonNmrPanel, docked below the canvas.
export default function ProtonNmrButton() {
  const state = useSyncExternalStore(subscribeProtonState, getProtonState);
  return (
    <section className="nmr-section" aria-label="¹H NMR">
      <h3>
        ¹H NMR <span className="preview-tag">Preview</span>
      </h3>
      <button
        type="button"
        className="nmr-predict"
        data-testid="proton-predict"
        disabled={state.kind === 'predicting'}
        onClick={() => {
          countUse('nmr-1h');
          makeRoomFor('proton'); // one panel below the canvas at a time
          predictProtonNmr();
        }}
      >
        Predict ¹H NMR
      </button>
    </section>
  );
}
