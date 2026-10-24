import { useEffect, useState, useSyncExternalStore } from 'react';
import type { Ketcher } from 'ketcher-core';
import { createTracker, type PanelState } from '../chem/tracker';
import type { PanelValues } from '../chem/properties';
import { readDrawing } from '../editor/drawing';
import { getKetcher, subscribeKetcher } from '../editor/instance';
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
  const worker = new Worker(new URL('../chem/rdkitWorker.ts', import.meta.url), { name: 'rdkit' });
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

function Values({ values }: { values: PanelValues }) {
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
    </>
  );
}

export default function PropertiesPanel() {
  const ketcher = useSyncExternalStore(subscribeKetcher, getKetcher);
  const [state, setState] = useState<PanelState>({ kind: 'working', drawing: 0 });

  useEffect(() => {
    if (!ketcher) return;
    return startTracking(ketcher, setState);
  }, [ketcher]);

  const current = state.kind === 'ready' && state.revision === state.drawing;
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
      {state.kind === 'ready' && <Values values={state.values} />}
    </aside>
  );
}
