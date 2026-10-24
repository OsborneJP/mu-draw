import type { Page } from '@playwright/test';
import { cspFor, cspPolicy } from '../config/csp.ts';
import { RDKIT_WASM_FILE, RDKIT_WORKER_FILE } from '../config/rdkitWasm.ts';
import {
  appManifest,
  clearCanvas,
  expect,
  fetchAndCompileWasm,
  fixture,
  fixturePath,
  goOffline,
  inchiKey,
  installabilityErrors,
  openEditor,
  openWithDialog,
  saveWithDialog,
  referenceCompound,
  test,
  waitForEditor,
  waitForServiceWorker,
} from './fixtures.ts';

// Ketcher UI that must stay hidden (src/editor/ketcherUi.ts, src/editor/editor.css). Each ID
// was confirmed present when its hiding is switched off: Help, About, the 3D viewer,
// create-monomer, and the macromolecules mode toggle.
const HIDDEN_TEST_IDS = [
  'help-button',
  'about-button',
  '3D Viewer button',
  'create-monomer',
  'polymer-toggler',
];

// Each control must be absent or itself display:none. "Not visible" isn't enough: in the
// compact toolbar they sit inside collapsed menus, invisible only until a menu is opened.
async function expectHiddenUiInvisible(page: Page) {
  const shown = await page.evaluate((ids) => {
    const elements = ids.flatMap((id) => [...document.querySelectorAll(`[data-testid="${id}"]`)]);
    return elements
      .filter((el) => getComputedStyle(el).display !== 'none')
      .map((el) => el.getAttribute('data-testid'));
  }, HIDDEN_TEST_IDS);
  expect(shown).toEqual([]);
}

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
    rdkitWorker: context.waitForEvent('request', (r) => r.url() === new URL(RDKIT_WORKER_FILE, server.url).href),
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
  await expectHiddenUiInvisible(page);
  // Ketcher re-renders its toolbar in a compact form after a resize, and that form ignores
  // buttons.hidden. Force it: the compact form duplicates the Save button, which is the
  // positive signal that it has rendered. Nothing hidden may show there either.
  await page.setViewportSize({ width: 640, height: 480 });
  await expect(page.getByTestId('save-file-button')).toHaveCount(2);
  await expectHiddenUiInvisible(page);
  await page.setViewportSize({ width: 1280, height: 720 });

  // Ketcher's debug shortcut Alt+Shift+R would write the drawing into the URL (and so the
  // server's access log). The app swallows it before it reaches the document; a harmless
  // combination still gets through, which shows the spy works.
  const url = page.url();
  await page.locator('.Ketcher-root').focus();
  await page.keyboard.press('Alt+Shift+KeyQ');
  await page.keyboard.press('Alt+Shift+KeyR');
  const keys = await page.evaluate(() => (window as unknown as { __keysAtDocument: string[] }).__keysAtDocument);
  expect(keys).toContain('Alt+Shift+KeyQ');
  expect(keys).not.toContain('Alt+Shift+KeyR');
  expect(page.url()).toBe(url);

  await waitForServiceWorker(app);
  // Positive control for the request policy: the requests it judged really happened.
  const [swScript, , indigoWorker, , rdkitWorker] = await Promise.all([
    seen.serviceWorkerScript,
    seen.precacheFetch,
    seen.indigoWorker,
    seen.indigoWasm,
    seen.rdkitWorker,
  ]);
  // Workers get their CSP only from their own response header, never from the page's
  // meta tag: the server (test server or Apache) must send it. Asked of the server
  // directly: the response event for a worker's own script (sw.js, the Indigo worker)
  // can be lost, since the browser fetches it before Playwright attaches to the worker.
  // Fetches made inside a running worker, like the Indigo wasm, are reported reliably.
  // The RDKit worker alone gets more than the page ('unsafe-eval', config/csp.ts).
  for (const request of [swScript, indigoWorker]) {
    const response = await context.request.get(request.url());
    expect(response.headers()['content-security-policy'], request.url()).toBe(cspPolicy());
  }
  const index = await context.request.get(server.url);
  expect(index.headers()['content-security-policy'], 'index.html').toBe(cspPolicy());
  const rdkitPolicy = (await context.request.get(rdkitWorker.url())).headers()['content-security-policy'];
  expect(rdkitPolicy, RDKIT_WORKER_FILE).toBe(cspFor(RDKIT_WORKER_FILE));
  expect(rdkitPolicy).not.toBe(cspPolicy());

  // RDKit.js ships before any code uses it: served as WebAssembly and compilable.
  const rdkit = await fetchAndCompileWasm(page, new URL(RDKIT_WASM_FILE, server.url).href);
  expect(rdkit).toMatchObject({ status: 200, contentType: 'application/wasm' });
  expect(rdkit.exports).toBeGreaterThan(0);

  expect(await installabilityErrors(app)).toEqual([]);
  const manifest = await appManifest(app);
  expect(manifest).toEqual({ scope: server.url, startUrl: server.url, id: server.url });
});

