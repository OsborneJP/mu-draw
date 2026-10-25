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
import { atomLabel, boxAt, crosses, LABEL, obstacles, overlaps, PICTURE, picture, placeLabels } from './stereoPictures';
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

/** The R/S and E/Z RDKit reads from a Molfile (its wedges and layout), as the panel labels. */
function cipOf(molfile: string) {
  const mol = rdkit.get_mol(molfile, JSON.stringify({ removeHs: false }))!;
  const tags = JSON.parse(mol.get_stereo_tags()) as { CIP_atoms: [number, string][]; CIP_bonds: [number, number, string][] };
  mol.delete();
  const shown = (label: string) => label !== '(?)';
  const plain = (label: string) => label.replace(/[()]/g, '');
  return {
    atoms: Object.fromEntries(tags.CIP_atoms.filter(([, l]) => shown(l)).map(([atom, l]) => [String(atom), plain(l)])),
    bonds: Object.fromEntries(
      tags.CIP_bonds.filter(([, , l]) => shown(l)).map(([a, b, l]) => [a < b ? `${a}-${b}` : `${b}-${a}`, plain(l)]),
    ),
  };
}

/** Whether a Molfile's layout draws double bond "a-b" with the first other neighbour of each
 * end (lowest atom index) on the same side or opposite sides: plain geometry, no RDKit. A
 * neighbour drawn in line with the bond counts as opposite the end's other neighbour. */
