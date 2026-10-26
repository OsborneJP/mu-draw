import { useEffect, useState, useSyncExternalStore } from 'react';
import { getKetcher, subscribeKetcher } from '../editor/instance';
import Docked from './Docked';
import { BANNER } from './nmr';
import NmrNotice from './NmrNotice';
import { axisRange, PLOT, sticks, xOf, type ProtonMessage, type ProtonState, type ShownSignal } from './protonNmr';
import { closeProton, getProtonState, predictProtonNmr, selectSignal, startProton, subscribeProtonState } from './protonStore';
import './nmr.css';
import './protonNmr.css';

// The ¹H NMR preview's result (docs/plans/v2-proton-nmr.md), below the canvas like the ¹³C
// one (NmrPanel): the spec's banner, NMRShiftDB2's licence notice, a stick spectrum on a
// reversed axis whose sticks are as tall as their number of H (the integration; signals
// drawn closer than a line's width make one stick, as tall as their H together), and the
// signal table. Clicking a stick or a row selects that signal and colours the atoms carrying
// its H; selecting such an atom on the canvas selects its signal. data-state and the rows'
// data-* attributes let tests read it exactly.

const MESSAGES: Record<ProtonMessage, string> = {
  empty: 'Draw a structure to predict its ¹H NMR spectrum.',
  reaction: '¹H NMR is predicted for structures, not reactions.',
  'not-elements': '¹H NMR needs every atom to be an element, so R-groups, atom lists and query atoms are left out.',
  unreadable: "RDKit can't interpret this structure, so no spectrum is predicted.",
  'no-hydrogens': 'There are no hydrogen atoms to predict.',
  unavailable: 'The ¹H NMR preview is unavailable',
};

const HEIGHT = 150;
const BASE = 118;
const TOP = 12;

/** "low confidence", "exchangeable", "diastereotopic", as they apply. */
function note(s: ShownSignal): string {
  return [s.shift === null ? 'no match' : s.low ? 'low confidence' : '', s.exchangeable ? 'exchangeable' : '', s.diastereotopic ? 'diastereotopic' : '']
    .filter((n) => n !== '')
    .join(', ');
}

function Spectrum({ signals, selected, tms }: { signals: ShownSignal[]; selected: number | null; tms: boolean }) {
  const range = axisRange(signals);
  const x = (ppm: number) => xOf(ppm, range);
  const drawn = sticks(signals, range);
  const most = Math.max(...drawn.map((d) => d.hydrogens));
  const ticks = Array.from({ length: range.max - range.min + 1 }, (_, i) => range.max - i);
  return (
    <svg
      className="nmr-spectrum"
      viewBox={`0 0 ${PLOT.width} ${HEIGHT}`}
      role="img"
      aria-label={`Predicted ¹H NMR stick spectrum, ${range.max} to ${range.min} ppm`}
      data-testid="proton-spectrum"
      data-max={range.max}
      data-min={range.min}
    >
      <line className="nmr-axis" x1={x(range.max)} x2={x(range.min)} y1={BASE} y2={BASE} />
      {ticks.map((ppm) => (
        <g key={ppm}>
          <line className="nmr-axis" x1={x(ppm)} x2={x(ppm)} y1={BASE} y2={BASE + 4} />
          <text className="nmr-tick" data-testid="proton-tick" x={x(ppm)} y={BASE + 16} textAnchor="middle">
            {ppm}
          </text>
        </g>
      ))}
      <text className="nmr-tick" x={x(range.min)} y={BASE + 30} textAnchor="end">
        δ (ppm)
      </text>
      {tms && (
        <g data-testid="proton-tms">
          <line className="nmr-tms" x1={x(0)} x2={x(0)} y1={TOP} y2={BASE} />
          <text className="nmr-tick" x={x(0) - 3} y={TOP + 8} textAnchor="end">
            TMS
          </text>
        </g>
      )}
      {drawn.map((d) => {
        const height = (BASE - TOP) * (d.hydrogens / most);
        return (
          <g
            key={d.signals[0]}
            className={`nmr-stick${d.exchangeable ? ' proton-exchangeable' : ''}`}
            data-testid="proton-stick"
            data-index={d.signals[0]}
            data-signals={d.signals.join(' ')}
            data-hydrogens={d.hydrogens}
            data-selected={selected !== null && d.signals.includes(selected)}
            data-low={d.low}
            role="button"
            aria-label={`${d.signals.map((i) => signals[i].shift).join(', ')} ppm, ${d.hydrogens}H`}
            onClick={() => selectSignal(d.signals[0])}
          >
            {/* A wider, invisible target, so a stick is easy to click; it stops halfway to its
                neighbours, so it never covers another stick. */}
            <rect x={d.from} y={TOP} width={d.to - d.from} height={BASE - TOP} fill="transparent" />
            <line x1={d.x} x2={d.x} y1={BASE} y2={BASE - height} />
          </g>
        );
      })}
    </svg>
  );
}

