// The ¹H NMR preview's prediction on its own: which atoms share a signal and which CH₂ are
// diastereotopic, against server-side RDKit on every NMR and functional-group fixture
// compound and the rule's own drawings (tests/fixtures/*/compounds.json,
// server/scripts/gen_reference_expected.py), and
// how a signal is looked up, on a made-up table.
import initRDKitModule, { type MainModule } from '@rdkit/rdkit';
import { beforeAll, describe, expect, it } from 'vitest';
import { configureRdkit } from './compute';
import { graphOf, hoseCodes, symmetryRanks, type RdkitJson } from './hose';
import { diastereotopic, HIGHER, LOWER, predictProton, type Shifts } from './protonNmr';

interface Index {
  compounds: { typed_name: string; file: string; hydrogen_classes: number[][]; hydrogen_count: number; diastereotopic: number[] }[];
}

const indexes = import.meta.glob<Index>(
  [
    '../../../tests/fixtures/nmr/compounds.json',
    '../../../tests/fixtures/functional_groups/compounds.json',
    '../../../tests/fixtures/proton_nmr/compounds.json',
    '../../../tests/fixtures/proton_rules/compounds.json',
  ],
  { eager: true, import: 'default' },
);
const molfiles = import.meta.glob<string>(
  [
    '../../../tests/fixtures/nmr/*.mol',
    '../../../tests/fixtures/functional_groups/*.mol',
    '../../../tests/fixtures/proton_nmr/*.mol',
    '../../../tests/fixtures/proton_rules/*.mol',
    '../../../tests/fixtures/stereoisomers/camphor.mol',
  ],
  { eager: true, query: '?raw', import: 'default' },
);
const COMPOUNDS = Object.values(indexes).flatMap((index) => index.compounds);
const JUDGED = (
  import.meta.glob<{ status: string; molecules: { name: string; diastereotopic: number }[] }>('../../../tests/fixtures/proton_rules/judged.json', {
    eager: true,
    import: 'default',
  })['../../../tests/fixtures/proton_rules/judged.json']
);

const WASM = new URL('../../node_modules/@rdkit/rdkit/dist/RDKit_minimal.wasm', import.meta.url).pathname;
let rdkit: MainModule;

beforeAll(async () => {
  rdkit = await initRDKitModule({ locateFile: () => WASM });
  configureRdkit(rdkit);
});

function molfile(rel: string): string {
  const text = molfiles[`../../../tests/fixtures/${rel}`];
  if (text === undefined) throw new Error(`no fixture ${rel}`);
  return text;
}

/** The graph, its ranks, the classes of atoms carrying H, and the CH₂ the rule flags, all
 * as Molfile indices. */
function read(text: string) {
  const mol = rdkit.get_mol(text, JSON.stringify({ removeHs: false }));
  if (!mol) throw new Error('RDKit could not read it');
  try {
    const g = graphOf(JSON.parse(mol.get_json()) as RdkitJson);
    const ranks = symmetryRanks(g);
    const byRank = new Map<number, number[]>();
    g.atoms.forEach((a, i) => {
      if (a.hs > 0) byRank.set(ranks[i], [...(byRank.get(ranks[i]) ?? []), i]);
    });
    const classes = [...byRank.values()];
    const flagged = diastereotopic(rdkit, mol, g, ranks, classes);
    return {
      g,
      ranks,
      classes: classes.map((c) => c.map((i) => g.atoms[i].index).sort((a, b) => a - b)).sort((a, b) => a[0] - b[0]),
      flagged: [...flagged].map((i) => g.atoms[i].index).sort((a, b) => a - b),
    };
  } finally {
    mol.delete();
  }
}

const withAllHs = (text: string) => {
  const mol = rdkit.get_mol(text)!;
  try {
    return mol.add_hs();
  } finally {
    mol.delete();
  }
};

