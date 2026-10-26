// The ¹³C NMR preview's acceptance checks (docs/plans/nmr.md), on the shipped table
// (public/nmr/carbon-shifts.bin) and the test compounds: signal counts, shifts against
// NMRShiftDB2's measured spectra (compounds the table never saw), the recorded outliers,
// speed, and that the reference shifts and the table's header are what they claim.
import type { MainModule } from '@rdkit/rdkit';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { beforeAll, describe, expect, it } from 'vitest';
import { decodeTable, encodeTable, type CarbonTable } from '../src/chem/carbonTable.ts';
import { predictCarbon, type Peak } from '../src/chem/nmr.ts';
import { referenceSpectra, testCompounds, type ReferenceSpectrum } from './nmrReference.ts';

const fixture = (rel: string) => readFileSync(new URL(`../../tests/fixtures/${rel}`, import.meta.url), 'utf8');
const json = <T>(rel: string) => JSON.parse(fixture(rel)) as T;

interface Compound {
  typed_name: string;
  file: string;
  heavy_atoms: number;
  inchikey: string;
  carbon_classes: number[][];
}

const COMPOUNDS = json<{ compounds: Compound[] }>('nmr/compounds.json').compounds;
const EXPECTED = json<{ status: string; molecules: { name: string; signals: number }[] }>('nmr/expected.json');
const REFERENCE = json<{ source: { sha256: string }; licence: string; compounds: ReferenceSpectrum[] }>('nmr/reference_spectra.json');
const OUTLIERS = json<{ tolerance_ppm: number; outliers: { name: string; atoms: number[]; why: string }[] }>('nmr/outliers.json');
const TOLERANCE = 3; // ppm, as the spec suggests
const WITHIN = 0.8; // "most signals"

let rdkit: MainModule;
let table: CarbonTable;

