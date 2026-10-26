// The 3D view (docs/plans/v2-3d-view.md, bar B). The API's answers are held until the test
// releases them, so every ordering is forced, and they are what the server answered for
// recorded PubChem replies (tests/fixtures/conformer_responses.json, built by
// server/scripts/record_conformers.py), so no test here reaches PubChem. The model is read
// back from 3Dmol itself (the viewer's element keeps it as `viewer3d`).
import type { Page, Request, Route } from '@playwright/test';
import { expect, fixture, goOffline, openEditor, test, type App } from './fixtures.ts';

interface Expected {
  name: string;
  file: string;
  status: number;
  found?: boolean;
  source?: 'pubchem' | 'rdkit' | null;
  cid?: number | null;
  pubchem?: string;
  reason?: string | null;
  undefined_stereo?: number;
  error?: string;
}

interface ServerAnswer {
  status: number;
  body: { molblock?: string | null } & Record<string, unknown>;
}

interface Atom {
  elem: string;
  x: number;
  y: number;
  z: number;
}

const EXPECTED = (JSON.parse(fixture('conformers_expected.json')) as { compounds: Expected[] }).compounds;
const ANSWERS = (JSON.parse(fixture('conformer_responses.json')) as { responses: Record<string, ServerAnswer> }).responses;

const ONE_SHAPE = 'One shape the molecule can take. Real molecules flex and rotate about single bonds.';
const MESSAGES: Record<string, string> = {
  too_big: 'Too big for a 3D model here (more than 100 atoms, or 300 counting hydrogens).',
  no_model: "RDKit could not build a 3D model of this structure. It may be an arrangement that can't exist, as in some bridged rings, or too large and flexible to build in time.",
  one_structure: 'The 3D view works on one structure at a time.',
  busy: 'Busy, try again shortly.',
  not_responding: "The 3D service isn't responding. Your drawing is safe; try again in a minute.",
  unreadable: "This structure can't be read, so there is no 3D model. Check it for errors such as a wrong valence.",
};
const SOURCES: Record<string, string> = {
  none: '3D model computed by RDKit: PubChem has none for this structure.',
  unusable: "3D model computed by RDKit: PubChem's model didn't match the drawing.",
  no_answer: '3D model computed by RDKit: PubChem did not answer.',
};

function expected(name: string): Expected {
  const found = EXPECTED.find((c) => c.name === name);
  if (!found) throw new Error(`${name} is not a 3D view test compound`);
  return found;
}

async function load(page: Page, name: string): Promise<void> {
  const molfile = fixture(expected(name).file);
  await page.evaluate((mol) => window.ketcher!.setMolecule(mol), molfile);
}

/** The atoms in a Molfile's atom block, as 3Dmol reads them (element and coordinates). */
function molfileAtoms(molblock: string): Atom[] {
  const lines = molblock.split('\n');
  const count = Number(lines[3].slice(0, 3));
  return lines.slice(4, 4 + count).map((line) => ({
    x: Number(line.slice(0, 10)),
    y: Number(line.slice(10, 20)),
    z: Number(line.slice(20, 30)),
    elem: line.slice(31, 34).trim(),
  }));
}

/** The model as 3Dmol has it: each atom's element, coordinates and style. */
function shownAtoms(page: Page) {
  return page.getByTestId('threed-viewer').evaluate((element) => {
    const viewer = (element as unknown as { viewer3d: import('3dmol').GLViewer }).viewer3d;
    return viewer
      .getModel()
      .selectedAtoms({})
      .map((a) => ({ elem: a.elem!, x: a.x!, y: a.y!, z: a.z!, style: JSON.stringify(a.style) }));
  });
}

interface Held {
  smiles: string;
  request: Request;
  route: Route;
  answer(answer: ServerAnswer): Promise<void>;
}