function sides(molfile: string, bond: string): 'same' | 'opposite' {
  const { atoms, bonds } = parts(molfile);
  const [a, b] = bond.split('-').map(Number);
  const others = (end: number, not: number) =>
    bonds.flatMap(([p, q]) => (p === end && q !== not ? [q] : q === end && p !== not ? [p] : [])).sort((x, y) => x - y);
  const xy = (i: number) => atoms[i] as number[];
  const side = (i: number) => {
    const [ax, ay] = xy(a);
    const [bx, by] = xy(b);
    const [px, py] = xy(i);
    return Math.sign((bx - ax) * (py - ay) - (by - ay) * (px - ax));
  };
  const sideOfFirst = (end: number, not: number) => {
    const [first, second] = others(end, not);
    return side(first) !== 0 || second === undefined ? side(first) : -side(second);
  };
  return sideOfFirst(a, b) === sideOfFirst(b, a) ? 'same' : 'opposite';
}

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
      // And its own wedges and layout give the labels placed on it: InChI can't tell the two
      // settings of a meso form apart, but the labels on the picture can.
      expect(cipOf(isomer.molfile), `stereoisomer ${isomer.number}`).toEqual(isomer.labels);
    }
  });

  // Known limits (docs/plans/v2-stereoisomers.md): only cyclooctatetraene with one or three
  // E has no flat drawing; read from the fixture's labels, not from the code under test.
  it('only the stereoisomers that cannot be drawn flat are listed without a picture', () => {
    const name = (c: Expected, number: number) => `${c.name} ${number}`;
    const expected = listed.flatMap((c) =>
      c.name !== 'cyclooctatetraene'
        ? []
        : c.stereoisomers!.filter((s) => Object.values(s.labels.bonds).filter((l) => l === 'E').length % 2 === 1).map((s) => name(c, s.number)),
    );
    const undrawable = listed.flatMap((c) => stereoisomersOf(c).filter((s) => s.molfile === null).map((s) => name(c, s.number)));
    expect(expected.length).toBeGreaterThan(0);
    expect(undrawable).toEqual(expected);
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
    for (const isomer of stereoisomersOf(compound)) {
      if (isomer.molfile === null) continue;
      const shown = parts(isomer.molfile);
      // Laid out afresh only where the drawing's layout shows one of its double bonds the
      // other way (decision 3); a crossed bond's layout still shows one way.
      const kept = JSON.stringify(shown.atoms) === JSON.stringify(drawn.atoms);
      const showable = Object.keys(isomer.labels.bonds).every((bond) => sides(isomer.molfile!, bond) === sides(drawing(compound), bond));
      expect(kept, `stereoisomer ${isomer.number} keeps the layout`).toBe(showable);
      if (!kept) continue;
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
      // Exactly the elements varied: a wedged biaryl axis is defined too, and is not drawn.
      if (defined !== compound.elements || (flag !== '1' && tags.CIP_atoms.length > 0)) continue;
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

/** A double bond's middle as RDKit draws it: the mean of the ends of its lines. */
function drawnMiddle(svg: string, bond: string) {
  const [a, b] = bond.split('-');
  const ends = [...svg.matchAll(/<path class='bond-\d+ atom-(\d+) atom-(\d+)' d='([^']*)'/g)]
    .filter((m) => [m[1], m[2]].sort().join() === [a, b].sort().join())
    .flatMap((m) => {
      const n = (m[3].match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
      return Array.from({ length: n.length / 2 }, (_, i) => ({ x: n[2 * i], y: n[2 * i + 1] }));
    });
  return { x: ends.reduce((t, p) => t + p.x, 0) / ends.length, y: ends.reduce((t, p) => t + p.y, 0) / ends.length };
}

describe('the pictures', () => {
  // Bar, round 3, item 1: RDKit draws R/S in place of its atom, "(R)" at a carbon and the
  // symbol then a smaller "(R)" at a heteroatom; no atom is highlighted.
  it.each(listed.map((c) => [c.name, c] as const))('%s: R/S at its atom, E/Z beside its bond, every wedge drawn', (_, compound) => {
    for (const isomer of stereoisomersOf(compound)) {
      if (isomer.molfile === null) continue;
      const { svg, atomLabels, labels } = picture(rdkit, isomer.molfile, isomer.labels);
      const where = `stereoisomer ${isomer.number}`;
      const symbols = parts(isomer.molfile).atoms.map((a) => a[3] as string);
      expect(Object.keys(atomLabels).sort(), where).toEqual(Object.keys(isomer.labels.atoms).sort());
      for (const [atom, label] of Object.entries(isomer.labels.atoms)) {
        const text = atomLabels[atom];
        const symbol = symbols[Number(atom)];
        if (symbol === 'C') expect(text, `${where}, atom ${atom}`).toBe(`(${label})`);
        else expect(text.startsWith(symbol) && text.endsWith(`<sub>(${label})</sub>`), `${where}, atom ${atom}: ${text}`).toBe(true);
        // RDKit drew it: a carbon has no glyphs of its own otherwise.
        expect(svg, `${where}, atom ${atom}`).toMatch(new RegExp(`<path class='atom-${atom}' d=`));
      }
      expect(svg, where).not.toContain('<ellipse');

      // Item 2: each E/Z beside its own bond: inside the picture, on no atom symbol or label
      // (RDKit's R/S included) and no other E/Z, nearer its own bond's middle than any other.
      expect(Object.fromEntries(labels.map((l) => [l.bond, l.text])), where).toEqual(isomer.labels.bonds);
      const { symbols: drawn } = obstacles(svg);
      const boxes = labels.map((l) => ({ left: l.x - LABEL.halfWidth, top: l.y - LABEL.halfHeight, right: l.x + LABEL.halfWidth, bottom: l.y + LABEL.halfHeight }));
      const middles = Object.fromEntries(labels.map((l) => [l.bond, drawnMiddle(svg, l.bond)]));
      const distance = (l: { x: number; y: number }, m: { x: number; y: number }) => Math.hypot(l.x - m.x, l.y - m.y);
      boxes.forEach((box, i) => {
        const label = labels[i];
        const what = `${where}, label ${label.bond}`;
        expect(box.left >= 0 && box.top >= 0 && box.right <= PICTURE.width && box.bottom <= PICTURE.height, what).toBe(true);
        expect(drawn.filter((s) => overlaps(box, s)), what).toEqual([]);
        expect(boxes.filter((other, j) => j !== i && overlaps(box, other)), what).toEqual([]);
        for (const [bond, middle] of Object.entries(middles)) {
          if (bond !== label.bond) expect(distance(label, middles[label.bond]) < distance(label, middle), `${what} nearer ${bond}`).toBe(true);
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

  it('labels a heteroatom stereocentre with its symbol, H and charge as RDKit writes them', () => {
    expect(atomLabel(rdkit, { z: 16, impHs: 0, chg: 0, isotope: 0 }, 'R')).toBe('S<sub>(R)</sub>');
    expect(atomLabel(rdkit, { z: 7, impHs: 1, chg: 1, isotope: 0 }, 's')).toBe('NH<sup>+</sup><sub>(s)</sub>');
    expect(atomLabel(rdkit, { z: 15, impHs: 2, chg: -2, isotope: 0 }, 'S')).toBe('PH<sub>2</sub><sup>2-</sup><sub>(S)</sub>');
    expect(atomLabel(rdkit, { z: 6, impHs: 1, chg: 0, isotope: 0 }, 'R')).toBe('(R)');
  });

  it('keeps an isotope or a charge at a labelled carbon: the label never hides them', () => {
    expect(atomLabel(rdkit, { z: 6, impHs: 1, chg: 0, isotope: 13 }, 'R')).toBe('<sup>13</sup>CH<sub>(R)</sub>');
    expect(atomLabel(rdkit, { z: 7, impHs: 0, chg: 0, isotope: 15 }, 'S')).toBe('<sup>15</sup>N<sub>(S)</sub>');
    expect(atomLabel(rdkit, { z: 6, impHs: 0, chg: -1, isotope: 0 }, 'S')).toBe('C<sup>-</sup><sub>(S)</sub>');
  });

  // No test drawing crowds an E/Z label off its first spot, square to the bond above it; two
  // bonds drawn as an SVG of lines and one symbol stand in.
  const line = (bond: number, a: number, b: number, d: string) => `<path class='bond-${bond} atom-${a} atom-${b}' d='${d}' />`;
  it('moves an E/Z label off an atom symbol', () => {
    const symbol = "<path class='atom-2' d='M 110.0 62.0 Q 120.0 62.0, 120.0 75.0' />";
    const svg = `<svg>${line(0, 0, 1, 'M 100.0,80.0 L 130.0,80.0')}${symbol}</svg>`;
    const [label] = placeLabels(svg, { '0-1': 'E' });
    expect(overlaps(boxAt(label), { left: 110, top: 62, right: 120, bottom: 75 })).toBe(false);
    expect(Math.hypot(label.x - 115, label.y - 80)).toBeLessThan(22);
  });

  it('keeps an E/Z label nearer its own bond than another labelled one', () => {
    // The first spot for 0-1, above its middle, touches no line but is nearer 2-3's middle.
    const svg = `<svg>${line(0, 0, 1, 'M 85.0,80.0 L 115.0,80.0')}${line(1, 2, 3, 'M 108.0,47.0 L 108.0,77.0')}</svg>`;
    const placed = placeLabels(svg, { '0-1': 'E', '2-3': 'Z' });
    const middles: Record<string, { x: number; y: number }> = { '0-1': { x: 100, y: 80 }, '2-3': { x: 108, y: 62 } };
    for (const label of placed) {
      const other = label.bond === '0-1' ? '2-3' : '0-1';
      const near = (m: { x: number; y: number }) => Math.hypot(label.x - m.x, label.y - m.y);
      expect(near(middles[label.bond]), label.bond).toBeLessThan(near(middles[other]));
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
