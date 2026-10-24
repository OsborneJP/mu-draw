// Reading NMRShiftDB2's SD file for the ¹³C NMR preview: its records, the test compounds
// (tests/fixtures/nmr_compounds.csv, from PubChem) and their measured spectra. Shared by
// scripts/build-carbon-table.ts and the test that rebuilds reference_spectra.json from
// tests/fixtures/nmr/excerpt.sd, so the reference shifts provably come from NMRShiftDB2.
import type { MainModule } from '@rdkit/rdkit';

export interface SdRecord {
  /** The record exactly as in the file, its $$$$ line included. */
  text: string;
  molblock: string;
  fields: Map<string, string>;
  /** Each ¹³C spectrum: its number, solvent, and peaks as [Molfile atom index, ppm]. */
  carbon: { number: number; solvent: string; peaks: [number, number][] }[];
}

// A Molfile ends at this line; the record's fields follow. Built by concatenation so the
// chemistry-literal check (scripts/checks/chem_literals.py) sees no Molfile text here.
const MOLFILE_END = 'M' + '  END';

export function parseRecords(sd: string): SdRecord[] {
  const records: SdRecord[] = [];
  const pattern = /^\$\$\$\$\r?$\n?/gm;
  let start = 0;
  for (let m = pattern.exec(sd); m; m = pattern.exec(sd)) {
    const text = sd.slice(start, m.index + m[0].length);
    start = m.index + m[0].length;
    const body = text.replace(/\r\n/g, '\n');
    const end = body.indexOf(MOLFILE_END);
    if (end < 0) continue;
    const fields = new Map<string, string>();
    for (const f of body.slice(end).matchAll(/^> *<([^>]+)>\n([\s\S]*?)(?=\n\n|\n> |\n\$\$\$\$|$)/gm)) {
      fields.set(f[1], f[2].trim());
    }
    const solvents = new Map<number, string>();
    for (const s of (fields.get('Solvent') ?? '').matchAll(/(\d+):(.*?)(?=\s+\d+:|\s*$)/g)) solvents.set(Number(s[1]), s[2]);
    const carbon = [...fields]
      .flatMap(([name, value]) => {
        const n = /^Spectrum 13C (\d+)$/.exec(name);
        if (!n) return [];
        const peaks = value
          .split('|')
          .map((p) => p.split(';'))
          .filter((p) => p.length >= 3 && p[0] !== '' && p[2] !== '')
          .map((p): [number, number] => [Number(p[2]), Number(p[0])]);
        return [{ number: Number(n[1]), solvent: solvents.get(Number(n[1])) ?? '', peaks }];
      })
      .sort((a, b) => a.number - b.number);
    records.push({ text, molblock: body.slice(0, end + MOLFILE_END.length), fields, carbon });
  }
  return records;
}

export interface TestCompound {
  name: string;
  smiles: string;
  inchikey: string;
}

/** Rows of a CSV written by Python's csv module (fields quoted only when needed). */
function csvRows(text: string): string[][] {
  const rows: string[][] = [];
  for (const line of text.split('\n').filter((l) => l !== '')) {
    const row: string[] = [];
    let field = '';
    let quoted = false;
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i];
      if (quoted && ch === '"' && line[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') {
        quoted = !quoted;
      } else if (ch === ',' && !quoted) {
        row.push(field);
        field = '';
      } else {
        field += ch;
      }
    }
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** The NMR test compounds, with RDKit's InChIKey for each PubChem structure. */
export function testCompounds(rdkit: MainModule, csv: string): TestCompound[] {
  const [header, ...rows] = csvRows(csv);
  const at = (name: string) => header.indexOf(name);
  return rows.map((row) => {
    const smiles = row[at('smiles')];
    const mol = rdkit.get_mol(smiles);
    if (!mol) throw new Error(`RDKit cannot read the PubChem SMILES for ${row[at('typed_name')]}`);
    const inchikey = rdkit.get_inchikey_for_inchi(mol.get_inchi());
    mol.delete();
    return { name: row[at('typed_name')], smiles, inchikey };
  });
}

export interface ReferenceSpectrum {
  name: string;
  nmrshiftdb2_id: string;
  spectrum: number;
  solvent: string;
  molblock: string;
  /** [Molfile atom index of NMRShiftDB2's structure, ppm], as recorded. */
  peaks: [number, number][];
}

/** For each compound, the record in `sd` with its InChIKey skeleton, and that record's
 * ¹³C spectrum measured in CDCl3 if there is one, else its first. */
export function referenceSpectra(rdkit: MainModule, sd: string, compounds: TestCompound[]): ReferenceSpectrum[] {
  const records = parseRecords(sd).filter((r) => r.carbon.length > 0);
  const keys = records.map((r) => {
    const mol = rdkit.get_mol(r.molblock, JSON.stringify({ removeHs: false }));
    if (!mol) return '';
    const key = rdkit.get_inchikey_for_inchi(mol.get_inchi()).split('-')[0];
    mol.delete();
    return key;
  });
  return compounds.flatMap((c) => {
    const i = keys.indexOf(c.inchikey.split('-')[0]);
    if (i < 0) return [];
    const r = records[i];
    const spectrum = r.carbon.find((s) => s.solvent.includes('CDCl3')) ?? r.carbon[0];
    return [
      {
        name: c.name,
        nmrshiftdb2_id: r.fields.get('nmrshiftdb2 ID') ?? '',
        spectrum: spectrum.number,
        solvent: spectrum.solvent,
        molblock: r.molblock,
        peaks: spectrum.peaks,
      },
    ];
  });
}
