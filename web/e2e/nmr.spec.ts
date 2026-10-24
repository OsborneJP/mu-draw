// ¹³C NMR preview (spec "NMR prediction proof of concept"), in the built app with the real
// CSP: a second RDKit worker predicts from the precached table. The panel must show exactly
// what the same prediction code gives here in Node (web/scripts/nmr.test.ts checks those
// predictions against measured spectra), and the highlighting must work both ways.
import type initRDKit from '@rdkit/rdkit';
import type { Page, Route } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { decodeTable, type CarbonTable } from '../src/chem/carbonTable.ts';
import { predictCarbon } from '../src/chem/nmr.ts';
import { CARBON_TABLE_FILE, CARBON_TABLE_LICENCE_FILE } from '../src/chem/rdkitFiles.ts';
import { BANNER, carbonType, PEAK_COLOR } from '../src/panels/nmr.ts';
import {
  clearCanvas,
  expect,
  fixture,
  highlights,
  holdableRdkitReplies,
  openEditor,
  test,
  type App,
  waitForEditor,
  waitForServiceWorker,
} from './fixtures.ts';

type RDKit = Awaited<ReturnType<typeof initRDKit>>;

interface Compound {
  typed_name: string;
  heavy_atoms: number;
  file: string;
}

const COMPOUNDS = (JSON.parse(fixture('nmr/compounds.json')) as { compounds: Compound[] }).compounds;
const compound = (name: string) => COMPOUNDS.find((c) => c.typed_name === name)!;
const molfile = (name: string) => fixture(compound(name).file);

let rdkit: RDKit;
let table: CarbonTable;

test.beforeAll(async () => {
  const require = createRequire(import.meta.url);
  rdkit = await (require('@rdkit/rdkit') as typeof initRDKit)();
  rdkit.use_legacy_stereo_perception(false); // as src/chem/compute.ts configureRdkit
  const bytes = readFileSync(new URL(`../public/${CARBON_TABLE_FILE}`, import.meta.url));
  table = decodeTable(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
});

/** The table the panel must show for a fixture loaded in Molfile order (Ketcher ids equal
 * Molfile indices; loadInOrder checks). */
function expectedRows(name: string) {
  return predictCarbon(rdkit, molfile(name), table)!.map((p) => ({
    shift: p.shift === null ? '' : String(p.shift),
    type: carbonType(p.hydrogens),
    count: String(p.atoms.length),
    low: String(p.shift !== null && p.sphere <= 2),
    atoms: [...p.atoms].sort((a, b) => a - b),
  }));
}

async function loadInOrder(page: Page, name: string): Promise<void> {
  await page.evaluate((s) => window.ketcher!.setMolecule(s), molfile(name));
  const ids = await page.evaluate(() => [...window.ketcher!.editor.struct().atoms.keys()]);
  expect(ids).toEqual(ids.map((_, i) => i));
  await expect(page.getByTestId('properties-panel')).toHaveAttribute('data-atoms', String(compound(name).heavy_atoms));
  await expect(page.getByTestId('properties-panel')).toHaveAttribute('data-state', 'ready');
}

/** The rows as the panel shows them, each with its carbons (from the highlight it makes
 * is checked separately). */
function rows(page: Page) {
  return page.getByTestId('nmr-peak').evaluateAll((trs) =>
    trs.map((tr) => ({
      shift: tr.getAttribute('data-shift'),
      type: tr.getAttribute('data-type'),
      count: tr.getAttribute('data-count'),
      low: tr.getAttribute('data-low'),
      note: tr.querySelector('.nmr-note')?.textContent ?? '',
    })),
  );
}

async function predict(page: Page): Promise<void> {
  await page.getByTestId('nmr-predict').click();
  const panel = page.getByTestId('nmr-panel');
  await expect(panel).toHaveAttribute('data-state', 'ready');
  // The canvas view has made up for the height the panel takes (NmrPanel's Docked).
  await expect(panel).toHaveAttribute('data-docked', String(await panel.evaluate((e) => (e as HTMLElement).offsetHeight)));
}

/** Counts change events and reads the undo history size, to show highlighting is no edit. */
async function editCounter(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __changes: number };
    w.__changes = 0;
    window.ketcher!.changeEvent.add(() => (w.__changes += 1));
  });
  return () =>
    page.evaluate(() => [
      (window as unknown as { __changes: number }).__changes,
      (window.ketcher!.editor as unknown as { historySize(): unknown }).historySize(),
    ]);
}

