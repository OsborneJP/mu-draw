import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode, type RefObject } from 'react';
import type { Action, Ketcher } from 'ketcher-core';
import { startRdkitWorker } from '../chem/rdkitWorkers';
import { createTracker, type PanelState } from '../chem/tracker';
import type { PanelValues } from '../chem/properties';
import { readDrawing } from '../editor/drawing';
import { getKetcher, subscribeKetcher } from '../editor/instance';
import { addColoured, addHighlight, removeHighlight } from '../editor/stereoHighlight';
import FunctionalGroups from './FunctionalGroups';
import NmrButton from './NmrButton';
import './properties.css';

// Properties panel (spec section 2): RDKit's values for the drawing as it changes, worked
// out on the device in the RDKit worker (src/chem/rdkitWorker.ts). data-state lets tests
// wait for each step: working, ready (or updating, while a newer drawing is worked out),
// or the message state shown instead of numbers; data-atoms says which drawing the values
// describe (its atom count), for changes that leave the values the same.

const MESSAGES: Partial<Record<PanelState['kind'], string>> = {
  working: 'Calculating…',
  unavailable: 'Properties are unavailable: RDKit could not start.',
  empty: 'Draw a structure to see its properties',
  reaction: 'Properties are shown for structures, not reactions',
  'not-elements': 'Properties need every atom to be an element, so R-groups, atom lists and query atoms show none.',
  unreadable: "RDKit can't interpret this structure, so no properties are shown.",
};

function message(state: PanelState): string | undefined {
  if (state.kind !== 'invalid') return MESSAGES[state.kind];
  const n = state.atoms;
  return n === 1
    ? '1 atom has an impossible valence (underlined in red). Fix it to see the properties.'
    : `${n} atoms have an impossible valence (underlined in red). Fix them to see the properties.`;
}

function startTracking(ketcher: Ketcher, show: (state: PanelState) => void): () => void {
  const worker = startRdkitWorker('rdkit');
  const tracker = createTracker(
    () => readDrawing(ketcher),
    (request) => worker.postMessage(request),
    show,
  );
  worker.onmessage = (event) => tracker.reply(event.data);
  // The worker script didn't load or threw while starting.
  worker.onerror = (event) => {
    event.preventDefault();
    tracker.reply({ failed: event.message || 'the RDKit worker did not start' });
  };
  const onChange = () => tracker.changed();
  ketcher.changeEvent.add(onChange);
  tracker.changed(); // the drawing autosave put back, or an empty canvas
  return () => {
    ketcher.changeEvent.remove(onChange);
    worker.terminate();
  };
}

/** C9H8O4 with subscripts; a charge (RDKit writes +2) as a superscript 2+. */
function Formula({ formula }: { formula: string }) {
  const [, body, sign, size] = /^(.*?)(?:([+-])(\d*))?$/.exec(formula) ?? [];
  const parts = [...(body ?? '').matchAll(/([A-Z][a-z]?)(\d*)/g)];
  return (
    <dd data-testid="prop-formula" data-formula={formula}>
      {parts.map(([, symbol, count], i) => (
        <span key={i}>
          {symbol}
          {count && <sub>{count}</sub>}
        </span>
      ))}
      {sign && <sup>{`${size}${sign}`}</sup>}
    </dd>
  );
}

interface StereoProps {
  stereo: PanelValues['stereo'];
  /** The values are for the drawing as it is now, so its atoms can be highlighted. */
  current: boolean;
  highlighted: boolean;
  onToggle: () => void;
}

