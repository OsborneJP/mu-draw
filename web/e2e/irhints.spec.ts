// IR hints (docs/plans/v2-ir-hints.md, bar B), in the built app with the real CSP: the
// page reads the shipped web/public/ir-bands.json and lists the bands for the groups the
// highlighter finds. Every value the tests expect is read from that file here (invariant
// 3); the molecules are the highlighter's test set (structures from PubChem).
import type { Page, Route } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { IR_BANDS_FILE } from '../src/chem/irBands.ts';
import {
  clearCanvas,
  expect,
  fixture,
  holdableRdkitReplies,
  openEditor,
  test,
  type App,
  waitForEditor,
  waitForServiceWorker,
} from './fixtures.ts';

interface FileBand {
  range: [number, number];
  diagnostic: boolean;
  verify: boolean;
  sources: string[];
}
interface TableFile {
  title: string;
  version: string;
  compiled_by: string;
  license: string;
  attribution: { key: string; text: string; url: string | null }[];
  regions: { range: [number, number]; sources: string[] }[];
  groups: Record<string, { note?: string | null; bands: FileBand[] }>;
}

const TABLE_TEXT = readFileSync(new URL(`../public/${IR_BANDS_FILE}`, import.meta.url), 'utf8');
const TABLE = JSON.parse(TABLE_TEXT) as TableFile;
const COMPOUNDS = (
  JSON.parse(fixture('functional_groups/compounds.json')) as { compounds: { typed_name: string; heavy_atoms: number; file: string }[] }
).compounds;

function compound(name: string) {
  const found = COMPOUNDS.find((c) => c.typed_name === name);
  if (!found) throw new Error(`${name} is not in functional_groups/compounds.json`);
  return found;
}

async function load(page: Page, name: string): Promise<void> {
  await page.evaluate((s) => window.ketcher!.setMolecule(s), fixture(compound(name).file));
}

/** The panel's values describe this molecule, as the drawing is now. */
async function expectReady(page: Page, name: string): Promise<void> {
  const panel = page.getByTestId('properties-panel');
  await expect(panel).toHaveAttribute('data-atoms', String(compound(name).heavy_atoms));
  await expect(panel).toHaveAttribute('data-state', 'ready');
}

/** Draw a molecule of the test set and wait until the panel describes it. */
async function draw(page: Page, name: string): Promise<void> {
  await load(page, name);
  await expectReady(page, name);
}

async function showHints(page: Page): Promise<void> {
  const toggle = page.getByTestId('ir-toggle');
  await toggle.check();
  await expect(toggle).toBeChecked();
}

/** The entries shown, by table key, in order. */
function entries(page: Page) {
  return page.getByTestId('ir-entry').evaluateAll((items) => items.map((li) => li.getAttribute('data-key')));
}

async function expectEntries(page: Page, keys: string[]): Promise<void> {
  await expect(page.getByTestId('ir-hints')).toHaveAttribute('data-state', 'ready');
  await expect.poll(() => entries(page)).toEqual(keys);
}

/** Each entry's bands as shown: [low, high, diagnostic, bold]. */
function shownBands(page: Page, key: string) {
  return page
    .locator(`[data-testid="ir-entry"][data-key="${key}"] [data-testid="ir-band"]`)
    .evaluateAll((items) =>
      items.map((li) => [
        Number(li.getAttribute('data-low')),
        Number(li.getAttribute('data-high')),
        li.getAttribute('data-diagnostic') === 'true',
        Number(getComputedStyle(li.querySelector('.ir-range')!).fontWeight) >= 700,
      ]),
    );
}

/** What the file says an entry shows: its bands not marked verify, bold if diagnostic. */
function fileBands(file: TableFile, key: string) {
  return file.groups[key].bands.filter((b) => !b.verify).map((b) => [b.range[0], b.range[1], b.diagnostic, b.diagnostic]);
}

/** Every entry shown has exactly the file's bands, and the "still being checked" line
 * exactly when the file marks one of its bands verify. */
