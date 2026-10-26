// The ¹H NMR preview's acceptance checks (docs/plans/v2-proton-nmr.md), on the shipped table
// (public/nmr/proton-shifts.bin) and the test compounds: signal counts, integration, shifts
// against NMRShiftDB2's measured spectra (compounds the table never saw), the recorded
// outliers, the held-out figures and the rule check the build wrote into the header, speed,
// and that the reference shifts and the header are what they claim.
import type { MainModule } from '@rdkit/rdkit';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { beforeAll, describe, expect, it } from 'vitest';
import { decodeTable, encodeTable, lookup, PROTON, type ShiftTable } from '../src/chem/carbonTable.ts';
import { predictProton, type ProtonTableInfo, type Shifts, type Signal } from '../src/chem/protonNmr.ts';
import {
  BAR,
  barProblems,
  byAtom,
  measuredFor,
  parseRecords,
  preferredSpectrum,
  protonPeaks,
  referenceProtonSpectra,
  sameStereo,
  testCompounds,
  type ProtonReference,
} from './nmrReference.ts';
import { serialise, setGeometry, type RdkitJson as StereoJson } from '../src/chem/stereoElements.ts';

const fixture = (rel: string) => readFileSync(new URL(`../../tests/fixtures/${rel}`, import.meta.url), 'utf8');
const json = <T>(rel: string) => JSON.parse(fixture(rel)) as T;

interface Compound {
  typed_name: string;
  file: string;
  heavy_atoms: number;
  inchikey: string;
  hydrogen_classes: number[][];
  hydrogen_count: number;
  diastereotopic: number[];
}

interface Outlier {
  name: string;
  atoms: number[];
  diastereotopic: 'higher' | 'lower' | null;
  predicted: number;
  /** null for an exchangeable H the spectrum doesn't list. */
  measured: number | null;
}

const COMPOUNDS = json<{ compounds: Compound[] }>('proton_nmr/compounds.json').compounds;
const EXPECTED = json<{ status: string; molecules: { name: string; signals: number }[] }>('proton_nmr/expected.json');
const REFERENCE = json<{ source: ProtonTableInfo['source']; licence: string; compounds: ProtonReference[] }>('proton_nmr/reference_spectra.json');
const OUTLIERS = json<{ tolerance_ppm: number; outliers: Outlier[]; exchangeable: Outlier[] }>('proton_nmr/outliers.json');
const TOLERANCE = 0.3; // ppm
const WITHIN = 0.8; // of the C–H signals (bar 4)
const WIDE = 0.5;
const WIDE_WITHIN = 0.9;
// Within a tolerance, allowing for the rounding of shifts held in hundredths.
const within = (error: number, tolerance: number) => error <= tolerance + 1e-9;

let rdkit: MainModule;
let table: ShiftTable<ProtonTableInfo>;
let shifts: Shifts;

beforeAll(async () => {
  const require = createRequire(import.meta.url);
  rdkit = await (require('@rdkit/rdkit') as () => Promise<MainModule>)();
  rdkit.use_legacy_stereo_perception(false);
  const bytes = readFileSync(new URL('../public/nmr/proton-shifts.bin', import.meta.url));
  table = decodeTable<ProtonTableInfo>(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, PROTON);
  shifts = { spheres: table.info.spheres, find: (code) => lookup(table, code) };
});

const compound = (name: string) => COMPOUNDS.find((c) => c.typed_name === name)!;
const predict = (name: string) => predictProton(rdkit, fixture(compound(name).file), shifts)!;

/** NMRShiftDB2's measured shift for each predicted signal: its structure's atoms matched onto
 * the PubChem structure the app predicts for. */
function measured(name: string, signals: Signal[]): (number | null)[] {
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
  const [ourInchi, theirInchi] = [ours.get_inchi(), query.get_inchi()];
  query.delete();
  ours.delete();
  expect(match.length, `${name}: NMRShiftDB2's structure is the PubChem one`).toBe(heavy.length);
  expect(sameStereo(ourInchi, theirInchi), `${name}: with the same stereo (or none defined)`).toBe(true);
  const onOurs = byAtom(reference.peaks.map(([atom, shift]): [number, number] => [match[heavy.indexOf(atom)], shift]));
  return signals.map((s) => measuredFor(s.atoms, s.diastereotopic, onOurs));
}