// Clicking either count highlights every stereo element on the canvas: defined ones blue,
// undefined ones amber (src/editor/stereoHighlight.ts); clicking again, or any change to
// the drawing, takes the highlight away.
function Stereo({ stereo, current, highlighted, onToggle }: StereoProps) {
  const total = stereo.centres + stereo.doubleBonds;
  const count = (n: number, testId: string, what: string) => (
    <button
      type="button"
      className="count-button"
      data-testid={testId}
      aria-pressed={highlighted}
      disabled={!current || n === 0}
      title={highlighted ? 'Hide them on the canvas' : `Show the ${what} on the canvas`}
      onClick={onToggle}
    >
      {n}
    </button>
  );
  return (
    <section className="stereo" aria-label="Stereochemistry">
      <h3>Stereochemistry</h3>
      <dl className="properties-list">
        <dt>Stereocenters</dt>
        <dd>{count(stereo.centres, 'stereo-centres', 'stereocenters and stereogenic double bonds')}</dd>
        <dt>Stereogenic double bonds</dt>
        <dd>{count(stereo.doubleBonds, 'stereo-double-bonds', 'stereocenters and stereogenic double bonds')}</dd>
        <dt>Undefined</dt>
        <dd className={stereo.undefined > 0 ? 'stereo-flag' : undefined}>
          {stereo.undefined > 0 && <span aria-hidden="true">⚠ </span>}
          <span data-testid="stereo-undefined">{stereo.undefined}</span>
        </dd>
        <dt>Stereoisomers, at most</dt>
        <dd data-testid="stereo-max">{stereo.maxStereoisomers}</dd>
      </dl>
      {stereo.undefined > 0 && (
        <p className="properties-note" data-testid="stereo-undefined-note">
          Undefined ones are drawn without a wedge, a hash or a fixed double-bond geometry.
        </p>
      )}
      {total >= 2 && (
        <p className="properties-note" data-testid="stereo-meso-note">
          Meso forms can make the real number of stereoisomers smaller.
        </p>
      )}
    </section>
  );
}

/** A highlight on the canvas, and the drawing it was made for. */
type Held = RefObject<{ removal: Action; drawing: number } | null>;

function drop(ketcher: Ketcher, held: Held): void {
  if (!held.current) return;
  removeHighlight(ketcher, held.current.removal);
  held.current = null;
}

/** Colour the functional groups of `state` on the canvas, if it describes the drawing as it
 * is now and they aren't coloured already. Called as each state arrives and when the
 * checkbox is ticked, both in step with the drawing, so the colours are never for another. */
function colourGroups(ketcher: Ketcher, held: Held, state: PanelState): void {
  if (held.current || state.kind !== 'ready' || state.revision !== state.drawing) return;
  if (state.groups.kind !== 'found') return;
  const parts = state.groups.groups.map((g) => ({
    atoms: g.instances.flatMap((i) => i.atoms),
    bonds: g.instances.flatMap((i) => i.bonds),
    color: g.color,
  }));
  held.current = { removal: addColoured(ketcher, parts), drawing: state.drawing };
}

function Values({ values, children }: { values: PanelValues; children: ReactNode }) {
  return (
    <>
      {values.fragments > 1 && (
        <p className="properties-note" data-testid="properties-note">
          {values.fragments} structures drawn: the values are for the whole drawing.
        </p>
      )}
      <dl className="properties-list">
        <dt>Formula</dt>
        <Formula formula={values.formula} />
        <dt>Average MW (g/mol)</dt>
        <dd data-testid="prop-average-mw">{values.averageMw}</dd>
        <dt>Exact mass</dt>
        <dd data-testid="prop-exact-mass">{values.exactMass}</dd>
        <dt>Degree of unsaturation</dt>
        <dd data-testid="prop-dou">{values.degreeOfUnsaturation}</dd>
        <dt>H-bond donors (NH + OH)</dt>
        <dd data-testid="prop-hbd">{values.hbd}</dd>
        <dt>H-bond acceptors (N + O)</dt>
        <dd data-testid="prop-hba">{values.hba}</dd>
        <dt>Rotatable bonds</dt>
        <dd data-testid="prop-rotatable">{values.rotatableBonds}</dd>
        <dt>TPSA (Å²)</dt>
        <dd data-testid="prop-tpsa">{values.tpsa}</dd>
        <dt>logP (Crippen estimate)</dt>
        <dd data-testid="prop-logp">{values.logp}</dd>
      </dl>
      <section className="lipinski" aria-label="Lipinski's rule of 5">
        <h3>Lipinski&apos;s rule of 5</h3>
        <ul>
          {values.lipinski.map((row) => (
            <li key={row.rule} data-testid={`lipinski-${row.rule}`} data-pass={row.pass}>
              <span className="lipinski-mark" aria-hidden="true">
                {row.pass ? '✓' : '✗'}
              </span>
              <span className="lipinski-label">{row.label}</span>
              <span className="lipinski-value">{row.value}</span>
              <span className="visually-hidden">{row.pass ? 'pass' : 'fail'}</span>
            </li>
          ))}
        </ul>
        <p data-testid="lipinski-summary">{values.lipinskiSummary}</p>
      </section>
      {children}
    </>
  );
}