async function expectBandsFromFile(page: Page, file: TableFile = TABLE): Promise<void> {
  await expect(page.locator('[data-testid="ir-band"][data-verify="true"]')).toHaveCount(0);
  for (const key of await entries(page)) {
    expect(await shownBands(page, key!), key!).toEqual(fileBands(file, key!));
    const checking = page.locator(`[data-testid="ir-entry"][data-key="${key}"] [data-testid="ir-checking"]`);
    await expect(checking).toHaveCount(file.groups[key!].bands.some((b) => b.verify) ? 1 : 0);
  }
}

test('the hints show only when ticked, wait for the table, and are for the drawing as it is then', async ({ app }) => {
  const { context, page } = app;
  // The page's request for the table is held; the service worker's precache copy is not.
  // On the first visit the page has no service worker in charge, so it asks the server.
  const asked = new Promise<Route>((resolve) => {
    void context.route(`**/${IR_BANDS_FILE}`, (route) => (route.request().serviceWorker() ? route.continue() : resolve(route)));
  });
  await openEditor(app);
  await draw(page, 'ethyl acetate');
  await expect(page.getByTestId('ir-toggle')).not.toBeChecked();
  await expect(page.getByTestId('ir-hints')).toHaveCount(0);
  await showHints(page);
  await expect(page.getByTestId('ir-hints')).toHaveAttribute('data-state', 'loading');
  await expect(page.getByTestId('ir-message')).toHaveText('Loading IR hints…');
  // The drawing changes before the table arrives: the hints are for the new drawing.
  await draw(page, 'acetophenone');
  await (await asked).continue();
  await expectEntries(page, ['ketone', 'arene', 'alkane']);
  await expectBandsFromFile(page);
  // Unticked: none of it.
  await page.getByTestId('ir-toggle').uncheck();
  await expect(page.getByTestId('ir-hints')).toHaveCount(0);
  // It stays ticked while the panel shows a message instead of the section.
  await showHints(page);
  await clearCanvas(page);
  await expect(page.getByTestId('properties-panel')).toHaveAttribute('data-state', 'empty');
  await expect(page.getByTestId('ir-hints')).toHaveCount(0);
  await draw(page, 'ethyl acetate');
  await expect(page.getByTestId('ir-toggle')).toBeChecked();
  await expectEntries(page, ['ester', 'alkane']);
});

test('shared and also_show entries are shown once, in order, with the bands and notes of the file', async ({ app }) => {
  const { page } = app;
  await openEditor(app);
  await draw(page, '4-hydroxybenzyl alcohol');
  await showHints(page);
  // Arene once, although phenol asks for it too (also_show); the alcohol O–H after the alcohol.
  await expectEntries(page, ['phenol', 'alcohol_primary', 'alcohol_oh', 'arene', 'alkane']);
  await expectBandsFromFile(page);
  // Two classes of alcohol share one O–H entry, after the first.
  await draw(page, 'glycerol');
  await expectEntries(page, ['alcohol_primary', 'alcohol_oh', 'alcohol_secondary', 'alkane']);
  await expectBandsFromFile(page);
  // Two classes of amine share one C–N entry; the 3° amine has a note and no bands.
  await draw(page, 'procaine');
  await expectEntries(page, ['ester', 'amine_primary', 'amine_cn', 'amine_tertiary', 'arene', 'alkane']);
  await expectBandsFromFile(page);
  const tertiary = page.locator('[data-testid="ir-entry"][data-key="amine_tertiary"]');
  await expect(tertiary.getByTestId('ir-group-note')).toHaveText(TABLE.groups.amine_tertiary.note!);
  await expect(tertiary.getByTestId('ir-band')).toHaveCount(0);
});

