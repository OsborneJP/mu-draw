// Practice mode (docs/plans/v2-practice-mode.md): the app gives a name, the student draws it,
// and Check compares InChIKeys from Indigo with the ones the list ships (made by RDKit).
// The shipped lists are web/public/practice.json; the hint cases use the test list
// (tests/fixtures/practice_test_lists.json), served in its place, and drawings from
// tests/fixtures/practice_cases.json. All three come from server/scripts/build_practice_lists.py.
import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { resolveBase } from '../config/app.ts';
import { autosaveKey } from '../src/editor/autosave.ts';
import { PRACTICE_FILE, type PracticeList } from '../src/panels/practiceFile.ts';
import {
  expect,
  fixture,
  goOffline,
  holdableIndigoReplies,
  inchiKey,
  openEditor,
  referenceCompound,
  test,
} from './fixtures.ts';

interface Lists {
  lists: PracticeList[];
}
interface Case {
  case: string;
  asked: string;
  verdict: string;
  molfile?: string;
  rxn?: string;
}

const shipped = JSON.parse(readFileSync(new URL(`../public/${PRACTICE_FILE}`, import.meta.url), 'utf8')) as Lists;
const testLists = JSON.parse(fixture('practice_test_lists.json')) as Lists;
const { cases } = JSON.parse(fixture('practice_cases.json')) as { cases: Case[] };
const testList = testLists.lists[0];
const molfileOf = (name: string) => fixture(referenceCompound(name).files.find((f) => f.endsWith('.mol'))!);
const caseNamed = (name: string) => cases.find((c) => c.case === name)!;

/** Serve `data` as the practice lists, in place of the shipped file. */
async function serveLists(page: Page, data: Lists): Promise<void> {
  await page.route(`**/${PRACTICE_FILE}`, (route) => route.fulfill({ json: data }));
}

async function load(page: Page, text: string): Promise<void> {
  await page.evaluate((t) => window.ketcher!.setMolecule(t), text);
}

async function openPractice(page: Page, list: PracticeList): Promise<void> {
  await page.getByTestId('app-practice-button').click();
  await expect(page.getByTestId('practice-name')).toHaveText(list.names[0].name);
}

const blank = (page: Page) => page.evaluate(() => window.ketcher!.editor.struct().isBlank());

/** Next or Previous: wait for the name, and for the canvas to be cleared (Ketcher's
 * setMolecule settles after the click). */
async function move(page: Page, button: 'next' | 'previous', to: string): Promise<void> {
  await page.getByTestId(`practice-${button}`).click();
  await expect(page.getByTestId('practice-name')).toHaveText(to);
  await expect.poll(() => blank(page)).toBe(true);
}

/** Next or Previous until `name`. */
async function goToName(page: Page, list: PracticeList, name: string): Promise<void> {
  const at = list.names.findIndex((n) => n.name === name);
  const shown = await page.getByTestId('practice-name').textContent();
  let from = list.names.findIndex((n) => n.name === shown);
  while (from !== at) {
    const button = from < at ? 'next' : 'previous';
    from += from < at ? 1 : -1;
    await move(page, button, list.names[from].name);
  }
}

/** Press Check and wait for its verdict. */
async function check(page: Page): Promise<string> {
  await page.getByTestId('practice-check').click();
  const verdict = page.getByTestId('practice-verdict');
  await expect(verdict).toBeVisible();
  await expect(page.getByTestId('practice-check')).toHaveText('Check');
  return (await verdict.getAttribute('data-verdict'))!;
}

const hold = (page: Page) => page.evaluate(() => (window as unknown as { __holdIndigo(): void }).__holdIndigo());
const release = (page: Page) => page.evaluate(() => (window as unknown as { __releaseIndigo(): void }).__releaseIndigo());
const heldReplies = (page: Page) => page.evaluate(() => (window as unknown as { __heldIndigo(): number }).__heldIndigo());

