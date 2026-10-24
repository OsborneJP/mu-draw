// Name to structure (spec "6. Name to structure"). The API's answers are held until the test
// releases them, so every ordering is forced, and they are what the server answered with the
// real OPSIN and recorded PubChem replies (tests/fixtures/structure_responses.json), so no test
// here reaches PubChem, except the live-only one at the end, which uses the deployed API.
import type { Page, Request, Route } from '@playwright/test';
import {
  clearCanvas,
  expect,
  fixture,
  inchiKey,
  nameResponse,
  openEditor,
  referenceCompound,
  test,
  type App,
  type NameResponse,
} from './fixtures.ts';

const NOT_FOUND = 'PubChem has no record of this exact structure, so no name is available.';
const NOT_RESPONDING = "The naming service isn't responding. Your drawing is safe; try again in a minute.";
const NO_COMPOUND = 'PubChem has no compound by this name, so nothing was drawn.';
const BUSY = 'Busy, try again shortly.';
const OFFLINE = 'Needs an internet connection';

interface StructureAnswer {
  found: boolean;
  smiles: string | null;
  molfile: string | null;
  source: 'OPSIN' | 'PubChem' | null;
  message: string | null;
  title: string | null;
  cid: number | null;
  matches: number;
  stereo_from_pubchem: boolean;
}

interface Recorded {
  kind: 'systematic' | 'common';
  structure: StructureAnswer;
  roundtrip: NameResponse;
  inchikey: string;
}

function recorded(): Record<string, Recorded> {
  return (JSON.parse(fixture('structure_responses.json')) as { responses: Record<string, Recorded> }).responses;
}

function answerFor(name: string): Recorded {
  const found = recorded()[name];
  if (!found) throw new Error(`${name} is not in structure_responses.json`);
  return found;
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
  body: Record<string, unknown>;
  request: Request;
  answer(body: unknown, status?: number): Promise<void>;
}

