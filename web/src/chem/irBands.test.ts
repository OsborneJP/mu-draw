// The IR hint table (docs/plans/v2-ir-hints.md, bar A): the shipped web/public/ir-bands.json
// must be usable as it is, agree with the highlighter's web/public/functional-groups.json,
// and never show a band marked verify. No IR value is typed here (invariant 3): tests that
// need a band take one from the shipped file.
import { describe, expect, it } from 'vitest';
import { citedAttributions, hintsFor, readIrBands, type Hint, type IrFile, type IrTable } from './irBands';

const one = <T>(found: Record<string, T>): T => {
  const values = Object.values(found);
  if (values.length !== 1) throw new Error(`expected one file, found ${values.length}`);
  return values[0];
};

type Json = Record<string, unknown>;
interface FileBand extends Json {
  range: [number, number];
  verify: boolean;
  sources: string[];
}
interface FileGroup extends Json {
  label: string;
  bands: FileBand[];
  shared?: string;
  also_show?: string[];
  always_show?: boolean;
}
interface TableFile extends Json {
  attribution: { key: string; text: string; url: string | null }[];
  regions: { range: [number, number]; label: string; sources: string[] }[];
  groups: Record<string, FileGroup>;
}

const FILE = one(import.meta.glob<TableFile>('../../public/ir-bands.json', { eager: true, import: 'default' }));
const PATTERNS = one(
  import.meta.glob<{ groups: { name: string; id?: string; priority: number }[] }>('../../public/functional-groups.json', {
    eager: true,
    import: 'default',
  }),
);
const EXPECTED = one(
  import.meta.glob<{ molecules: { name: string; groups: Record<string, number> }[] }>(
    '../../../tests/fixtures/functional_groups_expected.json',
    { eager: true, import: 'default' },
  ),
);

/** A fresh copy of the shipped file, to change. */
const copy = (): TableFile => structuredClone(FILE);

function table(file: unknown): IrTable {
  const read = readIrBands(file);
  if (read.kind !== 'table') throw new Error(`no table: ${read.reason}`);
  return read.table;
}

function problems(file: unknown): string[] {
  const read = readIrBands(file);
  if (read.kind !== 'table') throw new Error(`no table: ${read.reason}`);
  return read.problems;
}

const reason = (file: unknown) => (readIrBands(file) as Extract<IrFile, { kind: 'unavailable' }>).reason;
const keys = (hints: Hint[]) => hints.map((h) => (h.kind === 'hint' ? h.key : `missing ${h.name}`));

/** The highlighter's groups as the panel gets them: highest priority first, with ids. */
const byPriority = [...PATTERNS.groups].sort((a, b) => b.priority - a.priority);
const found = (...names: string[]) => byPriority.filter((g) => names.includes(g.name)).map(({ name, id }) => ({ name, id }));

const SHIPPED = table(FILE);
// Any real band and group, for files made up to test the rules.
const [ANY_KEY, ANY_GROUP] = Object.entries(FILE.groups).find(([, g]) => g.bands.length > 1)!;