const peakColour = (atoms: number[]) => [{ color: PEAK_COLOR, atoms, bonds: [] as number[] }];

/** Where Ketcher draws an atom on the page: its page-to-model transform is linear, so
 * three points give its inverse. */
function atomOnPage(page: Page, id: number): Promise<{ x: number; y: number }> {
  return page.evaluate((atom) => {
    const editor = window.ketcher!.editor as unknown as {
      render: { page2obj(e: { clientX: number; clientY: number }): { x: number; y: number } };
      struct(): { atoms: Map<number, { pp: { x: number; y: number } }> };
    };
    const at = (clientX: number, clientY: number) => editor.render.page2obj({ clientX, clientY });
    const o = at(0, 0);
    const ex = at(100, 0);
    const ey = at(0, 100);
    const [a, b, c, d] = [(ex.x - o.x) / 100, (ey.x - o.x) / 100, (ex.y - o.y) / 100, (ey.y - o.y) / 100];
    const { pp } = editor.struct().atoms.get(atom)!;
    const det = a * d - b * c;
    const [dx, dy] = [pp.x - o.x, pp.y - o.y];
    return { x: (d * dx - b * dy) / det, y: (a * dy - c * dx) / det };
  }, id);
}

/** What the student would hit at an atom's place: Ketcher's canvas, or something over it. */
function hitAt(page: Page, point: { x: number; y: number }) {
  return page.evaluate(({ x, y }) => {
    const hit = document.elementFromPoint(x, y);
    return hit?.closest('[data-testid="ketcher-canvas"]') ? 'canvas' : (hit?.outerHTML.slice(0, 80) ?? 'nothing');
  }, point);
}

async function clickAtom(page: Page, id: number): Promise<void> {
  const point = await atomOnPage(page, id);
  expect(await hitAt(page, point), `atom ${id} is on the open canvas`).toBe('canvas');
  await page.mouse.click(point.x, point.y);
}

test('every test compound: the predicted peaks, with the banner and the licence notice', async ({ app }) => {
  const { page } = app;
  await openEditor(app);
  for (const { typed_name: name } of COMPOUNDS) {
    await clearCanvas(page);
    await expect(page.getByTestId('properties-panel')).toHaveAttribute('data-state', 'empty');
    await loadInOrder(page, name);
    await predict(page);
    const expected = expectedRows(name);
    expect(await rows(page), name).toEqual(
      expected.map(({ shift, type, count, low }) => ({
        shift,
        type,
        count,
        low,
        note: shift === '' ? 'no match' : low === 'true' ? 'low confidence' : '',
      })),
    );
    await expect(page.getByTestId('nmr-stick')).toHaveCount(expected.filter((r) => r.shift !== '').length);
    await expect(page.getByTestId('nmr-banner')).toHaveText(BANNER);
    await expect(page.getByTestId('nmr-notice')).toContainText(
      'Contains information from nmrshiftdb2 (www.nmrshiftdb.org), which is made available here under the nmrshiftdb2 Database License',
    );
  }
  // Some predictions in the set are low confidence, so that marking is exercised.
  expect(COMPOUNDS.some((c) => expectedRows(c.typed_name).some((r) => r.low === 'true'))).toBe(true);
  // The notice's licence link stays in the app, and the licence is there.
  const link = page.getByTestId('nmr-notice').getByRole('link');
  expect(await link.evaluate((a) => (a as HTMLAnchorElement).href)).toBe(new URL(CARBON_TABLE_LICENCE_FILE, app.server.url).href);
  const licence = await page.evaluate(async (href) => (await fetch(href)).text(), CARBON_TABLE_LICENCE_FILE);
  expect(licence).toContain('nmrshiftdb2 Database License');
});

