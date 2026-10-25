import { useEffect, useSyncExternalStore } from 'react';
import type { Pictured, StereoResult } from '../chem/stereoPictures';
import { PICTURE } from '../chem/stereoPictures';
import type { Note } from '../chem/stereoisomers';
import { getKetcher, subscribeKetcher } from '../editor/instance';
import Docked from './Docked';
import type { StereoMessage, StereoState } from './stereo';
import { addStereoisomer, closeStereoisomers, getStereoState, startStereo, subscribeStereoState } from './stereoStore';
import './stereo.css';

// The stereoisomers (docs/plans/v2-stereoisomers.md), below the canvas like the ¹³C NMR
// preview: one numbered picture each, R/S and E/Z beside the atoms (never as a caption: RDKit
// has no IUPAC numbering), how each relates to the others, which match the drawing, and Add
// to put one in hand. data-* attributes let the tests read every card exactly.

const MESSAGES: Record<StereoMessage, string> = {
  empty: 'Draw a structure to list its stereoisomers.',
  reaction: 'Stereoisomers are listed for structures, not reactions.',
  'not-elements': 'Stereoisomers need every atom to be an element, so R-groups, atom lists and query atoms are left out.',
  unreadable: "RDKit can't interpret this structure, so no stereoisomers are listed.",
  unavailable: 'Stereoisomers are unavailable',
};

const NOTES: Record<Note, string> = {
  bridged: 'In a bridged ring system some of these cannot exist: RDKit cannot check that without 3D.',
  'axial-planar':
    'This structure has an axis or plane of chirality (an allene, a biaryl, or a double bond in a large ring), which RDKit cannot judge, so none of these is called achiral.',
};

const PSEUDO_NOTE = 'Lowercase r and s mark pseudo-asymmetric centres.';
const DIASTEREOMERS = 'Any two that are not enantiomers are diastereomers.';

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

function Card({ isomer, inHand }: { isomer: Pictured; inHand: boolean }) {
  const src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(isomer.picture.svg)}`;
  const said = relation(isomer);
  return (
    <li
      className="stereo-card"
      data-testid="stereo-card"
      data-number={isomer.number}
      data-inchikey={isomer.inchikey}
      data-relation={isomer.relation.kind}
      data-of={isomer.relation.kind === 'enantiomer' ? isomer.relation.of : undefined}
      data-matches={isomer.matches}
      data-in-hand={inHand}
    >
      <div className="stereo-card-head">
        <span className="stereo-number">{isomer.number}</span>
        {isomer.matches && <span className="stereo-match">Matches your drawing</span>}
      </div>
      <div className="stereo-picture" style={{ width: PICTURE.width, height: PICTURE.height }}>
        <img src={src} width={PICTURE.width} height={PICTURE.height} alt={`Stereoisomer ${isomer.number}`} />
        {isomer.picture.labels.map((l) => (
          <span
            key={l.atom ?? l.bond}
            className="stereo-label"
            data-testid="stereo-label"
            data-atom={l.atom}
            data-bond={l.bond}
            style={{ left: l.x, top: l.y }}
          >
            {l.text}
          </span>
        ))}
      </div>
      <div className="stereo-card-foot">
        <span className="stereo-relation">{said}</span>
        <button type="button" data-testid="stereo-add" onClick={() => addStereoisomer(isomer.number)}>
          {inHand ? 'In hand: click the canvas' : 'Add'}
        </button>
      </div>
    </li>
  );
}

function Listed({ result, inHand }: { result: Extract<StereoResult, { outcome: 'listed' }>; inHand: number | null }) {
  const pseudo = result.stereoisomers.some((s) => Object.values(s.labels.atoms).some((l) => l === 'r' || l === 's'));
  const n = result.stereoisomers.length;
  return (
    <>
      <p className="stereo-summary" data-testid="stereo-summary">
        {n === 1 ? '1 stereoisomer.' : `${n} stereoisomers.`} {n > 1 && DIASTEREOMERS}
      </p>
      {result.notes.map((note) => (
        <p key={note} className="stereo-note" data-testid="stereo-note" data-note={note}>
          {NOTES[note]}
        </p>
      ))}
      {pseudo && (
        <p className="stereo-note" data-testid="stereo-note" data-note="pseudo-asymmetric">
          {PSEUDO_NOTE}
        </p>
      )}
      <ol className="stereo-cards">
        {result.stereoisomers.map((isomer) => (
          <Card key={isomer.number} isomer={isomer} inHand={inHand === isomer.number} />
        ))}
      </ol>
    </>
  );
}

function Ready({ result, inHand }: { result: StereoResult; inHand: number | null }) {
  switch (result.outcome) {
    case 'listed':
      return <Listed result={result} inHand={inHand} />;
    case 'counted':
      return (
        <p className="stereo-message" data-testid="stereo-message">
          {result.count} stereoisomers: too many to draw here.
        </p>
      );
    case 'too-many':
      return (
        <p className="stereo-message" data-testid="stereo-message">
          {result.elements} stereocentres and stereogenic double bonds: too many to list here.
        </p>
      );
    case 'several':
      return (
        <p className="stereo-message" data-testid="stereo-message">
          Stereoisomers are listed for one structure at a time.
        </p>
      );
    case 'no-elements':
      return (
        <p className="stereo-message" data-testid="stereo-message">
          This structure has no stereocentres or stereogenic double bonds.
        </p>
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
      return <Ready result={state.result} inHand={state.inHand} />;
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
