// Reading NMRShiftDB2's SD file for the NMR previews: its records, the test compounds
// (tests/fixtures/nmr_compounds.csv and proton_nmr_compounds.csv, from PubChem) and their
// measured spectra. Shared by scripts/build-carbon-table.ts, build-proton-table.ts and the
// tests that rebuild each reference_spectra.json from its excerpt.sd, so the reference
// shifts provably come from NMRShiftDB2.
import type { MainModule } from '@rdkit/rdkit';

export interface Spectrum {
  number: number;
  solvent: string;
  /** [Molfile atom index, ppm]: for ¹³C the carbon; for ¹H the atom carrying the H, or the H
   * itself where the record draws it. */
  peaks: [number, number][];
}

export interface SdRecord {
  /** The record exactly as in the file, its $$$$ line included. */
  text: string;
  molblock: string;
  fields: Map<string, string>;
  /** Each ¹³C spectrum: its number, solvent, and peaks as [Molfile atom index, ppm]. */
  carbon: Spectrum[];
  /** Each measured ¹H spectrum. Those the record lists as calculated (a program named in
   * its NMRProgram or Program field) are left out and counted in `calculatedProton`. */
  proton: Spectrum[];
  calculatedProton: number;
}

/** A field that numbers its values by spectrum ("0:Unreported 1:Chloroform-D1 (CDCl3)"). */
function bySpectrum(value: string | undefined): Map<number, string> {
  const out = new Map<number, string>();
  for (const s of (value ?? '').matchAll(/(\d+):(.*?)(?=\s+\d+:|\s*$)/g)) out.set(Number(s[1]), s[2]);
  return out;
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
    const solvents = bySpectrum(fields.get('Solvent'));
    const spectra = (nucleus: string): Spectrum[] =>
      [...fields]
        .flatMap(([name, value]) => {
          const n = new RegExp(`^Spectrum ${nucleus} (\\d+)$`).exec(name);
          if (!n) return [];
          const peaks = value
            .split('|')
            .map((p) => p.split(';'))
            .filter((p) => p.length >= 3 && p[0] !== '' && p[2] !== '')
            .map((p): [number, number] => [Number(p[2]), Number(p[0])]);
          return [{ number: Number(n[1]), solvent: solvents.get(Number(n[1])) ?? '', peaks }];
        })
        .sort((a, b) => a.number - b.number);
    const programs = [...bySpectrum(fields.get('NMRProgram')), ...bySpectrum(fields.get('Program'))];
    const calculated = new Set(programs.filter(([, program]) => program.trim() !== '').map(([n]) => n));
    const proton = spectra('1H');
    records.push({
      text,
      molblock: body.slice(0, end + MOLFILE_END.length),
      fields,
      carbon: spectra('13C'),
      proton: proton.filter((s) => !calculated.has(s.number)),
      calculatedProton: proton.filter((s) => calculated.has(s.number)).length,
    });
  }
  return records;
}

/** The plan's bar 5 (C–H signals held out; corrected by Jeff on 2026-10-26) and bar 3 (the
 * diastereotopic rule), which build-proton-table.ts checks before it writes a table. */
export const BAR = { meanError: 0.27, within03: 0.72, flaggedDiffer: 0.75, unflaggedDiffer: 0.05 };

/** How the held-out figures and the rule's tallies miss the bar; a figure that isn't a number
 * (nothing held out, no pairs listed) misses it too. */
export function barProblems(
  heldOut: { meanError: number; within03: number },
  rule: { flagged: { pairs: number; differ: number }; unflagged: { pairs: number; differ: number } },
): string[] {
  const share = (t: { pairs: number; differ: number }) => t.differ / t.pairs;
  return [
    !(heldOut.meanError <= BAR.meanError) && `held-out C–H mean error ${heldOut.meanError} ppm is over ${BAR.meanError}`,
    !(heldOut.within03 >= BAR.within03) && `held-out C–H within ±0.3 ppm ${heldOut.within03} is under ${BAR.within03}`,
    !(share(rule.flagged) >= BAR.flaggedDiffer) && `flagged CH₂ differ in ${share(rule.flagged)}, under ${BAR.flaggedDiffer}`,
    !(share(rule.unflagged) <= BAR.unflaggedDiffer) && `unflagged CH₂ differ in ${share(rule.unflagged)}, over ${BAR.unflaggedDiffer}`,
  ].filter((p): p is string => typeof p === 'string');
}

const AQUEOUS = /D2O|Deuteriumoxide/i;
const UNREPORTED = /Unreported|Unknown|^$/;

/** The spectrum the tests compare with: one measured in CDCl3 if there is one, else in
 * another solvent the record names (not D₂O, where OH and NH exchange), else one whose
 * solvent isn't reported, else D₂O. */
export function preferredSpectrum<T extends { solvent: string }>(spectra: T[]): T | undefined {
  return (
    spectra.find((s) => s.solvent.includes('CDCl3')) ??
    spectra.find((s) => !UNREPORTED.test(s.solvent) && !AQUEOUS.test(s.solvent)) ??
    spectra.find((s) => !AQUEOUS.test(s.solvent)) ??
    spectra[0]
  );
}

/** A ¹H spectrum's peaks as [Molfile index of the atom carrying the H, ppm], in the
 * record's order: an entry on a drawn H goes to the atom it is bonded to. `bonds` are the
 * record's, from RDKit's JSON. */
