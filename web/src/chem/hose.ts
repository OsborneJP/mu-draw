// Carbon environments for the ¹³C NMR preview (docs/plans/nmr.md), on RDKit's view of a
// drawing: the heavy-atom graph, topological symmetry, and HOSE-style codes. The same code
// builds the shift table from NMRShiftDB2 (web/scripts/build-carbon-table.ts) and looks
// carbons up in it (src/chem/nmr.ts), so a code only has to be consistent, not Bremser's.

/** Heavy atoms in Molfile order (`index` is the Molfile atom index), hydrogens folded into
 * `hs`; and each atom's neighbours as [graph atom, bond code]. */
export interface Graph {
  atoms: { index: number; z: number; aromatic: boolean; charge: number; isotope: number; hs: number }[];
  neighbours: [number, string][][];
}

interface JsonAtom {
  z: number;
  impHs: number;
  chg: number;
  isotope: number;
}

/** RDKit.js `get_json()` output, the parts used here. */
export interface RdkitJson {
  defaults: { atom: JsonAtom; bond: { bo: number } };
  molecules: {
    atoms: Partial<JsonAtom>[];
    bonds?: (Partial<{ bo: number }> & { atoms: [number, number] })[];
    extensions?: { name: string; aromaticAtoms?: number[]; aromaticBonds?: number[] }[];
  }[];
}

// Bond codes: single, double, triple; aromatic is '*'. Anything else (dative, zero-order)
// is '?', so it is matched only by its own kind.
const BOND: Record<number, string> = { 1: '', 2: '=', 3: '#' };

/** The heavy-atom graph of the first molecule in RDKit's JSON. Hydrogen atoms (drawn ones
 * included; not isotopes such as deuterium) are counted on the atom they are bonded to. */
export function graphOf(json: RdkitJson): Graph {
  const m = json.molecules[0];
  const all = m.atoms.map((a) => ({ ...json.defaults.atom, ...a }));
  const bonds = (m.bonds ?? []).map((b) => ({ ...json.defaults.bond, ...b }));
  const rdkit = (m.extensions ?? []).find((e) => e.name === 'rdkitRepresentation');
  const aromaticAtoms = new Set(rdkit?.aromaticAtoms ?? []);
  const aromaticBonds = new Set(rdkit?.aromaticBonds ?? []);
  const toGraph = new Map<number, number>();
  const atoms: Graph['atoms'] = [];
  all.forEach((a, i) => {
    if (a.z === 1 && a.isotope === 0) return;
    toGraph.set(i, atoms.length);
    atoms.push({ index: i, z: a.z, aromatic: aromaticAtoms.has(i), charge: a.chg, isotope: a.isotope, hs: a.impHs });
  });
  const neighbours: Graph['neighbours'] = atoms.map(() => []);
  bonds.forEach((b, i) => {
    const [x, y] = b.atoms.map((a) => toGraph.get(a));
    if (x === undefined && y !== undefined) atoms[y].hs += 1;
    else if (y === undefined && x !== undefined) atoms[x].hs += 1;
    else if (x !== undefined && y !== undefined) {
      const code = aromaticBonds.has(i) ? '*' : (BOND[b.bo] ?? '?');
      neighbours[x].push([y, code]);
      neighbours[y].push([x, code]);
    }
  });
  return { atoms, neighbours };
}

/** Each string's place among the distinct strings, sorted: the same for any atom order. */
function ranked(keys: string[]): number[] {
  const order = new Map([...new Set(keys)].sort().map((k, i) => [k, i]));
  return keys.map((k) => order.get(k)!);
}

/** Canonical ranks without tie-breaking: atoms with the same rank are topologically
 * equivalent. Refines element, isotope, charge, aromaticity, hydrogens and degree by the
 * neighbours' ranks and bonds until nothing splits, as RDKit's
 * CanonicalRankAtoms(breakTies=False) does (RDKit.js has no binding for it; the tests
 * compare the two on the fixtures). */
export function symmetryRanks(g: Graph): number[] {
  let ranks = ranked(
    g.atoms.map((a, i) => `${a.z},${a.isotope},${a.charge},${a.aromatic ? 1 : 0},${a.hs},${g.neighbours[i].length}`),
  );
  for (;;) {
    const next = ranked(ranks.map((r, i) => `${r}|${g.neighbours[i].map(([n, b]) => `${b}${ranks[n]}`).sort().join(',')}`));
    if (new Set(next).size === new Set(ranks).size) return next;
    ranks = next;
  }
}

/** An atom as a code writes it: element (atomic number), 'a' if aromatic, isotope, charge,
 * and 'u' when `onward` says it has a double or triple bond further out. The 'u' sees half
 * a sphere ahead: at 4 bonds from a benzoyl ring's para carbon it tells C=O from CH3
 * (measured on held-out NMRShiftDB2 compounds: 2.51 ppm mean error with it, 2.59 without,
 * for a 6% larger table). */
function symbol(a: Graph['atoms'][number], onward = false): string {
  const charge = a.charge > 0 ? '+'.repeat(a.charge) : '-'.repeat(-a.charge);
  return `${a.aromatic ? 'a' : ''}${a.z}${a.isotope ? `i${a.isotope}` : ''}${charge}${onward ? 'u' : ''}`;
}

/** Whether atom `n` has a double or triple bond to an atom other than `from`. */
function unsaturatedOnward(g: Graph, n: number, from: number): boolean {
  return g.neighbours[n].some(([m, bond]) => m !== from && (bond === '=' || bond === '#'));
}

/** HOSE-style codes for one atom: codes[k - 1] describes it out to k bonds. Each sphere
 * lists, for each atom of the sphere before (in order), its other neighbours as bond +
 * symbol, sorted, with '&' marking a ring closure (an atom already reached); spheres are
 * separated by '/'. Ties are ordered by symmetry rank, so the codes don't depend on the
 * order atoms were drawn in. */
export function hoseCodes(g: Graph, ranks: number[], centre: number, spheres: number): string[] {
  const reached = new Set([centre]);
  let frontier = [{ atom: centre, parent: -1 }];
  const head = `${symbol(g.atoms[centre])}H${g.atoms[centre].hs}`;
  const parts: string[] = [];
  const codes: string[] = [];
  for (let k = 1; k <= spheres; k += 1) {
    const next: typeof frontier = [];
    const groups: string[] = [];
    for (const node of frontier) {
      const kids = g.neighbours[node.atom]
        .filter(([n]) => n !== node.parent)
        .map(([n, bond]) => ({ n, token: `${bond}${symbol(g.atoms[n], unsaturatedOnward(g, n, node.atom))}` }))
        .sort((x, y) => (x.token < y.token ? -1 : x.token > y.token ? 1 : ranks[x.n] - ranks[y.n]));
      groups.push(
        kids
          .map(({ n, token }) => {
            if (reached.has(n)) return `${token}&`;
            reached.add(n);
            next.push({ atom: n, parent: node.atom });
            return token;
          })
          .join(''),
      );
    }
    parts.push(groups.join(','));
    codes.push(`${head}(${parts.join('/')})`);
    frontier = next;
  }
  return codes;
}
