// Get name (spec "5. Get name"). The API's answers are held until the test releases them, so
// every ordering is forced, and they are what the server answered for recorded PubChem
// replies (tests/fixtures/name_responses.json), so no test here reaches PubChem, except the
// live-only one at the end, which runs against the deployed API.
import type { Page, Request, Route } from '@playwright/test';
import type initRDKit from '@rdkit/rdkit';
import { createRequire } from 'node:module';
import { resolveBase } from '../config/app.ts';
import { autosaveKey } from '../src/editor/autosave.ts';
import {
  clearCanvas,
  expect,
  fixture,
  nameResponse,
  nextAutosave,
  openEditor,
  test,
  type App,
  type NameResponse,
} from './fixtures.ts';

type RDKit = Awaited<ReturnType<typeof initRDKit>>;

const NOT_FOUND = 'PubChem has no record of this exact structure, so no name is available.';
const NOT_RESPONDING = "The naming service isn't responding. Your drawing is safe; try again in a minute.";
const BUSY = 'Busy, try again shortly.';
const INVALID = "This structure can't be looked up. Check it for errors such as a wrong valence.";
const REACTION = 'Get name works on structures, not reactions.';
const OFFLINE = 'Needs an internet connection';
const EMPTY = 'Draw a structure to name it';

interface TestCompound {
  name: string;
  smiles: string;
  canonical_smiles: string;
  files: string[];
}

/** The reference compounds (at least the spec's 20) and the 3 invented structures. */
function testCompounds(): TestCompound[] {
  const data = JSON.parse(fixture('reference_expected.json')) as {
    compounds: (Omit<TestCompound, 'name'> & { typed_name: string })[];
    invented: TestCompound[];
  };
  return [...data.compounds.map((c) => ({ ...c, name: c.typed_name })), ...data.invented];
}

function compound(name: string): TestCompound {
  const found = testCompounds().find((c) => c.name === name);
  if (!found) throw new Error(`${name} is not a test compound`);
  return found;
}

async function load(page: Page, name: string): Promise<void> {
  const molfile = fixture(compound(name).files.find((f) => f.endsWith('.mol'))!);
  await page.evaluate((mol) => window.ketcher!.setMolecule(mol), molfile);
}

/** Wait for `step`, but fail at once if a guard trips first. */
function guarded<T>(app: App, step: Promise<T>): Promise<T> {
  return Promise.race([step, app.failed]);
}

/** The guards' reports of problems this test causes on purpose, then forget them. Call it
 * last: the first problem also fails every later guarded() wait. */
async function expectProblems(app: App, expected: string[]): Promise<void> {
  await expect.poll(() => app.problems).toEqual(expected);
  app.problems.length = 0;
}

interface Held {
  smiles: string;
  request: Request;
  route: Route;
  answer(body: unknown, status?: number): Promise<void>;
}

/** Hold every Get name request until the test answers it; next() gives them in order. */
async function holdNames(page: Page) {
  const ready: Held[] = [];
  const waiting: ((held: Held) => void)[] = [];
  let count = 0;
  await page.route('**/api/name', (route) => {
    count += 1;
    const held: Held = {
      smiles: (JSON.parse(route.request().postData()!) as { smiles: string }).smiles,
      request: route.request(),
      route,
      answer: (body, status = 200) => route.fulfill({ status, json: body }),
    };
    const waiter = waiting.shift();
    if (waiter) waiter(held);
    else ready.push(held);
  });
  return {
    next: () => (ready.length ? Promise.resolve(ready.shift()!) : new Promise<Held>((r) => waiting.push(r))),
    count: () => count,
  };
}

function ui(page: Page) {
  return {
    button: page.getByTestId('app-get-name-button'),
    panel: page.getByTestId('name-panel'),
    message: page.getByTestId('name-message'),
  };
}

/** Load a compound and ask for its name; returns the held request. */
async function ask(app: App, names: Awaited<ReturnType<typeof holdNames>>, name: string): Promise<Held> {
  const { button, panel } = ui(app.page);
  await load(app.page, name);
  await expect(panel).toHaveCount(0); // a change closes any earlier answer
  await expect(button).toBeEnabled();
  await button.click();
  return guarded(app, names.next());
}

