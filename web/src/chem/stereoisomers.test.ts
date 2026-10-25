// The browser's stereoisomer enumerator (RDKit.js, the code the worker runs) against what
// server-side RDKit answered for the same drawings (tests/fixtures/stereoisomers_expected.json):
// the stereoisomers in order, their labels by atom, the pairs, achiral and meso, the matches
// and the notes must be the same (bar A.3); each picture's Molfile must read back as the
// stereoisomer it shows, keep the drawing's layout and the student's wedges, flipped where
// the configuration differs (bar B.3), and list the same stereoisomers if drawn itself.
import initRDKitModule, { type MainModule } from '@rdkit/rdkit';
import { beforeAll, describe, expect, it } from 'vitest';
import { configureRdkit } from './compute';
import { AXES, serialise, type RdkitJson } from './stereoElements';
import { crosses, HIGHLIGHT, LABEL, obstacles, overlaps, PICTURE, picture } from './stereoPictures';
import { enumerateStereoisomers, LIMITS, listOutcome, sizeOutcome, type Enumeration, type Stereoisomer } from './stereoisomers';

interface Expected {
  name: string;
  file: string;
  elements: number;
  outcome: Enumeration['outcome'];
  count?: number;
  notes: string[];
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

const listed = fixture.compounds.filter((c) => c.outcome === 'listed');

function stereoisomersOf(compound: Expected): Stereoisomer[] {
  const result = results.get(compound.name)!;
  if (result.outcome !== 'listed') throw new Error(`${compound.name} was not listed`);
  return result.stereoisomers;
}

/** The parts of a result the fixture records, without the pictures. */
function comparable(result: Enumeration) {
  switch (result.outcome) {
    case 'several':
      return { outcome: result.outcome };
    case 'no-elements':
      return { outcome: result.outcome, notes: result.notes };
    case 'too-many':
      return { outcome: result.outcome, elements: result.elements, notes: result.notes };
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
    case 'several':
    case 'no-elements':
      return outcome === 'several' ? { outcome } : { outcome, notes };
    case 'too-many':
      return { outcome, elements, notes };
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

describe('the same answers as server-side RDKit', () => {
  it('covers every outcome, with the approved limits', () => {
    const outcomes = new Set(fixture.compounds.map((c) => c.outcome));
    expect([...outcomes].sort()).toEqual(['counted', 'listed', 'no-elements', 'too-many']);
    expect(fixture.limits).toEqual(LIMITS);
  });

  it.each(fixture.compounds.map((c) => [c.name, c] as const))('%s', (_, compound) => {
    expect(comparable(results.get(compound.name)!)).toEqual(fromFixture(compound));
  });

  it('notes an axis by the same patterns as the generator', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('../../../server/scripts/gen_stereoisomers_expected.py', import.meta.url), 'utf8');
    const line = source.split('\n').find((l) => l.startsWith('AXES = '))!;
    expect([...line.matchAll(/MolFromSmarts\("([^"]+)"\)/g)].map((m) => m[1])).toEqual(AXES);
  });
});

/** A Molfile's counts, atom lines and bond lines as [first atom, second atom, stereo]. */
function parts(molfile: string) {
  const lines = molfile.split('\n');
  const [atomCount, bondCount] = [Number(lines[3].slice(0, 3)), Number(lines[3].slice(3, 6))];
  const bonds = lines
    .slice(4 + atomCount, 4 + atomCount + bondCount)
    .map((l) => [Number(l.slice(0, 3)) - 1, Number(l.slice(3, 6)) - 1, Number(l.slice(9, 12))] as const);
  // Coordinates as numbers (-0.0000 is 0.0000), and each atom's symbol.
  const atoms = lines.slice(4, 4 + atomCount).map((l) => [...[0, 10, 20].map((at) => Number(l.slice(at, at + 10)) + 0), l.slice(31, 34).trim()]);
  return { atoms, bonds };
}

function cipAtoms(molfile: string): Record<string, string> {
  const mol = rdkit.get_mol(molfile, JSON.stringify({ removeHs: false }))!;
  const tags = JSON.parse(mol.get_stereo_tags()) as { CIP_atoms: [number, string][] };
  mol.delete();
  return Object.fromEntries(tags.CIP_atoms.map(([atom, label]) => [String(atom), label.replace(/[()]/g, '')]));
}

const isWedge = (stereo: number) => stereo === 1 || stereo === 6;

describe('each picture is the stereoisomer it shows', () => {
  it.each(listed.map((c) => [c.name, c] as const))('%s', (_, compound) => {
    for (const isomer of stereoisomersOf(compound)) {
      if (isomer.molfile === null) {
        // Only a double bond in a ring can make a stereoisomer that can't be drawn flat.
        expect(compound.notes, `stereoisomer ${isomer.number}`).toContain('axial-planar');
        continue;
      }
      // The stereo RDKit reads from the Molfile (its wedges and layout), then its InChI
      // without coordinates, as the stereoisomers were told apart: with coordinates, InChI
      // also sets the single bonds of cyclooctatetraene's ring from the layout.
      const mol = rdkit.get_mol(isomer.molfile, JSON.stringify({ removeHs: false }))!;
      const read = JSON.parse(mol.get_json()) as RdkitJson;
      const chiralFlag = mol.get_prop('_MolFileChiralFlag');
      mol.delete();
      const bare = rdkit.get_mol(serialise(read, false), JSON.stringify({ removeHs: false }))!;
      const key = rdkit.get_inchikey_for_inchi(bare.get_inchi());
      bare.delete();
      expect(key, `stereoisomer ${isomer.number}`).toBe(isomer.inchikey);
      if (Object.keys(isomer.labels.atoms).length > 0) expect(chiralFlag, `stereoisomer ${isomer.number}`).toBe('1');
    }
  });

  it('one that cannot be drawn flat is listed without a picture, not as an error', () => {
    const undrawable = listed.flatMap((c) => stereoisomersOf(c).filter((s) => s.molfile === null).map(() => c.name));
    expect(new Set(undrawable)).toEqual(new Set(['cyclooctatetraene']));
  });

  // Bar B.3: the drawing's layout, and at each centre the student wedged, the student's own
  // wedges and hashes (as drawn where the centre is as drawn, every one swapped where it is
  // the other way), and no others. Uppercase labels only: R or S then follows the setting.
  it.each(listed.map((c) => [c.name, c] as const))("%s: the drawing's layout and the student's wedges", (_, compound) => {
    const drawn = parts(drawing(compound));
    const drawnLabels = cipAtoms(drawing(compound));
    const wedged = drawn.bonds.flatMap(([first, second, stereo], index) =>
      isWedge(stereo) && /^[RS]$/.test(drawnLabels[first] ?? '') ? [{ index, first, second, stereo }] : [],
    );
    const centres = new Set(wedged.map((w) => w.first));
    const doubleBonds = Object.keys(compound.stereoisomers![0].labels.bonds).length > 0;
    for (const isomer of stereoisomersOf(compound)) {
      if (isomer.molfile === null) continue;
      const shown = parts(isomer.molfile);
      if (!doubleBonds) expect(shown.atoms, `stereoisomer ${isomer.number} keeps the layout`).toEqual(drawn.atoms);
      if (JSON.stringify(shown.atoms) !== JSON.stringify(drawn.atoms)) continue;
      for (const w of wedged) {
        const label = isomer.labels.atoms[String(w.first)];
        if (!/^[RS]$/.test(label ?? '')) continue;
        const stereo = label === drawnLabels[w.first] ? w.stereo : 7 - w.stereo;
        expect(shown.bonds[w.index], `stereoisomer ${isomer.number}, bond ${w.index}`).toEqual([w.first, w.second, stereo]);
      }
      for (const [index, [first, , stereo]] of shown.bonds.entries()) {
        if (centres.has(first) && isWedge(stereo)) {
          expect(wedged.map((w) => w.index), `stereoisomer ${isomer.number}: no other wedge at ${first}`).toContain(index);
        }
      }
    }
  });

  it('the stereoisomer drawn is pictured exactly as drawn, when the drawing defines all its stereo', () => {
    const checked: string[] = [];
    for (const compound of listed) {
      const mol = rdkit.get_mol(drawing(compound), JSON.stringify({ removeHs: false }))!;
      const tags = JSON.parse(mol.get_stereo_tags()) as { CIP_atoms: [number, string][]; CIP_bonds: [number, number, string][] };
      const flag = mol.get_prop('_MolFileChiralFlag');
      mol.delete();
      const defined = [...tags.CIP_atoms, ...tags.CIP_bonds].filter((t) => t.at(-1) !== '(?)').length;
      if (defined < compound.elements || (flag !== '1' && tags.CIP_atoms.length > 0)) continue;
      const own = stereoisomersOf(compound).filter((s) => s.matches);
      expect(own.length, compound.name).toBe(1);
      expect(parts(own[0].molfile!), compound.name).toEqual(parts(drawing(compound)));
      checked.push(compound.name);
    }
    expect(checked).toEqual(expect.arrayContaining(['L-threonine', '2,3-dibromobutane, the meso form', 'cyclooctatetraene']));
  });

  it("the textbook drawings keep both the wedge and the hash, swapped in the mirror image", () => {
    for (const name of ['L-threonine, wedge and hash with H drawn', '(R)-2-butanol, wedge and hash with H drawn']) {
      const compound = fixture.compounds.find((c) => c.name === name)!;
      const drawnStereo = parts(drawing(compound)).bonds.map(([, , s]) => s);
      const isomers = stereoisomersOf(compound);
      const own = isomers.find((s) => s.matches)!;
      if (own.relation.kind !== 'enantiomer') throw new Error(`${name} is chiral`);
      const mirror = isomers[own.relation.of - 1];
      expect(parts(own.molfile!).bonds.map(([, , s]) => s), name).toEqual(drawnStereo);
      expect(parts(mirror.molfile!).bonds.map(([, , s]) => s), name).toEqual(drawnStereo.map((s) => (isWedge(s) ? 7 - s : s)));
      expect(drawnStereo.filter((s) => s === 1).length, name).toBeGreaterThan(0);
      expect(drawnStereo.filter((s) => s === 6).length, name).toBeGreaterThan(0);
    }
  });

  it.each(listed.map((c) => [c.name, c] as const))('%s: drawn as any of its stereoisomers, the same list', (_, compound) => {
    const keys = stereoisomersOf(compound).map((s) => s.inchikey);
    for (const isomer of stereoisomersOf(compound)) {
      if (isomer.molfile === null) continue;
      const again = enumerateStereoisomers(rdkit, isomer.molfile)!;
      if (again.outcome !== 'listed') throw new Error(`stereoisomer ${isomer.number} was not listed`);
      expect(again.stereoisomers.map((s) => s.inchikey).sort(), `stereoisomer ${isomer.number}`).toEqual([...keys].sort());
      expect(again.stereoisomers.find((s) => s.inchikey === isomer.inchikey)!.matches, `stereoisomer ${isomer.number}`).toBe(true);
    }
  });
});

describe('the pictures', () => {
  it.each(listed.map((c) => [c.name, c] as const))('%s: every label beside its atom, covering no symbol; every wedge drawn', (_, compound) => {
    for (const isomer of stereoisomersOf(compound)) {
      if (isomer.molfile === null) continue;
      const { svg, labels } = picture(rdkit, isomer.molfile, isomer.labels);
      const where = `stereoisomer ${isomer.number}`;
      // One placed label per CIP label, with its text.
      const atoms = Object.fromEntries(labels.filter((l) => l.atom !== undefined).map((l) => [String(l.atom), l.text]));
      const bonds = Object.fromEntries(labels.filter((l) => l.bond !== undefined).map((l) => [l.bond!, l.text]));
      expect({ atoms, bonds }, where).toEqual(isomer.labels);
      // Each inside the picture, off its own atom, over no atom symbol and no other label.
      const centres = new Map(
        [...svg.matchAll(/<ellipse cx='([-\d.]+)' cy='([-\d.]+)'[^>]*class='atom-(\d+)'/g)].map((m) => [Number(m[3]), { x: Number(m[1]), y: Number(m[2]) }]),
      );
      const { symbols } = obstacles(svg);
      const boxes = labels.map((l) => ({ left: l.x - LABEL.halfWidth, top: l.y - LABEL.halfHeight, right: l.x + LABEL.halfWidth, bottom: l.y + LABEL.halfHeight }));
      boxes.forEach((box, i) => {
        const label = labels[i];
        const what = `${where}, label ${label.atom ?? label.bond}`;
        expect(box.left >= 0 && box.top >= 0 && box.right <= PICTURE.width && box.bottom <= PICTURE.height, what).toBe(true);
        expect(symbols.filter((s) => overlaps(box, s)), what).toEqual([]);
        expect(boxes.filter((other, j) => j !== i && overlaps(box, other)), what).toEqual([]);
        if (label.atom !== undefined) {
          const at = centres.get(label.atom)!;
          expect(at.x > box.left && at.x < box.right && at.y > box.top && at.y < box.bottom, `${what} covers its atom`).toBe(false);
        }
      });
      // Each bond the Molfile wedges is drawn as a wedge (a filled path) or a hash (many
      // short strokes), not as a plain line.
      parts(isomer.molfile).bonds.forEach(([, , stereo], index) => {
        if (!isWedge(stereo)) return;
        const pieces = svg.match(new RegExp(`<path class='bond-${index} [^>]*>`, 'g')) ?? [];
        const drawnAsStereo = pieces.length > 2 || pieces.some((p) => / Z' style='fill:#/.test(p));
        expect(drawnAsStereo, `${where}, bond ${index}`).toBe(true);
      });
    }
  });

  it('reads what a label must not cover from the SVG', () => {
    const box = { left: 0, top: 0, right: 10, bottom: 10 };
    expect(crosses(box, [{ x: -5, y: 5 }, { x: 15, y: 5 }])).toBe(true);
    expect(crosses(box, [{ x: -5, y: -5 }, { x: 15, y: -1 }])).toBe(false);
    expect(crosses(box, [{ x: 12, y: 0 }, { x: 12, y: 10 }])).toBe(false);
    expect(overlaps(box, { left: 9, top: 9, right: 20, bottom: 20 })).toBe(true);
    expect(overlaps(box, { left: 10, top: 0, right: 20, bottom: 10 })).toBe(false);
  });

  it("highlights stereo atoms in the canvas's colour for a defined stereo element", async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('../editor/stereoHighlight.ts', import.meta.url), 'utf8');
    expect(/export const DEFINED_COLOR = '(#[0-9a-f]{6})'/.exec(source)?.[1]).toBe(HIGHLIGHT);
  });
});

it('works on one structure at a time', () => {
  const [first, second] = ['L-threonine', '(E)-cinnamic acid'].map((name) => fixture.compounds.find((c) => c.name === name)!);
  const a = rdkit.get_mol(drawing(first), JSON.stringify({ removeHs: false }))!;
  const b = rdkit.get_mol(drawing(second), JSON.stringify({ removeHs: false }))!;
  a.combine_with(b);
  const both = a.get_molblock();
  a.delete();
  b.delete();
  expect(enumerateStereoisomers(rdkit, both)).toEqual({ outcome: 'several' });
});

// Decision 7 as Jeff approved it, written out: a change to LIMITS must fail here.
describe('the limits', () => {
  it('are 8 stereo elements and 32 stereoisomers', () => {
    expect(LIMITS).toEqual({ elements: 8, drawn: 32 });
  });

  it('enumerates up to 8 stereo elements', () => {
    expect(sizeOutcome(0)).toBe('no-elements');
    expect(sizeOutcome(1)).toBe('enumerate');
    expect(sizeOutcome(8)).toBe('enumerate');
    expect(sizeOutcome(9)).toBe('too-many');
  });

  it('draws up to 32 stereoisomers', () => {
    expect(listOutcome(32)).toBe('listed');
    expect(listOutcome(33)).toBe('counted');
  });
});
