// The biochem section's ordering (bar B.4-B.6), forced with a stub worker: what is sent, when,
// and that an answer for older inputs is never shown. No timers anywhere.
import { describe, expect, it } from 'vitest';
import { isoelectricPoint, netCharge } from '../chem/biochem';
import type { BiochemReply, BiochemRequest, BiochemValues } from '../chem/indigoBiochem';
import { createBiochem, DEFAULT_INPUTS, type BiochemState, type Inputs } from './biochem';

const fixtures = import.meta.glob<{ concentrations: { sodium_mM: number; strand_uM: number }[] }>(
  '../../../tests/fixtures/biochem_sequences.json',
  { eager: true, import: 'default' },
);

const PEPTIDE: BiochemValues = { kind: 'peptide', formula: 'f', mass: 1, extinction: { reduced: 0, cystines: 0 }, hydrophobicity: [] };

function harness() {
  const sent: BiochemRequest[] = [];
  const shown: BiochemState[] = [];
  const biochem = createBiochem(
    (r) => sent.push(r),
    (s) => shown.push(s),
  );
  let inputs: Inputs = DEFAULT_INPUTS;
  const type = (patch: Partial<Inputs>) => {
    inputs = { ...inputs, ...patch };
    biochem.set(inputs);
  };
  const last = () => shown[shown.length - 1];
  const answer = (request: BiochemRequest, values: BiochemValues = PEPTIDE): BiochemReply => ({ id: request.id, values });
  return { sent, shown, biochem, type, last, answer };
}

