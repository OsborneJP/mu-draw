import { useSyncExternalStore } from 'react';
import type { NameOutcome } from '../api';
import {
  closeName,
  getNameState,
  NAME_MESSAGES,
  sameName,
  stereoNote,
  subscribeNameState,
  type DrawnState,
  type NameState,
} from './naming';
import './naming.css';

function PubChemLink({ url }: { url: string }) {
  // The app's one link out: opens PubChem in a new tab, without telling it where from.
  return (
    <a data-testid="name-pubchem-link" href={url} target="_blank" rel="noopener noreferrer">
      Open in PubChem
    </a>
  );
}

function StereoNote({ undefinedStereo }: { undefinedStereo: number }) {
  if (undefinedStereo === 0) return null;
  return (
    <p className="name-note" data-testid="name-stereo-note">
      {stereoNote(undefinedStereo)}
    </p>
  );
}

function Message({ kind }: { kind: keyof typeof NAME_MESSAGES }) {
  return (
    <p className="name-message" data-testid="name-message">
      {NAME_MESSAGES[kind]}
    </p>
  );
}

function OpsinMessage({ message }: { message: string | null }) {
  if (message === null) return null;
  return (
    <p className="name-opsin" data-testid="name-opsin-message">
      OPSIN: {message}
    </p>
  );
}

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
      <PubChemLink url={state.url} />
      <StereoNote undefinedStereo={state.undefinedStereo} />
    </>
  );
}

function RoundTrip({ typed, roundTrip }: { typed: string; roundTrip: NameOutcome | { kind: 'naming' } }) {
  if (roundTrip.kind !== 'found') {
    return (
      <p className="name-message" data-testid="name-roundtrip-message" data-state={roundTrip.kind}>
        {roundTrip.kind === 'naming' ? 'Asking PubChem for its name…' : NAME_MESSAGES[roundTrip.kind]}
      </p>
    );
  }
  const match = roundTrip.iupac !== null && sameName(typed, roundTrip.iupac);
  return (
    <>
      <dl>
        <dt>You typed</dt>
        <dd data-testid="name-typed">{typed}</dd>
        <dt>PubChem&apos;s IUPAC name</dt>
        <dd data-testid="name-roundtrip-iupac">
          {roundTrip.iupac ?? '—'}
          {match && (
            <span className="name-match" data-testid="name-match" aria-label="the same name">
              {' ✓'}
            </span>
          )}
        </dd>
      </dl>
      {!match && (
        <p className="name-differs" data-testid="name-differs">
          PubChem names this structure differently.
        </p>
      )}
      <PubChemLink url={roundTrip.url} />
      <StereoNote undefinedStereo={roundTrip.undefinedStereo} />
    </>
  );
}

function Drawn({ state }: { state: DrawnState }) {
  const { structure } = state;
  return (
    <>
      <p className="name-source" data-testid="name-source" data-source={structure.source}>
        {structure.source === 'OPSIN'
          ? 'Drawn from OPSIN.'
          : `Drawn from PubChem: ${structure.title ?? 'untitled'} (CID ${structure.cid}).`}
      </p>
      {structure.matches > 1 && (
        <p className="name-note" data-testid="name-matches">
          PubChem has {structure.matches} compounds by this name; this is its first.
        </p>
      )}
      {structure.stereoFromPubchem && (
        <p className="name-note" data-testid="name-stereo-source">
          OPSIN read this name without stereochemistry; PubChem&apos;s record specifies it.
        </p>
      )}
      <OpsinMessage message={structure.opsinMessage} />
      <RoundTrip typed={state.typed} roundTrip={state.roundTrip} />
    </>
  );
}

function Body({ state }: { state: Exclude<NameState, { kind: 'idle' }> }) {
  switch (state.kind) {
    case 'found':
      return <Found state={state} />;
    case 'drawn':
      return <Drawn state={state} />;
    case 'drawing':
      return (
        <p className="name-message" data-testid="name-message">
          Looking up “{state.typed}”…
        </p>
      );
    case 'no-compound':
      return (
        <>
          <OpsinMessage message={state.opsinMessage} />
          <Message kind="no-compound" />
        </>
      );
    default:
      return <Message kind={state.kind} />;
  }
}

// The naming panel (Get name, Name to structure), over the top-right of the canvas, clear of
// Ketcher's toolbars. It covers nothing it shouldn't for long: the next change to the
// drawing closes it.
export default function NamePanel() {
  const state = useSyncExternalStore(subscribeNameState, getNameState);
  if (state.kind === 'idle') return null;
  return (
    <section className="name-panel" aria-label="Name" data-testid="name-panel" data-state={state.kind}>
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
        <Body state={state} />
      </div>
    </section>
  );
}
