import { useEffect, useState } from 'react';
import { citedAttributions, hintsFor, IR_BANDS_FILE, type Band, type IrFile } from '../chem/irBands';
import type { GroupsView } from '../chem/tracker';
import { loadIrTable } from './irStore';
import './irHints.css';

// The IR hints (docs/plans/v2-ir-hints.md), in the functional-group section: for the
// groups found, the bands of web/public/ir-bands.json, bold where the table says to look
// first, and the table's credit, which its licence (CC BY-SA 4.0) requires wherever it is
// shown. Plain text only: nothing here may link out (invariant 1). data-* attributes let
// the tests compare what is shown with the file.

/** "1715–1720", or "≈1735" for a single typical value. */
function rangeText({ low, high, approx }: { low: number; high: number; approx?: boolean }): string {
  if (low !== high) return `${low}–${high}`;
  return approx ? `≈${low}` : String(low);
}

function BandRow({ band }: { band: Band }) {
  return (
    <li
      className={band.diagnostic ? 'ir-band ir-diagnostic' : 'ir-band'}
      data-testid="ir-band"
      data-low={band.low}
      data-high={band.high}
      data-diagnostic={band.diagnostic}
    >
      <span className="ir-range">{rangeText(band)}</span>
      <span className="ir-what">
        {/* The bond, unless the vibration names it already ("O–H stretch") or it has no
            atoms ("—", for overtones). */}
        {/[A-Za-z]/.test(band.bond) && !band.vibration.includes(band.bond) && <span className="ir-bond">{band.bond} </span>}
        {band.vibration}; {[band.intensity, band.shape].filter(Boolean).join(', ')}
        {band.diagnostic && <span className="visually-hidden"> (look for this first)</span>}
      </span>
      {band.note && <span className="ir-band-note">{band.note}</span>}
    </li>
  );
}

export default function IrHints({ groups }: { groups: GroupsView }) {
  const [file, setFile] = useState<IrFile | null>(null);
  useEffect(() => {
    let live = true;
    void loadIrTable().then((loaded) => live && setFile(loaded));
    return () => {
      live = false;
    };
  }, []);

  const body = () => {
    if (!file) return <p className="properties-note" data-testid="ir-message">Loading IR hints…</p>;
    if (file.kind === 'unavailable') {
      return (
        <p className="properties-note" data-testid="ir-message">
          IR hints are unavailable: {file.reason}.
        </p>
      );
    }
    if (groups.kind === 'unavailable') {
      return (
        <p className="properties-note" data-testid="ir-message">
          IR hints need the functional groups, which are unavailable.
        </p>
      );
    }
    const { table } = file;
    const hints = hintsFor(groups.groups, table);
    return (
      <>
        <p className="properties-note">Typical bands (cm⁻¹) for the groups found. Bold bands are the ones to look for first.</p>
        <ul className="ir-entries" data-testid="ir-entries">
          {hints.map((hint) =>
            hint.kind === 'missing' ? (
              <li key={`missing ${hint.name}`} data-testid="ir-entry" data-key="" data-name={hint.name}>
                <p className="ir-label">{hint.name}</p>
                <p className="properties-note">No IR hints for {hint.name} yet.</p>
              </li>
            ) : (
              <li key={hint.key} data-testid="ir-entry" data-key={hint.key}>
                <p className="ir-label">{hint.label}</p>
                {hint.note && (
                  <p className="ir-group-note" data-testid="ir-group-note">
                    {hint.note}
                  </p>
                )}
                {hint.bands.length > 0 && (
                  <ul className="ir-bands">
                    {hint.bands.map((band, i) => (
                      <BandRow key={i} band={band} />
                    ))}
                  </ul>
                )}
                {hint.checking && (
                  <p className="properties-note" data-testid="ir-checking">
                    Some values for this group are still being checked.
                  </p>
                )}
              </li>
            ),
          )}
        </ul>
        <details className="ir-regions" data-testid="ir-regions">
          <summary>Where bands appear</summary>
          <ul>
            {table.regions.map((region, i) => (
              <li key={i} data-testid="ir-region" data-low={region.low} data-high={region.high}>
                <span className="ir-range">{rangeText(region)}</span> {region.label}
              </li>
            ))}
          </ul>
        </details>
        {file.problems.length > 0 && (
          <div className="properties-note" data-testid="ir-problems">
            Skipped in {IR_BANDS_FILE}:
            <ul>
              {file.problems.map((problem, i) => (
                <li key={i}>{problem}</li>
              ))}
            </ul>
          </div>
        )}
        <p className="ir-credit" data-testid="ir-credit">
          {table.title}, version {table.version}, compiled by {table.compiledBy}. Licence: {table.licence} ({table.licenceUri}).
          {citedAttributions(hints, table).map((a) => (
            <span key={a.key} data-testid="ir-attribution" data-key={a.key}>
              {' '}
              {a.text}
              {a.url ? ` (${a.url})` : ''}.
            </span>
          ))}
        </p>
      </>
    );
  };

  return (
    <section className="ir-hints" aria-label="IR hints" data-testid="ir-hints" data-state={file ? (file.kind === 'table' ? 'ready' : 'unavailable') : 'loading'}>
      <h4>IR hints</h4>
      {body()}
    </section>
  );
}
