import { RDKIT_WASM_FILE } from '../config/rdkitWasm.ts';
import {
  appManifest,
  expect,
  fetchAndCompileWasm,
  fixture,
  installabilityErrors,
  openEditor,
  referenceCompound,
  test,
  waitForServiceWorker,
} from './fixtures.ts';

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

test('the installability check is live: a page without a manifest is not installable', async ({ app }) => {
  // Under the base, so the request policy holds; never loads the app, so no service worker.
  const url = new URL('no-manifest.html', app.server.url).href;
  await app.page.route(url, (route) =>
    route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>No manifest</title>' }),
  );
  await app.page.goto(url);
  const ids = (await installabilityErrors(app)).map((e) => e.errorId);
  expect(ids).toContain('no-manifest');
});

test('online: the editor loads, works, stays on its own origin and is installable', async ({ app }) => {
  const { context, page, server } = app;
  // Created before the first request so no event can be missed.
  const seen = {
    serviceWorkerScript: context.waitForEvent('request', (r) => r.url() === new URL('sw.js', server.url).href),
    precacheFetch: context.waitForEvent('request', (r) => r.serviceWorker() !== null),
    indigoWorker: context.waitForEvent('request', (r) => /\/assets\/indigoWorker-[^/]+\.js$/.test(r.url())),
    indigoWasm: context.waitForEvent('request', (r) => /\/assets\/indigo-ketcher-[^/]+\.wasm$/.test(r.url())),
  };

  await openEditor(app);
  const butanol = referenceCompound('(R)-2-butanol');
  const molfile = fixture(butanol.files.find((f) => f.endsWith('.mol'))!);
  const key = await page.evaluate(async (mol) => {
    await window.ketcher!.setMolecule(mol);
    return window.ketcher!.getInChIKey();
  }, molfile);
  // Indigo (in the browser) and RDKit (on the server) agree on the structure.
  expect(key).toBe(butanol.inchikey);
  for (const id of HIDDEN_TEST_IDS) {
    await expect(page.getByTestId(id), id).toHaveCount(0);
  }

  await waitForServiceWorker(page);
  // Positive control for the request policy: the requests it judged really happened.
  await Promise.all(Object.values(seen));

  // RDKit.js ships before any code uses it: served as WebAssembly and compilable.
  const rdkit = await fetchAndCompileWasm(page, new URL(RDKIT_WASM_FILE, server.url).href);
  expect(rdkit).toMatchObject({ status: 200, contentType: 'application/wasm' });
  expect(rdkit.exports).toBeGreaterThan(0);

  expect(await installabilityErrors(app)).toEqual([]);
  const manifest = await appManifest(app);
  expect(manifest).toEqual({ scope: server.url, startUrl: server.url, id: server.url });
});
