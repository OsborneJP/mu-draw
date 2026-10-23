import { expect, fixture, openEditor, referenceCompound, test } from './fixtures.ts';

// Ketcher UI that must stay hidden (src/editor/ketcherUi.ts). Each ID was confirmed present
// when its hiding is switched off: Help, About, the 3D viewer, create-monomer, and the
// macromolecules mode toggle.
const HIDDEN_TEST_IDS = [
  'help-button',
  'about-button',
  '3D Viewer button',
  'create-monomer',
  'polymer-toggler',
];

test('online: the editor loads and Indigo reads an RDKit Molfile', async ({ app }) => {
  await openEditor(app);
  const butanol = referenceCompound('(R)-2-butanol');
  const molfile = fixture(butanol.files.find((f) => f.endsWith('.mol'))!);
  const key = await app.page.evaluate(async (mol) => {
    await window.ketcher!.setMolecule(mol);
    return window.ketcher!.getInChIKey();
  }, molfile);
  // Indigo (in the browser) and RDKit (on the server) agree on the structure.
  expect(key).toBe(butanol.inchikey);
  for (const id of HIDDEN_TEST_IDS) {
    await expect(app.page.getByTestId(id), id).toHaveCount(0);
  }
});