export default function PropertiesPanel() {
  const ketcher = useSyncExternalStore(subscribeKetcher, getKetcher);
  const [state, setState] = useState<PanelState>({ kind: 'working', drawing: 0 });
  // The highlight on the canvas, and the drawing it was made for.
  const highlight = useRef<{ removal: Action; drawing: number } | null>(null);
  const [highlighted, setHighlighted] = useState(false);
  // The functional groups' colours, whether they are wanted, and the newest state (refs, so
  // the tracker's callback and the checkbox see them at once, not at the next render).
  const groupColours = useRef<{ removal: Action; drawing: number } | null>(null);
  const [groupsShown, setGroupsShown] = useState(false);
  const groupsWanted = useRef(false);
  const latest = useRef<PanelState>(state);

  useEffect(() => {
    if (!ketcher) return;
    const unhighlight = () => {
      if (!highlight.current) return;
      removeHighlight(ketcher, highlight.current.removal);
      highlight.current = null;
      setHighlighted(false);
    };
    // The tracker calls this once Ketcher has finished applying a change, so the highlights
    // go with the drawing they were made for, before anything else can happen, and the
    // groups of a new drawing are coloured the moment its values arrive.
    const show = (next: PanelState) => {
      latest.current = next;
      if (highlight.current && highlight.current.drawing !== next.drawing) unhighlight();
      if (groupColours.current && groupColours.current.drawing !== next.drawing) drop(ketcher, groupColours);
      if (groupsWanted.current) colourGroups(ketcher, groupColours, next);
      setState(next);
    };
    const stop = startTracking(ketcher, show);
    return () => {
      stop();
      unhighlight();
      drop(ketcher, groupColours);
    };
  }, [ketcher]);

  const showGroups = (shown: boolean) => {
    groupsWanted.current = shown;
    setGroupsShown(shown);
    if (!ketcher) return;
    if (shown) colourGroups(ketcher, groupColours, latest.current);
    else drop(ketcher, groupColours);
  };

  const current = state.kind === 'ready' && state.revision === state.drawing;
  // The count buttons are disabled unless the values are for the drawing as it is now.
  const toggle = () => {
    if (!ketcher || state.kind !== 'ready') return;
    if (highlight.current) {
      removeHighlight(ketcher, highlight.current.removal);
      highlight.current = null;
      setHighlighted(false);
    } else {
      highlight.current = { removal: addHighlight(ketcher, state.stereo), drawing: state.drawing };
      setHighlighted(true);
    }
  };
  const dataState = state.kind === 'ready' ? (current ? 'ready' : 'updating') : state.kind;
  const text = message(state);
  return (
    <aside
      className="properties-panel"
      aria-label="Properties"
      data-testid="properties-panel"
      data-state={dataState}
      data-atoms={state.kind === 'ready' ? state.atoms : undefined}
    >
      <h2>Properties</h2>
      {/* Always in the page, so screen readers announce a message when it appears. */}
      <p role="status" className="properties-message" data-testid="properties-message">
        {text}
      </p>
      {state.kind === 'ready' && (
        <Values values={state.values}>
          <Stereo stereo={state.values.stereo} current={current} highlighted={highlighted} onToggle={toggle} />
          <FunctionalGroups groups={state.groups} shown={groupsShown} onShow={showGroups} />
          <NmrButton />
        </Values>
      )}
    </aside>
  );
}