function Signals({ signals, selected }: { signals: ShownSignal[]; selected: number | null }) {
  return (
    <table className="nmr-table" data-testid="proton-table">
      <thead>
        <tr>
          <th scope="col">δ (ppm)</th>
          <th scope="col">H</th>
          <th scope="col">On</th>
          <th scope="col" className="visually-hidden">
            Note
          </th>
        </tr>
      </thead>
      <tbody>
        {signals.map((s, i) => (
          <tr
            key={i}
            data-testid="proton-signal"
            data-index={i}
            data-shift={s.shift ?? ''}
            data-hydrogens={s.hydrogens}
            data-on={s.on}
            data-low={s.low}
            data-exchangeable={s.exchangeable}
            data-diastereotopic={s.diastereotopic ?? ''}
            aria-selected={selected === i}
            onClick={() => selectSignal(i)}
          >
            <td>
              <button type="button" className="nmr-shift" title="Show these atoms on the drawing">
                {s.shift === null ? '—' : s.shift.toFixed(2)}
              </button>
            </td>
            <td>{s.hydrogens}H</td>
            <td>{s.on}</td>
            <td className="nmr-note">{note(s)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Body({ state, tms }: { state: ProtonState; tms: boolean }) {
  switch (state.kind) {
    case 'predicting':
      return <p className="nmr-message">Predicting…</p>;
    case 'stale':
      return (
        <p className="nmr-message">
          The drawing has changed.{' '}
          <button type="button" data-testid="proton-again" onClick={predictProtonNmr}>
            Predict again
          </button>
        </p>
      );
    case 'message':
      return (
        <p className="nmr-message" data-testid="proton-message">
          {MESSAGES[state.message]}
          {state.detail ? `: ${state.detail}.` : ''}
        </p>
      );
    case 'ready':
      return (
        <div className="nmr-result">
          <Spectrum signals={state.signals} selected={state.selected} tms={tms} />
          <Signals signals={state.signals} selected={state.selected} />
          {state.signals.some((s) => s.exchangeable) && (
            <p className="proton-note" data-testid="proton-exchangeable-note">
              Exchangeable H (OH, NH, SH): their shifts depend on solvent, concentration and temperature, and in D₂O they exchange and
              are not seen.
            </p>
          )}
          {state.signals.some((s) => s.diastereotopic) && (
            <p className="proton-note" data-testid="proton-diastereotopic-note">
              Diastereotopic: the two H of such a CH₂ can give two signals; which H gives which is not predicted.
            </p>
          )}
          {state.signals.some((s) => s.diastereotopic && s.bridged) && (
            <p className="proton-note" data-testid="proton-bridged-note">
              In a bridged ring system, a CH₂ marked diastereotopic may give one signal: telling them apart needs the molecule in 3D.
            </p>
          )}
        </div>
      );
    default:
      return null;
  }
}

export default function ProtonNmrPanel() {
  const ketcher = useSyncExternalStore(subscribeKetcher, getKetcher);
  const state = useSyncExternalStore(subscribeProtonState, getProtonState);
  const [tms, setTms] = useState(true);
  useEffect(() => (ketcher ? startProton(ketcher) : undefined), [ketcher]);
  if (state.kind === 'idle' || !ketcher) return null;
  return (
    <Docked ketcher={ketcher} className="nmr-panel" label="Predicted ¹H NMR" testId="proton-panel" state={state.kind}>
      <div className="nmr-head">
        <h2>
          Predicted ¹H NMR <span className="preview-tag">Preview</span>
        </h2>
        <label className="nmr-tms-toggle">
          <input type="checkbox" data-testid="proton-tms-toggle" checked={tms} onChange={(e) => setTms(e.target.checked)} />
          TMS (0 ppm)
        </label>
        <button type="button" className="nmr-close" data-testid="proton-close" aria-label="Close" onClick={closeProton}>
          ×
        </button>
      </div>
      <p className="nmr-banner" role="note" data-testid="proton-banner">
        {BANNER}
      </p>
      <Body state={state} tms={tms} />
      <NmrNotice testId="proton-notice" />
    </Docked>
  );
}