test('a peak colours its carbons, a carbon selects its peak, and a change takes the colour away', async ({ app }) => {
  const { page } = app;
  await openEditor(app);
  const name = 'toluene';
  await loadInOrder(page, name);
  await predict(page);
  // The panel below the canvas leaves the whole drawing in view, clear of Ketcher's bars.
  for (let atom = 0; atom < compound(name).heavy_atoms; atom += 1) {
    expect(await hitAt(page, await atomOnPage(page, atom)), `atom ${atom}`).toBe('canvas');
  }
  const expected = expectedRows(name);
  const edits = await editCounter(page);
  const before = await edits();
  const row = (i: number) => page.getByTestId('nmr-peak').nth(i);
  const stick = (i: number) => page.locator(`[data-testid="nmr-stick"][data-index="${i}"]`);

  // A row: its carbons (two equivalent ones here) are coloured; again: no longer.
  const pair = expected.findIndex((r) => r.count === '2');
  await row(pair).click();
  await expect(row(pair)).toHaveAttribute('aria-selected', 'true');
  await expect(stick(pair)).toHaveAttribute('data-selected', 'true');
  expect(await highlights(page)).toEqual(peakColour(expected[pair].atoms));
  await row(pair).click();
  await expect(row(pair)).toHaveAttribute('aria-selected', 'false');
  expect(await highlights(page)).toEqual([]);

  // A stick, then another: one peak's colour at a time. (Sticks within about a ppm of each
  // other overlap at this scale, so these two are ones with none close by; the table
  // selects any peak.)
  const methyl = expected.findIndex((r) => r.type === 'CH₃');
  await stick(0).click();
  await expect(stick(0)).toHaveAttribute('data-selected', 'true');
  expect(await highlights(page)).toEqual(peakColour(expected[0].atoms));
  await stick(methyl).click();
  await expect(row(methyl)).toHaveAttribute('aria-selected', 'true');
  expect(await highlights(page)).toEqual(peakColour(expected[methyl].atoms));
  expect(await edits()).toEqual(before); // colouring is no edit

  // A carbon on the canvas (the second of two equivalent ones): its peak is selected and
  // both its carbons coloured.
  await clickAtom(page, expected[pair].atoms[1]);
  await expect(row(pair)).toHaveAttribute('aria-selected', 'true');
  expect(await highlights(page)).toEqual(peakColour(expected[pair].atoms));
  expect((await edits())[0]).toBe(0);

  // Any change: the prediction is out of date and its colour goes at once.
  await page.evaluate((s) => window.ketcher!.setMolecule(s), molfile('anisole'));
  await expect(page.getByTestId('nmr-panel')).toHaveAttribute('data-state', 'stale');
  expect(await highlights(page)).toEqual([]);
  await page.getByTestId('nmr-again').click();
  await expect(page.getByTestId('nmr-panel')).toHaveAttribute('data-state', 'ready');
  await expect(page.getByTestId('nmr-peak')).toHaveCount(expectedRows('anisole').length);

  // Closing removes the panel and any colour.
  await page.getByTestId('nmr-peak').first().click();
  expect((await highlights(page)).length).toBe(1);
  await page.getByTestId('nmr-close').click();
  await expect(page.getByTestId('nmr-panel')).toHaveCount(0);
  expect(await highlights(page)).toEqual([]);
});

