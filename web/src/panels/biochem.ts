// The biochem section's state (docs/plans/v2-biochem.md). What the student types is read at
// once: an unreadable sequence is said so and never sent, and a peptide's net charge and pI
// come from the pKa table here, so changing the pH needs no worker. Indigo's values come
// from the worker with no timers: at most one request is in flight, edits made meanwhile
// collapse into one request for the newest inputs, and an answer for older inputs is never
// shown. biochem.test.ts forces each ordering with a stub worker.
import {
  isoelectricPoint,
  netCharge,
  parseSequence,
  problemMessage,
  TM_MIN_BASES,
  type SequenceType,
} from '../chem/biochem.ts';
import type { BiochemReply, BiochemRequest, BiochemValues } from '../chem/indigoBiochem';

/** The boxes, as typed. */
export interface Inputs {
  type: SequenceType;
  text: string;
  pH: string;
  /** [Na⁺], mM. */
  sodium: string;
  /** Strand concentration, µM. */
  strand: string;
}

/** Ketcher's own defaults for Tm (ketcher-react 3.18's initial state: 140 mM unipositive
 * ions, 200 µM oligonucleotides); tests/fixtures/biochem_sequences.json's first pair. */
export const DEFAULT_INPUTS: Inputs = { type: 'peptide', text: '', pH: '7.0', sodium: '140', strand: '200' };

/** The notes under the values, naming each method and source. */
export const NOTES = {
  charge: "Net charge and pI: Bjellqvist's pKa values (as ExPASy's Compute pI/Mw), from Biopython, with free N- and C-termini.",
  extinction:
    "ε280 in M⁻¹ cm⁻¹: Trp, Tyr and cystine values from Ketcher's Indigo (Pace et al. 1995, as ExPASy). \"All Cys paired\" counts one cystine for every two Cys.",
  noAbsorbance: 'No Trp or Tyr, and no two Cys to pair: ε280 is 0, so this peptide cannot be measured at 280 nm.',
  hydrophobicity: "Hydrophobicity: Black and Mould (1991), from Ketcher's Indigo; 0 is least and 1 most hydrophobic.",
  mass: "Formula and average mass: Ketcher's Indigo, for the neutral chain with free ends.",
  tm: "Tm: Khandelwal and Bhyravabhotla (2010), Ketcher's method, for the strand paired with its exact complement. Fitted for DNA of 15 base pairs or more, in 0.015-0.6 M Na⁺.",
  short: 'Tm needs 15 bases or more: the method was fitted on 15-mers and longer.',
  rna: "No Tm for RNA: Ketcher's method is for DNA.",
  conditions: 'Tm needs a positive [Na⁺] and strand concentration.',
};

export type IndigoPart =
  | { kind: 'working' }
  | { kind: 'ready'; values: BiochemValues }
  | { kind: 'error'; message: string }
  | { kind: 'unavailable'; reason: string };

/** Why a nucleic acid shows no Tm. */
export type TmNote = 'short' | 'rna' | 'conditions' | null;

export type BiochemState =
  | { kind: 'empty'; inputs: Inputs }
  | { kind: 'invalid'; inputs: Inputs; message: string }
  | {
      kind: 'peptide';
      inputs: Inputs;
      sequence: string;
      /** Null while the pH box holds no pH from 0 to 14. */
      charge: number | null;
      pI: number;
      indigo: IndigoPart;
    }
  | { kind: 'nucleic'; inputs: Inputs; type: 'dna' | 'rna'; sequence: string; tmNote: TmNote; indigo: IndigoPart };

export interface Biochem {
  set(inputs: Inputs): void;
  reply(reply: BiochemReply): void;
}

const number = (text: string) => (text.trim() === '' ? NaN : Number(text));

export function pHValue(text: string): number | null {
  const pH = number(text);
  return Number.isFinite(pH) && pH >= 0 && pH <= 14 ? pH : null;
}

function positive(text: string): number | null {
  const value = number(text);
  return Number.isFinite(value) && value > 0 ? value : null;
}

export function createBiochem(send: (request: BiochemRequest) => void, show: (state: BiochemState) => void): Biochem {
  let inputs = DEFAULT_INPUTS;
  let id = 0;
  // The newest request wanted, the one Indigo is working on, and the last answer.
  let wanted: { key: string; request: Omit<BiochemRequest, 'id'> } | null = null;
  let inFlight: { id: number; key: string } | null = null;
  let answered: { key: string; part: IndigoPart } | null = null;
  let unavailable: string | null = null;

  function pump() {
    if (unavailable || inFlight || !wanted || answered?.key === wanted.key) return;
    inFlight = { id: ++id, key: wanted.key };
    send({ id: inFlight.id, ...wanted.request });
  }

  function indigoPart(): IndigoPart {
    if (unavailable) return { kind: 'unavailable', reason: unavailable };
    if (wanted && answered?.key === wanted.key) return answered.part;
    return { kind: 'working' };
  }

  function update() {
    const parsed = parseSequence(inputs.type, inputs.text);
    if (!parsed.ok) {
      wanted = null;
      const message = problemMessage(inputs.type, parsed);
      show(message ? { kind: 'invalid', inputs, message } : { kind: 'empty', inputs });
      return;
    }
    const { type, sequence } = parsed;
    let tmNote: TmNote = null;
    let tm: BiochemRequest['tm'] = null;
    if (type === 'rna') tmNote = 'rna';
    else if (type === 'dna' && sequence.length < TM_MIN_BASES) tmNote = 'short';
    else if (type === 'dna') {
      const sodium = positive(inputs.sodium);
      const strand = positive(inputs.strand);
      if (sodium === null || strand === null) tmNote = 'conditions';
      else tm = { sodium: sodium / 1e3, strand: strand / 1e6 };
    }
    const request = { type, sequence, tm };
    wanted = { key: JSON.stringify(request), request };
    pump();
    const indigo = indigoPart();
    if (type === 'peptide') {
      const pH = pHValue(inputs.pH);
      show({
        kind: 'peptide',
        inputs,
        sequence,
        charge: pH === null ? null : netCharge(sequence, pH),
        pI: isoelectricPoint(sequence),
        indigo,
      });
    } else {
      show({ kind: 'nucleic', inputs, type, sequence, tmNote, indigo });
    }
  }

  return {
    set(next) {
      inputs = next;
      update();
    },
    reply(reply) {
      if ('failed' in reply) {
        unavailable = reply.failed;
        inFlight = null;
      } else {
        if (!inFlight || reply.id !== inFlight.id) return;
        const part: IndigoPart = 'values' in reply ? { kind: 'ready', values: reply.values } : { kind: 'error', message: reply.error };
        answered = { key: inFlight.key, part };
        inFlight = null;
      }
      update();
    },
  };
}
