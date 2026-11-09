// Hydrogens on aromatic atoms that a Molfile can't carry (docs/plans/v1-release.md, review
// round 1). After Aromatize, or a pasted aromatic SMILES such as indole's, Ketcher keeps an
// aromatic N-H only as the atom's implicit H count, which its Molfile writer never writes: the
// ring's bonds are type 4 and the N has no H. RDKit then can't kekulize imidazole, and reads
// guanine as a different compound, two H short. Nor does RDKit read an H count from the
// valence or query columns of an aromatic atom (measured).
//
// So the drawing side notes those counts in the Molfile's comment line (line 3, free text),
// and the worker, before anything reads the Molfile, gives RDKit a copy with the hydrogens as
// atoms, takes the single and double bonds RDKit's kekulization assigns, and writes them over
// the type-4 bonds of the drawing's own Molfile. Nothing else changes: atom order (Molfile atom
// i is Ketcher's i-th atom), coordinates, wedges, charges, the chiral flag.
//
// The tautomer and resonance lists don't take them: they compare each form with the bonds as
// drawn, so a ring drawn aromatic must stay so. They read the drawing without the note, as
// before it was made, so an aromatized ring with an N-H is unreadable to them (an accepted
// limit, docs/plans/v1-release.md: Jeff's decision of 2026-11-09).
import type { MainModule } from '@rdkit/rdkit';

const MARK = 'aromatic H:';

/** An atom of the drawing (Molfile order) and the hydrogens Ketcher gives it. */
export type AromaticHydrogens = [atom: number, count: number][];

/** The Molfile with `hydrogens` noted in its comment line; as it was when there are none. */
export function noteHydrogens(molfile: string, hydrogens: AromaticHydrogens): string {
  if (hydrogens.length === 0) return molfile;
  const lines = molfile.split('\n');
  if (lines.length < 4) return molfile;
  lines[2] = `${MARK} ${hydrogens.map(([atom, count]) => `${atom}=${count}`).join(' ')}`;
  return lines.join('\n');
}

function noted(line: string | undefined): AromaticHydrogens | null {
  if (!line?.startsWith(MARK)) return null;
  const pairs = line.slice(MARK.length).trim().split(/\s+/).map((pair) => pair.split('=').map(Number));
  return pairs.every((pair) => pair.length === 2 && pair.every(Number.isInteger)) ? (pairs as AromaticHydrogens) : null;
}

const field = (line: string, from: number, to: number) => Number.parseInt(line.slice(from, to), 10);

/** The Molfile text with each noted hydrogen as an atom bonded to its atom, after all others. */
function withHydrogenAtoms(lines: string[], atoms: number, bonds: number, hydrogens: AromaticHydrogens): string {
  const block = lines.slice(4, 4 + atoms);
  const added: string[] = [];
  const links: string[] = [];
  for (const [atom, count] of hydrogens) {
    const [x, y] = [Number.parseFloat(block[atom].slice(0, 10)), Number.parseFloat(block[atom].slice(10, 20))];
    for (let h = 0; h < count; h += 1) {
      added.push(`${(x + 0.5).toFixed(4).padStart(10)}${y.toFixed(4).padStart(10)}${'0.0000'.padStart(10)} H   0  0  0  0  0  0  0  0  0  0  0  0`);
      links.push(`${String(atom + 1).padStart(3)}${String(atoms + added.length).padStart(3)}  1  0`);
    }
  }
  const counts = `${String(atoms + added.length).padStart(3)}${String(bonds + links.length).padStart(3)}${lines[3].slice(6)}`;
  return [
    ...lines.slice(0, 3),
    counts,
    ...block,
    ...added,
    ...lines.slice(4 + atoms, 4 + atoms + bonds),
    ...links,
    ...lines.slice(4 + atoms + bonds),
  ].join('\n');
}

/** The Molfile RDKit can read: the drawing's own, its noted aromatic hydrogens turned into
 * the Kekulé bonds RDKit assigns them. Unchanged where nothing is noted, and with only the
 * note removed where it can't be done (the newer Molfile format, more than 999 atoms, RDKit
 * can't read it even so): what RDKit made of it before. */
export function readableMolfile(rdkit: MainModule, molfile: string): string {
  const lines = molfile.split('\n');
  const hydrogens = noted(lines[2]);
  if (hydrogens === null) return molfile;
  lines[2] = '';
  const plain = lines.join('\n');
  if (!/V2000\s*$/.test(lines[3] ?? '')) return plain; // chem-literal-ok: format marker
  const [atoms, bonds] = [field(lines[3], 0, 3), field(lines[3], 3, 6)];
  const extra = hydrogens.reduce((sum, [, count]) => sum + count, 0);
  if (atoms + extra > 999 || bonds + extra > 999 || hydrogens.some(([atom]) => atom < 0 || atom >= atoms)) return plain;
  let kekule: string[];
  try {
    const mol = rdkit.get_mol(withHydrogenAtoms(lines, atoms, bonds, hydrogens), JSON.stringify({ removeHs: false }));
    if (!mol) return plain;
    try {
      kekule = mol.get_molblock().split('\n'); // Kekulé, its bonds in the order given
    } finally {
      mol.delete();
    }
  } catch {
    return plain; // RDKit failed on it: as it read the drawing before
  }
  const kekuleAtoms = field(kekule[3], 0, 3);
  for (let i = 0; i < bonds; i += 1) {
    const ours = lines[4 + atoms + i];
    const theirs = kekule[4 + kekuleAtoms + i];
    if (theirs === undefined || field(theirs, 0, 3) !== field(ours, 0, 3) || field(theirs, 3, 6) !== field(ours, 3, 6)) {
      return plain; // not the bond it should be: leave the drawing as it was
    }
    if (field(ours, 6, 9) === 4) lines[4 + atoms + i] = `${ours.slice(0, 6)}${theirs.slice(6, 9)}${ours.slice(9)}`;
  }
  return lines.join('\n');
}

/** The drawing's own Molfile without the note, as it was before notes were made. */
function withoutNote(molfile: string): string {
  const lines = molfile.split('\n');
  if (noted(lines[2]) === null) return molfile;
  lines[2] = '';
  return lines.join('\n');
}

/** The Molfile a worker request reads (by its kind; the properties panel's has none): the
 * drawing without the note for the tautomer and resonance lists, readableMolfile's Kekulé
 * bonds for everything else. */
export function molfileFor(rdkit: MainModule, kind: string | undefined, molfile: string): string {
  return kind === 'tautomers' || kind === 'resonance' ? withoutNote(molfile) : readableMolfile(rdkit, molfile);
}
