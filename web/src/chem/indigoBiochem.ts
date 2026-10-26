// Indigo's side of the biochem tools (docs/plans/v2-biochem.md): the values Ketcher's
// macromolecules properties window shows, for a typed sequence, without that mode. Indigo
// (indigo-ketcher, the release Ketcher pins) turns the sequence into monomers with Ketcher's
// own monomer library, then runs calculateMacroProperties, the function Ketcher calls.
// biochemWorker.ts runs this in the browser; indigoBiochem.test.ts runs it in Node.
import type { IndigoModule, IndigoOptions } from 'indigo-ketcher/binaryWasm';
import { duplexHelm, extinction, type ChainType } from './biochem';

/** Tm conditions, in mol/L. */
export interface Conditions {
  sodium: number;
  strand: number;
}

export interface BiochemRequest {
  id: number;
  type: ChainType;
  /** One-letter codes, upper case (parseSequence's). */
  sequence: string;
  /** Asked only for DNA long enough for the method (decision 8). */
  tm: Conditions | null;
}

export type BiochemValues =
  | {
      kind: 'peptide';
      formula: string;
      mass: number;
      extinction: { reduced: number; cystines: number };
      hydrophobicity: number[];
    }
  | { kind: 'nucleic'; formula: string; mass: number; tm: number | null };

export type BiochemReply = { id: number; values: BiochemValues } | { id: number; error: string } | { failed: string };

/** The worker's first message carries the library; every other one is a request. */
export type BiochemMessage = { kind: 'library'; library: string } | ({ kind: 'compute' } & BiochemRequest);

const INPUT: Record<ChainType | 'helm', string> = {
  peptide: 'chemical/x-peptide-sequence',
  dna: 'chemical/x-dna-sequence',
  rna: 'chemical/x-rna-sequence',
  helm: 'chemical/x-helm',
};

/** What calculateMacroProperties gives for one chain (Indigo 1.46). */
interface Properties {
  grossFormula?: string;
  mass?: number;
  extinctionCoefficient?: number;
  hydrophobicity?: number[];
  Tm?: number;
}

export interface Engine {
  compute(request: BiochemRequest): BiochemReply;
}

export function createEngine(indigo: IndigoModule, library: string): Engine {
  function withOptions<T>(entries: Record<string, string>, run: (options: IndigoOptions) => T): T {
    const options = new indigo.MapStringString();
    try {
      for (const [key, value] of Object.entries(entries)) options.set(key, value);
      return run(options);
    } finally {
      options.delete();
    }
  }
  const toKet = (text: string, format: string) =>
    withOptions({ 'input-format': format, monomerLibrary: library }, (o) => indigo.convert(text, 'ket', o));
  // `nac` is mandatory even where there is no Tm; any positive value does there.
  const properties = (ket: string, tm: Conditions = { sodium: 1, strand: 1 }): Properties => {
    const conditions = { upc: String(tm.sodium), nac: String(tm.strand) };
    const answer = withOptions(conditions, (o) => indigo.calculateMacroProperties(ket, o));
    const chains = JSON.parse(JSON.parse(answer).properties) as Properties[];
    if (chains.length !== 1) throw new Error(`Indigo found ${chains.length} chains`);
    return chains[0];
  };
  const required = <T>(value: T | undefined, what: string): T => {
    if (value === undefined) throw new Error(`Indigo gave no ${what}`);
    return value;
  };
  // Indigo's ε for one Cys: what it adds per Cys, and Pace's value per cystine.
  const perCysteine = required(properties(toKet('C', INPUT.peptide)).extinctionCoefficient, 'extinction coefficient');

  function values(request: BiochemRequest): BiochemValues {
    const chain = properties(toKet(request.sequence, INPUT[request.type]));
    const formula = required(chain.grossFormula, 'formula');
    const mass = required(chain.mass, 'mass');
    if (request.type === 'peptide') {
      return {
        kind: 'peptide',
        formula,
        mass,
        extinction: extinction(required(chain.extinctionCoefficient, 'extinction coefficient'), request.sequence, perCysteine),
        hydrophobicity: required(chain.hydrophobicity, 'hydrophobicity'),
      };
    }
    let tm: number | null = null;
    if (request.tm) {
      const duplex = toKet(duplexHelm(request.type, request.sequence), INPUT.helm);
      tm = required(properties(duplex, request.tm).Tm, 'melting temperature');
    }
    return { kind: 'nucleic', formula, mass, tm };
  }

  return {
    compute(request) {
      try {
        return { id: request.id, values: values(request) };
      } catch (error) {
        return { id: request.id, error: error instanceof Error ? error.message : String(error) };
      }
    },
  };
}