/** Where the student clicks for the drawing's one bond to O: its middle, on the page. */
function bondToOxygenOnPage(page: Page): Promise<{ x: number; y: number }> {
  return page.evaluate(() => {
    const editor = window.ketcher!.editor as unknown as {
      render: { page2obj(e: { clientX: number; clientY: number }): { x: number; y: number } };
      struct(): {
        atoms: Map<number, { label: string; pp: { x: number; y: number } }>;
        bonds: Map<number, { begin: number; end: number }>;
      };
    };
    const struct = editor.struct();
    const toO = [...struct.bonds.values()].filter((b) => [b.begin, b.end].some((a) => struct.atoms.get(a)!.label === 'O'));
    if (toO.length !== 1) throw new Error(`expected one bond to O, found ${toO.length}`);
    const [a, b] = [struct.atoms.get(toO[0].begin)!.pp, struct.atoms.get(toO[0].end)!.pp];
    const target = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    // Ketcher maps page to drawing linearly; invert it from three points.
    const at = (clientX: number, clientY: number) => editor.render.page2obj({ clientX, clientY });
    const o = at(0, 0);
    const ex = at(100, 0);
    const ey = at(0, 100);
    const [m11, m12, m21, m22] = [(ex.x - o.x) / 100, (ey.x - o.x) / 100, (ex.y - o.y) / 100, (ey.y - o.y) / 100];
    const det = m11 * m22 - m12 * m21;
    const [dx, dy] = [target.x - o.x, target.y - o.y];
    return { x: (m22 * dx - m12 * dy) / det, y: (m11 * dy - m21 * dx) / det };
  });
}

function history(page: Page): Promise<{ undo: number; redo: number }> {
  return page.evaluate(() =>
    (window.ketcher!.editor as unknown as { historySize(): { undo: number; redo: number } }).historySize(),
  );
}

async function placeRing(page: Page, at = { x: 150, y: 150 }) {
  await page.getByTestId('template-0').click();
  // Ketcher also has a (hidden) macromolecules canvas with the same test id.
  await page.locator('[data-testid="ketcher-canvas"][data-canvasmode="molecules-mode"]').click({ position: at });
}