test('bands marked verify are not shown, and the credit names what the shown bands cite, in plain text', async ({ app }) => {
  const { page } = app;
  await openEditor(app);
  await draw(page, 'paracetamol');
  await showHints(page);
  await expectEntries(page, ['amide', 'phenol', 'arene', 'alkane']);
  await expectBandsFromFile(page);

  const credit = page.getByTestId('ir-credit');
  await expect(credit).toContainText(`${TABLE.title}, version ${TABLE.version}, compiled by ${TABLE.compiled_by}.`);
  await expect(credit).toContainText(`${TABLE.license} (https://creativecommons.org/licenses/by-sa/4.0/)`);
  const keys = await entries(page);
  const cited = new Set(TABLE.regions.flatMap((r) => r.sources));
  for (const key of keys) for (const b of TABLE.groups[key!].bands) if (!b.verify) b.sources.forEach((s) => cited.add(s));
  const expected = TABLE.attribution.filter((a) => cited.has(a.key));
  await expect(credit.getByTestId('ir-attribution')).toHaveText(
    expected.map((a) => `${a.text}${a.url ? ` (${a.url})` : ''}.`),
  );
  await expect(page.getByTestId('ir-hints').locator('a')).toHaveCount(0);
  // The regions are there, closed until opened.
  const regions = page.getByTestId('ir-regions');
  await expect(regions.getByTestId('ir-region').first()).toBeHidden();
  await regions.locator('summary').click();
  expect(
    await regions.getByTestId('ir-region').evaluateAll((items) =>
      items.map((li) => [Number(li.getAttribute('data-low')), Number(li.getAttribute('data-high'))]),
    ),
  ).toEqual(TABLE.regions.map((r) => r.range));
});

test('the hints follow the drawing: while RDKit works on a change they stay those of the list above', async ({ app }) => {
  const { context, page } = app;
  await context.addInitScript(holdableRdkitReplies);
  await openEditor(app);
  await draw(page, 'benzonitrile');
  await showHints(page);
  await expectEntries(page, ['nitrile', 'arene', 'alkane']);
  await page.evaluate(() => (window as unknown as { __holdRdkit(): void }).__holdRdkit());
  await load(page, 'benzoyl chloride');
  await expect(page.getByTestId('properties-panel')).toHaveAttribute('data-state', 'updating');
  expect(await entries(page)).toEqual(['nitrile', 'arene', 'alkane']);
  await page.evaluate(() => (window as unknown as { __releaseRdkit(): void }).__releaseRdkit());
  await expectReady(page, 'benzoyl chloride');
  await expectEntries(page, ['acid_chloride', 'arene', 'alkane']);
  await expectBandsFromFile(page);
});

test('offline: after one visit the hints work with no network and no server', async ({ app }) => {
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
  const tableFile = page.waitForResponse((r) => r.url().endsWith(`/${IR_BANDS_FILE}`));
  await draw(page, 'cinnamaldehyde');
  await showHints(page);
  await expectEntries(page, ['aldehyde', 'alkene', 'arene', 'alkane']);
  await expectBandsFromFile(page);
  expect((await tableFile).fromServiceWorker(), 'table from the cache').toBe(true);
  expect(notFromCache).toEqual([]);
});

/** The guards' reports of problems this test causes on purpose, then forget them. */
async function expectProblems(app: App, expected: string[]): Promise<void> {
  await expect.poll(() => app.problems).toEqual(expected);
  app.problems.length = 0;
}

test('a table the server cannot find: the section says so; the groups and properties still show', async ({ app }) => {
  const { context, page, server } = app;
  test.skip(!server.local, 'changes what the server sends');
  // Both requests are held, so the 404s (which the guards report) come when the test says;
  // holding the precache request also keeps the service worker from taking over.
  let pageAsked: (route: Route) => void = () => {};
  const asked = new Promise<Route>((resolve) => (pageAsked = resolve));
  const precache = new Promise<Route>((resolve) => {
    void context.route(`**/${IR_BANDS_FILE}`, (route) => (route.request().serviceWorker() ? resolve(route) : pageAsked(route)));
  });
  await openEditor(app);
  await draw(page, 'aspirin');
  await showHints(page);
  await (await asked).fulfill({ status: 404, body: 'Not Found' });
  await (await precache).fulfill({ status: 404, body: 'Not Found' });
  await expect(page.getByTestId('ir-message')).toHaveText(
    `IR hints are unavailable: ${IR_BANDS_FILE} could not be loaded (Error: HTTP 404).`,
  );
  await page.getByTestId('groups-toggle').check();
  await expect(page.getByTestId('group')).not.toHaveCount(0);
  await expect(page.getByTestId('prop-formula')).toHaveCount(1);
  const missing = `HTTP 404: ${server.url}${IR_BANDS_FILE}`;
  await expectProblems(app, [missing, missing]); // the page's request, then the service worker's
});