/** Each test compound's signals beside their measured shifts. */
function compared() {
  return EXPECTED.molecules.flatMap(({ name }) => {
    const signals = predict(name);
    return measured(name, signals).map((value, i) => ({ name, signal: signals[i], measured: value }));
  });
}

const recorded = (rows: ReturnType<typeof compared>) =>
  rows.map(({ name, signal, measured: value }) => ({
    name,
    atoms: signal.atoms,
    diastereotopic: signal.diastereotopic,
    predicted: signal.shift!,
    measured: value === null ? null : Math.round(value * 1000) / 1000,
  }));

describe('the 22 test compounds', () => {
  it('are provisional, 22, with structures and measured spectra', () => {
    expect(EXPECTED.status).toBe('provisional');
    expect(EXPECTED.molecules.map((m) => m.name)).toEqual(COMPOUNDS.map((c) => c.typed_name));
    expect(EXPECTED.molecules.length).toBe(22);
    for (const m of EXPECTED.molecules) expect(REFERENCE.compounds.some((r) => r.name === m.name), m.name).toBe(true);
  });

  it.each(EXPECTED.molecules.map((m) => [m.name, m.signals] as const))(
    '%s: %i signals, as expected, on the atoms RDKit groups',
    (name, count) => {
      const signals = predict(name);
      expect(signals.length).toBe(count);
      const sets = [...new Set(signals.map((s) => JSON.stringify([...s.atoms].sort((a, b) => a - b))))].map((s) => JSON.parse(s) as number[]);
      expect(sets.sort((a, b) => a[0] - b[0])).toEqual(compound(name).hydrogen_classes);
      // Each diastereotopic CH₂ (by server-side RDKit) gives its two signals.
      const pairs = signals.filter((s) => s.diastereotopic !== null).flatMap((s) => s.atoms);
      expect([...new Set(pairs)].sort((a, b) => a - b)).toEqual(compound(name).diastereotopic);
      expect(pairs.length).toBe(2 * compound(name).diastereotopic.length);
    },
  );

  it.each(EXPECTED.molecules.map((m) => [m.name] as const))('%s: the integrations add up to its H', (name) => {
    const signals = predict(name);
    for (const s of signals) expect(s.hydrogens).toBe(s.diastereotopic ? s.atoms.length : s.atoms.length * s.perAtom);
    expect(signals.reduce((n, s) => n + s.hydrogens, 0)).toBe(compound(name).hydrogen_count);
  });

  it(`have at least ${WITHIN * 100}% of their C–H signals within ±${TOLERANCE} ppm and ${WIDE_WITHIN * 100}% within ±${WIDE} ppm of the measured shifts, the rest recorded`, () => {
    const rows = compared();
    for (const row of rows) expect(row.signal.shift, `${row.name}: every signal is predicted`).not.toBeNull();
    const ch = rows.filter((r) => !r.signal.exchangeable);
    // Every C–H has a measured shift; a spectrum may leave out an exchangeable H.
    for (const row of ch) expect(row.measured, `${row.name}: every C–H signal has a measured shift`).not.toBeNull();
    const error = (r: (typeof rows)[number]) => Math.abs(r.signal.shift! - r.measured!);
    const outside = ch.filter((r) => !within(error(r), TOLERANCE));
    expect(OUTLIERS.tolerance_ppm).toBe(TOLERANCE);
    expect(recorded(outside)).toEqual(OUTLIERS.outliers);
    expect(1 - outside.length / ch.length).toBeGreaterThanOrEqual(WITHIN);
    expect(ch.filter((r) => within(error(r), WIDE)).length / ch.length).toBeGreaterThanOrEqual(WIDE_WITHIN);
    // Exchangeable H are outside the bar, and every one of them is recorded.
    expect(recorded(rows.filter((r) => r.signal.exchangeable))).toEqual(OUTLIERS.exchangeable);
  });

  it('include low-confidence, exchangeable and diastereotopic signals, so each marking is exercised', () => {
    const signals = EXPECTED.molecules.flatMap(({ name }) => predict(name));
    expect(signals.some((s) => s.shift !== null && s.sphere <= 2)).toBe(true);
    expect(signals.some((s) => s.exchangeable)).toBe(true);
    expect(signals.some((s) => s.diastereotopic === 'higher')).toBe(true);
  });
});

