// The biochem tools (docs/plans/v2-biochem.md) at the foot of the side panel: a typed
// peptide, DNA or RNA sequence and its values. Closed until clicked; the drawing never
// touches it, and the sequence is not saved.
import { useSyncExternalStore, type ReactNode } from 'react';
import { RESIDUES, type SequenceType } from '../chem/biochem';
import type { BiochemValues } from '../chem/indigoBiochem';
import { shown } from '../chem/properties';
import { NOTES, type BiochemState, type IndigoPart, type Inputs } from './biochem';
import { getBiochemState, setBiochemInputs, startBiochem, subscribeBiochemState } from './biochemStore';
import './biochem.css';

const TYPES: { value: SequenceType; label: string }[] = [
  { value: 'peptide', label: 'Peptide, one-letter (ACDEF…)' },
  { value: 'peptide3', label: 'Peptide, three-letter (Ala-Cys-Asp…)' },
  { value: 'dna', label: 'DNA' },
  { value: 'rna', label: 'RNA' },
];

export default function BiochemSection() {
  const state = useSyncExternalStore(subscribeBiochemState, getBiochemState);
  const { inputs } = state;
  const change = (field: keyof Inputs) => (event: { target: { value: string } }) =>
    setBiochemInputs({ ...inputs, [field]: event.target.value });
  const peptide = inputs.type === 'peptide' || inputs.type === 'peptide3';
  return (
    <details
      className="biochem"
      data-testid="biochem"
      onToggle={(event) => {
        if (event.currentTarget.open) startBiochem();
      }}
    >
      <summary>Peptide or nucleic acid</summary>
      <div className="biochem-inputs">
        <label>
          Sequence type
          <select data-testid="biochem-type" value={inputs.type} onChange={change('type')}>
            {TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Sequence
          <textarea
            data-testid="biochem-sequence"
            value={inputs.text}
            onChange={change('text')}
            rows={3}
            spellCheck={false}
            autoComplete="off"
          />
        </label>
        {peptide && (
          <label className="biochem-number">
            pH
            <input data-testid="biochem-ph" type="number" min={0} max={14} step={0.1} value={inputs.pH} onChange={change('pH')} />
          </label>
        )}
        {inputs.type === 'dna' && (
          <>
            <label className="biochem-number">
              [Na⁺] (mM)
              <input data-testid="biochem-sodium" type="number" min={0} step="any" value={inputs.sodium} onChange={change('sodium')} />
            </label>
            <label className="biochem-number">
              Strands (µM)
              <input data-testid="biochem-strand" type="number" min={0} step="any" value={inputs.strand} onChange={change('strand')} />
            </label>
          </>
        )}
      </div>
      <div role="status" className="biochem-values" data-testid="biochem-values" data-state={dataState(state)}>
        <Values state={state} />
      </div>
    </details>
  );
}

function dataState(state: BiochemState): string {
  if (state.kind === 'empty' || state.kind === 'invalid') return state.kind;
  return state.indigo.kind;
}

function Values({ state }: { state: BiochemState }) {
  switch (state.kind) {
    case 'empty':
      return <p className="properties-note">Type or paste a sequence.</p>;
    case 'invalid':
      return (
        <p className="biochem-problem" data-testid="biochem-problem">
          {state.message}
        </p>
      );
    case 'peptide':
      return (
        <>
          <dl className="biochem-list">
            <dt>Residues</dt>
            <dd data-testid="biochem-length">{state.sequence.length}</dd>
            <dt>Net charge at pH {state.charge === null ? '…' : state.inputs.pH}</dt>
            <dd data-testid="biochem-charge">{state.charge === null ? 'pH 0 to 14' : shown(state.charge, 2)}</dd>
            <dt>Isoelectric point</dt>
            <dd data-testid="biochem-pi">{shown(state.pI, 2)}</dd>
          </dl>
          <IndigoValues part={state.indigo}>{(values) => <PeptideValues values={values} sequence={state.sequence} />}</IndigoValues>
          <p className="properties-note">{NOTES.charge}</p>
        </>
      );
    case 'nucleic':
      return (
        <>
          <dl className="biochem-list">
            <dt>Bases</dt>
            <dd data-testid="biochem-length">{state.sequence.length}</dd>
          </dl>
          <IndigoValues part={state.indigo}>{(values) => <NucleicValues values={values} />}</IndigoValues>
          {state.tmNote && (
            <p className="properties-note" data-testid="biochem-tm-note">
              {NOTES[state.tmNote]}
            </p>
          )}
        </>
      );
  }
}

function IndigoValues({ part, children }: { part: IndigoPart; children: (values: BiochemValues) => ReactNode }) {
  switch (part.kind) {
    case 'working':
      return <p className="properties-note">Working…</p>;
    case 'ready':
      return children(part.values);
    case 'error':
      return (
        <p className="biochem-problem" data-testid="biochem-problem">
          Indigo could not read this sequence: {part.message}
        </p>
      );
    case 'unavailable':
      return (
        <p className="biochem-problem" data-testid="biochem-problem">
          Peptide and nucleic acid values are unavailable: {part.reason}
        </p>
      );
  }
}

function PeptideValues({ values, sequence }: { values: BiochemValues; sequence: string }) {
  if (values.kind !== 'peptide') return null;
  const { reduced, cystines } = values.extinction;
  return (
    <>
      <dl className="biochem-list">
        <dt>Formula</dt>
        <IndigoFormula formula={values.formula} />
        <dt>Average mass (g/mol)</dt>
        <dd data-testid="biochem-mass">{shown(values.mass, 2)}</dd>
        <dt>ε280, Cys reduced</dt>
        <dd data-testid="biochem-ext-reduced">{reduced}</dd>
        <dt>ε280, all Cys paired</dt>
        <dd data-testid="biochem-ext-cystines">{cystines}</dd>
      </dl>
      {reduced === 0 && cystines === 0 && (
        <p className="properties-note" data-testid="biochem-no-absorbance">
          {NOTES.noAbsorbance}
        </p>
      )}
      <p className="properties-note">{NOTES.extinction}</p>
      <h3>Hydrophobicity</h3>
      <Hydrophobicity values={values.hydrophobicity} sequence={sequence} />
      <p className="properties-note">{NOTES.hydrophobicity}</p>
      <p className="properties-note">{NOTES.mass}</p>
    </>
  );
}

function NucleicValues({ values }: { values: BiochemValues }) {
  if (values.kind !== 'nucleic') return null;
  return (
    <>
      <dl className="biochem-list">
        <dt>Formula (one strand)</dt>
        <IndigoFormula formula={values.formula} />
        <dt>Average mass (g/mol)</dt>
        <dd data-testid="biochem-mass">{shown(values.mass, 2)}</dd>
        {values.tm !== null && (
          <>
            <dt>Tm (°C)</dt>
            <dd data-testid="biochem-tm">{shown(values.tm, 1)}</dd>
          </>
        )}
      </dl>
      {values.tm !== null && <p className="properties-note">{NOTES.tm}</p>}
      <p className="properties-note">{NOTES.mass}</p>
    </>
  );
}

/** Indigo writes "C107 H159 N29 O30 S2". */
function IndigoFormula({ formula }: { formula: string }) {
  const parts = formula.split(' ').map((part) => /^([A-Z][a-z]?)(\d*)$/.exec(part) ?? [part, part, '']);
  return (
    <dd data-testid="biochem-formula" data-formula={formula.replaceAll(' ', '')}>
      {parts.map(([, symbol, count], i) => (
        <span key={i}>
          {symbol}
          {count && <sub>{count}</sub>}
        </span>
      ))}
    </dd>
  );
}

/** One bar per residue, 0 to 1. Each bar carries its value, and says it on hover. */
function Hydrophobicity({ values, sequence }: { values: number[]; sequence: string }) {
  return (
    <svg
      className="biochem-hydrophobicity"
      data-testid="biochem-hydrophobicity"
      viewBox={`0 0 ${values.length} 1`}
      preserveAspectRatio="none"
      role="img"
      aria-label={`Hydrophobicity of each of the ${values.length} residues`}
    >
      {values.map((value, i) => (
        <rect key={i} x={i + 0.1} width={0.8} y={1 - value} height={value} data-value={value}>
          <title>{`${RESIDUES[sequence[i]]} ${i + 1}: ${value}`}</title>
        </rect>
      ))}
    </svg>
  );
}