test.describe('a table that is changed or broken', () => {
  // Each test serves its own copy of the build and edits the table in it, as a person
  // editing the file would. A deployed site can't serve a copy, so these skip there.
  test.skip(Boolean(process.env.SMOKE_URL), 'needs a server the test owns, to serve an edited copy of the build');
  test.use({ buildCopy: true });

  const publishTable = (app: App, text: string) => writeFileSync(join(app.server.copy!, IR_BANDS_FILE), text);

  test('a band newly marked verify is hidden, and only that band (the guard is not vacuous)', async ({ app }) => {
    const file = JSON.parse(TABLE_TEXT) as TableFile;
    const phenol = file.groups.phenol.bands;
    expect(phenol.filter((b) => !b.verify).length).toBeGreaterThan(1);
    phenol.find((b) => !b.verify)!.verify = true;
    publishTable(app, JSON.stringify(file));
    const { page } = app;
    await openEditor(app);
    await draw(page, 'methylparaben');
    await showHints(page);
    await expectEntries(page, ['ester', 'phenol', 'arene', 'alkane']);
    await expectBandsFromFile(page, file);
    expect(await shownBands(page, 'phenol')).toEqual(fileBands(TABLE, 'phenol').slice(1));
  });

  test('a broken band is skipped and named; the rest of its group and the others still show', async ({ app }) => {
    const file = JSON.parse(TABLE_TEXT) as TableFile;
    const [low, high] = file.groups.ester.bands[0].range;
    file.groups.ester.bands[0].range = [high, low - 1];
    publishTable(app, JSON.stringify(file));
    const { page } = app;
    await openEditor(app);
    await draw(page, 'ethyl acetate');
    await showHints(page);
    await expectEntries(page, ['ester', 'alkane']);
    await expect(page.getByTestId('ir-problems')).toHaveText(
      `Skipped in ${IR_BANDS_FILE}:"ester" band 1: its range is not [low, high] with low ≤ high`,
    );
    expect(await shownBands(page, 'ester')).toEqual(fileBands(TABLE, 'ester').slice(1));
  });

  test('a table that is not JSON: the section says so; the groups and properties still show', async ({ app }) => {
    publishTable(app, TABLE_TEXT.replace(/\}\s*$/, ',}'));
    const { page } = app;
    await openEditor(app);
    await draw(page, 'aspirin');
    await showHints(page);
    await expect(page.getByTestId('ir-message')).toHaveText(
      new RegExp(`^IR hints are unavailable: ${IR_BANDS_FILE.replace('.', '\\.')} could not be loaded \\(SyntaxError: .+\\)\\.$`),
    );
    await page.getByTestId('groups-toggle').check();
    await expect(page.getByTestId('group')).not.toHaveCount(0);
    await expect(page.getByTestId('prop-formula')).toHaveCount(1);
  });

  test('a table with the wrong licence is not shown, and says why', async ({ app }) => {
    publishTable(app, JSON.stringify({ ...TABLE, license: 'CC BY-NC-SA 4.0' }));
    const { page } = app;
    await openEditor(app);
    await draw(page, 'aspirin');
    await showHints(page);
    await expect(page.getByTestId('ir-message')).toHaveText(
      `IR hints are unavailable: ${IR_BANDS_FILE} can't be used: its licence is not "CC BY-SA 4.0".`,
    );
    await expect(page.getByTestId('ir-entry')).toHaveCount(0);
  });
});