test('two InChIKeys asked for at once each get their own drawing', async ({ app }) => {
  const { page } = app;
  await openEditor(app);
  const kets: string[] = [];
  for (const name of ['ethanol', 'toluene']) {
    await load(page, molfileOf(name));
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

test('every shipped name: its answer, loaded, gets a right key and Check says Correct', async ({ app }) => {
  const { page } = app;
  await openEditor(app);
  expect(shipped.lists.length).toBeGreaterThan(0);
  for (const [index, list] of shipped.lists.entries()) {
    if (index === 0) await openPractice(page, list);
    else {
      await page.getByTestId('practice-list').selectOption(String(index));
      await expect(page.getByTestId('practice-name')).toHaveText(list.names[0].name);
      await expect.poll(() => blank(page)).toBe(true);
    }
    for (const [at, name] of list.names.entries()) {
      await expect(page.getByTestId('practice-position')).toHaveText(`${at + 1} of ${list.names.length}`);
      await load(page, name.molfile);
      const key = await inchiKey(page);
      if (name.stereo === 'checked') expect(name.keys, name.name).toContain(key);
      else expect([key.slice(0, 14), key.slice(-1)], name.name).toEqual([name.keys[0].slice(0, 14), name.keys[0].slice(-1)]);
      expect(await check(page), name.name).toBe('correct');
      if (at < list.names.length - 1) await move(page, 'next', list.names[at + 1].name);
    }
    await expect(page.getByTestId('practice-next')).toBeDisabled();
  }
});

test('the hint cases: each drawing gets its verdict, and the panel says it plainly', async ({ app }) => {
  const { page } = app;
  await serveLists(page, testLists);
  await openEditor(app);
  await openPractice(page, testList);
  for (const c of cases) {
    await goToName(page, testList, c.asked);
    await load(page, c.molfile ?? c.rxn!);
    expect(await check(page), c.case).toBe(c.verdict);
    await expect(page.getByTestId('practice-verdict'), c.case).not.toBeEmpty();
    // Show answer is offered after any Check that wasn't right.
    await expect(page.getByTestId('practice-show-answer'), c.case).toHaveCount(c.verdict === 'correct' ? 0 : 1);
  }
  // A drawing marked as an AND group gets the note about & and "or".
  await goToName(page, testList, '(R)-butan-2-ol');
  await load(page, caseNamed('marked as an AND group').molfile!);
  expect(await check(page)).toBe('stereo');
  await expect(page.getByTestId('practice-verdict')).toContainText('“&” or “or”');
  // A name that doesn't state its stereo says so when the drawing is right.
  await goToName(page, testList, 'pent-2-ene');
  await load(page, caseNamed('E for a name without E/Z').molfile!);
  expect(await check(page)).toBe('correct');
  await expect(page.getByTestId('practice-verdict')).toContainText("doesn't give the stereochemistry");
});

test('a stereo answer drawn with the wedge tool, as a student draws it, is Correct', async ({ app }) => {
  const { page } = app;
  await serveLists(page, testLists);
  await openEditor(app);
  await openPractice(page, testList);
  expect(testList.names[0].name).toBe('(R)-butan-2-ol');
  await load(page, caseNamed('no stereo drawn').molfile!);
  expect(await check(page)).toBe('stereo');
  // The wedge tool, from the bond tools' menu (a second click on the bond tool opens it), on
  // the bond from the stereocentre to O.
  const bonds = page.getByTestId('bonds').filter({ visible: true });
  await bonds.click();
  await bonds.click();
  await page.getByTestId('bond-up').filter({ visible: true }).click();
  const point = await bondToOxygenOnPage(page);
  await page.mouse.click(point.x, point.y);
  await expect(page.getByTestId('practice-verdict')).toHaveCount(0);
  expect(await check(page)).toBe('correct');
});

test('a verdict for a drawing that changed while checking is never shown', async ({ app }) => {
  const { context, page } = app;
  await context.addInitScript(holdableIndigoReplies);
  await serveLists(page, testLists);
  await openEditor(app);
  await openPractice(page, testList);
  await load(page, testList.names[0].molfile);
  const checkButton = page.getByTestId('practice-check');

  await hold(page);
  await checkButton.click();
  await expect(checkButton).toHaveText('Checking…');
  await expect(checkButton).toBeDisabled();
  await expect.poll(() => heldReplies(page)).toBe(1);
  // The drawing changes while Indigo has it.
  await placeRing(page);
  await release(page);
  await expect(checkButton).toHaveText('Check');
  await expect(page.getByTestId('practice-verdict')).toHaveCount(0);

  // An edit after a verdict takes it away.
  expect(await check(page)).toBe('fragments');
  await placeRing(page, { x: 300, y: 150 });
  await expect(page.getByTestId('practice-verdict')).toHaveCount(0);
});

test('Next while checking: the old verdict never reaches the new name', async ({ app }) => {
  const { context, page } = app;
  await context.addInitScript(holdableIndigoReplies);
  await serveLists(page, testLists);
  await openEditor(app);
  await openPractice(page, testList);
  await load(page, testList.names[0].molfile);
  await hold(page);
  await page.getByTestId('practice-check').click();
  await expect.poll(() => heldReplies(page)).toBe(1);
  await page.getByTestId('practice-next').click();
  await expect(page.getByTestId('practice-name')).toHaveText(testList.names[1].name);
  await release(page);
  await expect(page.getByTestId('practice-check')).toHaveText('Check');
  await expect(page.getByTestId('practice-verdict')).toHaveCount(0);
  await expect(page.getByTestId('practice-show-answer')).toHaveCount(0);
});

test('Close while checking: the old verdict is not there when Practice opens again', async ({ app }) => {
  const { context, page } = app;
  await context.addInitScript(holdableIndigoReplies);
  await serveLists(page, testLists);
  await openEditor(app);
  await openPractice(page, testList);
  await load(page, testList.names[0].molfile);
  await hold(page);
  await page.getByTestId('practice-check').click();
  await expect.poll(() => heldReplies(page)).toBe(1);
  await page.getByTestId('practice-close').click();
  await page.getByTestId('app-practice-button').click();
  await expect(page.getByTestId('practice-check')).toHaveText('Checking…');
  await release(page);
  await expect(page.getByTestId('practice-check')).toHaveText('Check');
  await expect(page.getByTestId('practice-verdict')).toHaveCount(0);
});

test("Next while the answer's picture is being drawn: it never shows under the new name", async ({ app }) => {
  const { context, page } = app;
  await context.addInitScript(holdableIndigoReplies);
  await serveLists(page, testLists);
  await openEditor(app);
  await openPractice(page, testList);
  await load(page, caseNamed('the other enantiomer').molfile!);
  expect(await check(page)).toBe('stereo');
  await hold(page);
  await page.getByTestId('practice-show-answer').click();
  await expect(page.getByTestId('practice-answer-message')).toHaveText('Drawing the answer…');
  await expect.poll(() => heldReplies(page)).toBe(1);
  await page.getByTestId('practice-next').click();
  await expect(page.getByTestId('practice-name')).toHaveText(testList.names[1].name);
  await release(page);
  await expect.poll(() => blank(page)).toBe(true);
  // Check's requests wait in Indigo's queue behind the picture's, so once its verdict is
  // in, the picture's answer has arrived and been dropped.
  await load(page, caseNamed('Z for a name without E/Z').molfile!);
  expect(await check(page)).toBe('correct');
  await expect(page.getByTestId('practice-answer')).toHaveCount(0);
  await expect(page.getByTestId('practice-answer-message')).toHaveCount(0);
});

test('Next and Previous clear the canvas in one Undo step, and stop at both ends', async ({ app }) => {
  const { page } = app;
  await serveLists(page, testLists);
  await openEditor(app);
  await openPractice(page, testList);
  const previous = page.getByTestId('practice-previous');
  const next = page.getByTestId('practice-next');
  await expect(previous).toBeDisabled();
  await load(page, testList.names[0].molfile);
  const drawn = await inchiKey(page);

  await move(page, 'next', testList.names[1].name);
  await expect(page.getByTestId('practice-position')).toHaveText(`2 of ${testList.names.length}`);
  // One Undo (Ketcher's button) brings the drawing back.
  const undo = page.getByTestId('undo').filter({ visible: true });
  await expect(undo).toBeEnabled();
  await undo.click();
  await expect.poll(() => inchiKey(page)).toBe(drawn);

  // An empty canvas stays as it is (nothing to undo), and Check is greyed on it.
  await page.evaluate(() => window.ketcher!.setMolecule(''));
  await expect(undo).toBeEnabled();
  const undoable = await history(page);
  await move(page, 'previous', testList.names[0].name);
  expect(await history(page)).toEqual(undoable);
  await expect(page.getByTestId('practice-check')).toBeDisabled();
  await goToName(page, testList, testList.names[testList.names.length - 1].name);
  await expect(next).toBeDisabled();
});

test('Show answer: a picture of the answer after a wrong Check; the canvas is untouched', async ({ app }) => {
  const { page } = app;
  await serveLists(page, testLists);
  await openEditor(app);
  await openPractice(page, testList);
  await load(page, caseNamed('the other enantiomer').molfile!);
  const before = await page.evaluate(() => window.ketcher!.getKet());
  expect(await check(page)).toBe('stereo');
  await page.getByTestId('practice-show-answer').click();
  const picture = page.getByTestId('practice-answer').locator('img');
  await expect(picture).toBeVisible();
  expect(await picture.getAttribute('src')).toMatch(/^data:image\/svg\+xml;base64,/);
  expect(await picture.evaluate((img: HTMLImageElement) => img.decode().then(() => img.naturalWidth))).toBeGreaterThan(0);
  // The canvas view has made up for the height the panel takes, the picture included
  // (Docked, as for the NMR preview), so the drawing isn't pushed behind the panel.
  const panel = page.getByTestId('practice-panel');
  await expect(panel).toHaveAttribute('data-docked', String(await panel.evaluate((e) => (e as HTMLElement).offsetHeight)));
  expect(await page.evaluate(() => window.ketcher!.getKet())).toBe(before);
  await expect(page.getByTestId('practice-show-answer')).toHaveCount(0);
  // It stays while the student edits, and goes with the name.
  await placeRing(page);
  await expect(picture).toBeVisible();
  await move(page, 'next', testList.names[1].name);
  await expect(page.getByTestId('practice-answer')).toHaveCount(0);
});

test('the panel docks below the canvas, closes three ways, and leaves naming available', async ({ app }) => {
  const { page } = app;
  await serveLists(page, testLists);
  await openEditor(app);
  const button = page.getByTestId('app-practice-button');
  await expect(button).toHaveAttribute('aria-pressed', 'false');
  await openPractice(page, testList);
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  const panel = await page.getByTestId('practice-panel').boundingBox();
  const editor = await page.locator('.editor').boundingBox();
  expect(panel!.y).toBeGreaterThanOrEqual(editor!.y + editor!.height);
  // Name to structure and Get name stay as they are (decision 4).
  await load(page, testList.names[0].molfile);
  await expect(page.getByTestId('app-get-name-button')).toBeEnabled();
  await expect(page.getByTestId('name-to-structure-input')).toBeEnabled();

  await page.getByTestId('practice-close').click();
  await expect(page.getByTestId('practice-panel')).toHaveCount(0);
  await button.click();
  await page.getByTestId('practice-next').focus();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('practice-panel')).toHaveCount(0);
  await button.click();
  await expect(page.getByTestId('practice-panel')).toBeVisible();
  // Closing and opening again comes back to the same name.
  await expect(page.getByTestId('practice-name')).toHaveText(testList.names[0].name);
  await button.click();
  await expect(page.getByTestId('practice-panel')).toHaveCount(0);
});

test('practising stores nothing and sends nothing', async ({ app }) => {
  const { page } = app;
  await serveLists(page, testLists);
  await openEditor(app);
  const storage = () =>
    page.evaluate((autosave) => {
      const all = (s: Storage) => Object.fromEntries(Object.keys(s).filter((k) => k !== autosave).map((k) => [k, s.getItem(k)]));
      return indexedDB.databases().then((dbs) => ({
        local: all(localStorage),
        session: all(sessionStorage),
        indexedDB: dbs.map((d) => d.name).sort(),
      }));
    }, autosaveKey(resolveBase()));
  // Ketcher writes its own settings when its second editor starts (src/editor/KetcherEditor.tsx).
  await page.evaluate(() => (window as unknown as { __secondInit: Promise<true> }).__secondInit);
  const before = await storage();
  await openPractice(page, testList);
  await load(page, caseNamed('the other enantiomer').molfile!);
  expect(await check(page)).toBe('stereo');
  await page.getByTestId('practice-show-answer').click();
  await expect(page.getByTestId('practice-answer')).toBeVisible();
  await move(page, 'next', testList.names[1].name);
  await load(page, testList.names[1].molfile);
  expect(await check(page)).toBe('correct');
  await page.getByTestId('practice-close').click();
  expect(await storage()).toEqual(before);
  const uploads = app.requests.filter((r) => r.method() !== 'GET').map((r) => `${r.method()} ${r.url()}`);
  expect(uploads).toEqual([]);
});

test('offline: the lists come from the precache and Check works with the network cut', async ({ app }) => {
  const { page } = app;
  await goOffline(app);
  const [list] = shipped.lists;
  await openPractice(page, list);
  await load(page, list.names[0].molfile);
  expect(await check(page)).toBe('correct');
});

test('lists that fail to load say so, and opening Practice again tries again', async ({ app }) => {
  const { page } = app;
  let fail = true;
  await page.route(`**/${PRACTICE_FILE}`, (route) =>
    fail ? route.abort('failed') : route.fulfill({ json: testLists }),
  );
  await openEditor(app);
  await page.getByTestId('app-practice-button').click();
  await expect(page.getByTestId('practice-message')).toContainText("didn't load");
  fail = false;
  await page.getByTestId('practice-close').click();
  await openPractice(page, testList);
});

test('two lists: the chooser switches list, back to its first name, and clears the canvas', async ({ app }) => {
  const { page } = app;
  const two = { lists: [testList, ...shipped.lists] };
  await serveLists(page, two);
  await openEditor(app);
  await openPractice(page, testList);
  await move(page, 'next', testList.names[1].name);
  await load(page, testList.names[1].molfile);
  await page.getByTestId('practice-list').selectOption({ label: shipped.lists[0].title });
  await expect(page.getByTestId('practice-name')).toHaveText(shipped.lists[0].names[0].name);
  await expect(page.getByTestId('practice-position')).toHaveText(`1 of ${shipped.lists[0].names.length}`);
  await expect.poll(() => page.evaluate(() => window.ketcher!.editor.struct().isBlank())).toBe(true);
});

