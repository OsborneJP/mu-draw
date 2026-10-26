// The IR hint table (docs/SPEC.md, "After v1" > "Teaching features"; plan and acceptance
// bar in docs/plans/v2-ir-hints.md). The bands come from web/public/ir-bands.json, a
// faculty-checked table under CC BY-SA 4.0 that anyone may edit; this code reads it, says
// which entries it can't use, and picks the entries for the groups the highlighter found.
// No IR value is ever written here or in the tests (invariant 3): they all come from the
// file. Plain data, no RDKit, so the page reads the file itself.

/** The table, under the base. Not hashed, so anyone can edit it; the precache revision
 * picks up a change. */
export const IR_BANDS_FILE = 'ir-bands.json';

/** The licences this app knows how to credit, with their URIs (shown as plain text: the
 * app may not link out, invariant 1). */
const LICENCES: Record<string, string> = {
  'CC BY-SA 4.0': 'https://creativecommons.org/licenses/by-sa/4.0/',
};

const INTENSITIES = ['strong', 'medium', 'weak', 'variable'] as const;
const SHAPES = ['sharp', 'broad'] as const;

export interface Band {
  bond: string;
  vibration: string;
  low: number;
  high: number;
  approx: boolean;
  intensity: (typeof INTENSITIES)[number];
  shape: (typeof SHAPES)[number] | null;
  diagnostic: boolean;
  note: string | null;
  sources: string[];
  /** Still to be checked against a reference text: never shown. */
  verify: boolean;
}

export interface IrGroup {
  label: string;
  note: string | null;
  bands: Band[];
  shared: string | null;
  alsoShow: string[];
  alwaysShow: boolean;
}

export interface Region {
  low: number;
  high: number;
  label: string;
  sources: string[];
}

export interface Attribution {
  key: string;
  text: string;
  url: string | null;
}

export interface IrTable {
  title: string;
  version: string;
  compiledBy: string;
  licence: string;
  licenceUri: string;
  attribution: Attribution[];
  regions: Region[];
  /** By key, in the file's order. */
  groups: Map<string, IrGroup>;
}

/** The usable table and what was wrong with the rest, or why there is no table at all. */
export type IrFile = { kind: 'table'; table: IrTable; problems: string[] } | { kind: 'unavailable'; reason: string };

type Fields = Record<string, unknown>;

const isObject = (value: unknown): value is Fields =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isText = (value: unknown): value is string => typeof value === 'string' && value.trim() !== '';
const isNoteOrNull = (value: unknown) => value === undefined || value === null || isText(value);

/** [low, high] with low <= high, or null. */
function range(value: unknown): [number, number] | null {
  if (!Array.isArray(value) || value.length !== 2) return null;
  const [low, high] = value as unknown[];
  if (typeof low !== 'number' || typeof high !== 'number' || !Number.isFinite(low) || !Number.isFinite(high)) return null;
  return low <= high ? [low, high] : null;
}

/** Why `sources` can't be credited, or null. */
function sourcesProblem(sources: unknown, credited: Set<string>): string | null {
  if (!Array.isArray(sources) || sources.length === 0 || !sources.every(isText)) return 'it cites no source';
  const unknown = sources.find((s) => !credited.has(s));
  return unknown === undefined ? null : `it cites "${unknown}", which has no attribution`;
}

/** The table in a parsed ir-bands.json. Entries that can't be used are left out and
 * described in `problems`, so one mistake doesn't hide every other group. */
