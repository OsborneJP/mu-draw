// Build the ¹H NMR preview's shift table from NMRShiftDB2 (docs/plans/v2-proton-nmr.md):
//   node scripts/build-proton-table.ts <path to nmrshiftdb2withsignals.sd>     (from web/)
// The same SD file as the ¹³C table (scripts/build-carbon-table.ts says where it comes from;
// its SHA-256 goes into the header). Writes:
//   public/nmr/proton-shifts.bin                          the table (src/chem/carbonTable.ts)
//   ../tests/fixtures/proton_nmr/excerpt.sd               the ¹H test compounds' records, verbatim
//   ../tests/fixtures/proton_nmr/reference_spectra.json   their measured shifts, from the excerpt
// Codes are centred on the atom carrying the H (src/chem/protonNmr.ts). Each measured ¹H
// spectrum gives one value per such atom, the mean of its entries (some list each H, some a
// group once); a CH₂ listed with both H also gives its higher and lower shift to the code's
// HIGHER and LOWER entries. Spectra NMRShiftDB2 lists as calculated are left out, and so are
// the test compounds (tests/fixtures/proton_nmr_compounds.csv, from PubChem).
// Before writing, it predicts a fixed share of the compounds (by InChIKey hash) from a table
// built without them, and checks the diastereotopic rule against the CH₂ listed with both
// H; it stops if either misses the plan's bar, and writes the figures into the header.
// Deterministic: the same SD file gives the same bytes.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import type { MainModule } from '@rdkit/rdkit';
import { encodeTable, keyOf, PROTON } from '../src/chem/carbonTable.ts';
import { graphOf, hoseCodes, symmetryRanks, type RdkitJson } from '../src/chem/hose.ts';
import { diastereotopic, HIGHER, LOWER, predictProton, type ProtonTableInfo } from '../src/chem/protonNmr.ts';
import {
  barProblems,
  byAtom,
  measuredFor,
  parseRecords,
  preferredSpectrum,
  protonPeaks,
  readRecord,
  referenceProtonSpectra,
  testCompounds,
  type SdRecord,
  type Spectrum,
} from './nmrReference.ts';

export const SPHERES = 4;
/** One compound in this many (by InChIKey hash) is held out to measure the table. */
const HELD_OUT_EVERY = 50;
/** Two shifts on one CH₂ "differ" beyond this (ppm). */
const DIFFER = 0.05;
// Within a tolerance, allowing for the rounding of shifts held in hundredths.
const within = (error: number, tolerance: number) => error <= tolerance + 1e-9;
const LICENCE =
  'Contains information from nmrshiftdb2 (www.nmrshiftdb.org), which is made available here under the nmrshiftdb2 Database License (nmr/LICENSE-nmrshiftdb2.txt; https://nmrshiftdb.nmr.uni-koeln.de/nmrshiftdbhtml/nmrshiftdb2datalicense.txt).';

const path = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const hundredths = (ppm: number) => Math.round(ppm * 100) / 100;
const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;
const thousandths = (x: number) => Math.round(x * 1000) / 1000;

function observe(into: Map<string, number[]>, code: string, value: number): void {
  const seen = into.get(code);
  if (seen) seen.push(value);
  else into.set(code, [value]);
}

function medians(observed: Map<string, number[]>): Map<string, number> {
  return new Map([...observed].map(([code, values]) => [code, hundredths(median(values))]));
}

interface HeldOut {
  record: SdRecord;
  spectrum: Spectrum;
  solvent: string;
  peaks: [number, number][];
}

