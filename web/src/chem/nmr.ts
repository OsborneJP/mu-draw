// The ¹³C NMR preview's prediction (spec "NMR prediction proof of concept"; plan and
// acceptance bar in docs/plans/nmr.md): one peak per set of topologically equivalent
// carbons, at the median shift NMRShiftDB2 records for the most specific environment it
// has (src/chem/carbonTable.ts). Runs in the NMR worker and, in the unit tests, in Node.
import type { MainModule } from '@rdkit/rdkit';
import { lookup, type CarbonTable } from './carbonTable.ts';
import { graphOf, hoseCodes, symmetryRanks, type RdkitJson } from './hose.ts';

/** Matches this many bonds out or fewer are "low confidence": on NMRShiftDB2 compounds
 * left out of the table, predictions matched at 1 or 2 bonds were off by 4.5 ppm and more
 * on average, at 3 bonds 2.3, at 4 bonds 1.2 (docs/plans/nmr.md). */
export const LOW_CONFIDENCE_SPHERES = 2;

export interface Peak {
  /** ppm, to 0.1; null when the table has nothing for this carbon at any sphere. */
  shift: number | null;
  /** How many bonds out the match reached (0 when there was none). */
  sphere: number;
  /** The equivalent carbons, by Molfile atom index. */
  atoms: number[];
  /** Hydrogens on each of them (drawn or implicit): C, CH, CH2, CH3. */
  hydrogens: number;
}

/** A prediction request to the NMR worker, and its answer: the peaks (null when RDKit can't
 * read the drawing), or why there is no table. The worker also sends {failed} once if
 * RDKit can't start. */
export interface NmrRequest {
  kind: 'nmr';
  id: number;
  molfile: string;
}

export type NmrReply = { kind: 'nmr'; id: number; peaks: Peak[] | null } | { kind: 'nmr'; id: number; unavailable: string };

/** Peaks from the highest shift down (as a spectrum is read), or null when RDKit can't
 * read the drawing. */
export function predictCarbon(rdkit: MainModule, molfile: string, table: CarbonTable): Peak[] | null {
  const mol = rdkit.get_mol(molfile, JSON.stringify({ removeHs: false }));
  if (!mol) return null;
  let json: RdkitJson;
  try {
    json = JSON.parse(mol.get_json()) as RdkitJson;
  } finally {
    mol.delete();
  }
  const g = graphOf(json);
  const ranks = symmetryRanks(g);
  const classes = new Map<number, number[]>();
  g.atoms.forEach((a, i) => {
    if (a.z !== 6) return;
    const members = classes.get(ranks[i]) ?? [];
    members.push(i);
    classes.set(ranks[i], members);
  });
  const peaks: Peak[] = [];
  for (const members of classes.values()) {
    // Equivalent carbons have the same codes; each is looked up anyway, and averaged.
    let sum = 0;
    let found = 0;
    let sphere = Infinity;
    for (const atom of members) {
      const codes = hoseCodes(g, ranks, atom, table.info.spheres);
      for (let k = codes.length; k >= 1; k -= 1) {
        const shift = lookup(table, codes[k - 1]);
        if (shift !== null) {
          sum += shift;
          found += 1;
          sphere = Math.min(sphere, k);
          break;
        }
      }
    }
    peaks.push({
      shift: found === members.length ? Math.round((sum / found) * 10) / 10 : null,
      sphere: found === members.length ? sphere : 0,
      atoms: members.map((i) => g.atoms[i].index),
      hydrogens: g.atoms[members[0]].hs,
    });
  }
  return peaks.sort((a, b) => (b.shift ?? -Infinity) - (a.shift ?? -Infinity) || a.atoms[0] - b.atoms[0]);
}