/** Hold every request to <base>api/<path> until the test answers it; next() gives them in order. */
async function holdApi(page: Page, path: string) {
  const ready: Held[] = [];
  const waiting: ((held: Held) => void)[] = [];
  let count = 0;
  await page.route(`**/api/${path}`, (route: Route) => {
    count += 1;
    const held: Held = {
      body: JSON.parse(route.request().postData()!) as Record<string, unknown>,
      request: route.request(),
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
    input: page.getByTestId('name-to-structure-input'),
    add: page.getByTestId('name-to-structure-add'),
    replace: page.getByTestId('name-to-structure-replace'),
    panel: page.getByTestId('name-panel'),
    message: page.getByTestId('name-message'),
  };
}

/** The drawing's fragments as bounding boxes [minX, minY, maxX, maxY], in Ketcher's units. */
async function fragments(page: Page): Promise<number[][]> {
  return page.evaluate(() => {
    const boxes = new Map<number, number[]>();
    for (const [, atom] of window.ketcher!.editor.struct().atoms) {
      const { x, y } = atom.pp;
      const box = boxes.get(atom.fragment) ?? [x, y, x, y];
      boxes.set(atom.fragment, [Math.min(box[0], x), Math.min(box[1], y), Math.max(box[2], x), Math.max(box[3], y)]);
    }
    return [...boxes.values()];
  });
}

function overlap(a: number[], b: number[]): boolean {
  return a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];
}

async function loadMolfile(page: Page, typedName: string): Promise<void> {
  const molfile = fixture(referenceCompound(typedName).files.find((f) => f.endsWith('.mol'))!);
  await page.evaluate((mol) => window.ketcher!.setMolecule(mol), molfile);
}

/** Click Ketcher's visible Undo once it is enabled (it refreshes 100 ms after a change). */
async function undo(page: Page): Promise<void> {
  const button = page.getByTestId('undo').filter({ visible: true });
  await expect(button).toBeEnabled();
  await button.click();
}

/** Type a name and press Add or Replace; answer both requests from the recordings. */
async function drawRecorded(
  app: App,
  apis: { structures: Awaited<ReturnType<typeof holdApi>>; names: Awaited<ReturnType<typeof holdApi>> },
  name: string,
  how: 'add' | 'replace',
): Promise<Recorded> {
  const { input, add, replace, panel } = ui(app.page);
  const answer = answerFor(name);
  await input.fill(name);
  await (how === 'add' ? add : replace).click();
  const structure = await guarded(app, apis.structures.next());
  expect(structure.body).toEqual({ name });
  await structure.answer(answer.structure);
  // Drawn, and the panel kept through the drawing's own change event.
  await expect(panel).toHaveAttribute('data-state', 'drawn');
  const naming = await guarded(app, apis.names.next());
  expect(naming.body).toEqual({ smiles: answer.structure.smiles });
  await naming.answer(answer.roundtrip);
  return answer;
}

function samePlainName(a: string, b: string): boolean {
  const plain = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();
  return plain(a) === plain(b);
}

test('Name to structure: 20 systematic and 10 common names draw, and the round trip names each', async ({
  app,
}) => {
  const { page } = app;
  await openEditor(app);
  const apis = { structures: await holdApi(page, 'structure'), names: await holdApi(page, 'name') };
  const names = Object.keys(recorded());
  expect(names.length).toBeGreaterThanOrEqual(30);
  for (const name of names) {
    await clearCanvas(page);
    const answer = await drawRecorded(app, apis, name, 'replace');
    // What the canvas holds is the structure the server drew (Indigo's InChIKey vs RDKit's).
    expect(await inchiKey(page), name).toBe(answer.inchikey);
    const { structure, roundtrip } = answer;
    await expect(page.getByTestId('name-source')).toHaveAttribute('data-source', structure.source!);
    await expect(page.getByTestId('name-typed')).toHaveText(name);
    await expect(page.getByTestId('name-roundtrip-iupac')).toContainText(roundtrip.iupac!);
    const match = samePlainName(name, roundtrip.iupac!);
    await expect(page.getByTestId('name-match')).toHaveCount(match ? 1 : 0);
    await expect(page.getByTestId('name-differs')).toHaveCount(match ? 0 : 1);
    await expect(page.getByTestId('name-opsin-message')).toHaveCount(structure.message ? 1 : 0);
    await expect(page.getByTestId('name-stereo-source')).toHaveCount(structure.stereo_from_pubchem ? 1 : 0);
    await expect(page.getByTestId('name-pubchem-link')).toHaveAttribute('href', roundtrip.url!);
  }
});

test('Add puts the second compound beside the first, and one Undo removes it', async ({ app }) => {
  const { page } = app;
  await openEditor(app);
  const apis = { structures: await holdApi(page, 'structure'), names: await holdApi(page, 'name') };
  await clearCanvas(page);
  const first = await drawRecorded(app, apis, 'cyclohexanol', 'replace');
  await drawRecorded(app, apis, 'caffeine', 'add');
  const boxes = await fragments(page);
  expect(boxes).toHaveLength(2);
  expect(overlap(boxes[0], boxes[1])).toBe(false);
  await expect(ui(page).panel).toHaveAttribute('data-state', 'drawn');
  await undo(page);
  await expect.poll(() => fragments(page).then((b) => b.length)).toBe(1);
  expect(await inchiKey(page)).toBe(first.inchikey);
  await expect(ui(page).panel).toHaveCount(0); // the Undo is a change: the answer was about before
});

test('Replace clears the drawing first, and one Undo brings it back', async ({ app }) => {
  const { page } = app;
  await openEditor(app);
  const apis = { structures: await holdApi(page, 'structure'), names: await holdApi(page, 'name') };
  await loadMolfile(page, 'aspirin');
  const before = await inchiKey(page);
  const drawn = await drawRecorded(app, apis, 'caffeine', 'replace');
  expect(await fragments(page)).toHaveLength(1);
  expect(await inchiKey(page)).toBe(drawn.inchikey);
  await undo(page);
  await expect.poll(() => inchiKey(page)).toBe(before);
});

test('Enter replaces an empty canvas and adds to a drawing', async ({ app }) => {
  const { page } = app;
  const { input } = ui(page);
  await openEditor(app);
  const structures = await holdApi(page, 'structure');
  const names = await holdApi(page, 'name');
  await clearCanvas(page);
  for (const [name, count] of [['cyclohexanol', 1], ['propanenitrile', 2]] as const) {
    await input.fill(name);
    await input.press('Enter');
    const held = await guarded(app, structures.next());
    await held.answer(answerFor(name).structure);
    await (await guarded(app, names.next())).answer(answerFor(name).roundtrip);
    await expect(page.getByTestId('name-roundtrip-iupac')).toBeVisible();
    expect(await fragments(page)).toHaveLength(count);
  }
});

test('a change while the name is looked up draws nothing', async ({ app }) => {
  const { page } = app;
  const { input, replace, panel, message } = ui(page);
  const getName = page.getByTestId('app-get-name-button');
  await openEditor(app);
  const structures = await holdApi(page, 'structure');
  await loadMolfile(page, 'aspirin');
  await expect(getName).toBeEnabled();
  await input.fill('caffeine');
  await replace.click();
  const held = await guarded(app, structures.next());
  await expect(message).toHaveText('Looking up “caffeine”…');
  // One request at a time: nothing else can start while this one is on its way.
  await expect(getName).toBeDisabled();
  await expect(input).toBeDisabled();
  const aborted = page.waitForEvent('requestfailed', (r) => r === held.request);
  await loadMolfile(page, 'ethanol');
  await guarded(app, aborted);
  await expect(panel).toHaveCount(0);
  await held.answer(answerFor('caffeine').structure).catch(() => {}); // already aborted
  expect(await inchiKey(page)).toBe(referenceCompound('ethanol').inchikey);
});

test('a change after drawing closes the panel, drops the round trip, and keeps the drawing', async ({
  app,
}) => {
  const { page } = app;
  const { input, replace, panel } = ui(page);
  await openEditor(app);
  const structures = await holdApi(page, 'structure');
  const names = await holdApi(page, 'name');
  await clearCanvas(page);
  await input.fill('caffeine');
  await replace.click();
  await (await guarded(app, structures.next())).answer(answerFor('caffeine').structure);
  const naming = await guarded(app, names.next());
  await expect(page.getByTestId('name-roundtrip-message')).toHaveText('Asking PubChem for its name…');
  const aborted = page.waitForEvent('requestfailed', (r) => r === naming.request);
  // The student's own change (not Name to structure's): another structure beside it.
  const ethanol = fixture(referenceCompound('ethanol').files.find((f) => f.endsWith('.mol'))!);
  await page.evaluate((mol) => window.ketcher!.addFragment(mol), ethanol);
  await guarded(app, aborted);
  await expect(panel).toHaveCount(0);
  await naming.answer(answerFor('caffeine').roundtrip).catch(() => {});
  expect(await fragments(page)).toHaveLength(2); // caffeine stays, ethanol beside it
});

test('no answer within 8 s means "not responding", and nothing is drawn', async ({ app }) => {
  const { page } = app;
  const { input, replace, panel, message } = ui(page);
  await openEditor(app);
  const structures = await holdApi(page, 'structure');
  await loadMolfile(page, 'ethanol');
  await input.fill('caffeine');
  // From here the page's clock moves only when the test moves it.
  const start = Date.now();
  await page.clock.install({ time: start });
  await page.clock.pauseAt(start + 1000);
  await replace.click();
  const held = await guarded(app, structures.next());
  await page.clock.runFor(7999);
  await expect(panel).toHaveAttribute('data-state', 'drawing');
  await page.clock.runFor(1);
  await guarded(app, expect(message).toHaveText(NOT_RESPONDING));
  await held.answer(answerFor('caffeine').structure).catch(() => {});
  expect(await inchiKey(page)).toBe(referenceCompound('ethanol').inchikey);
});

test("a name nobody knows: OPSIN's words, and nothing drawn", async ({ app }) => {
  const { page } = app;
  const { input, replace, message } = ui(page);
  await openEditor(app);
  const structures = await holdApi(page, 'structure');
  await loadMolfile(page, 'ethanol');
  await input.fill('no such name');
  await replace.click();
  const unknown: StructureAnswer = {
    found: false,
    smiles: null,
    molfile: null,
    source: null,
    message: 'no such name was uninterpretable',
    title: null,
    cid: null,
    matches: 0,
    stereo_from_pubchem: false,
  };
  await (await guarded(app, structures.next())).answer(unknown);
  await expect(message).toHaveText(NO_COMPOUND);
  await expect(page.getByTestId('name-opsin-message')).toHaveText('OPSIN: no such name was uninterpretable');
  expect(await inchiKey(page)).toBe(referenceCompound('ethanol').inchikey);
});

test("the round trip finding no record keeps the drawing and says so", async ({ app }) => {
  const { page } = app;
  const { input, replace } = ui(page);
  await openEditor(app);
  const structures = await holdApi(page, 'structure');
  const names = await holdApi(page, 'name');
  await clearCanvas(page);
  await input.fill('cyclohexanol');
  await replace.click();
  await (await guarded(app, structures.next())).answer(answerFor('cyclohexanol').structure);
  // An invented structure's recorded answer: PubChem has no record.
  const invented = nameResponse('invented: cholesterol + caffeine');
  expect(invented.found).toBe(false);
  await (await guarded(app, names.next())).answer(invented);
  await expect(page.getByTestId('name-roundtrip-message')).toHaveText(NOT_FOUND);
  expect(await inchiKey(page)).toBe(answerFor('cyclohexanol').inchikey);
});

test('offline the name box and its buttons are greyed with "Needs an internet connection"', async ({ app }) => {
  const { page } = app;
  const { input, add, replace } = ui(page);
  await openEditor(app);
  await input.fill('caffeine');
  await expect(add).toBeEnabled();
  await app.context.setOffline(true);
  for (const control of [input, add, replace]) {
    await expect(control).toBeDisabled();
    await expect(control).toHaveAttribute('title', OFFLINE);
  }
  await app.context.setOffline(false);
  await expect(add).toBeEnabled();
  await expect(replace).toBeEnabled();
});

test("typing in the name box never reaches Ketcher's shortcuts", async ({ app }) => {
  const { page } = app;
  const { input } = ui(page);
  await openEditor(app);
  await loadMolfile(page, 'aspirin');
  const before = await inchiKey(page);
  await expect(page.getByTestId('undo').filter({ visible: true })).toBeEnabled();
  await input.click();
  await page.keyboard.type('cn');
  await page.keyboard.press('Delete');
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.getByTestId('undo').filter({ visible: true })).toBeEnabled();
  expect(await inchiKey(page)).toBe(before);
});

