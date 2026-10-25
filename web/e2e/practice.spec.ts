// Practice mode (docs/plans/v2-practice-mode.md): the app gives a name, the student draws it,
// and Check compares InChIKeys from Indigo with the ones the list ships (made by RDKit).
import { expect, fixture, openEditor, referenceCompound, test } from './fixtures.ts';

const molfileOf = (name: string) => fixture(referenceCompound(name).files.find((f) => f.endsWith('.mol'))!);

test('two InChIKeys asked for at once each get their own drawing', async ({ app }) => {
  const { page } = app;
  await openEditor(app);
  const kets: string[] = [];
  for (const name of ['ethanol', 'toluene']) {
    await page.evaluate((molfile) => window.ketcher!.setMolecule(molfile), molfileOf(name));
    kets.push(await page.evaluate(() => window.ketcher!.getKet()));
  }
  // Straight to Ketcher's struct service, as Ketcher's own getInChIKey() calls it.
  const keys = await page.evaluate(
    (drawings) => {
      const service = (window.ketcher as unknown as { structService: { getInChIKey(ket: string): Promise<string> } })
        .structService;
      return Promise.all(drawings.map((ket) => service.getInChIKey(ket)));
    },
    kets,
  );
  expect(keys).toEqual([referenceCompound('ethanol').inchikey, referenceCompound('toluene').inchikey]);
});