describe('the shipped table', () => {
  it('is usable as it is: no problems, every group and band read', () => {
    expect(problems(FILE)).toEqual([]);
    expect([...SHIPPED.groups.keys()]).toEqual(Object.keys(FILE.groups));
    for (const [key, group] of Object.entries(FILE.groups)) {
      const read = SHIPPED.groups.get(key)!;
      expect(read.bands.map((b) => [b.low, b.high, b.verify])).toEqual(group.bands.map((b) => [...b.range, b.verify]));
    }
    expect(SHIPPED.regions.length).toBe(FILE.regions.length);
    expect(SHIPPED.attribution.map((a) => a.key)).toEqual(FILE.attribution.map((a) => a.key));
  });

  it('is credited: CC BY-SA 4.0, its compiler, its version', () => {
    expect(SHIPPED.licence).toBe('CC BY-SA 4.0');
    expect(SHIPPED.licenceUri).toBe('https://creativecommons.org/licenses/by-sa/4.0/');
    expect(SHIPPED.compiledBy).toBe(FILE.compiled_by);
    expect(SHIPPED.version).toBe(FILE.version);
  });

  it('agrees with the highlighter: every group has an id, and every id is in the table', () => {
    const ids = PATTERNS.groups.map((g) => g.id);
    expect(ids.every((id) => typeof id === 'string')).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.filter((id) => !SHIPPED.groups.has(id!))).toEqual([]);
  });

  it('has no group nothing leads to', () => {
    const reachable = new Set<string>(PATTERNS.groups.map((g) => g.id!));
    for (const [key, group] of SHIPPED.groups) {
      if (group.shared) reachable.add(group.shared);
      group.alsoShow.forEach((k) => reachable.add(k));
      if (group.alwaysShow) reachable.add(key);
    }
    expect([...SHIPPED.groups.keys()].filter((k) => !reachable.has(k))).toEqual([]);
  });
});

describe('which entries show, and in what order', () => {
  // A made-up table of real bands: a and b share s; b also shows c; z always shows.
  const band = ANY_GROUP.bands.find((b) => !b.verify)!;
  const made = copy();
  made.groups = {
    a: { label: 'A', bands: [band], shared: 's' },
    b: { label: 'B', bands: [band], shared: 's', also_show: ['c'] },
    c: { label: 'C', bands: [band] },
    s: { label: 'S', bands: [band] },
    z: { label: 'Z', bands: [band], always_show: true },
  };
  const t = table(made);

  it('shows a shared entry once, after the first group that names it', () => {
    expect(keys(hintsFor([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], t))).toEqual(['a', 's', 'b', 'c', 'z']);
  });

  it('shows an also_show entry after its group, unless that group was found itself', () => {
    expect(keys(hintsFor([{ id: 'b', name: 'B' }], t))).toEqual(['b', 's', 'c', 'z']);
    expect(keys(hintsFor([{ id: 'b', name: 'B' }, { id: 'c', name: 'C' }], t))).toEqual(['b', 's', 'c', 'z']);
    expect(keys(hintsFor([{ id: 'c', name: 'C' }, { id: 'b', name: 'B' }], t))).toEqual(['c', 'b', 's', 'z']);
  });

  it('shows the always_show entries last, also with no group found', () => {
    expect(keys(hintsFor([], t))).toEqual(['z']);
    expect(keys(hintsFor([{ id: 'z', name: 'Z' }, { id: 'a', name: 'A' }], t))).toEqual(['z', 'a', 's']);
  });

  it('says so for a group the table has nothing for, or that has no id', () => {
    expect(keys(hintsFor([{ id: 'x', name: 'Imine' }, { name: 'Azide' }, { id: 'a', name: 'A' }], t))).toEqual([
      'missing Imine',
      'missing Azide',
      'a',
      's',
      'z',
    ]);
  });

  it('on each molecule of the 25-molecule set, shows what its expected groups lead to', () => {
    for (const molecule of EXPECTED.molecules) {
      const groups = found(...Object.keys(molecule.groups));
      expect(groups.length, molecule.name).toBe(Object.keys(molecule.groups).length);
      const shown = keys(hintsFor(groups, SHIPPED));
      const leadTo = new Set<string>();
      for (const g of groups) {
        const group = SHIPPED.groups.get(g.id!)!;
        leadTo.add(g.id!);
        if (group.shared) leadTo.add(group.shared);
        group.alsoShow.forEach((k) => leadTo.add(k));
      }
      for (const [key, group] of SHIPPED.groups) if (group.alwaysShow) leadTo.add(key);
      expect(new Set(shown), molecule.name).toEqual(leadTo);
      expect(shown.length, `${molecule.name}: no entry twice`).toBe(leadTo.size);
      // The groups found come in the highlighter's order.
      expect(shown.filter((k) => groups.some((g) => g.id === k))).toEqual(groups.map((g) => g.id));
    }
  });
});

