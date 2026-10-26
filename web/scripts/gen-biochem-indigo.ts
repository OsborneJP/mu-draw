// What Indigo answers for the biochem test sequences (docs/plans/v2-biochem.md, bar A.2):
//   node scripts/gen-biochem-indigo.ts                                  (from web/)
// Reads ../tests/fixtures/biochem_sequences.json (sequences only) and writes
// ../tests/fixtures/biochem_indigo_expected.json: for each peptide (and every residue alone, first
// in XG and last in GX, as the Biopython generator has them)
// Indigo's formula, mass, ε and hydrophobicity; for each nucleic acid, as DNA and as RNA, the
// single strand's formula and mass, and the DNA duplex's Tm at each test concentration.
//
// Independent of the app's code on purpose: each duplex is built here from two strands
// converted apart and joined base to base by hydrogen-bond connections in KET, where the app
// writes HELM (src/chem/biochem.ts). Deterministic; gen-biochem-indigo.test.ts regenerates it
// and compares bytes.
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import Module, { type IndigoModule } from 'indigo-ketcher/binaryWasm';
import data from '../src/chem/biochemData.json' with { type: 'json' };

const path = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));
export const INPUTS = path('../../tests/fixtures/biochem_sequences.json');
export const OUTPUT = path('../../tests/fixtures/biochem_indigo_expected.json');
const TM_MIN_BASES = 15; // decision 8: the paper's shortest

interface Entry {
  name: string;
  sequence?: string;
  repeat?: string;
  times?: number;
}
interface Inputs {
  peptides: Entry[];
  nucleic: Entry[];
  concentrations: { sodium_mM: number; strand_uM: number }[];
}
interface Ket {
  root: { nodes: { $ref: string }[]; connections: Connection[]; templates: { $ref: string }[] };
  [key: string]: unknown;
}
interface Connection {
  connectionType: string;
  endpoint1: { monomerId: string; attachmentPointId?: string };
  endpoint2: { monomerId: string; attachmentPointId?: string };
}
interface Monomer {
  id: string;
  templateId: string;
  position?: { x: number; y: number };
}

const expand = (e: Entry) => e.sequence ?? (e.repeat ?? '').repeat(e.times ?? 0);

export async function loadIndigo(): Promise<{ indigo: IndigoModule; library: string }> {
  const require = createRequire(import.meta.url);
  const wasm = readFileSync(path('../node_modules/indigo-ketcher/indigo-ketcher-1.46.0.wasm'));
  const indigo = await Module({ wasmBinary: wasm });
  const library = (require('ketcher-core/dist/application/editor/data/monomers.js') as { default: string }).default;
  return { indigo, library };
}

function engine(indigo: IndigoModule, library: string) {
  const call = <T>(entries: Record<string, string>, run: (o: InstanceType<IndigoModule['MapStringString']>) => T): T => {
    const o = new indigo.MapStringString();
    try {
      for (const [k, v] of Object.entries(entries)) o.set(k, v);
      return run(o);
    } finally {
      o.delete();
    }
  };
  const ket = (sequence: string, format: string): Ket =>
    JSON.parse(call({ 'input-format': format, monomerLibrary: library }, (o) => indigo.convert(sequence, 'ket', o)));
  const props = (document: Ket, sodium = 1, strand = 1) => {
    const text = call({ upc: String(sodium), nac: String(strand) }, (o) => indigo.calculateMacroProperties(JSON.stringify(document), o));
    const chains = JSON.parse(JSON.parse(text).properties);
    if (chains.length !== 1) throw new Error(`${chains.length} chains`);
    return chains[0] as { grossFormula: string; mass: number; extinctionCoefficient?: number; hydrophobicity?: number[]; Tm?: number };
  };
  return { ket, props };
}

/** A strand's base monomers from 5' to 3': walk sugar → phosphate → sugar from the sugar
 * whose R1 is free, taking the base on each sugar's R3. */
function basesInOrder(document: Ket): string[] {
  const links = new Map<string, Map<string, string>>(); // monomer → its attachment point → monomer
  for (const c of document.root.connections) {
    const ends = [c.endpoint1, c.endpoint2];
    ends.forEach((end, i) => {
      const other = ends[1 - i];
      if (!end.attachmentPointId) return;
      if (!links.has(end.monomerId)) links.set(end.monomerId, new Map());
      links.get(end.monomerId)!.set(end.attachmentPointId, other.monomerId);
    });
  }
  const sugars = [...links].filter(([, at]) => at.has('R3')).map(([id]) => id);
  let sugar: string | undefined = sugars.find((id) => !links.get(id)!.has('R1'));
  const bases: string[] = [];
  while (sugar) {
    bases.push(links.get(sugar)!.get('R3')!);
    const phosphate = links.get(sugar)!.get('R2');
    sugar = phosphate ? links.get(phosphate)?.get('R2') : undefined;
  }
  if (bases.length !== sugars.length) throw new Error('strand walk missed a nucleotide');
  return bases;
}