describe('which atoms share a signal, and which CH₂ are diastereotopic', () => {
  it("covers every NMR and functional-group fixture compound, and the rule's own drawings", () => {
    expect(Object.keys(indexes).length).toBe(4);
    for (const index of Object.values(indexes)) expect(index.compounds.length).toBeGreaterThan(0);
    // The rule is exercised both ways: sp³ and =CH₂ flagged, and CH₂ that are not.
    expect(COMPOUNDS.filter((c) => c.diastereotopic.length > 0).length).toBeGreaterThan(5);
  });

  it.each(COMPOUNDS.map((c) => [c.typed_name, c] as const))('%s: as server-side RDKit gives them', (_name, c) => {
    const { classes, flagged } = read(molfile(c.file));
    expect(classes).toEqual(c.hydrogen_classes);
    expect(flagged).toEqual(c.diastereotopic);
  });

  it("flags as many CH₂ as a person judges diastereotopic in each of the rule's drawings", () => {
    expect(JUDGED.status).toBe('provisional');
    const drawings = COMPOUNDS.filter((c) => c.file.startsWith('proton_rules/'));
    expect(JUDGED.molecules.map((m) => m.name)).toEqual(drawings.map((c) => c.typed_name));
    for (const m of JUDGED.molecules) {
      expect(read(molfile(drawings.find((c) => c.typed_name === m.name)!.file)).flagged.length, m.name).toBe(m.diastereotopic);
    }
  });

  it('is the same with every hydrogen drawn as an atom', () => {
    for (const c of COMPOUNDS) {
      const { classes, flagged } = read(withAllHs(molfile(c.file)));
      expect(classes, c.typed_name).toEqual(c.hydrogen_classes);
      expect(flagged, c.typed_name).toEqual(c.diastereotopic);
    }
  });
});

