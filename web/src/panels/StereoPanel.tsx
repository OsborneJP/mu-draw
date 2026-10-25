import { useEffect, useSyncExternalStore, type ReactNode } from 'react';
import type { Pictured, StereoResult } from '../chem/stereoPictures';
import { PICTURE } from '../chem/stereoPictures';
import type { Note } from '../chem/stereoisomers';
import { getKetcher, subscribeKetcher } from '../editor/instance';
import Docked from './Docked';
import type { StereoMessage, StereoState } from './stereo';
import { addStereoisomer, closeStereoisomers, getStereoState, startStereo, subscribeStereoState } from './stereoStore';
import './stereo.css';

// The stereoisomers (docs/plans/v2-stereoisomers.md), below the canvas like the ¹³C NMR
// preview: one numbered picture each, R/S drawn by RDKit at its atom and E/Z beside its double
// bond (never as a caption: RDKit has no IUPAC numbering), how each relates to the others,
// which match the drawing, and Add to put one in hand. data-* attributes let the tests read
// every card exactly.

const MESSAGES: Record<StereoMessage, string> = {
  empty: 'Draw a structure to list its stereoisomers.',
  reaction: 'Stereoisomers are listed for structures, not reactions.',
  'not-elements': 'Stereoisomers need every atom to be an element, so R-groups, atom lists and query atoms are left out.',
  unreadable: "RDKit can't interpret this structure, so no stereoisomers are listed.",
  unavailable: 'Stereoisomers are unavailable',
};

const NOTES: Record<Note, string> = {
  bridged: 'In a bridged ring system some of these cannot exist, and stereo at a bridgehead nitrogen is missed: RDKit cannot check that without 3D.',
  'axial-planar':
    'This structure may be chiral about an axis or a plane (an allene, a biaryl, or a double bond in a ring). RDKit cannot judge that kind of chirality, so it lists no mirror images for it and calls nothing here achiral or meso.',
};

const PSEUDO_NOTE = 'Lowercase r, s, e and z are pseudo-asymmetric labels: they depend on the R and S of the groups around them.';
const DIASTEREOMERS = 'Any two that are not enantiomers are diastereomers.';
const UNDRAWABLE = 'RDKit can’t draw this one flat as itself.';

function relation(isomer: Pictured): string | null {
  switch (isomer.relation.kind) {
    case 'enantiomer':
      return `Enantiomer of ${isomer.relation.of}`;
    case 'achiral':
      return 'Achiral';
    case 'meso':
      return 'Meso';
    case 'unjudged':
      return null;
  }
}

function Notes({ notes, pseudo = false }: { notes: Note[]; pseudo?: boolean }) {
  return (
    <>
      {notes.map((note) => (
        <p key={note} className="stereo-note" data-testid="stereo-note" data-note={note}>
          {NOTES[note]}
        </p>
      ))}
      {pseudo && (
        <p className="stereo-note" data-testid="stereo-note" data-note="pseudo-asymmetric">
          {PSEUDO_NOTE}
        </p>
      )}
    </>
  );
}

