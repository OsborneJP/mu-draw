import type { FormsKind } from '../chem/formPictures';
import { makeRoomFor } from './belowCanvas';
import { showForms } from './formsStore';

// The properties panel's "Tautomers and resonance" section (docs/plans/v2-tautomers-
// resonance.md): two buttons for one structure; for more, a note instead. The lists show in
// FormsPanel, docked below the canvas.
export default function FormsButtons({ fragments }: { fragments: number }) {
  const open = (kind: FormsKind) => {
    makeRoomFor(kind); // one panel below the canvas at a time
    showForms(kind);
  };
  return (
    <section className="forms-section" aria-label="Tautomers and resonance">
      <h3>Tautomers and resonance</h3>
      {fragments > 1 ? (
        <p className="properties-note" data-testid="forms-one-at-a-time">
          Tautomers and resonance structures are listed for one structure at a time. For a salt, draw the ion on its own.
        </p>
      ) : (
        <div className="forms-buttons">
          <button type="button" data-testid="tautomers-show" onClick={() => open('tautomers')}>
            Show tautomers
          </button>
          <button type="button" data-testid="resonance-show" onClick={() => open('resonance')}>
            Show resonance structures
          </button>
        </div>
      )}
    </section>
  );
}