async function main(sdFile: string): Promise<void> {
  const require = createRequire(import.meta.url);
  const rdkit = (await (require('@rdkit/rdkit') as () => Promise<MainModule>)()) as MainModule;
  rdkit.use_legacy_stereo_perception(false);
  const raw = readFileSync(sdFile);
  const sha256 = createHash('sha256').update(raw).digest('hex');
  const records = parseRecords(raw.toString('utf8'));
  const compounds = testCompounds(rdkit, readFileSync(path('../../tests/fixtures/proton_nmr_compounds.csv'), 'utf8'));
  const left = new Set(compounds.map((c) => c.inchikey.split('-')[0]));

  const shipped = new Map<string, number[]>();
  const training = new Map<string, number[]>();
  const heldOut = new Map<string, HeldOut[]>();
  const rule = { flagged: { pairs: 0, differ: 0 }, unflagged: { pairs: 0, differ: 0 } };
  const excerpt: string[] = [];
  let spectra = 0;
  let atoms = 0;
  let calculated = 0;
  for (const record of records) {
    calculated += record.calculatedProton;
    if (record.proton.length === 0) continue;
    const structure = readRecord(rdkit, record.molblock);
    if (!structure) continue;
    if (left.has(structure.key)) {
      excerpt.push(record.text);
      continue;
    }
    const mol = rdkit.get_mol(record.molblock, JSON.stringify({ removeHs: false }))!;
    const g = graphOf(JSON.parse(mol.get_json()) as RdkitJson);
    const ranks = symmetryRanks(g);
    const graphAtom = new Map(g.atoms.map((a, i) => [a.index, i]));
    const held = keyOf(structure.key)[0] % HELD_OUT_EVERY === 0;
    const listed = record.proton.map((spectrum) => ({ spectrum, shifts: byAtom(protonPeaks(spectrum, structure.isHydrogen, structure.bonds)) }));

    // The diastereotopic rule, where this record lists a CH₂ with both H.
    const pairsListed = listed.flatMap(({ shifts }) =>
      [...shifts].filter(([atom, values]) => values.length === 2 && g.atoms[graphAtom.get(atom) ?? -1]?.hs === 2 && g.atoms[graphAtom.get(atom)!].z === 6),
    );
    if (pairsListed.length > 0) {
      const classes = new Map<number, number[]>();
      g.atoms.forEach((a, i) => {
        if (a.hs > 0) classes.set(ranks[i], [...(classes.get(ranks[i]) ?? []), i]);
      });
      const flagged = diastereotopic(rdkit, mol, g, ranks, [...classes.values()]);
      for (const [atom, [x, y]] of pairsListed) {
        const tally = flagged.has(graphAtom.get(atom)!) ? rule.flagged : rule.unflagged;
        tally.pairs += 1;
        if (Math.abs(x - y) > DIFFER) tally.differ += 1;
      }
    }
    mol.delete();

    if (held) {
      const list = heldOut.get(structure.key) ?? [];
      for (const { spectrum } of listed) {
        list.push({ record, spectrum, solvent: spectrum.solvent, peaks: protonPeaks(spectrum, structure.isHydrogen, structure.bonds) });
      }
      heldOut.set(structure.key, list);
    }
    for (const { shifts } of listed) {
      spectra += 1;
      for (const [atom, values] of shifts) {
        const i = graphAtom.get(atom);
        if (i === undefined || g.atoms[i].hs === 0) continue;
        atoms += 1;
        const value = mean(values);
        const [lower, higher] = values.length === 2 && g.atoms[i].hs === 2 ? [...values].sort((a, b) => a - b) : [null, null];
        for (const code of hoseCodes(g, ranks, i, SPHERES)) {
          const into = held ? [shipped] : [shipped, training];
          for (const map of into) {
            observe(map, code, value);
            if (lower !== null && higher !== null) {
              observe(map, code + LOWER, lower);
              observe(map, code + HIGHER, higher);
            }
          }
        }
      }
    }
  }
  const missing = compounds.filter((c) => referenceProtonSpectra(rdkit, excerpt.join(''), [c]).length === 0);
  if (missing.length > 0) throw new Error(`NMRShiftDB2 has no measured ¹H spectrum for ${missing.map((c) => c.name).join(', ')}`);

  // Held out: each compound's preferred spectrum, predicted from the table without them.
  const trained = medians(training);
  const errors: { error: number; sphere: number; exchangeable: boolean }[] = [];
  for (const candidates of heldOut.values()) {
    const chosen = preferredSpectrum(candidates)!;
    const signals = predictProton(rdkit, chosen.record.molblock, { spheres: SPHERES, find: (code) => trained.get(code) ?? null });
    const shifts = byAtom(chosen.peaks);
    for (const s of signals ?? []) {
      const measured = measuredFor(s.atoms, s.diastereotopic, shifts);
      if (measured === null || s.shift === null) continue;
      errors.push({ error: Math.abs(s.shift - measured), sphere: s.sphere, exchangeable: s.exchangeable });
    }
  }
  const ch = errors.filter((e) => !e.exchangeable);
  const exchangeable = errors.filter((e) => e.exchangeable);
  const figures: ProtonTableInfo['heldOut'] = {
    every: HELD_OUT_EVERY,
    compounds: heldOut.size,
    signals: ch.length,
    meanError: thousandths(mean(ch.map((e) => e.error))),
    within03: thousandths(ch.filter((e) => within(e.error, 0.3)).length / ch.length),
    within05: thousandths(ch.filter((e) => within(e.error, 0.5)).length / ch.length),
    bySphere: Array.from({ length: SPHERES }, (_, k) => {
      const at = ch.filter((e) => e.sphere === k + 1);
      return { sphere: k + 1, signals: at.length, meanError: at.length ? thousandths(mean(at.map((e) => e.error))) : 0 };
    }),
    exchangeable: { signals: exchangeable.length, meanError: thousandths(mean(exchangeable.map((e) => e.error))) },
  };
  const problems = barProblems(figures, rule);
  if (problems.length > 0) throw new Error(`build-proton-table: the table misses the plan's bar: ${problems.join('; ')}`);

  const entries = medians(shipped);
  const info: ProtonTableInfo = {
    version: 1,
    spheres: SPHERES,
    source: { file: 'nmrshiftdb2withsignals.sd', sha256, records: records.length, spectra, atoms, calculated },
    excluded: compounds.map((c) => ({ name: c.name, inchikey: c.inchikey.split('-')[0] })),
    generator: 'web/scripts/build-proton-table.ts',
    rdkit: rdkit.version(),
    licence: LICENCE,
    codes: Array.from({ length: SPHERES }, (_, k) => [...entries.keys()].filter((c) => !c.includes('|') && c.split('/').length === k + 1).length),
    dropped: 0,
    pairs: [...entries.keys()].filter((c) => c.endsWith(HIGHER)).length,
    heldOut: figures,
    diastereotopic: rule,
  };
  mkdirSync(path('../public/nmr'), { recursive: true });
  writeFileSync(path('../public/nmr/proton-shifts.bin'), encodeTable(info, entries, keyOf, PROTON));
  mkdirSync(path('../../tests/fixtures/proton_nmr'), { recursive: true });
  const excerptText = excerpt.join('');
  writeFileSync(path('../../tests/fixtures/proton_nmr/excerpt.sd'), excerptText);
  const reference = referenceProtonSpectra(rdkit, excerptText, compounds);
  writeFileSync(
    path('../../tests/fixtures/proton_nmr/reference_spectra.json'),
    `${JSON.stringify({ source: info.source, licence: LICENCE, compounds: reference }, null, 2)}\n`,
  );
  console.log(
    `build-proton-table: ${entries.size} codes (${info.pairs} pairs) from ${spectra} spectra (${atoms} atoms), ` +
      `${calculated} calculated spectra and ${compounds.length} compounds left out; held out: ${JSON.stringify(figures)}; ` +
      `diastereotopic: ${JSON.stringify(rule)}`,
  );
}

await main(process.argv[2] ?? '');