/** What the panel shows for an answer the server gave. */
async function expectShown(app: App, response: NameResponse): Promise<void> {
  const { page } = app;
  const { panel, message } = ui(page);
  await guarded(app, expect(panel).toHaveAttribute('data-state', response.found ? 'found' : 'not-found'));
  if (!response.found) {
    await expect(message).toHaveText(NOT_FOUND);
    await expect(page.getByTestId('name-pubchem-link')).toHaveCount(0);
    return;
  }
  await expect(page.getByTestId('name-iupac')).toHaveText(response.iupac!);
  await expect(page.getByTestId('name-title')).toHaveText(response.title!);
  await expect(page.getByTestId('name-cid')).toHaveText(String(response.cid));
  const link = page.getByTestId('name-pubchem-link');
  await expect(link).toHaveAttribute('href', response.url!);
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  const note = page.getByTestId('name-stereo-note');
  if (response.undefined_stereo === 0) await expect(note).toHaveCount(0);
  else
    await expect(note).toHaveText(
      `Stereochemistry is undefined at ${response.undefined_stereo === 1 ? '1 place' : `${response.undefined_stereo} places`} in this drawing, so the name may differ for a specific stereoisomer.`,
    );
}

let rdkit: RDKit;

test.beforeAll(async () => {
  // RDKit.js (the same release as the server's RDKit) reads the SMILES the app sends.
  const require = createRequire(import.meta.url);
  rdkit = await (require('@rdkit/rdkit') as typeof initRDKit)();
  rdkit.use_legacy_stereo_perception(false); // as server/chem.py
});

function canonical(smiles: string): string {
  const mol = rdkit.get_mol(smiles);
  if (!mol) throw new Error('RDKit cannot read this SMILES');
  try {
    return mol.get_smiles();
  } finally {
    mol.delete();
  }
}

test('RDKit.js in the test canonicalizes like the server', () => {
  for (const c of testCompounds()) expect(canonical(c.smiles), c.name).toBe(c.canonical_smiles);
});

test('Get name: the reference compounds get their PubChem names; 3 invented ones get the not-found message', async ({
  app,
}) => {
  await openEditor(app);
  const names = await holdNames(app.page);
  const compounds = testCompounds();
  expect(compounds.length).toBeGreaterThanOrEqual(23);
  for (const c of compounds) {
    const held = await ask(app, names, c.name);
    // What Ketcher sends is this structure, stereo included: the server's cache key and
    // PubChem query (its canonical SMILES) are the ones recorded for it.
    expect(canonical(held.smiles), c.name).toBe(c.canonical_smiles);
    const response = nameResponse(c.name);
    await held.answer(response);
    await expectShown(app, response);
  }
});

test('Get name: nothing shows until the answer comes, and only for the drawing it was asked about', async ({
  app,
}) => {
  const { page } = app;
  const { button, panel } = ui(page);
  await openEditor(app);
  const names = await holdNames(page);
  const save = await nextAutosave(page);
  await load(page, 'aspirin');
  const saved = await save();
  await button.click();
  const first = await guarded(app, names.next());
  // The drawing is safe in browser storage before anything goes over the network.
  expect(await page.evaluate((key) => localStorage.getItem(key), autosaveKey(resolveBase()))).toBe(saved);
  await expect(button).toBeDisabled();
  await expect(button).toHaveText('Naming…');
  await expect(panel).toHaveAttribute('data-state', 'naming');
  await first.answer(nameResponse('aspirin'));
  await expectShown(app, nameResponse('aspirin'));
  await expect(button).toBeEnabled();

  // A change closes the answer.
  await load(page, 'caffeine');
  await expect(panel).toHaveCount(0);

  // A change while the answer is on its way aborts the request; its answer can never show.
  await button.click();
  const second = await guarded(app, names.next());
  const aborted = page.waitForEvent('requestfailed', (r) => r === second.request);
  await load(page, 'ibuprofen');
  await guarded(app, aborted);
  await expect(panel).toHaveCount(0);
  await second.answer(nameResponse('caffeine')).catch(() => {}); // already aborted

  // The close button closes it too.
  await button.click();
  const third = await guarded(app, names.next());
  await third.answer(nameResponse('ibuprofen'));
  await expectShown(app, nameResponse('ibuprofen'));
  await page.getByTestId('name-panel-close').click();
  await expect(panel).toHaveCount(0);
  expect(names.count()).toBe(3);
});

test('Get name: no answer within 8 s means "not responding", and a late answer is dropped', async ({ app }) => {
  const { page } = app;
  const { button, panel, message } = ui(page);
  await openEditor(app);
  const names = await holdNames(page);
  await load(page, 'aspirin');
  await expect(button).toBeEnabled();
  // From here the page's clock moves only when the test moves it.
  const start = Date.now();
  await page.clock.install({ time: start });
  await page.clock.pauseAt(start + 1000);
  await button.click();
  const held = await guarded(app, names.next());
  await page.clock.runFor(7999);
  await expect(panel).toHaveAttribute('data-state', 'naming');
  const aborted = page.waitForEvent('requestfailed', (r) => r === held.request);
  await page.clock.runFor(1);
  await guarded(app, expect(message).toHaveText(NOT_RESPONDING));
  await guarded(app, aborted);
  await held.answer(nameResponse('aspirin')).catch(() => {}); // already aborted
  await expect(panel).toHaveAttribute('data-state', 'not-responding');
});