describe('bands marked verify', () => {
  it('are never shown by the shipped table, and their group says some are being checked', () => {
    const all = hintsFor(
      byPriority.map(({ name, id }) => ({ name, id })),
      SHIPPED,
    );
    for (const hint of all) {
      if (hint.kind !== 'hint') continue;
      expect(hint.bands.filter((b) => b.verify)).toEqual([]);
      const marked = FILE.groups[hint.key].bands.some((b) => b.verify);
      expect(hint.checking, hint.key).toBe(marked);
    }
  });

  it('hide exactly the band marked, and nothing else (the guard is not vacuous)', () => {
    const file = copy();
    const group = file.groups[ANY_KEY];
    group.bands.forEach((b) => (b.verify = false));
    const before = hintsFor([{ id: ANY_KEY, name: 'X' }], table(file))[0];
    group.bands[1].verify = true;
    const after = hintsFor([{ id: ANY_KEY, name: 'X' }], table(file))[0];
    if (before.kind !== 'hint' || after.kind !== 'hint') throw new Error('no hint');
    expect(before.checking).toBe(false);
    expect(after.checking).toBe(true);
    expect(after.bands).toEqual(before.bands.filter((_, i) => i !== 1));
  });
});

describe('the credit', () => {
  it('names the attributions the shown bands and the regions cite, in the file order', () => {
    const regions = new Set(FILE.regions.flatMap((r) => r.sources));
    const hints = hintsFor([], SHIPPED);
    const cited = new Set(regions);
    for (const h of hints) if (h.kind === 'hint') h.bands.forEach((b) => b.sources.forEach((s) => cited.add(s)));
    expect(citedAttributions(hints, SHIPPED).map((a) => a.key)).toEqual(
      FILE.attribution.map((a) => a.key).filter((k) => cited.has(k)),
    );
  });

  it('leaves out a source only hidden bands cite', () => {
    const file = copy();
    const group = file.groups[ANY_KEY];
    file.attribution.push({ key: 'only-hidden', text: 'A reference text', url: null });
    group.bands[0] = { ...group.bands[0], sources: ['only-hidden'], verify: true };
    const t = table(file);
    expect(citedAttributions(hintsFor([{ id: ANY_KEY, name: 'X' }], t), t).map((a) => a.key)).not.toContain('only-hidden');
    group.bands[0].verify = false;
    const shown = table(file);
    expect(citedAttributions(hintsFor([{ id: ANY_KEY, name: 'X' }], shown), shown).map((a) => a.key)).toContain('only-hidden');
  });
});

