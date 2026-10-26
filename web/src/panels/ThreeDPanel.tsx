import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { getKetcher, subscribeKetcher } from '../editor/instance';
import Docked from './Docked';
import { OFFLINE, ONE_SHAPE, sourceLine, stereoNote, type ShownModel, type ThreeDMessage, type ThreeDState } from './threeD';
import { closeThreeD, getThreeDState, openThreeD, startThreeD, subscribeThreeDState } from './threeDStore';
import { browserDeps, FIRST_LOOK, showModel, type Look, type Style, type Viewer, type ViewerProblem } from './viewer3d';
import './threed.css';

// The 3D view (docs/plans/v2-3d-view.md), below the canvas like the ¹³C NMR preview: one model
// of the drawing, from PubChem or computed by RDKit, which the student turns with the mouse
// or a finger, in one of three styles, with where it came from in plain text (no link: the
// only link out of the app is Get name's). data-* attributes let the tests read it exactly.

const MESSAGES: Record<ThreeDMessage, string> = {
  empty: 'Draw a structure to see it in 3D.',
  reaction: 'The 3D view works on structures, not reactions.',
  'not-elements': 'The 3D view needs every atom to be an element, so R-groups, atom lists and query atoms are left out.',
  unreadable: "This structure can't be read, so there is no 3D model. Check it for errors such as a wrong valence.",
  'one-structure': 'The 3D view works on one structure at a time.',
  offline: OFFLINE,
  busy: 'Busy, try again shortly.',
  'not-responding': "The 3D service isn't responding. Your drawing is safe; try again in a minute.",
  'too-big': 'Too big for a 3D model here (more than 100 non-hydrogen atoms).',
  'no-model': 'RDKit could not build a 3D model of this structure. Some arrangements of bridged rings cannot exist.',
};

const PROBLEMS: Record<ViewerProblem, string> = {
  'no-webgl': "This browser can't show 3D graphics (WebGL is turned off).",
  unavailable: "The 3D viewer didn't load. Reload the app and try again.",
};

const STYLE_NAMES: Record<Style, string> = {
  'ball-and-stick': 'Ball and stick',
  sticks: 'Sticks',
  'space-filling': 'Space-filling',
};

function Model({ model }: { model: ShownModel }) {
  const box = useRef<HTMLDivElement>(null);
  const viewer = useRef<Viewer | null>(null);
  const [look, setLook] = useState<Look>(FIRST_LOOK);
  const lookNow = useRef(look);
  const [status, setStatus] = useState<'loading' | 'shown' | ViewerProblem>('loading');

  useEffect(() => {
    const element = box.current;
    if (!element) return;
    setStatus('loading');
    const shown = showModel(element, model.molblock, lookNow.current, browserDeps(() => setStatus('shown'), setStatus));
    viewer.current = shown;
    return () => {
      shown.close();
      viewer.current = null;
    };
  }, [model.molblock]);

  const change = (next: Look) => {
    lookNow.current = next;
    setLook(next);
    viewer.current?.setLook(next);
  };
  const note = stereoNote(model.undefinedStereo);
  return (
    <>
      <div
        ref={box}
        className="threed-viewer"
        data-testid="threed-viewer"
        data-viewer={status}
        data-style={look.style}
        data-hydrogens={look.hydrogens}
        role="img"
        aria-label="3D model of the drawing. Drag to turn it, scroll or pinch to zoom."
      />
      {status !== 'loading' && status !== 'shown' && (
        <p className="threed-message" data-testid="threed-problem" role="alert">
          {PROBLEMS[status]}
        </p>
      )}
      <div className="threed-controls">
        <fieldset className="threed-styles">
          <legend className="visually-hidden">Style</legend>
          {(Object.keys(STYLE_NAMES) as Style[]).map((style) => (
            <label key={style}>
              <input
                type="radio"
                name="threed-style"
                data-testid={`threed-style-${style}`}
                checked={look.style === style}
                onChange={() => change({ ...look, style })}
              />
              {STYLE_NAMES[style]}
            </label>
          ))}
        </fieldset>
        <label>
          <input
            type="checkbox"
            data-testid="threed-hydrogens"
            checked={look.hydrogens}
            onChange={(event) => change({ ...look, hydrogens: event.target.checked })}
          />
          Hydrogens
        </label>
        <button type="button" data-testid="threed-reset" onClick={() => viewer.current?.reset()}>
          Reset view
        </button>
      </div>
      <p className="threed-source" data-testid="threed-source">
        {sourceLine(model)}
      </p>
      <p className="threed-note" data-testid="threed-one-shape">
        {ONE_SHAPE}
      </p>
      {note && (
        <p className="threed-note" data-testid="threed-stereo-note">
          {note}
        </p>
      )}
    </>
  );
}

function Body({ state }: { state: ThreeDState }) {
  switch (state.kind) {
    case 'loading':
      return <p className="threed-message">Getting the 3D model…</p>;
    case 'stale':
      return (
        <p className="threed-message">
          The drawing has changed.{' '}
          <button type="button" data-testid="threed-again" onClick={openThreeD}>
            Show again
          </button>
        </p>
      );
    case 'message':
      return (
        <p className="threed-message" data-testid="threed-message" data-message={state.message}>
          {MESSAGES[state.message]}
        </p>
      );
    case 'ready':
      return <Model model={state.model} />;
    default:
      return null;
  }
}

export default function ThreeDPanel() {
  const ketcher = useSyncExternalStore(subscribeKetcher, getKetcher);
  const state = useSyncExternalStore(subscribeThreeDState, getThreeDState);
  useEffect(() => (ketcher ? startThreeD(ketcher) : undefined), [ketcher]);
  if (state.kind === 'idle' || !ketcher) return null;
  return (
    <Docked ketcher={ketcher} className="threed-panel" label="3D view" testId="threed-panel" state={state.kind}>
      <div className="threed-head">
        <h2>3D view</h2>
        <button type="button" className="threed-close" data-testid="threed-close" aria-label="Close" onClick={closeThreeD}>
          ×
        </button>
      </div>
      <Body state={state} />
    </Docked>
  );
}
