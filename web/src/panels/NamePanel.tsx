import { useSyncExternalStore } from 'react';
import { closeName, getNameState, NAME_MESSAGES, stereoNote, subscribeNameState, type NameState } from './naming';
import './naming.css';

function Found({ state }: { state: Extract<NameState, { kind: 'found' }> }) {
  return (
    <>
      <dl>
        <dt>IUPAC name</dt>
        <dd data-testid="name-iupac">{state.iupac ?? '—'}</dd>
        <dt>PubChem title</dt>
        <dd data-testid="name-title">{state.title ?? '—'}</dd>
        <dt>CID</dt>
        <dd data-testid="name-cid">{state.cid}</dd>
      </dl>
      {/* The app's one link out: opens PubChem in a new tab, without telling it where from. */}
      <a data-testid="name-pubchem-link" href={state.url} target="_blank" rel="noopener noreferrer">
        Open in PubChem
      </a>
      {state.undefinedStereo > 0 && (
        <p className="name-note" data-testid="name-stereo-note">
          {stereoNote(state.undefinedStereo)}
        </p>
      )}
    </>
  );
}

// Get name's answer, over the top-right of the canvas, clear of Ketcher's toolbars. It covers
// nothing it shouldn't for long: the next change to the drawing closes it.
export default function NamePanel() {
  const state = useSyncExternalStore(subscribeNameState, getNameState);
  if (state.kind === 'idle') return null;
  return (
    <section className="name-panel" aria-label="Get name" data-testid="name-panel" data-state={state.kind}>
      <div className="name-panel-head">
        <h2>Name</h2>
        <button
          type="button"
          className="name-panel-close"
          data-testid="name-panel-close"
          aria-label="Close"
          onClick={closeName}
        >
          ×
        </button>
      </div>
      <div role="status">
        {state.kind === 'found' ? (
          <Found state={state} />
        ) : (
          <p className="name-message" data-testid="name-message">
            {NAME_MESSAGES[state.kind]}
          </p>
        )}
      </div>
    </section>
  );
}
