import { useEffect, useState, useSyncExternalStore } from 'react';
import { CARBON_TABLE_LICENCE_FILE } from '../chem/rdkitFiles';
import { getKetcher, subscribeKetcher } from '../editor/instance';
import Docked from './Docked';
import { BANNER, carbonType, type NmrMessage, type NmrState, type ShownPeak } from './nmr';
import { closeNmr, getNmrState, predictNmr, selectPeak, startNmr, subscribeNmrState } from './nmrStore';
import './nmr.css';

// The ¹³C NMR preview's result (spec "NMR prediction proof of concept"), below the canvas
// (it takes the bottom of .canvas-area, so it never covers the drawing): the spec's banner,
// NMRShiftDB2's licence notice (its section 4.3), a stick spectrum on a reversed axis and
// the peak table. Clicking a stick or a row selects that peak and colours its carbons;
// selecting a carbon on the canvas selects its peak. data-state and the rows' data-*
// attributes let tests read it exactly.

const LICENCE_URI = 'https://nmrshiftdb.nmr.uni-koeln.de/nmrshiftdbhtml/nmrshiftdb2datalicense.txt';

const MESSAGES: Record<NmrMessage, string> = {
  empty: 'Draw a structure to predict its ¹³C NMR spectrum.',
  reaction: '¹³C NMR is predicted for structures, not reactions.',
  'not-elements': '¹³C NMR needs every atom to be an element, so R-groups, atom lists and query atoms are left out.',
  unreadable: "RDKit can't interpret this structure, so no spectrum is predicted.",
  'no-carbons': 'There are no carbon atoms to predict.',
  unavailable: 'The ¹³C NMR preview is unavailable',
};

// The axis, as the spec draws it: 220 ppm on the left to 0 on the right.
const AXIS_MAX = 220;
const WIDTH = 560;
const HEIGHT = 150;
const LEFT = 16;
const RIGHT = 16;
const BASE = 118;
const TOP = 12;
const x = (ppm: number) => LEFT + ((AXIS_MAX - Math.min(AXIS_MAX, Math.max(0, ppm))) / AXIS_MAX) * (WIDTH - LEFT - RIGHT);

function Spectrum({ peaks, selected, tms }: { peaks: ShownPeak[]; selected: number | null; tms: boolean }) {
  const most = Math.max(...peaks.map((p) => p.atoms.length));
  const ticks = Array.from({ length: AXIS_MAX / 20 + 1 }, (_, i) => AXIS_MAX - i * 20);
  return (
    <svg className="nmr-spectrum" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label="Predicted ¹³C NMR stick spectrum, 220 to 0 ppm">
      <line className="nmr-axis" x1={x(AXIS_MAX)} x2={x(0)} y1={BASE} y2={BASE} />
      {ticks.map((ppm) => (
        <g key={ppm}>
          <line className="nmr-axis" x1={x(ppm)} x2={x(ppm)} y1={BASE} y2={BASE + 4} />
          <text className="nmr-tick" x={x(ppm)} y={BASE + 16} textAnchor="middle">
            {ppm}
          </text>
        </g>
      ))}
      <text className="nmr-tick" x={x(0)} y={BASE + 30} textAnchor="end">
        δ (ppm)
      </text>
      {tms && (
        <g data-testid="nmr-tms">
          <line className="nmr-tms" x1={x(0)} x2={x(0)} y1={TOP} y2={BASE} />
          <text className="nmr-tick" x={x(0) - 3} y={TOP + 8} textAnchor="end">
            TMS
          </text>
        </g>
      )}
      {peaks.map((p, i) =>
        p.shift === null ? null : (
          <g
            key={i}
            className="nmr-stick"
            data-testid="nmr-stick"
            data-index={i}
            data-selected={selected === i}
            data-low={p.low}
            role="button"
            aria-label={`${p.shift} ppm`}
            onClick={() => selectPeak(i)}
          >
            {/* A wider, invisible target, so a stick is easy to click. */}
            <rect x={x(p.shift) - 4} y={TOP} width={8} height={BASE - TOP} fill="transparent" />
            <line x1={x(p.shift)} x2={x(p.shift)} y1={BASE} y2={BASE - (BASE - TOP) * (0.35 + (0.65 * p.atoms.length) / most)} />
          </g>
        ),
      )}
    </svg>
  );
}