describe('a table with mistakes', () => {
  it('is unavailable, with the reason, when it can not be credited or read as a whole', () => {
    expect(reason(null)).toBe('it is not a JSON object');
    expect(reason([])).toBe('it is not a JSON object');
    expect(reason({ ...copy(), units: 'nm' })).toBe('its units are not "cm-1"');
    expect(reason({ ...copy(), license: 'CC BY-NC-SA 4.0' })).toBe('its licence is not "CC BY-SA 4.0"');
    for (const field of ['title', 'version', 'compiled_by']) {
      expect(reason({ ...copy(), [field]: ' ' })).toBe(`it has no "${field}"`);
    }
    expect(reason({ ...copy(), attribution: {} })).toBe('it has no "attribution" list');
    expect(reason({ ...copy(), regions: null })).toBe('it has no "regions" list');
    expect(reason({ ...copy(), regions: [] })).toBe('it has no usable region');
    expect(reason({ ...copy(), groups: [] })).toBe('it has no "groups"');
  });

  it('skips each broken band, says why, and still uses the others', () => {
    const file = copy();
    const bands = file.groups[ANY_KEY].bands;
    const good = bands[0];
    const lowest = Math.min(...FILE.regions.map((r) => r.range[0]));
    const highest = Math.max(...FILE.regions.map((r) => r.range[1]));
    const [low, high] = good.range;
    const broken: unknown[] = [
      { ...good, range: [high, low - 1] },
      { ...good, range: [low] },
      { ...good, range: [lowest - 1, high] },
      { ...good, range: [low, highest + 1] },
      { ...good, range: [low, low + 1], approx: true },
      { ...good, approx: 'yes' },
      { ...good, intensity: 'huge' },
      { ...good, shape: 'round' },
      { ...good, diagnostic: 1 },
      { ...good, verify: undefined },
      { ...good, note: 3 },
      { ...good, sources: [] },
      { ...good, sources: ['pavia'] },
      { ...good, vibration: '' },
      { ...good, bond: null },
      null,
    ];
    file.groups[ANY_KEY].bands = [good, ...(broken as FileBand[])];
    const at = (n: number) => `"${ANY_KEY}" band ${n + 2}`;
    expect(problems(file)).toEqual([
      `${at(0)}: its range is not [low, high] with low ≤ high`,
      `${at(1)}: its range is not [low, high] with low ≤ high`,
      `${at(2)}: its range is outside the regions (${lowest}–${highest})`,
      `${at(3)}: its range is outside the regions (${lowest}–${highest})`,
      `${at(4)}: it is approx, but its low and high differ`,
      `${at(5)}: its approx is not true or false`,
      `${at(6)}: its intensity is not strong, medium, weak or variable`,
      `${at(7)}: its shape is not sharp, broad or null`,
      `${at(8)}: its diagnostic is not true or false`,
      `${at(9)}: its verify is not true or false`,
      `${at(10)}: its note is not text or null`,
      `${at(11)}: it cites no source`,
      `${at(12)}: it cites "pavia", which has no attribution`,
      `${at(13)}: it has no vibration`,
      `${at(14)}: its bond is not text`,
      `${at(15)}: it is not an object`,
    ]);
    expect(table(file).groups.get(ANY_KEY)!.bands.map((b) => [b.low, b.high])).toEqual([good.range]);
  });

  it('skips a broken group, region or attribution, and a reference to a group that is not there', () => {
    const file = copy();
    const [first, second] = Object.keys(file.groups);
    file.groups = {
      ...file.groups,
      nolabel: { ...file.groups[first], label: '' },
      nobands: { ...file.groups[first], bands: 'none' as unknown as FileBand[] },
      badnote: { ...file.groups[first], note: 1 },
      badalways: { ...file.groups[first], always_show: 'yes' as unknown as boolean },
      sharesmissing: { ...file.groups[first], shared: 'gone' },
      sharesshared: { ...file.groups[first], shared: 'sharesmissing' },
      alsomissing: { ...file.groups[first], also_show: [second, 'gone'] },
      alsonotlist: { ...file.groups[first], also_show: second as unknown as string[] },
    };
    file.regions = [...file.regions, { ...file.regions[0], label: '' }];
    file.attribution = [...file.attribution, { ...file.attribution[0] }, { key: 'x', text: '', url: null }];
    const n = FILE.regions.length + 1;
    const a = FILE.attribution.length;
    expect(problems(file)).toEqual([
      `attribution ${a + 1}: another attribution has the same key`,
      `attribution ${a + 2}: it has no text`,
      `region ${n}: it has no label`,
      '"nolabel": it has no label',
      '"nobands": its bands are not a list',
      '"badnote": its note is not text or null',
      '"badalways": its always_show is not true or false',
      '"sharesmissing": its shared entry "gone" is not a group',
      '"sharesshared": its shared entry "sharesmissing" has a shared entry of its own',
      '"alsomissing": its also_show entry "gone" is not another group',
      '"alsonotlist": its also_show is not a list',
    ]);
    const t = table(file);
    expect(['nolabel', 'nobands', 'badnote', 'badalways'].filter((k) => t.groups.has(k))).toEqual([]);
    expect(t.groups.get('sharesmissing')!.shared).toBeNull();
    expect(t.groups.get('alsomissing')!.alsoShow).toEqual([second]);
    expect(t.regions.length).toBe(FILE.regions.length);
  });
});