test("peaks land on the right carbons when Ketcher's atom ids are out of order", async ({ app }) => {
  const { page } = app;
  await openEditor(app);
  const name = 'toluene';
  await loadInOrder(page, name);
  const expected = expectedRows(name);
  const methyl = expected.find((r) => r.type === 'CH₃')!.atoms[0];
  // Delete the methyl and undo: Ketcher restores it under its old id, last in its list.
  await page.evaluate((id) => window.ketcher!.editor.selection({ atoms: [id] }), methyl);
  await page.locator('.Ketcher-root').focus();
  await page.keyboard.press('Delete');
  await expect(page.getByTestId('properties-panel')).toHaveAttribute('data-atoms', String(compound(name).heavy_atoms - 1));
  await expect(page.getByTestId('undo').filter({ visible: true })).toBeEnabled();
  await page.keyboard.press('Control+z');
  await expect(page.getByTestId('properties-panel')).toHaveAttribute('data-atoms', String(compound(name).heavy_atoms));
  await expect(page.getByTestId('properties-panel')).toHaveAttribute('data-state', 'ready');
  const ids = await page.evaluate(() => [...window.ketcher!.editor.struct().atoms.keys()]);
  expect(ids[ids.length - 1]).toBe(methyl);
  await predict(page);
  await page.locator('[data-testid="nmr-peak"][data-type="CH₃"]').click();
  expect(await highlights(page)).toEqual(peakColour([methyl]));
});

test('a prediction for a drawing that has since changed is never shown', async ({ app }) => {
  const { context, page } = app;
  await context.addInitScript(holdableRdkitReplies);
  await openEditor(app);
  await loadInOrder(page, 'acetophenone');
  // Every state the NMR panel shows from here on.
  await page.evaluate(() => {
    const now = () => document.querySelector('[data-testid="nmr-panel"]')?.getAttribute('data-state') ?? 'closed';
    const seen: string[] = [now()];
    Object.assign(window, { __nmrStates: seen });
    new MutationObserver(() => {
      if (seen[seen.length - 1] !== now()) seen.push(now());
    }).observe(document.body, { subtree: true, childList: true, attributes: true });
  });
  // The NMR worker starts on the first prediction; hold its answers from then on.
  await page.evaluate(() => (window as unknown as { __holdRdkit(name: string): void }).__holdRdkit('rdkit-nmr'));
  await page.getByTestId('nmr-predict').click();
  await expect(page.getByTestId('nmr-panel')).toHaveAttribute('data-state', 'predicting');
  await loadInOrder(page, 'benzaldehyde');
  await expect(page.getByTestId('nmr-panel')).toHaveAttribute('data-state', 'stale');
  // Acetophenone's answer has come and is held: it arrives only after the change.
  const held = () => page.evaluate(() => (window as unknown as { __heldRdkit(name: string): number }).__heldRdkit('rdkit-nmr'));
  await expect.poll(held).toBe(1);
  await page.evaluate(() => (window as unknown as { __releaseRdkit(name: string): void }).__releaseRdkit('rdkit-nmr'));
  expect(await held()).toBe(0);
  // Released, it was dropped: the panel still asks to predict again.
  await expect(page.getByTestId('nmr-panel')).toHaveAttribute('data-state', 'stale');
  await page.getByTestId('nmr-again').click();
  await expect(page.getByTestId('nmr-panel')).toHaveAttribute('data-state', 'ready');
  expect((await rows(page)).map((r) => r.shift)).toEqual(expectedRows('benzaldehyde').map((r) => r.shift));
  expect(await page.evaluate(() => (window as unknown as { __nmrStates: string[] }).__nmrStates)).toEqual([
    'closed',
    'predicting',
    'stale',
    'predicting',
    'ready',
  ]);
});

test('a 30-heavy-atom molecule is predicted in under 2 seconds, the first time and again', async ({ app }) => {
  const { page } = app;
  await openEditor(app);
  const name = 'squalene';
  expect(compound(name).heavy_atoms).toBe(30);
  await loadInOrder(page, name);
  for (const time of ['first (worker start and table load included)', 'again']) {
    const started = Date.now();
    await predict(page);
    expect(Date.now() - started, time).toBeLessThan(2000);
    await page.getByTestId('nmr-close').click();
  }
});