function Peaks({ peaks, selected }: { peaks: ShownPeak[]; selected: number | null }) {
  return (
    <table className="nmr-table" data-testid="nmr-table">
      <thead>
        <tr>
          <th scope="col">δ (ppm)</th>
          <th scope="col">Carbon</th>
          <th scope="col">Equivalent carbons</th>
          <th scope="col" className="visually-hidden">
            Note
          </th>
        </tr>
      </thead>
      <tbody>
        {peaks.map((p, i) => (
          <tr
            key={i}
            data-testid="nmr-peak"
            data-index={i}
            data-shift={p.shift ?? ''}
            data-type={carbonType(p.hydrogens)}
            data-count={p.atoms.length}
            data-low={p.low}
            aria-selected={selected === i}
            onClick={() => selectPeak(i)}
          >
            <td>
              <button type="button" className="nmr-shift" title="Show these carbons on the drawing">
                {p.shift === null ? '—' : p.shift.toFixed(1)}
              </button>
            </td>
            <td>{carbonType(p.hydrogens)}</td>
            <td>{p.atoms.length}</td>
            <td className="nmr-note">{p.shift === null ? 'no match' : p.low ? 'low confidence' : ''}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Body({ state, tms }: { state: NmrState; tms: boolean }) {
  switch (state.kind) {
    case 'predicting':
      return <p className="nmr-message">Predicting…</p>;
    case 'stale':
      return (
        <p className="nmr-message">
          The drawing has changed.{' '}
          <button type="button" data-testid="nmr-again" onClick={predictNmr}>
            Predict again
          </button>
        </p>
      );
    case 'message':
      return (
        <p className="nmr-message" data-testid="nmr-message">
          {MESSAGES[state.message]}
          {state.detail ? `: ${state.detail}.` : ''}
        </p>
      );
    case 'ready':
      return (
        <div className="nmr-result">
          <Spectrum peaks={state.peaks} selected={state.selected} tms={tms} />
          <Peaks peaks={state.peaks} selected={state.selected} />
        </div>
      );
    default:
      return null;
  }
}

export default function NmrPanel() {
  const ketcher = useSyncExternalStore(subscribeKetcher, getKetcher);
  const state = useSyncExternalStore(subscribeNmrState, getNmrState);
  const [tms, setTms] = useState(true);
  useEffect(() => (ketcher ? startNmr(ketcher) : undefined), [ketcher]);
  if (state.kind === 'idle' || !ketcher) return null;
  return (
    <Docked ketcher={ketcher} className="nmr-panel" label="Predicted ¹³C NMR" testId="nmr-panel" state={state.kind}>
      <div className="nmr-head">
        <h2>
          Predicted ¹³C NMR <span className="preview-tag">Preview</span>
        </h2>
        <label className="nmr-tms-toggle">
          <input type="checkbox" data-testid="nmr-tms-toggle" checked={tms} onChange={(e) => setTms(e.target.checked)} />
          TMS (0 ppm)
        </label>
        <button type="button" className="nmr-close" data-testid="nmr-close" aria-label="Close" onClick={closeNmr}>
          ×
        </button>
      </div>
      <p className="nmr-banner" role="note" data-testid="nmr-banner">
        {BANNER}
      </p>
      <Body state={state} tms={tms} />
      <p className="nmr-notice" data-testid="nmr-notice">
        Contains information from nmrshiftdb2 (www.nmrshiftdb.org), which is made available here under the{' '}
        <a href={CARBON_TABLE_LICENCE_FILE} target="_blank" rel="noopener">
          nmrshiftdb2 Database License
        </a>{' '}
        ({LICENCE_URI}).
      </p>
    </Docked>
  );
}