beforeAll(async () => {
  const require = createRequire(import.meta.url);
  rdkit = await (require('@rdkit/rdkit') as () => Promise<MainModule>)();
  rdkit.use_legacy_stereo_perception(false);
  const bytes = readFileSync(new URL('../public/nmr/carbon-shifts.bin', import.meta.url));
  table = decodeTable(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
});

const compound = (name: string) => COMPOUNDS.find((c) => c.typed_name === name)!;
const predict = (name: string) => predictCarbon(rdkit, fixture(compound(name).file), table)!;

/** NMRShiftDB2's measured shift for each predicted peak (the mean over its carbons): its
 * structure's atoms matched onto the PubChem structure the app predicts for. */
function measured(name: string, peaks: Peak[]): (number | null)[] {
  const reference = REFERENCE.compounds.find((r) => r.name === name)!;
  const theirs = rdkit.get_mol(reference.molblock, JSON.stringify({ removeHs: false }))!;
  const heavy = (JSON.parse(theirs.get_json()) as { molecules: { atoms: { z?: number }[] }[] }).molecules[0].atoms
    .map((a, i) => [a.z ?? 6, i] as const)
    .filter(([z]) => z !== 1)
    .map(([, i]) => i);
  theirs.delete();
  const query = rdkit.get_mol(reference.molblock, JSON.stringify({ removeHs: true }))!;
  const ours = rdkit.get_mol(fixture(compound(name).file))!;
  const match = (JSON.parse(ours.get_substruct_match(query)) as { atoms: number[] }).atoms;
  query.delete();
  ours.delete();
  expect(match.length, `${name}: NMRShiftDB2's structure is the PubChem one`).toBe(heavy.length);
  const byAtom = new Map<number, number[]>();
  for (const [atom, shift] of reference.peaks) {
    const ourAtom = match[heavy.indexOf(atom)];
    byAtom.set(ourAtom, [...(byAtom.get(ourAtom) ?? []), shift]);
  }
  return peaks.map((p) => {
    const values = p.atoms.flatMap((a) => byAtom.get(a) ?? []);
    return values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length;
  });
}

describe('the 15 test compounds', () => {
  it('are provisional, 15, with structures and measured spectra', () => {
    expect(EXPECTED.status).toBe('provisional');
    expect(EXPECTED.molecules.length).toBe(15);
    for (const m of EXPECTED.molecules) {
      expect(compound(m.name), m.name).toBeDefined();
      expect(REFERENCE.compounds.some((r) => r.name === m.name), m.name).toBe(true);
    }
  });

  it.each(EXPECTED.molecules.map((m) => [m.name, m.signals] as const))(
    '%s: %i signals, as expected and as RDKit groups the carbons',
    (name, signals) => {
      const peaks = predict(name);
      expect(peaks.length).toBe(signals);
      expect(compound(name).carbon_classes.length).toBe(signals);
      expect(peaks.map((p) => [...p.atoms].sort((a, b) => a - b)).sort((a, b) => a[0] - b[0])).toEqual(compound(name).carbon_classes);
    },
  );

  it(`have at least ${WITHIN * 100}% of their signals within ±${TOLERANCE} ppm of the measured shifts, and the rest recorded`, () => {
    const outliers: { name: string; atoms: number[] }[] = [];
    let signals = 0;
    for (const { name } of EXPECTED.molecules) {
      const peaks = predict(name);
      measured(name, peaks).forEach((value, i) => {
        expect(value, `${name}: every carbon has a measured shift`).not.toBeNull();
        expect(peaks[i].shift, `${name}: every carbon is predicted`).not.toBeNull();
        signals += 1;
        if (Math.abs(peaks[i].shift! - value!) > TOLERANCE) outliers.push({ name, atoms: peaks[i].atoms });
      });
    }
    expect(OUTLIERS.tolerance_ppm).toBe(TOLERANCE);
    expect(outliers).toEqual(OUTLIERS.outliers.map(({ name, atoms }) => ({ name, atoms })));
    expect(1 - outliers.length / signals).toBeGreaterThanOrEqual(WITHIN);
  });
});

describe('the shipped table', () => {
  it('names its source, its licence, and exactly the compounds it leaves out', () => {
    expect(table.info.source.sha256).toBe(REFERENCE.source.sha256);
    expect(table.info.source.spectra).toBeGreaterThan(40000);
    expect(table.info.licence).toBe(REFERENCE.licence);
    expect(table.info.licence).toContain('nmrshiftdb2 Database License');
    expect(table.info.excluded).toEqual(COMPOUNDS.map((c) => ({ name: c.typed_name, inchikey: c.inchikey.split('-')[0] })));
    expect(table.info.spheres).toBe(4);
  });

  it('reads back byte for byte: re-encoding its own entries gives the same file (the ¹H table shares the format)', () => {
    const bytes = readFileSync(new URL('../public/nmr/carbon-shifts.bin', import.meta.url));
    const entries = new Map([...table.hashes].map((_, i) => [String(i), table.shifts[i] / 10]));
    const key = (code: string): [number, number] => [table.hashes[Number(code)], table.checks[Number(code)]];
    expect(Buffer.from(encodeTable(table.info, entries, key)).equals(bytes)).toBe(true);
  });

  it('predicts a 30-heavy-atom molecule in well under 2 seconds', () => {
    const squalene = compound('squalene');
    expect(squalene.heavy_atoms).toBe(30);
    const started = performance.now();
    const peaks = predict('squalene');
    expect(performance.now() - started).toBeLessThan(2000);
    expect(peaks.every((p) => p.shift !== null)).toBe(true);
  });

  it('gives the same peaks with every hydrogen drawn as an atom', () => {
    for (const { name } of EXPECTED.molecules) {
      const mol = rdkit.get_mol(fixture(compound(name).file))!;
      const withHs = mol.add_hs();
      mol.delete();
      expect(predictCarbon(rdkit, withHs, table), name).toEqual(predict(name));
    }
  });
});

describe('the reference spectra', () => {
  it("are rebuilt exactly from NMRShiftDB2's records in the excerpt", () => {
    const compounds = testCompounds(rdkit, fixture('nmr_compounds.csv'));
    const rebuilt = referenceSpectra(rdkit, fixture('nmr/excerpt.sd'), compounds);
    expect(rebuilt).toEqual(REFERENCE.compounds);
    expect(rebuilt.map((r) => r.name)).toEqual(compounds.map((c) => c.name));
  });

  it('prefer a spectrum measured in CDCl3', () => {
    const cdcl3 = REFERENCE.compounds.filter((r) => r.solvent.includes('CDCl3'));
    expect(cdcl3.length).toBeGreaterThan(10);
  });
});