test('the TMS line can be switched off', async ({ app }) => {
  const { page } = app;
  await openEditor(app);
  await loadInOrder(page, 'ethyl acetate');
  await predict(page);
  await expect(page.getByTestId('nmr-tms')).toHaveCount(1);
  await page.getByTestId('nmr-tms-toggle').uncheck();
  await expect(page.getByTestId('nmr-tms')).toHaveCount(0);
});

test('offline: after one visit the prediction works with no network and no server', async ({ app }) => {
  const { context, page, server } = app;
  await openEditor(app);
  await waitForServiceWorker(app);
  if (server.local) await server.close();
  await context.setOffline(true);
  const notFromCache: string[] = [];
  const origin = new URL(server.url).origin;
  context.on('response', (r) => {
    if (new URL(r.url()).origin === origin && !r.fromServiceWorker()) notFromCache.push(r.url());
  });
  context.on('requestfailed', (r) => notFromCache.push(`failed ${r.url()}`));
  await page.reload();
  await waitForEditor(app);
  const name = 'ibuprofen';
  await loadInOrder(page, name);
  // The NMR worker fetches the table on its first prediction.
  const tableFile = context.waitForEvent('response', (r) => r.url().endsWith(`/${CARBON_TABLE_FILE}`));
  await predict(page);
  expect((await rows(page)).map((r) => r.shift)).toEqual(expectedRows(name).map((r) => r.shift));
  expect((await tableFile).fromServiceWorker(), 'the table from the cache').toBe(true);
  expect(notFromCache).toEqual([]);
});

/** The guards' reports of problems this test causes on purpose, then forget them. */
async function expectProblems(app: App, expected: string[]): Promise<void> {
  await expect.poll(() => app.problems).toEqual(expected);
  app.problems.length = 0;
}

test('a table the server cannot find: the panel says so, and the properties carry on', async ({ app }) => {
  const { context, page, server } = app;
  test.skip(!server.local, 'changes what the server sends');
  // Missing for the service worker's precache too, so it never takes over and the NMR
  // worker asks the server (a worker started under an active service worker is served from
  // the precache). The service worker's request is held until the editor is up, so its 404
  // (which the guards report) can't fail the start.
  const precache = new Promise<Route>((resolve) => {
    void context.route(`**/${CARBON_TABLE_FILE}`, (route: Route) =>
      route.request().serviceWorker() ? resolve(route) : route.fulfill({ status: 404, body: 'Not Found' }),
    );
  });
  await openEditor(app);
  await (await precache).fulfill({ status: 404, body: 'Not Found' });
  await loadInOrder(page, 'toluene');
  await page.getByTestId('nmr-predict').click();
  await expect(page.getByTestId('nmr-message')).toHaveText(
    `The ¹³C NMR preview is unavailable: ${CARBON_TABLE_FILE} could not be loaded (Error: HTTP 404).`,
  );
  await expect(page.getByTestId('prop-formula')).toHaveCount(1);
  const missing = `HTTP 404: ${server.url}${CARBON_TABLE_FILE}`;
  await expectProblems(app, [missing, missing]); // the service worker's request, then the NMR worker's
});

test.describe('a damaged table', () => {
  // A deployed site can't serve an edited copy of the build; skip before the copy is made.
  test.skip(Boolean(process.env.SMOKE_URL), 'needs a server the test owns, to serve an edited copy of the build');
  test.use({ buildCopy: true });

  test('one that is not a table: the panel says so', async ({ app }) => {
    writeFileSync(join(app.server.copy!, CARBON_TABLE_FILE), '<!doctype html><title>Not Found</title>');
    const { page } = app;
    await openEditor(app);
    await loadInOrder(page, 'toluene');
    await page.getByTestId('nmr-predict').click();
    await expect(page.getByTestId('nmr-message')).toHaveText(
      `The ¹³C NMR preview is unavailable: ${CARBON_TABLE_FILE} could not be loaded (Error: not a ¹³C shift table).`,
    );
  });
});
