// The functional-group highlighter's matching (docs/SPEC.md, "3. Functional group
// highlighter"; plan and acceptance bar in docs/plans/functional-groups.md). The patterns
// come from web/public/functional-groups.json, which anyone may edit; this code reads them,
// says which entries it can't use, and finds the groups in one drawing. Runs in the RDKit
// worker and, in the unit tests, in Node with the same RDKit.js.
//
// Every atom a SMARTS matches belongs to that group (atoms that only have to be nearby sit
// inside recursive SMARTS). Overlap rule: groups are applied from the highest priority
// down, a match that uses an atom a higher-priority group already claimed is dropped, and
// matches of one group that share atoms merge into one instance.
import type { MainModule, Mol } from '@rdkit/rdkit';

/** One entry of functional-groups.json. `id`, if given, is the group's key in the IR
 * hint table (src/chem/irBands.ts). */
export interface GroupPattern {
  name: string;
  id?: string;
  smarts: string;
  color: string;
  priority: number;
}

/** The usable patterns, highest priority first, and what was wrong with the others. */
export interface Patterns {
  groups: (GroupPattern & { query: Mol })[];
  problems: string[];
}

/** One group found in a drawing: its atoms, and each bond between two of them as its two
 * atoms, all by Molfile atom index. */
export interface GroupInstance {
  atoms: number[];
  bonds: [number, number][];
}

export interface FoundGroup {
  name: string;
  id?: string;
  color: string;
  instances: GroupInstance[];
}

/** What the worker reports for one drawing. */
export type GroupsResult =
  | { kind: 'found'; groups: FoundGroup[]; problems: string[] }
  | { kind: 'unavailable'; reason: string };

const COLOR = /^#[0-9a-fA-F]{6}$/;
const ID = /^[a-z][a-z0-9_]*$/;

/** The patterns in a parsed functional-groups.json. Entries that can't be used are left
 * out and described in `problems`, so one mistake doesn't hide every other group. */
export function readPatterns(rdkit: MainModule, file: unknown): Patterns {
  const entries = (file as { groups?: unknown } | null)?.groups;
  if (!Array.isArray(entries)) return { groups: [], problems: ['it has no "groups" list'] };
  const groups: Patterns['groups'] = [];
  const problems: string[] = [];
  const names = new Set<string>();
  const ids = new Set<string>();
  entries.forEach((entry: Partial<Record<keyof GroupPattern, unknown>> | null, i) => {
    const { name, id, smarts, color, priority } = entry ?? {};
    const label = typeof name === 'string' && name.trim() !== '' ? `"${name}"` : `entry ${i + 1}`;
    const wrong = (what: string) => problems.push(`${label}: ${what}`);
    if (typeof name !== 'string' || name.trim() === '') return wrong('it has no name');
    if (names.has(name)) return wrong('another group has the same name');
    const key = typeof id === 'string' ? id : undefined;
    if (id !== undefined && (key === undefined || !ID.test(key))) return wrong('its id is not lowercase letters, digits and _');
    if (key !== undefined && ids.has(key)) return wrong('another group has the same id');
    if (typeof smarts !== 'string' || smarts.trim() === '') return wrong('it has no SMARTS');
    if (typeof color !== 'string' || !COLOR.test(color)) return wrong('its color is not #rrggbb');
    if (typeof priority !== 'number' || !Number.isFinite(priority)) return wrong('its priority is not a number');
    const query = rdkit.get_qmol(smarts);
    if (!query) return wrong("RDKit can't read its SMARTS");
    names.add(name);
    if (key !== undefined) ids.add(key);
    groups.push({ name, id: key, smarts, color, priority, query });
  });
  // Highest priority first; equal priorities keep the file's order (sort is stable).
  groups.sort((a, b) => b.priority - a.priority);
  return { groups, problems };
}

/** Free the RDKit query molecules. */
export function deletePatterns(patterns: Patterns): void {
  for (const group of patterns.groups) group.query.delete();
}

/** The groups in `mol` (whose atom indices are the Molfile's), highest priority first;
 * `bonds` are mol's bonds as atom pairs. Groups with no instance are left out. */
export function findGroups(mol: Mol, bonds: [number, number][], patterns: Patterns): FoundGroup[] {
  const claimed = new Set<number>();
  const found: FoundGroup[] = [];
  for (const group of patterns.groups) {
    const matches = (JSON.parse(mol.get_substruct_matches(group.query)) as { atoms: number[] }[] | Record<string, never>);
    const usable = (Array.isArray(matches) ? matches : [])
      .map((m) => m.atoms)
      .filter((atoms) => !atoms.some((a) => claimed.has(a)));
    const instances = merge(usable).map((atoms) => {
      const inside = new Set(atoms);
      return {
        atoms,
        bonds: bonds.filter(([a, b]) => inside.has(a) && inside.has(b)),
      };
    });
    for (const instance of instances) instance.atoms.forEach((a) => claimed.add(a));
    if (instances.length > 0) found.push({ name: group.name, id: group.id, color: group.color, instances });
  }
  return found;
}

/** Matches that share atoms, joined into one sorted atom list each, ordered by their lowest
 * atom. */
function merge(matches: number[][]): number[][] {
  const sets: Set<number>[] = [];
  for (const match of matches) {
    const joined = new Set(match);
    for (let i = sets.length - 1; i >= 0; i -= 1) {
      if ([...sets[i]].some((a) => joined.has(a))) {
        sets[i].forEach((a) => joined.add(a));
        sets.splice(i, 1);
      }
    }
    sets.push(joined);
  }
  return sets.map((s) => [...s].sort((a, b) => a - b)).sort((a, b) => a[0] - b[0]);
}