describe('the shipped table', () => {
  it('names its source, its licence, the calculated spectra and exactly the compounds it leaves out', () => {
    expect(table.info.source).toEqual(REFERENCE.source);
    expect(table.info.source.sha256).toBe(json<{ source: { sha256: string } }>('nmr/reference_spectra.json').source.sha256);
    expect(table.info.source.spectra).toBeGreaterThan(17000);
    expect(table.info.source.calculated).toBeGreaterThan(0);
    expect(table.info.licence).toBe(REFERENCE.licence);
    expect(table.info.licence).toContain('nmrshiftdb2 Database License');
    expect(table.info.excluded).toEqual(COMPOUNDS.map((c) => ({ name: c.typed_name, inchikey: c.inchikey.split('-')[0] })));
    expect(table.info.spheres).toBe(4);
    expect(table.info.pairs).toBeGreaterThan(0);
  });

  it('was measured on held-out NMRShiftDB2 compounds and met the bar (bars 3 and 5)', () => {
    const { heldOut, diastereotopic } = table.info;
    expect(heldOut.every).toBe(50);
    expect(heldOut.compounds).toBeGreaterThan(300);
    expect(heldOut.signals).toBeGreaterThan(2000);
    // Bar 5 as corrected by Jeff (2026-10-26): the plan first measured these with the test
    // compounds among the held-out ones.
    expect(BAR.meanError).toBe(0.27);
    expect(BAR.within03).toBe(0.72);
    expect(barProblems(heldOut, diastereotopic)).toEqual([]);
    expect(heldOut.meanError).toBeLessThanOrEqual(0.27);
    expect(heldOut.within03).toBeGreaterThanOrEqual(0.72);
    expect(heldOut.bySphere.map((s) => s.sphere)).toEqual([1, 2, 3, 4]);
    expect(heldOut.bySphere.reduce((n, s) => n + s.signals, 0)).toBe(heldOut.signals);
    expect(diastereotopic.flagged.differ / diastereotopic.flagged.pairs).toBeGreaterThanOrEqual(0.75);
    expect(diastereotopic.unflagged.differ / diastereotopic.unflagged.pairs).toBeLessThanOrEqual(0.05);
  });

  it('stops the build when a figure is missing, not only when it is too far off', () => {
    const { heldOut, diastereotopic } = table.info;
    expect(barProblems({ ...heldOut, meanError: NaN }, diastereotopic)).toHaveLength(1);
    expect(barProblems({ ...heldOut, within03: NaN }, diastereotopic)).toHaveLength(1);
    expect(barProblems(heldOut, { ...diastereotopic, flagged: { pairs: 0, differ: 0 } })).toHaveLength(1);
    expect(barProblems(heldOut, { ...diastereotopic, unflagged: { pairs: 0, differ: 0 } })).toHaveLength(1);
    expect(barProblems({ meanError: BAR.meanError + 0.001, within03: BAR.within03 - 0.001 }, diastereotopic)).toHaveLength(2);
  });

  it('reads back byte for byte: re-encoding its own entries gives the same file', () => {
    const bytes = readFileSync(new URL('../public/nmr/proton-shifts.bin', import.meta.url));
    const entries = new Map([...table.hashes].map((_, i) => [String(i), table.shifts[i] / table.scale]));
    const key = (code: string): [number, number] => [table.hashes[Number(code)], table.checks[Number(code)]];
    expect(Buffer.from(encodeTable(table.info, entries, key, PROTON)).equals(bytes)).toBe(true);
  });

  it('predicts a 30-heavy-atom molecule in well under 2 seconds', () => {
    const squalene = json<{ compounds: Compound[] }>('nmr/compounds.json').compounds.find((c) => c.typed_name === 'squalene')!;
    expect(squalene.heavy_atoms).toBe(30);
    const started = performance.now();
    const signals = predictProton(rdkit, fixture(squalene.file), shifts)!;
    expect(performance.now() - started).toBeLessThan(2000);
    expect(signals.every((s) => s.shift !== null)).toBe(true);
  });

  it("is quick on the stereoisomer list's slowest drawing too (no search for dependent double bonds)", () => {
    // =CH2 between two open centres, every H drawn: the full stereo search takes about a
    // second for each of its CH2 groups (docs/plans/v2-stereoisomers.md, round 4).
    const started = performance.now();
    predictProton(rdkit, fixture('stereoisomers/cholesterol-with-ch2-for-its-oh-no-stereo-every-h-drawn.mol'), shifts);
    expect(performance.now() - started).toBeLessThan(2000);
  });

  it('gives the same signals with every hydrogen drawn as an atom', () => {
    for (const { name } of EXPECTED.molecules) {
      const mol = rdkit.get_mol(fixture(compound(name).file))!;
      const withHs = mol.add_hs();
      mol.delete();
      expect(predictProton(rdkit, withHs, shifts), name).toEqual(predict(name));
    }
  });
});

