// Build the ¹³C NMR preview's shift table from NMRShiftDB2 (docs/plans/nmr.md):
//   node scripts/build-carbon-table.ts <path to nmrshiftdb2withsignals.sd>     (from web/)
// Download the SD file from https://sourceforge.net/projects/nmrshiftdb2/files/data/
// (its SHA-256 goes into the table's header). Writes:
//   public/nmr/carbon-shifts.bin                 the table (src/chem/carbonTable.ts)
//   ../tests/fixtures/nmr/excerpt.sd             the NMR test compounds' records, verbatim
//   ../tests/fixtures/nmr/reference_spectra.json their measured shifts, from the excerpt
// The test compounds (tests/fixtures/nmr_compounds.csv, structures from PubChem) are left
// out of the table, so the tests measure predictions for compounds it has never seen.
// Deterministic: the same SD file gives the same bytes.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import type { MainModule } from '@rdkit/rdkit';
import { encodeTable, type TableInfo } from '../src/chem/carbonTable.ts';
import { graphOf, hoseCodes, symmetryRanks, type RdkitJson } from '../src/chem/hose.ts';
import { parseRecords, referenceSpectra, testCompounds } from './nmrReference.ts';

export const SPHERES = 4;
const LICENCE =
  'Contains information from nmrshiftdb2 (www.nmrshiftdb.org), which is made available here under the nmrshiftdb2 Database License (nmr/LICENSE-nmrshiftdb2.txt; https://nmrshiftdb.nmr.uni-koeln.de/nmrshiftdbhtml/nmrshiftdb2datalicense.txt).';

const path = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

async function main(sdFile: string): Promise<void> {
  const require = createRequire(import.meta.url);
  const rdkit = (await (require('@rdkit/rdkit') as () => Promise<MainModule>)()) as MainModule;
  rdkit.use_legacy_stereo_perception(false);
  const raw = readFileSync(sdFile);
  const sha256 = createHash('sha256').update(raw).digest('hex');
  const records = parseRecords(raw.toString('utf8'));
  const compounds = testCompounds(rdkit, readFileSync(path('../../tests/fixtures/nmr_compounds.csv'), 'utf8'));
  const left = new Map(compounds.map((c) => [c.inchikey.split('-')[0], c]));

  const observed: Map<string, number[]>[] = Array.from({ length: SPHERES }, () => new Map());
  const excerpt: string[] = [];
  let spectra = 0;
  let carbons = 0;
  for (const record of records) {
    if (record.carbon.length === 0) continue;
    const mol = rdkit.get_mol(record.molblock, JSON.stringify({ removeHs: false }));
    if (!mol) continue;
    const key = rdkit.get_inchikey_for_inchi(mol.get_inchi()).split('-')[0];
    const json = JSON.parse(mol.get_json()) as RdkitJson;
    mol.delete();
    if (left.has(key)) {
      excerpt.push(record.text);
      continue;
    }
    spectra += record.carbon.length;
    const g = graphOf(json);
    const ranks = symmetryRanks(g);
    const byIndex = new Map(g.atoms.map((a, i) => [a.index, i]));
    const shifts = new Map<number, number[]>();
    for (const spectrum of record.carbon) {
      for (const [atom, shift] of spectrum.peaks) shifts.set(atom, [...(shifts.get(atom) ?? []), shift]);
    }
    for (const [atom, values] of shifts) {
      const i = byIndex.get(atom);
      if (i === undefined || g.atoms[i].z !== 6) continue;
      carbons += 1;
      hoseCodes(g, ranks, i, SPHERES).forEach((code, k) => {
        const seen = observed[k].get(code);
        if (seen) seen.push(...values);
        else observed[k].set(code, [...values]);
      });
    }
  }
  const missing = compounds.filter((c) => !excerpt.some((text) => referenceSpectra(rdkit, text, [c]).length > 0));
  if (missing.length > 0) throw new Error(`NMRShiftDB2 has no ¹³C spectrum for ${missing.map((c) => c.name).join(', ')}`);

  const entries = new Map<string, number>();
  for (const level of observed) for (const [code, values] of level) entries.set(code, Math.round(median(values) * 10) / 10);
  const info: TableInfo = {
    version: 1,
    spheres: SPHERES,
    source: { file: 'nmrshiftdb2withsignals.sd', sha256, records: records.length, spectra, carbons },
    excluded: compounds.map((c) => ({ name: c.name, inchikey: c.inchikey.split('-')[0] })),
    generator: 'web/scripts/build-carbon-table.ts',
    rdkit: rdkit.version(),
    licence: LICENCE,
    codes: observed.map((level) => level.size),
    dropped: 0,
  };
  mkdirSync(path('../public/nmr'), { recursive: true });
  writeFileSync(path('../public/nmr/carbon-shifts.bin'), encodeTable(info, entries));
  mkdirSync(path('../../tests/fixtures/nmr'), { recursive: true });
  const excerptText = excerpt.join('');
  writeFileSync(path('../../tests/fixtures/nmr/excerpt.sd'), excerptText);
  const reference = referenceSpectra(rdkit, excerptText, compounds);
  writeFileSync(
    path('../../tests/fixtures/nmr/reference_spectra.json'),
    `${JSON.stringify({ source: info.source, licence: LICENCE, compounds: reference }, null, 2)}\n`,
  );
  console.log(`build-carbon-table: ${entries.size} codes from ${spectra} spectra (${carbons} carbons), ${compounds.length} compounds left out`);
}

await main(process.argv[2] ?? '');
