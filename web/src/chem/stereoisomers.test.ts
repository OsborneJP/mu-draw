// The browser's stereoisomer enumerator (RDKit.js, the code the worker runs) against what
// server-side RDKit's EnumerateStereoisomers answered for the same drawings
// (tests/fixtures/stereoisomers_expected.json): the stereoisomers in order, their labels by
// atom, the pairs, achiral and meso, the matches and the notes must be the same, and each
// picture's Molfile must read back as the stereoisomer it shows (bar A.3).
import initRDKitModule, { type MainModule } from '@rdkit/rdkit';
import { beforeAll, describe, expect, it } from 'vitest';
import { configureRdkit } from './compute';
import { HIGHLIGHT, PICTURE, picture } from './stereoPictures';
import { enumerateStereoisomers, LIMITS, listOutcome, sizeOutcome, type Enumeration } from './stereoisomers';

interface Expected {
  name: string;
  file: string;
  elements: number;
  outcome: Enumeration['outcome'];
  count?: number;
  notes?: string[];
  stereoisomers?: {
    number: number;
    inchikey: string;
    labels: { atoms: Record<string, string>; bonds: Record<string, string> };
    relation: { kind: string; of?: number };
    matches: boolean;
  }[];
}

const fixture = Object.values(
  import.meta.glob<{ limits: typeof LIMITS; compounds: Expected[] }>('../../../tests/fixtures/stereoisomers_expected.json', {
    eager: true,
    import: 'default',
  }),
)[0];
const molfiles = import.meta.glob<string>('../../../tests/fixtures/stereoisomers/*.mol', {
  eager: true,
  query: '?raw',
  import: 'default',
});

function drawing(compound: Expected): string {
  const text = molfiles[`../../../tests/fixtures/${compound.file}`];
  if (text === undefined) throw new Error(`no fixture file ${compound.file}`);
  return text;
}

let rdkit: MainModule;
const results = new Map<string, Enumeration>();

beforeAll(async () => {
  rdkit = await initRDKitModule();
  configureRdkit(rdkit);
  for (const compound of fixture.compounds) results.set(compound.name, enumerateStereoisomers(rdkit, drawing(compound))!);
});

/** The parts of a result the fixture records, without the pictures. */
function comparable(result: Enumeration) {
  switch (result.outcome) {
    case 'no-elements':
      return { outcome: result.outcome };
    case 'too-many':
      return { outcome: result.outcome, elements: result.elements };
    case 'counted':
      return { outcome: result.outcome, elements: result.elements, count: result.count, notes: result.notes };
    case 'listed':
      return {
        outcome: result.outcome,
        elements: result.elements,
        notes: result.notes,
        stereoisomers: result.stereoisomers.map(({ number, inchikey, labels, relation, matches }) => ({
          number,
          inchikey,
          labels,
          relation,
          matches,
        })),
      };
  }
}

function fromFixture(compound: Expected) {
  const { outcome, elements, count, notes, stereoisomers } = compound;
  switch (outcome) {
    case 'no-elements':
      return { outcome };
    case 'too-many':
      return { outcome, elements };
    case 'counted':
      return { outcome, elements, count, notes };
    case 'listed':
      return {
        outcome,
        elements,
        notes,
        stereoisomers: stereoisomers!.map(({ number, inchikey, labels, relation, matches }) => ({
          number,
          inchikey,
          labels,
          relation,
          matches,
        })),
      };
  }
}

describe('the same answers as RDKit’s own enumerator', () => {
  it('covers every outcome', () => {
    const outcomes = new Set(fixture.compounds.map((c) => c.outcome));
    expect([...outcomes].sort()).toEqual(['counted', 'listed', 'no-elements', 'too-many']);
    expect(fixture.limits).toEqual(LIMITS);
  });

  it.each(fixture.compounds.map((c) => [c.name, c] as const))('%s', (_, compound) => {
    expect(comparable(results.get(compound.name)!)).toEqual(fromFixture(compound));
  });
});