export function readIrBands(file: unknown): IrFile {
  const unavailable = (reason: string): IrFile => ({ kind: 'unavailable', reason });
  if (!isObject(file)) return unavailable('it is not a JSON object');
  if (file.units !== 'cm-1') return unavailable('its units are not "cm-1"');
  const licence = file.license;
  if (typeof licence !== 'string' || !(licence in LICENCES)) return unavailable('its licence is not "CC BY-SA 4.0"');
  for (const field of ['title', 'version', 'compiled_by'] as const) {
    if (!isText(file[field])) return unavailable(`it has no "${field}"`);
  }
  if (!Array.isArray(file.attribution)) return unavailable('it has no "attribution" list');
  if (!Array.isArray(file.regions)) return unavailable('it has no "regions" list');
  if (!isObject(file.groups)) return unavailable('it has no "groups"');

  const problems: string[] = [];
  const attribution: Attribution[] = [];
  (file.attribution as unknown[]).forEach((entry, i) => {
    const wrong = (what: string) => problems.push(`attribution ${i + 1}: ${what}`);
    if (!isObject(entry) || !isText(entry.key)) return wrong('it has no key');
    if (attribution.some((a) => a.key === entry.key)) return wrong('another attribution has the same key');
    if (!isText(entry.text)) return wrong('it has no text');
    if (entry.url !== null && !isText(entry.url)) return wrong('its url is not text or null');
    attribution.push({ key: entry.key, text: entry.text, url: entry.url });
  });
  const credited = new Set(attribution.map((a) => a.key));

  const regions: Region[] = [];
  (file.regions as unknown[]).forEach((entry, i) => {
    const wrong = (what: string) => problems.push(`region ${i + 1}: ${what}`);
    if (!isObject(entry)) return wrong('it is not an object');
    const span = range(entry.range);
    if (!span) return wrong('its range is not [low, high] with low ≤ high');
    if (!isText(entry.label)) return wrong('it has no label');
    const source = sourcesProblem(entry.sources, credited);
    if (source) return wrong(source);
    regions.push({ low: span[0], high: span[1], label: entry.label, sources: entry.sources as string[] });
  });
  if (regions.length === 0) return { kind: 'unavailable', reason: 'it has no usable region' };
  // Every band lies somewhere in the spectrum the regions cover.
  const lowest = Math.min(...regions.map((r) => r.low));
  const highest = Math.max(...regions.map((r) => r.high));

  // First each group on its own; then the references between them, among the usable ones.
  const groups = new Map<string, IrGroup & { sharedKey: unknown; alsoKeys: unknown }>();
  for (const [key, entry] of Object.entries(file.groups)) {
    const wrong = (what: string) => problems.push(`"${key}": ${what}`);
    if (!isObject(entry)) {
      wrong('it is not an object');
      continue;
    }
    if (!isText(entry.label)) {
      wrong('it has no label');
      continue;
    }
    if (!Array.isArray(entry.bands)) {
      wrong('its bands are not a list');
      continue;
    }
    if (!isNoteOrNull(entry.note)) {
      wrong('its note is not text or null');
      continue;
    }
    if (entry.always_show !== undefined && typeof entry.always_show !== 'boolean') {
      wrong('its always_show is not true or false');
      continue;
    }
    const bands: Band[] = [];
    (entry.bands as unknown[]).forEach((band, i) => {
      const bad = (what: string) => problems.push(`"${key}" band ${i + 1}: ${what}`);
      if (!isObject(band)) return bad('it is not an object');
      if (typeof band.bond !== 'string') return bad('its bond is not text');
      if (!isText(band.vibration)) return bad('it has no vibration');
      const span = range(band.range);
      if (!span) return bad('its range is not [low, high] with low ≤ high');
      if (span[0] < lowest || span[1] > highest) return bad(`its range is outside the regions (${lowest}–${highest})`);
      if (band.approx !== undefined && typeof band.approx !== 'boolean') return bad('its approx is not true or false');
      if (band.approx === true && span[0] !== span[1]) return bad('it is approx, but its low and high differ');
      const intensity = INTENSITIES.find((x) => x === band.intensity);
      if (!intensity) return bad('its intensity is not strong, medium, weak or variable');
      const shape = band.shape === null ? null : SHAPES.find((x) => x === band.shape);
      if (shape === undefined) return bad('its shape is not sharp, broad or null');
      if (typeof band.diagnostic !== 'boolean') return bad('its diagnostic is not true or false');
      if (typeof band.verify !== 'boolean') return bad('its verify is not true or false');
      if (!isNoteOrNull(band.note)) return bad('its note is not text or null');
      const source = sourcesProblem(band.sources, credited);
      if (source) return bad(source);
      bands.push({
        bond: band.bond,
        vibration: band.vibration,
        low: span[0],
        high: span[1],
        approx: band.approx === true,
        intensity,
        shape,
        diagnostic: band.diagnostic,
        note: (band.note as string | null | undefined) ?? null,
        sources: band.sources as string[],
        verify: band.verify,
      });
    });
    groups.set(key, {
      label: entry.label,
      note: (entry.note as string | null | undefined) ?? null,
      bands,
      shared: null,
      alsoShow: [],
      alwaysShow: entry.always_show === true,
      sharedKey: entry.shared,
      alsoKeys: entry.also_show,
    });
  }

  const table = new Map<string, IrGroup>();
  for (const [key, { sharedKey, alsoKeys, ...group }] of groups) {
    const wrong = (what: string) => problems.push(`"${key}": ${what}`);
    if (sharedKey !== undefined) {
      const target = typeof sharedKey === 'string' ? groups.get(sharedKey) : undefined;
      if (!target) wrong(`its shared entry ${JSON.stringify(sharedKey)} is not a group`);
      else if (target.sharedKey !== undefined) wrong(`its shared entry "${String(sharedKey)}" has a shared entry of its own`);
      else group.shared = sharedKey as string;
    }
    if (alsoKeys !== undefined) {
      if (!Array.isArray(alsoKeys)) wrong('its also_show is not a list');
      else
        for (const also of alsoKeys as unknown[]) {
          if (typeof also === 'string' && groups.has(also) && also !== key) group.alsoShow.push(also);
          else wrong(`its also_show entry ${JSON.stringify(also)} is not another group`);
        }
    }
    table.set(key, group);
  }

  return {
    kind: 'table',
    table: {
      title: file.title as string,
      version: file.version as string,
      compiledBy: file.compiled_by as string,
      licence,
      licenceUri: LICENCES[licence],
      attribution,
      regions,
      groups: table,
    },
    problems,
  };
}