/** Hold every 3D request until the test answers it; next() gives them in order. */
async function holdConformers(page: Page) {
  const ready: Held[] = [];
  const waiting: ((held: Held) => void)[] = [];
  let count = 0;
  await page.route('**/api/conformer', (route) => {
    count += 1;
    const held: Held = {
      smiles: (JSON.parse(route.request().postData()!) as { smiles: string }).smiles,
      request: route.request(),
      route,
      answer: ({ status, body }) => route.fulfill({ status, json: body }),
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

function guarded<T>(app: App, step: Promise<T>): Promise<T> {
  return Promise.race([step, app.failed]);
}

/** The guards' reports of problems this test causes on purpose, then forget them. Call it
 * last: the first problem also fails every later guarded() wait. */
async function expectProblems(app: App, expected: string[]): Promise<void> {
  await expect.poll(() => app.problems).toEqual(expected);
  app.problems.length = 0;
}

function ui(page: Page) {
  return {
    open: page.getByTestId('threed-open'),
    panel: page.getByTestId('threed-panel'),
    viewer: page.getByTestId('threed-viewer'),
    message: page.getByTestId('threed-message'),
  };
}

/** Load a test compound and press Show in 3D; returns its held request, if one is made. */
async function ask(app: App, held: Awaited<ReturnType<typeof holdConformers>>, name: string): Promise<Held> {
  const { open } = ui(app.page);
  await load(app.page, name);
  await expect(app.page.getByTestId('properties-panel')).toHaveAttribute('data-state', 'ready');
  await open.click();
  return guarded(app, held.next());
}

/** What the panel shows for the server's answer to a test compound. */
async function expectShown(app: App, name: string): Promise<void> {
  const { page } = app;
  const { panel, viewer, message } = ui(page);
  const e = expected(name);
  if (!e.found) {
    await guarded(app, expect(panel).toHaveAttribute('data-state', 'message'));
    await expect(message).toHaveText(MESSAGES[e.error ?? e.reason!]);
    await expect(viewer).toHaveCount(0);
    return;
  }
  await guarded(app, expect(viewer).toHaveAttribute('data-viewer', 'shown'));
  const atoms = (await shownAtoms(page)).map(({ elem, x, y, z }) => ({ elem, x, y, z }));
  expect(atoms).toEqual(molfileAtoms(ANSWERS[name].body.molblock!));
  await expect(page.getByTestId('threed-source')).toHaveText(
    e.source === 'pubchem' ? `3D model from PubChem (CID ${e.cid}).` : SOURCES[e.pubchem!],
  );
  await expect(page.getByTestId('threed-one-shape')).toHaveText(ONE_SHAPE);
  const note = page.getByTestId('threed-stereo-note');
  const n = e.undefined_stereo!;
  if (n === 0) await expect(note).toHaveCount(0);
  else
    await expect(note).toHaveText(
      `Your drawing leaves the stereochemistry undefined at ${n === 1 ? '1 place' : `${n} places`}. This model shows one arrangement.`,
    );
  // Where the model came from is plain text: the one link out of the app is Get name's.
  await expect(panel.locator('a')).toHaveCount(0);
}

test('every test compound: the model the server sent, where it came from, and its notes (bar B.3)', async ({ app }) => {
  const { page } = app;
  await openEditor(app);
  const held = await holdConformers(page);
  for (const e of EXPECTED) {
    await test.step(e.name, async () => {
      if (e.error === 'one_structure') {
        // Two structures: the browser says so itself, and asks nothing (bar B.1).
        const before = held.count();
        await load(page, e.name);
        await expect(page.getByTestId('properties-panel')).toHaveAttribute('data-state', 'ready');
        await ui(page).open.click();
        await expect(ui(page).message).toHaveText(MESSAGES.one_structure);
        expect(held.count()).toBe(before);
        return;
      }
      const request = await ask(app, held, e.name);
      await request.answer(ANSWERS[e.name]);
      await expectShown(app, e.name);
    });
  }
});

test('styles, hydrogens and Reset view change what 3Dmol draws (bar B.4)', async ({ app }) => {
  const { page } = app;
  await openEditor(app);
  const held = await holdConformers(page);
  await (await ask(app, held, 'aspirin')).answer(ANSWERS.aspirin);
  await expectShown(app, 'aspirin');
  const { viewer } = ui(page);
  const styles = async () => [...new Set((await shownAtoms(page)).map((a) => `${a.elem === 'H' ? 'H' : 'heavy'} ${a.style}`))].sort();
  const ballAndStick = JSON.stringify({ stick: { radius: 0.15, colorscheme: 'Jmol' }, sphere: { scale: 0.25, colorscheme: 'Jmol' } });
  const sticks = JSON.stringify({ stick: { radius: 0.2, colorscheme: 'Jmol' } });
  const spaceFilling = JSON.stringify({ sphere: { colorscheme: 'Jmol' } });
  await expect(viewer).toHaveAttribute('data-style', 'ball-and-stick');
  expect(await styles()).toEqual([`H ${ballAndStick}`, `heavy ${ballAndStick}`]);

  await page.getByTestId('threed-style-sticks').check();
  await expect(viewer).toHaveAttribute('data-style', 'sticks');
  expect(await styles()).toEqual([`H ${sticks}`, `heavy ${sticks}`]);

  await page.getByTestId('threed-hydrogens').uncheck();
  await expect(viewer).toHaveAttribute('data-hydrogens', 'false');
  expect(await styles()).toEqual(['H {}', `heavy ${sticks}`]);

  await page.getByTestId('threed-style-space-filling').check();
  await expect(viewer).toHaveAttribute('data-style', 'space-filling');
  expect(await styles()).toEqual(['H {}', `heavy ${spaceFilling}`]);

  // Turn the model by dragging it, then Reset view puts it back as it was first shown.
  const view = () => viewer.evaluate((el) => (el as unknown as { viewer3d: import('3dmol').GLViewer }).viewer3d.getView());
  const first = await view();
  const box = (await viewer.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2 + 30, { steps: 5 });
  await page.mouse.up();
  expect(await view()).not.toEqual(first);
  await page.getByTestId('threed-reset').click();
  expect(await view()).toEqual(first);
});

test('a change to the drawing makes the model stale; an answer for an older drawing is never shown (bar B.5)', async ({ app }) => {
  const { page } = app;
  await openEditor(app);
  const held = await holdConformers(page);
  const { panel, viewer } = ui(page);
  const older = await ask(app, held, 'aspirin');
  await expect(panel).toHaveAttribute('data-state', 'loading');
  const aborted = page.waitForEvent('requestfailed', (r) => r === older.request);
  await load(page, 'cholesterol');
  await expect(panel).toHaveAttribute('data-state', 'stale');
  await guarded(app, aborted);
  await older.answer(ANSWERS.aspirin).catch(() => {}); // already aborted
  await expect(panel).toHaveAttribute('data-state', 'stale');
  await expect(viewer).toHaveCount(0);

  await page.getByTestId('threed-again').click();
  const newer = await guarded(app, held.next());
  expect(newer.smiles).not.toBe(older.smiles);
  await newer.answer(ANSWERS.cholesterol);
  await expectShown(app, 'cholesterol');

  // And a change with a model shown makes it stale too.
  await load(page, 'aspirin');
  await expect(panel).toHaveAttribute('data-state', 'stale');
  await expect(viewer).toHaveCount(0);
});

test('one panel below the canvas at a time: the 3D view, the NMR preview, the stereoisomers and Practice (bar B.2)', async ({ app }) => {
  const { page } = app;
  await openEditor(app);
  const held = await holdConformers(page);
  const { panel, open } = ui(page);
  await (await ask(app, held, '(R)-2-butanol')).answer(ANSWERS['(R)-2-butanol']);
  await expect(panel).toHaveAttribute('data-state', 'ready');

  await page.getByTestId('nmr-predict').click();
  await expect(page.getByTestId('nmr-panel')).toHaveAttribute('data-state', 'ready');
  await expect(panel).toHaveCount(0);
  await open.click();
  await (await guarded(app, held.next())).answer(ANSWERS['(R)-2-butanol']);
  await expect(panel).toHaveAttribute('data-state', 'ready');
  await expect(page.getByTestId('nmr-panel')).toHaveCount(0);

  await page.getByTestId('stereo-show').click();
  await expect(page.getByTestId('stereo-panel')).toBeVisible();
  await expect(panel).toHaveCount(0);
  await open.click();
  await (await guarded(app, held.next())).answer(ANSWERS['(R)-2-butanol']);
  await expect(panel).toHaveAttribute('data-state', 'ready');
  await expect(page.getByTestId('stereo-panel')).toHaveCount(0);

  await page.getByTestId('app-practice-button').click();
  await expect(page.getByTestId('practice-panel')).toBeVisible();
  await expect(panel).toHaveCount(0);
  await open.click();
  await (await guarded(app, held.next())).answer(ANSWERS['(R)-2-butanol']);
  await expect(panel).toHaveAttribute('data-state', 'ready');
  await expect(page.getByTestId('practice-panel')).toHaveCount(0);
});

test("the server's refusals and silence each get their message (bar B.6)", async ({ app }) => {
  const { page } = app;
  await openEditor(app);
  const held = await holdConformers(page);
  const { panel, message } = ui(page);
  const cases: [string, (request: Held) => Promise<void>, string][] = [
    ['busy', (r) => r.answer({ status: 503, body: { error: 'busy' } }), MESSAGES.busy],
    ['not responding', (r) => r.route.abort('connectionrefused'), MESSAGES.not_responding],
    ['one structure', (r) => r.answer({ status: 400, body: { error: 'one_structure' } }), MESSAGES.one_structure],
    ['unreadable', (r) => r.answer({ status: 400, body: { error: 'invalid_structure' } }), MESSAGES.unreadable],
  ];
  await load(page, 'aspirin');
  await expect(page.getByTestId('properties-panel')).toHaveAttribute('data-state', 'ready');
  const urls: string[] = [];
  for (const [what, respond, text] of cases) {
    await test.step(what, async () => {
      // Not guarded(): the answers here are HTTP errors on purpose, which the guard reports.
      await ui(page).open.click();
      const request = await held.next();
      urls.push(request.request.url());
      await respond(request);
      await expect(panel).toHaveAttribute('data-state', 'message');
      await expect(message).toHaveText(text);
    });
  }
  await expectProblems(app, [`HTTP 503: ${urls[0]}`, `HTTP 400: ${urls[2]}`, `HTTP 400: ${urls[3]}`]);
});

test("3Dmol's chunk is fetched only when a model is first shown, and is precached (bar B.7)", async ({ app }) => {
  const { page } = app;
  await openEditor(app);
  const held = await holdConformers(page);
  const fetched = () =>
    page.evaluate(() => performance.getEntriesByType('resource').filter((e) => /\/assets\/3Dmol-[\w-]+\.js$/.test(e.name)).length);
  await load(page, 'aspirin');
  await expect(page.getByTestId('properties-panel')).toHaveAttribute('data-state', 'ready');
  expect(await fetched()).toBe(0);
  await ui(page).open.click();
  await (await guarded(app, held.next())).answer(ANSWERS.aspirin);
  await expect(ui(page).viewer).toHaveAttribute('data-viewer', 'shown');
  expect(await fetched()).toBe(1);
});

test('offline: the button is greyed with "Needs an internet connection" (bar B.1)', async ({ app }) => {
  await goOffline(app);
  const { page } = app;
  await load(page, 'aspirin');
  await expect(page.getByTestId('properties-panel')).toHaveAttribute('data-state', 'ready');
  await expect(ui(page).open).toBeDisabled();
  await expect(page.getByTestId('threed-offline')).toHaveText('Needs an internet connection');
});

test.describe('without WebGL', () => {
  test.use({ browserArgs: ['--disable-webgl', '--disable-3d-apis'] });

  test('the panel says the browser cannot show 3D graphics (bar B.6)', async ({ app }) => {
    const { page } = app;
    await openEditor(app);
    const held = await holdConformers(page);
    await (await ask(app, held, 'aspirin')).answer(ANSWERS.aspirin);
    await expect(ui(page).viewer).toHaveAttribute('data-viewer', 'no-webgl');
    await expect(page.getByTestId('threed-problem')).toHaveText("This browser can't show 3D graphics (WebGL is turned off).");
  });
});
