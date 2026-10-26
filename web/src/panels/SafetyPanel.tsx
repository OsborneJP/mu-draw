import { useSyncExternalStore } from 'react';
import { getKetcher, subscribeKetcher } from '../editor/instance';
import Docked from './Docked';
import { pictogramFile } from './ghsPictograms';
import { closeSafety, getSafetyState, subscribeSafetyState } from './safety';
import {
  credit,
  NOT_CLASSIFIED,
  noneListed,
  othersLine,
  REMINDER,
  SAFETY_MESSAGES,
  type GhsClassification,
  type SafetyOutcome,
} from './safetyAnswer';
import './safety.css';

// The safety snapshot (docs/plans/v2-safety-snapshot.md), docked below the canvas like the
// ¹³C NMR preview. Every word of a hazard is PubChem's; the app adds only the reminder, the
// headings and the credit. data-* attributes let tests compare it with the server's answer.

type Found = Extract<SafetyOutcome, { kind: 'found' }>;

function PubChemLink({ url }: { url: string }) {
  // The same link Get name gives (invariant 1): a new tab, not telling PubChem where from.
  return (
    <a data-testid="safety-pubchem-link" href={url} target="_blank" rel="noopener noreferrer">
      Open in PubChem
    </a>
  );
}

function Reminder() {
  return (
    <p className="safety-reminder" role="note" data-testid="safety-reminder">
      {REMINDER}
    </p>
  );
}

function Notes({ notes }: { notes: string[] }) {
  return notes.map((note, i) => (
    <p key={i} className="safety-note" data-testid="safety-note">
      {note}
    </p>
  ));
}

function Hazards({ c }: { c: GhsClassification }) {
  return (
    <>
      {c.signal && (
        <p className="safety-signal" data-testid="safety-signal" data-signal={c.signal}>
          {c.signal}
        </p>
      )}
      <ul className="safety-pictograms" aria-label="Hazard pictograms">
        {c.pictograms.map((p, i) => (
          <li key={i} data-testid="safety-pictogram" data-code={p.code}>
            <img src={`${import.meta.env.BASE_URL}${pictogramFile(p.code)}`} alt={p.name} width={56} height={56} />
            <span aria-hidden="true">{p.name}</span>
          </li>
        ))}
      </ul>
      <Notes notes={c.notes} />
      <ul className="safety-statements" aria-label="Hazard statements">
        {c.statements.map((s, i) => (
          <li
            key={i}
            data-testid="safety-statement"
            data-code={s.code}
            data-annex-note={s.annexNote ?? ''}
            data-share={s.share ?? ''}
          >
            <span className="safety-code">
              {s.code}
              {s.annexNote ? ` ${s.annexNote}` : ''}
            </span>{' '}
            <span className="safety-words">{s.words}</span>
            {s.share && <span className="safety-share"> ({s.share})</span>}
            {s.hazardClass && <span className="safety-class">{s.hazardClass}</span>}
          </li>
        ))}
      </ul>
    </>
  );
}

function Classification({ found, c }: { found: Found; c: GhsClassification }) {
  return (
    <>
      {c.notClassified ? (
        <>
          <p className="safety-not-classified" data-testid="safety-not-classified">
            {NOT_CLASSIFIED}
          </p>
          <Notes notes={c.notes} />
        </>
      ) : (
        <Hazards c={c} />
      )}
      {c.summary.length > 0 && (
        <details className="safety-summary" data-testid="safety-summary">
          <summary>About these notifications</summary>
          {c.summary.map((line, i) => (
            <p key={i}>{line}</p>
          ))}
        </details>
      )}
      <p className="safety-credit" data-testid="safety-credit" data-source={c.source}>
        {credit(c, found.cid)}
      </p>
    </>
  );
}

function Result({ found }: { found: Found }) {
  const { classification: c, others } = found;
  return (
    <>
      <p className="safety-compound" data-testid="safety-compound">
        {found.title ?? 'Untitled'}, PubChem CID {found.cid}
      </p>
      <Reminder />
      {c ? (
        <Classification found={found} c={c} />
      ) : (
        <p className="safety-message" data-testid="safety-none">
          {noneListed(found.cid)}
        </p>
      )}
      {others.count > 0 && (
        <p className="safety-others" data-testid="safety-others">
          {othersLine(others.count, others.sources)}
        </p>
      )}
      <PubChemLink url={found.url} />
    </>
  );
}

export default function SafetyPanel() {
  const ketcher = useSyncExternalStore(subscribeKetcher, getKetcher);
  const state = useSyncExternalStore(subscribeSafetyState, getSafetyState);
  if (state.kind === 'idle' || !ketcher) return null;
  return (
    <Docked ketcher={ketcher} className="safety-panel" label="Safety" testId="safety-panel" state={state.kind}>
      <div className="safety-head">
        <h2>Safety (GHS)</h2>
        <button type="button" className="safety-close" data-testid="safety-close" aria-label="Close" onClick={closeSafety}>
          ×
        </button>
      </div>
      <div role="status">
        {state.kind === 'found' ? (
          <Result found={state} />
        ) : (
          <>
            {state.kind === 'not-found' && <Reminder />}
            <p className="safety-message" data-testid="safety-message">
              {SAFETY_MESSAGES[state.kind]}
            </p>
          </>
        )}
      </div>
    </Docked>
  );
}