/** One entry of the hints: a group of the table with the bands that may be shown, or a
 * group the highlighter found that the table has nothing for. */
export type Hint =
  | { kind: 'hint'; key: string; label: string; note: string | null; bands: Band[]; checking: boolean }
  | { kind: 'missing'; name: string };

/** The hints for the groups found (highlighter order, highest priority first): each
 * group, then its shared entry the first time one names it, then its also_show entries
 * that weren't found themselves; the always_show entries last. No entry twice. Bands
 * marked verify are left out, and their entry says some are still being checked. */
export function hintsFor(found: { id?: string; name: string }[], table: IrTable): Hint[] {
  const hints: Hint[] = [];
  const shown = new Set<string>();
  const add = (key: string) => {
    if (shown.has(key)) return;
    shown.add(key);
    const group = table.groups.get(key)!;
    const bands = group.bands.filter((b) => !b.verify);
    hints.push({
      kind: 'hint',
      key,
      label: group.label,
      note: group.note,
      bands,
      checking: bands.length < group.bands.length,
    });
  };
  const foundKeys = new Set(found.flatMap((g) => (g.id !== undefined && table.groups.has(g.id) ? [g.id] : [])));
  for (const g of found) {
    const group = g.id === undefined ? undefined : table.groups.get(g.id);
    if (!group || g.id === undefined) {
      hints.push({ kind: 'missing', name: g.name });
      continue;
    }
    add(g.id);
    if (group.shared) add(group.shared);
    for (const also of group.alsoShow) if (!foundKeys.has(also)) add(also);
  }
  for (const [key, group] of table.groups) if (group.alwaysShow) add(key);
  return hints;
}

/** The attributions the shown bands and the regions cite, in the file's order. */
export function citedAttributions(hints: Hint[], table: IrTable): Attribution[] {
  const cited = new Set(table.regions.flatMap((r) => r.sources));
  for (const hint of hints) if (hint.kind === 'hint') for (const band of hint.bands) band.sources.forEach((s) => cited.add(s));
  return table.attribution.filter((a) => cited.has(a.key));
}