describe('the biochem section', () => {
  it("starts with Ketcher's own Tm conditions (the generators' first concentration pair)", () => {
    const [first] = Object.values(fixtures)[0].concentrations;
    expect([Number(DEFAULT_INPUTS.sodium), Number(DEFAULT_INPUTS.strand)]).toEqual([first.sodium_mM, first.strand_uM]);
  });

  it('shows the charge and pI at once, and Indigo\'s values when they come', () => {
    const h = harness();
    h.type({ text: 'GKG' });
    expect(h.sent).toEqual([{ id: 1, type: 'peptide', sequence: 'GKG', tm: null }]);
    expect(h.last()).toMatchObject({
      kind: 'peptide',
      charge: netCharge('GKG', 7),
      pI: isoelectricPoint('GKG'),
      indigo: { kind: 'working' },
    });
    h.biochem.reply(h.answer(h.sent[0]));
    expect(h.last()).toMatchObject({ kind: 'peptide', indigo: { kind: 'ready', values: PEPTIDE } });
  });

  it('a pH change recomputes the charge with no request, even while Indigo is busy', () => {
    const h = harness();
    h.type({ text: 'GKG' });
    h.type({ pH: '3.5' });
    expect(h.sent).toHaveLength(1);
    expect(h.last()).toMatchObject({ charge: netCharge('GKG', 3.5), indigo: { kind: 'working' } });
    h.type({ pH: '15' });
    expect(h.last()).toMatchObject({ charge: null });
  });

  it('edits made while Indigo is busy send one request, for the newest inputs', () => {
    const h = harness();
    h.type({ text: 'G' });
    h.type({ text: 'GK' });
    h.type({ text: 'GKG' });
    h.type({ text: 'GKGW' });
    expect(h.sent).toHaveLength(1);
    // The answer for "G" comes while "GKGW" is wanted: dropped, and "GKGW" is asked for.
    h.biochem.reply(h.answer(h.sent[0]));
    expect(h.last()).toMatchObject({ sequence: 'GKGW', indigo: { kind: 'working' } });
    expect(h.sent.map((r) => r.sequence)).toEqual(['G', 'GKGW']);
    h.biochem.reply(h.answer(h.sent[1]));
    expect(h.last()).toMatchObject({ sequence: 'GKGW', indigo: { kind: 'ready' } });
    expect(h.shown.filter((s) => s.kind === 'peptide' && s.indigo.kind === 'ready').map((s) => 'sequence' in s && s.sequence)).toEqual([
      'GKGW',
    ]);
  });

  it('going back to the sequence Indigo is working on sends nothing more', () => {
    const h = harness();
    h.type({ text: 'G' });
    h.type({ text: 'GK' });
    h.type({ text: 'G' });
    h.biochem.reply(h.answer(h.sent[0]));
    expect(h.sent).toHaveLength(1);
    expect(h.last()).toMatchObject({ sequence: 'G', indigo: { kind: 'ready' } });
  });

  it('a reply that is not for the request in flight is ignored', () => {
    const h = harness();
    h.type({ text: 'G' });
    h.biochem.reply({ id: 99, values: PEPTIDE });
    expect(h.last()).toMatchObject({ indigo: { kind: 'working' } });
  });

  it('an unreadable sequence is said so and never sent; an empty box says nothing', () => {
    const h = harness();
    h.type({ text: 'GXG' });
    expect(h.sent).toEqual([]);
    expect(h.last()).toEqual({ kind: 'invalid', inputs: expect.anything(), message: '"X" (character 2) is not one of the 20 standard amino acids.' });
    h.type({ text: ' 12 ' });
    expect(h.last()).toMatchObject({ kind: 'empty' });
    expect(h.sent).toEqual([]);
  });

  it('an answer that arrives after the box became unreadable is not shown, and is not asked for again', () => {
    const h = harness();
    h.type({ text: 'G' });
    h.type({ text: 'G!' });
    h.biochem.reply(h.answer(h.sent[0]));
    expect(h.last()).toMatchObject({ kind: 'invalid' });
    h.type({ text: 'G' });
    expect(h.sent).toHaveLength(1);
    expect(h.last()).toMatchObject({ kind: 'peptide', indigo: { kind: 'ready' } });
  });

  it('DNA: Tm is asked for at the conditions in the boxes, in mol/L, from 15 bases', () => {
    const h = harness();
    const fifteen = 'ACGTTGCAAGGCTTA';
    h.type({ type: 'dna', text: fifteen.slice(1) });
    expect(h.sent[0]).toMatchObject({ type: 'dna', tm: null });
    expect(h.last()).toMatchObject({ kind: 'nucleic', tmNote: 'short' });
    h.biochem.reply(h.answer(h.sent[0]));
    h.type({ text: fifteen });
    expect(h.sent[1]).toEqual({ id: 2, type: 'dna', sequence: fifteen, tm: { sodium: 0.14, strand: 0.0002 } });
    h.biochem.reply(h.answer(h.sent[1]));
    h.type({ sodium: '50', strand: '0.5' });
    expect(h.sent[2]).toMatchObject({ tm: { sodium: 0.05, strand: 0.0000005 } });
    h.biochem.reply(h.answer(h.sent[2]));
    h.type({ strand: '0' });
    expect(h.last()).toMatchObject({ tmNote: 'conditions' });
    expect(h.sent[3]).toMatchObject({ tm: null });
  });

  it('RNA never asks for Tm', () => {
    const h = harness();
    h.type({ type: 'rna', text: 'ACGUUGCAAGGCUUAA' });
    expect(h.sent[0]).toMatchObject({ type: 'rna', tm: null });
    expect(h.last()).toMatchObject({ tmNote: 'rna' });
  });

  it("an Indigo error is shown for its own sequence; a worker that can't start stops all requests", () => {
    const h = harness();
    h.type({ text: 'G' });
    h.biochem.reply({ id: h.sent[0].id, error: 'no' });
    expect(h.last()).toMatchObject({ indigo: { kind: 'error', message: 'no' } });
    h.type({ text: 'GG' });
    h.biochem.reply({ failed: 'wasm' });
    expect(h.last()).toMatchObject({ indigo: { kind: 'unavailable', reason: 'wasm' } });
    h.type({ text: 'GGG' });
    expect(h.sent).toHaveLength(2);
    expect(h.last()).toMatchObject({ sequence: 'GGG', indigo: { kind: 'unavailable' } });
  });
});