test('Get name: a failed request means "not responding"', async ({ app }) => {
  await openEditor(app);
  const names = await holdNames(app.page);
  const held = await ask(app, names, 'aspirin');
  await held.route.abort('connectionrefused');
  await guarded(app, expect(ui(app.page).message).toHaveText(NOT_RESPONDING));
});

test('Get name: a reaction is not sent', async ({ app }) => {
  const { page } = app;
  await openEditor(app);
  const names = await holdNames(page);
  // A reaction made of two reference compounds' SMILES (from PubChem, not typed here).
  const reaction = `${compound('ethanol').smiles}>>${compound('acetone').smiles}`;
  await page.evaluate((r) => window.ketcher!.setMolecule(r), reaction);
  expect(await page.evaluate(() => window.ketcher!.containsReaction())).toBe(true);
  await ui(page).button.click();
  // The message shows only after any request was answered, and none is ever answered here.
  await guarded(app, expect(ui(page).message).toHaveText(REACTION));
  expect(names.count()).toBe(0);
});

test('Get name: an empty canvas greys the button', async ({ app }) => {
  const { button } = ui(app.page);
  await openEditor(app);
  await clearCanvas(app.page);
  await expect(button).toBeDisabled();
  await expect(button).toHaveAttribute('title', EMPTY);
  await load(app.page, 'aspirin');
  await expect(button).toBeEnabled();
});

test('Get name: offline the button is greyed with "Needs an internet connection"', async ({ app }) => {
  const { button } = ui(app.page);
  await openEditor(app);
  await load(app.page, 'aspirin');
  await expect(button).toBeEnabled();
  await app.context.setOffline(true);
  await expect(button).toBeDisabled();
  await expect(button).toHaveAttribute('title', OFFLINE);
  await app.context.setOffline(false);
  await expect(button).toBeEnabled();
  await expect(button).not.toHaveAttribute('title', OFFLINE);
});

test('Get name: PubChem busy means "Busy, try again shortly."', async ({ app }) => {
  await openEditor(app);
  const names = await holdNames(app.page);
  const held = await ask(app, names, 'aspirin');
  await held.answer({ error: 'busy' }, 503);
  await expect(ui(app.page).message).toHaveText(BUSY);
  await expectProblems(app, [`HTTP 503: ${held.request.url()}`]);
});

test("Get name: a structure the server can't read is explained", async ({ app }) => {
  await openEditor(app);
  const names = await holdNames(app.page);
  const held = await ask(app, names, 'aspirin');
  await held.answer({ error: 'invalid_structure' }, 400);
  await expect(ui(app.page).message).toHaveText(INVALID);
  await expectProblems(app, [`HTTP 400: ${held.request.url()}`]);
});

test('the PubChem link opens one new tab at the compound page, and the app stays put', async ({ app }) => {
  const { page } = app;
  await openEditor(app);
  const names = await holdNames(page);
  const response = nameResponse('aspirin');
  const held = await ask(app, names, 'aspirin');
  await held.answer(response);
  await expectShown(app, response);
  // A stand-in for PubChem's page, so nothing reaches the network.
  await app.context.route(response.url!, (route) => route.fulfill({ contentType: 'text/plain', body: 'stand-in' }));
  const appUrl = page.url();
  const [popup] = await Promise.all([app.context.waitForEvent('page'), page.getByTestId('name-pubchem-link').click()]);
  await popup.waitForLoadState();
  expect(popup.url()).toBe(response.url);
  expect(await popup.evaluate(() => window.opener)).toBeNull();
  expect(page.url()).toBe(appUrl);
  expect(app.context.pages()).toHaveLength(2);
  // The guards report both, as they must for anything else: the student's click is the
  // only way out (invariant 1).
  await expectProblems(app, [`request (other origin): ${response.url}`, `popup: ${response.url}`]);
});

test('live: Get name asks the deployed API, which asks PubChem', async ({ app }) => {
  test.skip(!process.env.SMOKE_URL, 'needs the deployed API; local runs serve only the build');
  await openEditor(app);
  const { button } = ui(app.page);
  await load(app.page, 'aspirin');
  await button.click();
  await expectShown(app, nameResponse('aspirin'));
});