describe('each picture is the stereoisomer it shows', () => {
  const listed = fixture.compounds.filter((c) => c.outcome === 'listed');

  it.each(listed.map((c) => [c.name, c] as const))('%s', (_, compound) => {
    const result = results.get(compound.name)!;
    if (result.outcome !== 'listed') throw new Error(`${compound.name} was not listed`);
    for (const isomer of result.stereoisomers) {
      const mol = rdkit.get_mol(isomer.molfile, JSON.stringify({ removeHs: false }))!;
      const key = rdkit.get_inchikey_for_inchi(mol.get_inchi());
      const chiralFlag = mol.get_prop('_MolFileChiralFlag');
      mol.delete();
      expect(key, `stereoisomer ${isomer.number}`).toBe(isomer.inchikey);
      const centres = Object.keys(isomer.labels.atoms).length > 0;
      if (centres) expect(chiralFlag, `stereoisomer ${isomer.number}`).toBe('1');
    }
  });

  it("a stereoisomer that matches a fully drawn structure keeps the drawing's layout and wedges", () => {
    const compound = fixture.compounds.find((c) => c.name === 'L-threonine')!;
    const result = results.get(compound.name)!;
    if (result.outcome !== 'listed') throw new Error('not listed');
    const drawn = result.stereoisomers.find((s) => s.matches)!;
    const block = (text: string) => text.split('\n').slice(4);
    // The atom and bond lines are the drawing's, wedges included; only the header differs.
    expect(block(drawn.molfile)).toEqual(block(drawing(compound)));
  });

  it('an enantiomer keeps the layout and flips the wedges', () => {
    const compound = fixture.compounds.find((c) => c.name === 'L-threonine')!;
    const result = results.get(compound.name)!;
    if (result.outcome !== 'listed') throw new Error('not listed');
    const drawn = result.stereoisomers.find((s) => s.matches)!;
    if (drawn.relation.kind !== 'enantiomer') throw new Error('threonine is chiral');
    const mirror = result.stereoisomers[drawn.relation.of - 1];
    const lines = (text: string) => text.split('\n');
    const atomCount = Number(lines(drawing(compound))[3].slice(0, 3));
    const atoms = (text: string) => lines(text).slice(4, 4 + atomCount);
    const stereo = (text: string) => lines(text).slice(4 + atomCount).filter((l) => / [16]$/.test(l.trimEnd().slice(0, 12)));
    expect(atoms(mirror.molfile)).toEqual(atoms(drawing(compound)));
    expect(stereo(mirror.molfile).length).toBeGreaterThan(0);
    expect(stereo(mirror.molfile)).not.toEqual(stereo(drawing(compound)));
  });
});

describe('the pictures', () => {
  const listed = fixture.compounds.filter((c) => c.outcome === 'listed');

  it.each(listed.map((c) => [c.name, c] as const))('%s: every label at its atom, every wedge drawn', (_, compound) => {
    const result = results.get(compound.name)!;
    if (result.outcome !== 'listed') throw new Error('not listed');
    for (const isomer of result.stereoisomers) {
      const { svg, labels } = picture(rdkit, isomer.molfile, isomer.labels);
      // One placed label per CIP label, with its text, inside the picture.
      const atoms = Object.fromEntries(labels.filter((l) => l.atom !== undefined).map((l) => [String(l.atom), l.text]));
      const bonds = Object.fromEntries(labels.filter((l) => l.bond !== undefined).map((l) => [l.bond!, l.text]));
      expect({ atoms, bonds }, `stereoisomer ${isomer.number}`).toEqual(isomer.labels);
      for (const l of labels) {
        expect(l.x).toBeGreaterThan(0);
        expect(l.x).toBeLessThan(PICTURE.width);
        expect(l.y).toBeGreaterThan(0);
        expect(l.y).toBeLessThan(PICTURE.height);
      }
      // Each bond the Molfile wedges is drawn as a wedge (a filled path) or a hash (many
      // short strokes), not as a plain line.
      const lines = isomer.molfile.split('\n');
      const [atomCount, bondCount] = [Number(lines[3].slice(0, 3)), Number(lines[3].slice(3, 6))];
      lines.slice(4 + atomCount, 4 + atomCount + bondCount).forEach((line, index) => {
        if (!['1', '6'].includes(line.slice(9, 12).trim())) return;
        const pieces = svg.match(new RegExp(`<path class='bond-${index} [^>]*>`, 'g')) ?? [];
        const drawnAsStereo = pieces.length > 2 || pieces.some((p) => / Z' style='fill:#/.test(p));
        expect(drawnAsStereo, `stereoisomer ${isomer.number}, bond ${index}`).toBe(true);
      });
    }
  });

  it("highlights stereo atoms in the canvas's colour for a defined stereo element", async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('../editor/stereoHighlight.ts', import.meta.url), 'utf8');
    expect(/export const DEFINED_COLOR = '(#[0-9a-f]{6})'/.exec(source)?.[1]).toBe(HIGHLIGHT);
  });
});

describe('the limits', () => {
  it('enumerates up to 8 stereo elements', () => {
    expect(sizeOutcome(0)).toBe('no-elements');
    expect(sizeOutcome(1)).toBe('enumerate');
    expect(sizeOutcome(LIMITS.elements)).toBe('enumerate');
    expect(sizeOutcome(LIMITS.elements + 1)).toBe('too-many');
  });

  it('draws up to 32 stereoisomers', () => {
    expect(listOutcome(LIMITS.drawn)).toBe('listed');
    expect(listOutcome(LIMITS.drawn + 1)).toBe('counted');
  });
});
