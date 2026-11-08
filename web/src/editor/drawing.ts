// The drawing as the properties panel needs it (src/chem/tracker.ts): what kind of drawing
// it is, and for a plain structure, a Molfile plus the Ketcher atom id of each Molfile atom.
import { Bond, Elements, MolSerializer, type Ketcher } from 'ketcher-core';
import { noteHydrogens, type AromaticHydrogens } from '../chem/aromaticHydrogens';
import type { Drawing } from '../chem/tracker';

const serializer = new MolSerializer();

type Struct = ReturnType<Ketcher['editor']['struct']>;

/** Ketcher's H count for each aromatic atom whose hydrogens RDKit can't work out from a
 * Molfile: in a drawing whose aromatic atoms are not all neutral carbons (an N-H, a charged
 * ring carbon), every aromatic atom with hydrogens. The worker gives these to RDKit
 * (src/chem/aromaticHydrogens.ts). None for a benzene ring, which RDKit reads as it is. */
function aromaticHydrogens(struct: Struct, atomIds: number[]): AromaticHydrogens {
  const aromatic = new Set<number>();
  for (const bond of struct.bonds.values()) {
    if (bond.type === Bond.PATTERN.TYPE.AROMATIC) aromatic.add(bond.begin).add(bond.end);
  }
  const plain = (id: number) => {
    const atom = struct.atoms.get(id)!;
    return atom.label === 'C' && !atom.charge;
  };
  if ([...aromatic].every(plain)) return [];
  return atomIds.flatMap((id, index): AromaticHydrogens => {
    const count = struct.atoms.get(id)!.implicitHCount;
    return aromatic.has(id) && count ? [[index, count]] : [];
  });
}

/** Read the drawing now. Synchronous, so the Molfile and the atom ids are of one moment.
 * Safe to call from Ketcher's change event: Ketcher announces a change once the action is
 * applied, hydrogens and valence warnings included (measured: attaching a ring to a carbon
 * that already had four bonds, the warning was set when the event fired). */
export function readDrawing(ketcher: Ketcher): Drawing {
  const struct = ketcher.editor.struct();
  // Any reaction arrow, multi-tailed ones included; plus signs alone don't make a reaction.
  if (struct.rxnArrows.size > 0 || struct.multitailArrows.size > 0) return { kind: 'reaction' };
  // Text, shapes and images alone are no structure.
  if (struct.atoms.size === 0) return { kind: 'empty' };
  const atoms = [...struct.atoms.values()];
  // R-groups, atom lists, generic and pseudo atoms (A, Q, X, "Alk", ...) aren't elements.
  const notElement = (a: (typeof atoms)[number]) => !Elements.get(a.label) || a.atomList != null || a.rglabel != null;
  if (struct.rgroups.size > 0 || atoms.some(notElement)) return { kind: 'not-elements' };
  try {
    // Ketcher's in-page Molfile writer, not Indigo: Indigo's converter mixes up answers to
    // two requests in flight at once (like its images, src/editor/imageQueue.ts). The writer
    // copies the drawing in its own atom order, so Molfile atom i is the i-th atom here.
    const atomIds = [...struct.atoms.keys()];
    return {
      kind: 'structure',
      molfile: noteHydrogens(serializer.serialize(struct), aromaticHydrogens(struct, atomIds)),
      atomIds,
      // Ketcher's own valence warning (the atoms it underlines in red).
      badValence: atoms.filter((a) => a.badConn).length,
    };
  } catch (error) {
    console.error('Ketcher could not write the drawing as a Molfile:', error);
    return { kind: 'unreadable' };
  }
}