describe('looking a signal up', () => {
  // Made-up shifts on 2-butanol's real codes: the lookup doesn't care what they mean.
  const butanol = () => molfile('proton_nmr/2-butanol.mol');
  function codesOf(text: string) {
    const { g, ranks } = read(text);
    return (index: number) => hoseCodes(g, ranks, g.atoms.findIndex((a) => a.index === index), 4);
  }
  function table(entries: Map<string, number>): Shifts & { asked: string[] } {
    const asked: string[] = [];
    return {
      spheres: 4,
      asked,
      find(code) {
        asked.push(code);
        return entries.get(code) ?? null;
      },
    };
  }
  const ch2 = () => read(butanol()).flagged[0];

  it('backs off one sphere at a time and says how far the match reached', () => {
    const codes = codesOf(butanol());
    const entries = new Map<string, number>();
    for (const c of read(butanol()).classes) entries.set(codes(c[0])[1], 1.234 + c[0]);
    const shifts = table(entries);
    const signals = predictProton(rdkit, butanol(), shifts)!;
    expect(signals.every((s) => s.sphere === 2)).toBe(true);
    // The methyl (atom 0) is asked at 4, then 3, then 2 bonds, and no further.
    const methyl = codes(0);
    const first = shifts.asked.indexOf(methyl[3]);
    expect(shifts.asked.slice(first, first + 3)).toEqual([methyl[3], methyl[2], methyl[1]]);
    expect(shifts.asked).not.toContain(methyl[0]);
    // Its value, rounded to hundredths.
    for (const s of signals) expect(s.shift).toBe(Math.round((1.234 + s.atoms[0]) * 100) / 100);
  });

  it('gives a diastereotopic CH₂ two signals, higher first, from its pair entries', () => {
    const codes = codesOf(butanol());
    const at = ch2();
    const entries = new Map([
      [codes(at)[3], 5.55],
      [codes(at)[3] + HIGHER, 6.66],
      [codes(at)[3] + LOWER, 4.44],
    ]);
    const signals = predictProton(rdkit, butanol(), table(entries))!;
    const pair = signals.filter((s) => s.atoms.includes(at));
    expect(pair.map((s) => [s.shift, s.diastereotopic, s.hydrogens, s.sphere])).toEqual([
      [6.66, 'higher', 1, 4],
      [4.44, 'lower', 1, 4],
    ]);
    expect(signals.indexOf(pair[0])).toBeLessThan(signals.indexOf(pair[1]));
  });

  it("centres the pair on the CH₂'s own median when that matched further out than the pair", () => {
    const codes = codesOf(butanol());
    const at = ch2();
    const entries = new Map([
      [codes(at)[3], 5.55],
      [codes(at)[1] + HIGHER, 6.0],
      [codes(at)[1] + LOWER, 5.0],
    ]);
    const pair = predictProton(rdkit, butanol(), table(entries))!.filter((s) => s.atoms.includes(at));
    // The pair's gap (1.0) centred on 5.55, as sure as the plain match (4 bonds out).
    expect(pair.map((s) => [s.shift, s.diastereotopic, s.sphere])).toEqual([
      [6.05, 'higher', 4],
      [5.05, 'lower', 4],
    ]);
    // A pair matched as far out as the plain code keeps its own medians.
    const level = new Map([
      [codes(at)[1], 5.55],
      [codes(at)[1] + HIGHER, 6.0],
      [codes(at)[1] + LOWER, 5.0],
    ]);
    const own = predictProton(rdkit, butanol(), table(level))!.filter((s) => s.atoms.includes(at));
    expect(own.map((s) => [s.shift, s.sphere])).toEqual([
      [6.0, 2],
      [5.0, 2],
    ]);
  });

  it('marks a diastereotopic CH₂ in a bridged ring system, and only there', () => {
    const everywhere: Shifts = { spheres: 4, find: () => 1 };
    const camphor = predictProton(rdkit, molfile('stereoisomers/camphor.mol'), everywhere)!;
    expect(camphor.some((s) => s.diastereotopic && s.bridged)).toBe(true);
    expect(camphor.every((s) => s.bridged === (s.diastereotopic !== null))).toBe(true);
    for (const c of COMPOUNDS.filter((x) => x.file.startsWith('proton_nmr/'))) {
      expect(predictProton(rdkit, molfile(c.file), everywhere)!.some((s) => s.bridged), c.typed_name).toBe(false);
    }
  });

  it('gives a diastereotopic CH₂ one signal when the table has no pair for it', () => {
    const codes = codesOf(butanol());
    const at = ch2();
    const signals = predictProton(rdkit, butanol(), table(new Map([[codes(at)[3], 5.55]])))!;
    expect(signals.filter((s) => s.atoms.includes(at)).map((s) => [s.shift, s.diastereotopic, s.hydrogens])).toEqual([[5.55, null, 2]]);
  });

  it('marks what has no match, and H on O, N and S as exchangeable', () => {
    const signals = predictProton(rdkit, butanol(), table(new Map()))!;
    expect(signals.every((s) => s.shift === null && s.sphere === 0)).toBe(true);
    // The exchangeable signals are exactly those on O, N or S atoms carrying H.
    const { g } = read(butanol());
    const heteroatoms = g.atoms.filter((a) => a.hs > 0 && [7, 8, 16].includes(a.z)).map((a) => a.index);
    expect(heteroatoms.length).toBeGreaterThan(0);
    expect(signals.filter((s) => s.exchangeable).flatMap((s) => s.atoms)).toEqual(heteroatoms);
  });

  it('gives every H once, as integrations, on every fixture compound (bar 2)', () => {
    // A table with a value for every code, so each diastereotopic CH₂ splits into its pair.
    const everywhere: Shifts = { spheres: 4, find: () => 1 };
    for (const c of COMPOUNDS) {
      const signals = predictProton(rdkit, molfile(c.file), everywhere)!;
      expect(signals.reduce((n, s) => n + s.hydrogens, 0), c.typed_name).toBe(c.hydrogen_count);
      for (const s of signals) expect(s.hydrogens, c.typed_name).toBe(s.diastereotopic ? s.atoms.length : s.atoms.length * s.perAtom);
      // Two signals for each class of equivalent CH₂ that server-side RDKit flags.
      const flaggedClasses = c.hydrogen_classes.filter((members) => members.some((a) => c.diastereotopic.includes(a)));
      expect(signals.filter((s) => s.diastereotopic).length, c.typed_name).toBe(2 * flaggedClasses.length);
    }
  });

  it('answers null for a drawing RDKit cannot read', () => {
    expect(predictProton(rdkit, 'not a molfile', table(new Map()))).toBeNull();
  });
});