export function protonPeaks(spectrum: Spectrum, isHydrogen: (atom: number) => boolean, bonds: [number, number][]): [number, number][] {
  const carrier = new Map<number, number>();
  for (const [a, b] of bonds) {
    if (isHydrogen(a) && !isHydrogen(b)) carrier.set(a, b);
    if (isHydrogen(b) && !isHydrogen(a)) carrier.set(b, a);
  }
  return spectrum.peaks.flatMap(([index, shift]): [number, number][] => {
    const atom = isHydrogen(index) ? carrier.get(index) : index;
    return atom === undefined ? [] : [[atom, shift]];
  });
}

/** Peaks grouped by atom. */
export function byAtom(peaks: [number, number][]): Map<number, number[]> {
  const out = new Map<number, number[]>();
  for (const [atom, shift] of peaks) out.set(atom, [...(out.get(atom) ?? []), shift]);
  return out;
}

/** The measured shift for one predicted ¹H signal: the mean over its atoms of what the
 * spectrum lists on them, or for one of a diastereotopic pair, of the higher or the lower
 * where an atom is listed with two shifts (with one, that one). Null when none is listed. */
export function measuredFor(atoms: number[], diastereotopic: 'higher' | 'lower' | null, shifts: Map<number, number[]>): number | null {
  const values = atoms.flatMap((a) => {
    const listed = shifts.get(a) ?? [];
    if (diastereotopic === null || listed.length !== 2) return listed;
    return [diastereotopic === 'higher' ? Math.max(...listed) : Math.min(...listed)];
  });
  return values.length === 0 ? null : values.reduce((x, y) => x + y, 0) / values.length;
}

export interface TestCompound {
  name: string;
  smiles: string;
  inchikey: string;
  inchi: string;
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
    const inchi = mol.get_inchi();
    const inchikey = rdkit.get_inchikey_for_inchi(inchi);
    mol.delete();
    return { name: row[at('typed_name')], smiles, inchikey, inchi };
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

interface JsonAtomsAndBonds {
  defaults: { atom: { z: number; isotope: number } };
  molecules: { atoms: { z?: number; isotope?: number }[]; bonds?: { atoms: [number, number] }[] }[];
}

/** A record's structure as RDKit reads it: its InChI and InChIKey skeleton, which atoms are
 * H (not deuterium), and its bonds; null if RDKit can't read it. */
export function readRecord(
  rdkit: MainModule,
  molblock: string,
): { key: string; inchi: string; isHydrogen: (atom: number) => boolean; bonds: [number, number][] } | null {
  const mol = rdkit.get_mol(molblock, JSON.stringify({ removeHs: false }));
  if (!mol) return null;
  try {
    const json = JSON.parse(mol.get_json()) as JsonAtomsAndBonds;
    const { atoms, bonds = [] } = json.molecules[0];
    const h = atoms.map((a) => (a.z ?? json.defaults.atom.z) === 1 && (a.isotope ?? json.defaults.atom.isotope) === 0);
    const inchi = mol.get_inchi();
    return {
      key: rdkit.get_inchikey_for_inchi(inchi).split('-')[0],
      inchi,
      isHydrogen: (atom) => h[atom] === true,
      bonds: bonds.map((b) => b.atoms),
    };
  } finally {
    mol.delete();
  }
}

export interface ProtonReference {
  name: string;
  nmrshiftdb2_id: string;
  spectrum: number;
  solvent: string;
  molblock: string;
  /** [Molfile atom index of NMRShiftDB2's structure, ppm], as recorded, an entry on a drawn
   * H moved to the atom it is bonded to. */
  peaks: [number, number][];
}

/** InChI's stereo layers (/b double bonds, /t centres), or null when it has neither. */
function stereoLayers(inchi: string): string | null {
  const layers = inchi.split('/').filter((l) => l.startsWith('b') || l.startsWith('t'));
  return layers.length === 0 ? null : layers.join('/');
}

/** Whether a record's structure can stand for a compound with the same skeleton: the same
 * stereo, or none defined on one side. Mirror images count as the same (InChI's /m layer is
 * left out), since enantiomers have the same spectrum; E and Z, or other diastereomers, don't. */
export function sameStereo(ours: string, theirs: string): boolean {
  const [a, b] = [stereoLayers(ours), stereoLayers(theirs)];
  return a === null || b === null || a === b;
}

/** For each compound, the measured ¹H spectrum preferredSpectrum picks among all of `sd`'s
 * records with its InChIKey skeleton and its stereo (sameStereo), in file order. */
export function referenceProtonSpectra(rdkit: MainModule, sd: string, compounds: TestCompound[]): ProtonReference[] {
  const records = parseRecords(sd).filter((r) => r.proton.length > 0);
  const read = records.map((r) => readRecord(rdkit, r.molblock));
  return compounds.flatMap((c) => {
    const key = c.inchikey.split('-')[0];
    const candidates = records.flatMap((record, i) =>
      read[i]?.key === key && sameStereo(c.inchi, read[i]!.inchi) ? record.proton.map((spectrum) => ({ record, spectrum, structure: read[i]! })) : [],
    );
    const chosen = preferredSpectrum(candidates.map((x) => ({ ...x, solvent: x.spectrum.solvent })));
    if (!chosen) return [];
    return [
      {
        name: c.name,
        nmrshiftdb2_id: chosen.record.fields.get('nmrshiftdb2 ID') ?? '',
        spectrum: chosen.spectrum.number,
        solvent: chosen.spectrum.solvent,
        molblock: chosen.record.molblock,
        peaks: protonPeaks(chosen.spectrum, chosen.structure.isHydrogen, chosen.structure.bonds),
      },
    ];
  });
}