function naturalBase(document: Ket, monomerId: string): string {
  const monomer = document[monomerId] as Monomer;
  return (document[`monomerTemplate-${monomer.templateId}`] as { naturalAnalogShort: string }).naturalAnalogShort;
}

/** Strand and complement in one KET, each base joined to its partner by a hydrogen bond. */
function duplex(first: Ket, second: Ket, sequence: string, complement: string): Ket {
  const renamed: Ket = { ...first, root: { ...first.root, nodes: [...first.root.nodes], connections: [...first.root.connections] } };
  const rename = (id: string) => `${id}b`;
  for (const node of second.root.nodes) {
    const monomer = second[node.$ref] as Monomer;
    const moved = { ...monomer, id: rename(monomer.id), position: { x: monomer.position?.x ?? 0, y: (monomer.position?.y ?? 0) - 5 } };
    renamed[rename(node.$ref)] = moved;
    renamed.root.nodes.push({ $ref: rename(node.$ref) });
  }
  for (const c of second.root.connections) {
    renamed.root.connections.push({
      ...c,
      endpoint1: { ...c.endpoint1, monomerId: rename(c.endpoint1.monomerId) },
      endpoint2: { ...c.endpoint2, monomerId: rename(c.endpoint2.monomerId) },
    });
  }
  const refs = new Set(renamed.root.templates.map((t) => t.$ref));
  for (const t of second.root.templates) {
    if (!refs.has(t.$ref)) renamed.root.templates.push(t);
    renamed[t.$ref] = second[t.$ref];
  }
  const top = basesInOrder(first);
  const bottom = basesInOrder(second);
  if (top.map((b) => naturalBase(first, b)).join('') !== sequence) throw new Error(`strand read wrongly: ${sequence}`);
  if (bottom.map((b) => naturalBase(second, b)).join('') !== complement) throw new Error(`complement read wrongly: ${complement}`);
  top.forEach((base, k) => {
    renamed.root.connections.push({
      connectionType: 'hydrogen',
      endpoint1: { monomerId: base },
      endpoint2: { monomerId: rename(bottom[bottom.length - 1 - k]) },
    });
  });
  return renamed;
}

export async function generate(): Promise<string> {
  const inputs = JSON.parse(readFileSync(INPUTS, 'utf8')) as Inputs;
  const { indigo, library } = await loadIndigo();
  const { ket, props } = engine(indigo, library);
  const three = data.residues as Record<string, string>;
  const peptides = [
    ...inputs.peptides.map((e) => ({ name: e.name, sequence: expand(e) })),
    ...Object.keys(three).map((r) => ({ name: `${three[r]} alone`, sequence: r })),
    ...Object.keys(three).map((r) => ({ name: `${three[r]} first`, sequence: `${r}G` })),
    ...Object.keys(three).map((r) => ({ name: `${three[r]} last`, sequence: `G${r}` })),
  ].map(({ name, sequence }) => {
    const p = props(ket(sequence, 'chemical/x-peptide-sequence'));
    return { name, sequence, formula: p.grossFormula, mass: p.mass, extinction: p.extinctionCoefficient, hydrophobicity: p.hydrophobicity };
  });
  const pairs = data.complement as Record<'dna' | 'rna', Record<string, string>>;
  const nucleic = inputs.nucleic.map((e) => {
    const dna = expand(e);
    const rna = dna.replaceAll('T', 'U');
    const single = (sequence: string, format: string) => {
      const p = props(ket(sequence, format));
      return { formula: p.grossFormula, mass: p.mass };
    };
    let tm: number[] | null = null;
    if (dna.length >= TM_MIN_BASES) {
      const complement = [...dna].reverse().map((b) => pairs.dna[b]).join('');
      const both = duplex(ket(dna, 'chemical/x-dna-sequence'), ket(complement, 'chemical/x-dna-sequence'), dna, complement);
      tm = inputs.concentrations.map((c) => {
        const answer = props(both, c.sodium_mM / 1e3, c.strand_uM / 1e6).Tm;
        if (answer === undefined) throw new Error(`no Tm for ${e.name}`);
        return answer;
      });
    }
    return {
      name: e.name,
      sequence: dna,
      dna: { ...single(dna, 'chemical/x-dna-sequence'), tm },
      rna: single(rna, 'chemical/x-rna-sequence'),
    };
  });
  const expected = {
    _generated: `web/scripts/gen-biochem-indigo.ts with Indigo ${indigo.version()} and ketcher-core's monomer library; do not edit`,
    indigo: indigo.version(),
    concentrations: inputs.concentrations,
    peptides,
    nucleic,
  };
  return `${JSON.stringify(expected, null, 2)}\n`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeFileSync(OUTPUT, await generate());
  console.log(`wrote ${OUTPUT}`);
}