describe('the reference spectra', () => {
  it("are rebuilt exactly from NMRShiftDB2's records in the excerpt", () => {
    const compounds = testCompounds(rdkit, fixture('proton_nmr_compounds.csv'));
    const rebuilt = referenceProtonSpectra(rdkit, fixture('proton_nmr/excerpt.sd'), compounds);
    expect(rebuilt).toEqual(REFERENCE.compounds);
    expect(rebuilt.map((r) => r.name)).toEqual(compounds.map((c) => c.name));
  });

  it('are measured in CDCl3 for most of the compounds', () => {
    expect(REFERENCE.compounds.filter((r) => r.solvent.includes('CDCl3')).length).toBeGreaterThanOrEqual(15);
  });
});

describe("reading NMRShiftDB2's ¹H spectra", () => {
  it('prefers CDCl3, then another named solvent that is not D2O, then an unreported one', () => {
    const s = (solvent: string) => ({ solvent });
    expect(preferredSpectrum([s('Unreported'), s('Deuteriumoxide (D2O)'), s('Chloroform-D1 (CDCl3)')])!.solvent).toContain('CDCl3');
    expect(preferredSpectrum([s('Deuteriumoxide (D2O)'), s('Unreported'), s('TETRACHLORO-METHANE (CCl4)')])!.solvent).toContain('CCl4');
    expect(preferredSpectrum([s('Deuteriumoxide (D2O)'), s('Unknown')])!.solvent).toBe('Unknown');
    expect(preferredSpectrum([s('Deuteriumoxide (D2O)')])!.solvent).toContain('D2O');
  });

  it('moves an entry on a drawn H to the atom it is bonded to, and leaves out spectra listed as calculated', () => {
    const spectrum = { number: 0, solvent: '', peaks: [[2, 1.5] as [number, number], [0, 2.5] as [number, number]] };
    expect(protonPeaks(spectrum, (a) => a === 2, [[0, 1], [0, 2]])).toEqual([
      [0, 1.5],
      [0, 2.5],
    ]);
    // A record of the excerpt with two made-up ¹H spectra, the second named as calculated.
    const [first] = parseRecords(fixture('proton_nmr/excerpt.sd'));
    const fields = ['Spectrum 1H 0', '1.0;0.0;0|', 'Spectrum 1H 1', '2.0;0.0;0|', 'NMRProgram', '1:Spartan ', 'Solvent', '0:Unreported 1:Unreported '];
    const text = `${first.molblock}\n${fields.map((f, i) => (i % 2 ? `${f}\n\n` : `> <${f}>\n`)).join('')}$$$$\n`;
    const [record] = parseRecords(text);
    expect(record.proton.map((s) => s.number)).toEqual([0]);
    expect(record.calculatedProton).toBe(1);
  });

  it('takes a record for a compound only with its stereo: a mirror image or undefined stereo will do, E for Z will not', () => {
    const json = (name: string) => {
      const mol = rdkit.get_mol(fixture(compound(name).file))!;
      try {
        return JSON.parse(mol.get_json()) as StereoJson & { molecules: [{ atoms: { stereo?: string }[] }] };
      } finally {
        mol.delete();
      }
    };
    const inchi = (text: string) => {
      const mol = rdkit.get_mol(text)!;
      try {
        return mol.get_inchi();
      } finally {
        mol.delete();
      }
    };
    // Cinnamic acid as drawn, and with its C=C (the double bond outside the ring between two
    // carbons) set the other way.
    const drawn = json('(E)-cinnamic acid');
    const molecule = drawn.molecules[0] as typeof drawn.molecules[0] & { atoms: { z?: number }[]; extensions?: { atomRings?: number[][] }[] };
    const inRing = new Set((molecule.extensions ?? []).flatMap((e) => e.atomRings ?? []).flat());
    const carbon = (a: number) => (molecule.atoms[a].z ?? 6) === 6;
    const double = molecule.bonds!.findIndex((b) => b.bo === 2 && b.atoms.every((a) => carbon(a) && !inRing.has(a)));
    expect(double).toBeGreaterThanOrEqual(0);
    const [e, z] = [structuredClone(drawn), structuredClone(drawn)];
    setGeometry(e, double, 'trans');
    setGeometry(z, double, 'cis');
    const [ei, zi] = [inchi(serialise(e, false)), inchi(serialise(z, false))];
    expect(ei).not.toBe(zi);
    expect(sameStereo(ei, zi)).toBe(false);
    expect(sameStereo(ei, ei)).toBe(true);
    // Nicotine's centre as drawn, and inverted: mirror images.
    const s = json('nicotine');
    const r = structuredClone(s);
    for (const atom of r.molecules[0].atoms) if (atom.stereo) atom.stereo = atom.stereo === 'cw' ? 'ccw' : 'cw';
    const [si, ri] = [inchi(serialise(s, false)), inchi(serialise(r, false))];
    expect(si).not.toBe(ri);
    expect(sameStereo(si, ri)).toBe(true);
    // No stereo on one side.
    expect(sameStereo(inchi(fixture(compound('limonene').file)), si)).toBe(true);

    // NMRShiftDB2's crotonic acid (E) stands for crotonic acid, not for its Z isomer.
    const crotonic = testCompounds(rdkit, fixture('proton_nmr_compounds.csv')).find((c) => c.name === 'crotonic acid')!;
    const acid = json('crotonic acid');
    const bond = acid.molecules[0].bonds!.findIndex((b) => b.bo === 2 && b.atoms.every((a) => ((acid.molecules[0].atoms[a] as { z?: number }).z ?? 6) === 6));
    setGeometry(acid, bond, 'cis');
    const isomer = { ...crotonic, name: 'the Z isomer', inchi: inchi(serialise(acid, false)) };
    expect(isomer.inchi).not.toBe(crotonic.inchi);
    const excerpt = fixture('proton_nmr/excerpt.sd');
    expect(referenceProtonSpectra(rdkit, excerpt, [crotonic]).map((r) => r.name)).toEqual(['crotonic acid']);
    expect(referenceProtonSpectra(rdkit, excerpt, [isomer])).toEqual([]);
  });

  it('takes the higher or lower of a CH₂ listed with both H for a diastereotopic signal', () => {
    const listed = new Map([
      [1, [2.0, 1.6]],
      [2, [1.0]],
    ]);
    expect(measuredFor([1], 'higher', listed)).toBe(2.0);
    expect(measuredFor([1], 'lower', listed)).toBe(1.6);
    expect(measuredFor([1], null, listed)).toBeCloseTo(1.8, 10);
    expect(measuredFor([2], 'higher', listed)).toBe(1.0);
    expect(measuredFor([3], null, listed)).toBeNull();
  });
});