test('PubChem busy means "Busy, try again shortly."', async ({ app }) => {
  const { page } = app;
  const { input, replace, message } = ui(page);
  await openEditor(app);
  const structures = await holdApi(page, 'structure');
  await input.fill('caffeine');
  await replace.click();
  const held = await guarded(app, structures.next());
  await held.answer({ error: 'busy' }, 503);
  await expect(message).toHaveText(BUSY);
  await expectProblems(app, [`HTTP 503: ${held.request.url()}`]);
});

test('live: Name to structure asks the deployed API, which runs OPSIN and asks PubChem', async ({ app }) => {
  test.skip(!process.env.SMOKE_URL, 'needs the deployed API; local runs serve only the build');
  const { page } = app;
  const { input, replace } = ui(page);
  await openEditor(app);
  const names = Object.entries(recorded());
  const opsin = names.find(([, r]) => r.kind === 'systematic' && r.structure.source === 'OPSIN')!;
  const pubchem = names.find(([, r]) => r.structure.source === 'PubChem' && !r.structure.stereo_from_pubchem)!;
  for (const [name, answer] of [opsin, pubchem]) {
    await clearCanvas(page);
    await input.fill(name);
    await replace.click();
    await expect(page.getByTestId('name-roundtrip-iupac')).toContainText(answer.roundtrip.iupac!);
    await expect(page.getByTestId('name-source')).toHaveAttribute('data-source', answer.structure.source!);
    expect(await inchiKey(page), name).toBe(answer.inchikey);
  }
});