test('offline: after one visit the app loads and works with no network and no server', async ({ app }) => {
  const { context, page, server } = app;
  const butanol = referenceCompound('(R)-2-butanol');
  const molfile = fixture(butanol.files.find((f) => f.endsWith('.mol'))!);
  const rdkitUrl = new URL(RDKIT_WASM_FILE, server.url).href;

  await openEditor(app);
  await waitForServiceWorker(app); // installed = every precache entry fetched and stored

  // Take the server away as well as the network: nothing can come from anywhere but the
  // service worker's cache. (Against a deployed site only the network can be cut.)
  if (server.local) await server.close();
  await context.setOffline(true);
  const networkAfterReload: string[] = [];
  context.on('request', (r) => {
    if (r.serviceWorker()) networkAfterReload.push(`service worker fetched ${r.url()}`);
  });
  context.on('requestfailed', (r) => networkAfterReload.push(`failed ${r.url()}`));
  // Against a deployed site the HTTP cache could answer a request the service worker
  // missed; so every same-origin response from here on must come from the worker.
  const origin = new URL(server.url).origin;
  context.on('response', (r) => {
    if (new URL(r.url()).origin === origin && !r.fromServiceWorker()) {
      networkAfterReload.push(`not from the service worker: ${r.url()}`);
    }
  });
  // Created before the reload so no response can be missed.
  const documentResponse = page.waitForResponse((r) => r.url() === server.url);
  const indigoWasm = context.waitForEvent('response', (r) =>
    /\/assets\/indigo-ketcher-[^/]+\.wasm$/.test(r.url()),
  );

  await page.reload();
  await waitForEditor(app);

  expect((await documentResponse).fromServiceWorker(), 'index.html from the cache').toBe(true);
  expect((await indigoWasm).fromServiceWorker(), 'Indigo wasm from the cache').toBe(true);
  expect(await page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
  // Loaded while offline: the header says so from the start.
  await expect(page.getByTestId('offline-badge')).toHaveText('Offline');

  // Indigo works offline.
  const key = await page.evaluate(async (mol) => {
    await window.ketcher!.setMolecule(mol);
    return window.ketcher!.getInChIKey();
  }, molfile);
  expect(key).toBe(butanol.inchikey);
  // Get name needs the server: greyed, and it says why.
  const getName = page.getByTestId('app-get-name-button');
  await expect(getName).toBeDisabled();
  await expect(getName).toHaveAttribute('title', 'Needs an internet connection');
  const nameBox = page.getByTestId('name-to-structure-input');
  await expect(nameBox).toBeDisabled();
  await expect(nameBox).toHaveAttribute('title', 'Needs an internet connection');

  // RDKit's wasm is served from the cache, as WebAssembly, and compiles.
  const rdkitResponse = page.waitForResponse((r) => r.url() === rdkitUrl);
  const rdkit = await fetchAndCompileWasm(page, rdkitUrl);
  expect(rdkit).toMatchObject({ status: 200, contentType: 'application/wasm' });
  expect((await rdkitResponse).fromServiceWorker(), 'RDKit wasm from the cache').toBe(true);

  expect(networkAfterReload).toEqual([]);
});

test("offline: Ketcher's own dialogs open and save Molfile and CDXML", async ({ app }, testInfo) => {
  const { page } = app;
  const butanol = referenceCompound('(R)-2-butanol');
  const molfile = fixturePath(butanol.files.find((f) => f.endsWith('.mol'))!);
  await goOffline(app);

  // A Molfile written by RDKit opens as the same stereoisomer.
  await clearCanvas(page);
  await openWithDialog(app, molfile);
  expect(await inchiKey(page)).toBe(butanol.inchikey);

  // Save as CDXML, clear, reopen: same structure. (RDKit's own CDXML doesn't load in
  // Indigo 1.46, see BUILD-LEARNINGS.md, so the file comes from Ketcher's Save dialog.)
  const cdxmlPath = testInfo.outputPath('saved.cdxml');
  const cdxml = await saveWithDialog(app, 'CDXML', /<CDXML/, cdxmlPath); // chem-literal-ok: format marker
  expect(cdxml).toContain('<CDXML'); // chem-literal-ok: format marker
  await clearCanvas(page);
  await openWithDialog(app, cdxmlPath);
  expect(await inchiKey(page)).toBe(butanol.inchikey);

  // Save as Molfile, clear, reopen: same structure.
  const molPath = testInfo.outputPath('saved.mol');
  const mol = await saveWithDialog(app, 'MDL Molfile V2000', /V2000/, molPath); // chem-literal-ok: format marker
  expect(mol).toMatch(/V2000[\s\S]*M {2}END/); // chem-literal-ok: format marker
  await clearCanvas(page);
  await openWithDialog(app, molPath);
  expect(await inchiKey(page)).toBe(butanol.inchikey);
});
