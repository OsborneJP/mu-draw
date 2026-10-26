// The tautomer and resonance pictures (docs/plans/v2-tautomers-resonance.md, bar B.2-B.3):
// each is RDKit's drawing of the Molfile Add places, with exactly the atoms and bonds that
// differ from the drawing highlighted, read from RDKit's own SVG shapes.
import initRDKitModule, { type MainModule } from '@rdkit/rdkit';
import { beforeAll, describe, expect, it } from 'vitest';
import { configureRdkit } from './compute';
import { answer, HIGHLIGHT, picture } from './formPictures';

const molfiles = import.meta.glob<string>('../../../tests/fixtures/forms/*.mol', { eager: true, query: '?raw', import: 'default' });
const fixtures = import.meta.glob<{ compounds: { name: string; file: string; outcome: string }[] }>(
  ['../../../tests/fixtures/tautomers_expected.json', '../../../tests/fixtures/resonance_expected.json'],
  { eager: true, import: 'default' },
);

const colour = `#${HIGHLIGHT.map((c) => Math.round(c * 255).toString(16).padStart(2, '0').toUpperCase()).join('')}`;

/** The atoms and bonds RDKit filled with the highlight colour. */
function highlighted(svg: string): { atoms: number[]; bonds: number[] } {
  const atoms = new Set<number>();
  const bonds = new Set<number>();
  for (const m of svg.matchAll(/<(ellipse|path)[^>]*class='([^']*)'[^>]*style='fill:(#[0-9A-F]{6})/g)) {
    if (m[3] !== colour) continue;
    const bond = /^bond-(\d+)/.exec(m[2]);
    const atom = /^atom-(\d+)$/.exec(m[2]);
    if (bond) bonds.add(Number(bond[1]));
    else if (atom) atoms.add(Number(atom[1]));
  }
  return { atoms: [...atoms].sort((a, b) => a - b), bonds: [...bonds].sort((a, b) => a - b) };
}

let rdkit: MainModule;

beforeAll(async () => {
  rdkit = await initRDKitModule();
  configureRdkit(rdkit);
});

describe('highlights', () => {
  it('are read back from an SVG: none, or exactly those given', () => {
    const molfile = Object.values(molfiles)[0];
    expect(highlighted(picture(rdkit, molfile, [], []))).toEqual({ atoms: [], bonds: [] });
    expect(highlighted(picture(rdkit, molfile, [0], [0]))).toEqual({ atoms: [0], bonds: [0] });
  });

  it('mark exactly what differs from the drawing, on every listed card of every test drawing', () => {
    let cards = 0;
    for (const [path, fixture] of Object.entries(fixtures)) {
      const kind = path.includes('tautomers') ? 'tautomers' : 'resonance';
      for (const c of fixture.compounds) {
        if (c.outcome !== 'listed') continue;
        const reply = answer(rdkit, { kind, id: 1, molfile: molfiles[`../../../tests/fixtures/${c.file}`] });
        if (!('result' in reply) || reply.result?.outcome !== 'listed') throw new Error(`${c.name}: not listed`);
        const listed = 'tautomers' in reply.result ? reply.result.tautomers : reply.result.structures;
        for (const s of listed) {
          expect(highlighted(s.svg), `${kind} ${c.name} ${s.number}`).toEqual({ atoms: s.changedAtoms, bonds: s.changedBonds });
          cards += 1;
        }
      }
    }
    expect(cards).toBeGreaterThan(150);
  });
});
