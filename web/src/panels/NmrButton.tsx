import { useSyncExternalStore } from 'react';
import { getNmrState, predictNmr, subscribeNmrState } from './nmrStore';
import { makeRoomFor } from './belowCanvas';

// The properties panel's "Predict ¹³C NMR" button, tagged as a preview (spec "NMR prediction
// proof of concept"). The result shows in NmrPanel, over the canvas.
export default function NmrButton() {
  const state = useSyncExternalStore(subscribeNmrState, getNmrState);
  return (
    <section className="nmr-section" aria-label="¹³C NMR">
      <h3>
        ¹³C NMR <span className="preview-tag">Preview</span>
      </h3>
      <button type="button" className="nmr-predict" data-testid="nmr-predict" disabled={state.kind === 'predicting'} onClick={() => {
          makeRoomFor('nmr'); // one panel below the canvas at a time
          predictNmr();
        }}>
        Predict ¹³C NMR
      </button>
    </section>
  );
}