function Card({ isomer, inHand }: { isomer: Pictured; inHand: boolean }) {
  const said = relation(isomer);
  const { picture } = isomer;
  return (
    <div
      className="stereo-card"
      data-testid="stereo-card"
      data-number={isomer.number}
      data-inchikey={isomer.inchikey}
      data-relation={isomer.relation.kind}
      data-of={isomer.relation.kind === 'enantiomer' ? isomer.relation.of : undefined}
      data-matches={isomer.matches}
      data-drawn={picture !== null}
      data-in-hand={inHand}
    >
      <div className="stereo-card-head">
        <span className="stereo-number">{isomer.number}</span>
        {isomer.matches && <span className="stereo-match">Matches your drawing</span>}
      </div>
      <div
        className="stereo-picture"
        style={{ width: PICTURE.width, height: PICTURE.height }}
        data-atom-labels={picture === null ? undefined : JSON.stringify(picture.atomLabels)}
      >
        {picture === null ? (
          <p className="stereo-undrawable" data-testid="stereo-undrawable">
            {UNDRAWABLE}
          </p>
        ) : (
          <>
            <img
              src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(picture.svg)}`}
              width={PICTURE.width}
              height={PICTURE.height}
              alt={`Stereoisomer ${isomer.number}`}
            />
            {picture.labels.map((l) => (
              <span key={l.bond} className="stereo-label" data-testid="stereo-label" data-bond={l.bond} style={{ left: l.x, top: l.y }}>
                {l.text}
              </span>
            ))}
          </>
        )}
      </div>
      <div className="stereo-card-foot">
        <span className="stereo-relation">{said}</span>
        {picture !== null && (
          <button
            type="button"
            data-testid="stereo-add"
            aria-label={`${inHand ? 'In hand' : 'Add'}: stereoisomer ${isomer.number}`}
            onClick={() => addStereoisomer(isomer.number)}
          >
            {inHand ? 'In hand' : 'Add'}
          </button>
        )}
      </div>
    </div>
  );
}

/** The stereoisomers in their order, each enantiomer pair kept together in one group. */
function grouped(isomers: Pictured[]): Pictured[][] {
  const groups: Pictured[][] = [];
  for (const isomer of isomers) {
    const last = groups.at(-1);
    const pairsWithLast =
      last?.length === 1 && last[0].relation.kind === 'enantiomer' && last[0].relation.of === isomer.number;
    if (pairsWithLast) last.push(isomer);
    else groups.push([isomer]);
  }
  return groups;
}

interface ListedProps {
  result: Extract<StereoResult, { outcome: 'listed' }>;
  inHand: number | null;
  failedAdd: number | null;
}

function Listed({ result, inHand, failedAdd }: ListedProps) {
  const pseudo = result.stereoisomers.some((s) =>
    [...Object.values(s.labels.atoms), ...Object.values(s.labels.bonds)].some((l) => l === l.toLowerCase()),
  );
  const n = result.stereoisomers.length;
  return (
    <>
      <p className="stereo-summary" data-testid="stereo-summary">
        {n === 1 ? '1 stereoisomer.' : `${n} stereoisomers. ${DIASTEREOMERS}`}
      </p>
      {/* Stays at the top of the panel while the cards scroll beneath it. */}
      <div className="stereo-status">
        {inHand !== null && (
          <p className="stereo-hint" data-testid="stereo-hint" role="status">
            Stereoisomer {inHand} is in hand: click the canvas to place it, or press Esc.
          </p>
        )}
        {failedAdd !== null && (
          <p className="stereo-hint" data-testid="stereo-add-failed" role="alert">
            Stereoisomer {failedAdd} could not be put in hand. Try Add again.
          </p>
        )}
      </div>
      <Notes notes={result.notes} pseudo={pseudo} />
      <ol className="stereo-cards">
        {grouped(result.stereoisomers).map((group) => (
          <li key={group[0].number} className="stereo-group" data-testid="stereo-group">
            {group.map((isomer) => (
              <Card key={isomer.number} isomer={isomer} inHand={inHand === isomer.number} />
            ))}
          </li>
        ))}
      </ol>
    </>
  );
}

function Message({ children }: { children: ReactNode }) {
  return (
    <p className="stereo-message" data-testid="stereo-message">
      {children}
    </p>
  );
}

function Ready({ result, inHand, failedAdd }: { result: StereoResult; inHand: number | null; failedAdd: number | null }) {
  switch (result.outcome) {
    case 'listed':
      return <Listed result={result} inHand={inHand} failedAdd={failedAdd} />;
    case 'counted':
      return (
        <>
          <Message>{result.count} stereoisomers: too many to draw here.</Message>
          <Notes notes={result.notes} />
        </>
      );
    case 'too-many':
      return (
        <>
          <Message>{result.elements} stereocentres and stereogenic double bonds: too many to list here.</Message>
          <Notes notes={result.notes} />
        </>
      );
    case 'several':
      return <Message>Stereoisomers are listed for one structure at a time.</Message>;
    case 'no-elements':
      return (
        <>
          <Message>RDKit finds no stereocentres or stereogenic double bonds in this structure.</Message>
          <Notes notes={result.notes} />
        </>
      );
  }
}

function Body({ state }: { state: StereoState }) {
  switch (state.kind) {
    case 'working':
      return <p className="stereo-message">Working…</p>;
    case 'message':
      return (
        <p className="stereo-message" data-testid="stereo-message">
          {MESSAGES[state.message]}
          {state.detail ? `: ${state.detail}.` : ''}
        </p>
      );
    case 'ready':
      return <Ready result={state.result} inHand={state.inHand} failedAdd={state.failedAdd} />;
    default:
      return null;
  }
}

export default function StereoPanel() {
  const ketcher = useSyncExternalStore(subscribeKetcher, getKetcher);
  const state = useSyncExternalStore(subscribeStereoState, getStereoState);
  useEffect(() => (ketcher ? startStereo(ketcher) : undefined), [ketcher]);
  if (state.kind === 'idle' || !ketcher) return null;
  return (
    <Docked ketcher={ketcher} className="stereo-panel" label="Stereoisomers" testId="stereo-panel" state={state.kind}>
      <div className="stereo-head">
        <h2>Stereoisomers</h2>
        <button type="button" className="stereo-close" data-testid="stereo-close" aria-label="Close" onClick={closeStereoisomers}>
          ×
        </button>
      </div>
      <Body state={state} />
    </Docked>
  );
}
