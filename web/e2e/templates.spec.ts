// The Templates menu (docs/plans/v2-templates.md, bars B and C): each template is picked from
// the header, follows the mouse over the canvas until a click places it, and is then what
// the generator says it is (tests/fixtures/templates_expected.json, from PubChem and RDKit).
import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import {
  clearCanvas,
  expect,
  fixture,
  goOffline,
  inchiKey,
  nextAutosave,
  openEditor,
  test,
  waitForEditor,
  type App,
} from './fixtures.ts';

const CANVAS = '[data-testid="ketcher-canvas"][data-canvasmode="molecules-mode"]';
const PLACING = 'Click on the canvas to place it. Esc cancels.';

interface Panel {
  formula: string;
  stereo: { centres: string; undefined: string };
}

interface Expected {
  id: string;
  source: string | null;
  atoms: number;
  bonds: number;
  shapes: number;
  texts: number;
  inchikey?: string;
  panel?: Panel;
}

interface MenuTemplate {
  id: string;
  group: string;
  name: string;
}

const EXPECTED = (JSON.parse(fixture('templates_expected.json')) as { templates: Expected[] }).templates;
const MENU = (
  JSON.parse(readFileSync(new URL('../src/editor/templates.json', import.meta.url), 'utf8')) as {
    templates: MenuTemplate[];
  }
).templates;
const MOLECULES = EXPECTED.filter((t) => t.source !== null);
const PICTURES = EXPECTED.filter((t) => t.atoms === 0);
const NOTHING = { atoms: 0, bonds: 0, shapes: 0, texts: 0 };

type Counts = typeof NOTHING;

function counts(page: Page): Promise<Counts> {
  return page.evaluate(() => {
    const struct = window.ketcher!.editor.struct();
    return { atoms: struct.atoms.size, bonds: struct.bonds.size, shapes: struct.simpleObjects.size, texts: struct.texts.size };
  });
}

function sizeOf(template: Expected): Counts {
  return { atoms: template.atoms, bonds: template.bonds, shapes: template.shapes, texts: template.texts };
}

interface CanvasPoint {
  x: number;
  y: number;
  model: { x: number; y: number };
}

/** A point on the open canvas, as fractions of its box: on the page, and in model units. */
async function canvasPoint(page: Page, fx: number, fy: number): Promise<CanvasPoint> {
  const box = (await page.locator(CANVAS).boundingBox())!;
  const [x, y] = [box.x + box.width * fx, box.y + box.height * fy];
  const model = await page.evaluate(
    ([px, py]) =>
      (
        window.ketcher!.editor as unknown as {
          render: { page2obj(e: { clientX: number; clientY: number; pageX: number; pageY: number }): { x: number; y: number } };
        }
      ).render.page2obj({ clientX: px, clientY: py, pageX: px, pageY: py }),
    [x, y],
  );
  return { x, y, model };
}

/** Ketcher redraws what is in hand at most once a frame, so the next move waits a frame. */
async function moveTo(page: Page, point: CanvasPoint): Promise<void> {
  await page.mouse.move(point.x, point.y);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
}

/** The centre of everything drawn (atoms, shapes, text), in model units. */
function centre(page: Page): Promise<{ x: number; y: number }> {
  return page.evaluate(() => {
    const struct = window.ketcher!.editor.struct();
    const points = [
      ...[...struct.atoms.values()].map((atom) => atom.pp),
      ...[...struct.simpleObjects.values()].flatMap((shape) => shape.pos),
      ...[...struct.texts.values()].flatMap((text) => text.pos),
    ];
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    return { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
  });
}

async function expectNear(page: Page, point: CanvasPoint): Promise<void> {
  const at = await centre(page);
  expect(Math.hypot(at.x - point.model.x, at.y - point.model.y)).toBeLessThan(0.5);
}

/** Counts the drawing's change events from now on. */
async function changeCounter(page: Page): Promise<() => Promise<number>> {
  await page.evaluate(() => {
    const w = window as unknown as { __changes: number };
    w.__changes = 0;
    window.ketcher!.changeEvent.add(() => (w.__changes += 1));
  });
  return () => page.evaluate(() => (window as unknown as { __changes: number }).__changes);
}

/** The tools Ketcher's left toolbar shows as chosen. */
function chosenTools(page: Page): Promise<(string | null)[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll('[data-testid=left-toolbar] [data-testid]')]
      .filter((e) => (e as HTMLElement).offsetParent !== null && e.className.toString().includes('selected'))
      .map((e) => e.getAttribute('data-testid')),
  );
}

/** Click Ketcher's visible Undo once it is enabled (it refreshes 100 ms after a change). */
async function undo(page: Page): Promise<void> {
  const button = page.getByTestId('undo').filter({ visible: true });
  await expect(button).toBeEnabled();
  await button.click();
}

/** Pick a template from the menu: it is then in hand. */
async function pick(page: Page, id: string): Promise<void> {
  await page.getByTestId('templates-button').click();
  await page.getByTestId(`template-item-${id}`).click();
  await expect(page.getByRole('dialog', { name: 'Templates' })).toHaveCount(0);
  await expect(page.getByTestId('templates-placing')).toHaveText(PLACING);
}

/** An empty canvas and a counter of its changes. */
async function emptyCanvas(app: App): Promise<() => Promise<number>> {
  await openEditor(app);
  await clearCanvas(app.page);
  return changeCounter(app.page);
}

test('the menu shows every template under its group, each with its picture', async ({ app }) => {
  const { page } = app;
  const changes = await emptyCanvas(app);
  const button = page.getByTestId('templates-button');
  await button.click();
  const menu = page.getByRole('dialog', { name: 'Templates' });
  const groups = [...new Set(MENU.map((t) => t.group))];
  await expect(menu.getByRole('heading')).toHaveText(groups);
  for (const group of groups) {
    const section = menu.getByRole('region', { name: group });
    const items = MENU.filter((t) => t.group === group);
    const buttons = section.getByRole('button');
    await expect(buttons).toHaveCount(items.length);
    for (const [i, item] of items.entries()) {
      await expect(buttons.nth(i)).toHaveAccessibleName(item.name);
      // Drawn by Ketcher's renderer: bonds are SVG paths.
      await expect(page.getByTestId(`template-picture-${item.id}`).locator('svg path').first()).toBeAttached();
    }
  }
  await expect(menu.getByRole('button').first()).toBeFocused();
  // Esc closes it, back to the button; so does a press anywhere else, adding nothing.
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(button).toBeFocused();
  await button.click();
  await expect(menu).toBeVisible();
  const away = await canvasPoint(page, 0.2, 0.7);
  await page.mouse.click(away.x, away.y);
  await expect(menu).toHaveCount(0);
  await expect(page.getByTestId('templates-placing')).toHaveCount(0);
  expect(await counts(page)).toEqual(NOTHING);
  expect(await changes()).toBe(0);
});

for (const template of EXPECTED) {
  test(`${template.id}: it follows the mouse, a click places it there as one change, and one Undo removes it`, async ({
    app,
  }) => {
    const { page } = app;
    const changes = await emptyCanvas(app);
    await page.getByTestId('bonds').filter({ visible: true }).click();
    await pick(page, template.id);
    const a = await canvasPoint(page, 0.25, 0.4);
    await moveTo(page, a);
    expect(await counts(page)).toEqual(sizeOf(template)); // shown under the mouse...
    await expectNear(page, a);
    const b = await canvasPoint(page, 0.6, 0.6);
    await moveTo(page, b);
    await expectNear(page, b);
    expect(await changes()).toBe(0); // ...but not yet part of the drawing
    await page.mouse.click(b.x, b.y);
    await expect(page.getByTestId('templates-placing')).toHaveCount(0);
    await expectNear(page, b);
    expect(await counts(page)).toEqual(sizeOf(template));
    expect(await changes()).toBe(1);
    // The selection tool is back (the bond tool chosen before would draw a bond).
    await expect.poll(() => chosenTools(page)).toEqual(['select-rectangle']);
    await undo(page);
    await expect.poll(() => counts(page)).toEqual(NOTHING);
  });
}

for (const template of MOLECULES) {
  test(`${template.id}: on the canvas it is ${template.source}, with its stereocenters as the generator says`, async ({
    app,
  }) => {
    const { page } = app;
    await emptyCanvas(app);
    await pick(page, template.id);
    const point = await canvasPoint(page, 0.4, 0.5);
    await moveTo(page, point);
    await page.mouse.click(point.x, point.y);
    const panel = page.getByTestId('properties-panel');
    await expect(panel).toHaveAttribute('data-atoms', String(template.atoms));
    await expect(panel).toHaveAttribute('data-state', 'ready');
    await expect(page.getByTestId('prop-formula')).toHaveAttribute('data-formula', template.panel!.formula);
    await expect(page.getByTestId('stereo-centres')).toHaveText(template.panel!.stereo.centres);
    await expect(page.getByTestId('stereo-undefined')).toHaveText(template.panel!.stereo.undefined);
    expect(await inchiKey(page)).toBe(template.inchikey);
  });
}

for (const template of PICTURES) {
  test(`${template.id}: a picture, not a structure; Export draws its circle, lines and labels`, async ({ app }) => {
    const { page } = app;
    await emptyCanvas(app);
    await pick(page, template.id);
    const point = await canvasPoint(page, 0.4, 0.5);
    await moveTo(page, point);
    await page.mouse.click(point.x, point.y);
    await expect(page.getByTestId('templates-placing')).toHaveCount(0);
    await expect(page.getByTestId('properties-message')).toHaveText('Draw a structure to see its properties');
    await page.getByTestId('app-export-button').click();
    const dialog = page.getByRole('dialog', { name: 'Export image' });
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      dialog.getByRole('button', { name: 'Download SVG' }).click(),
    ]);
    const svg = readFileSync((await download.path())!, 'utf8');
    // Indigo strokes shapes as unfilled paths (a circle with curves, a line straight) and
    // draws each letter of a label as one glyph.
    const strokes = [...svg.matchAll(/<path fill="none"[^>]* d="([^"]*)"/g)].map((m) => m[1]);
    expect(strokes.filter((d) => / C /.test(d))).toHaveLength(1);
    expect(strokes.filter((d) => !/ C /.test(d))).toHaveLength(template.shapes - 1);
    expect(svg.match(/<use /g)).toHaveLength(template.texts);
  });
}

for (const [how, putAway, toolAfter] of [
  ['Esc', (page: Page) => page.keyboard.press('Escape'), 'select-rectangle'],
  ['another tool', (page: Page) => page.getByTestId('chain').filter({ visible: true }).click(), 'chain'],
] as const) {
  test(`${how} puts the template in hand away: nothing added, no change`, async ({ app }) => {
    const { page } = app;
    const changes = await emptyCanvas(app);
    const [template] = EXPECTED;
    await pick(page, template.id);
    await moveTo(page, await canvasPoint(page, 0.3, 0.5));
    expect(await counts(page)).toEqual(sizeOf(template));
    await putAway(page);
    await expect(page.getByTestId('templates-placing')).toHaveCount(0);
    await expect.poll(() => chosenTools(page)).toEqual([toolAfter]);
    expect(await counts(page)).toEqual(NOTHING);
    // Put away for good: moving over the canvas does not bring it back.
    await moveTo(page, await canvasPoint(page, 0.5, 0.6));
    expect(await counts(page)).toEqual(NOTHING);
    expect(await changes()).toBe(0);
  });
}

/** Name to structure answers from the recordings at once (its own spec holds them). */
async function answerNamesFromRecordings(page: Page): Promise<void> {
  const recorded = (
    JSON.parse(fixture('structure_responses.json')) as {
      responses: Record<string, { structure: unknown; roundtrip: unknown }>;
    }
  ).responses;
  await page.route('**/api/structure', (route) => {
    const { name } = JSON.parse(route.request().postData()!) as { name: string };
    return route.fulfill({ json: recorded[name].structure });
  });
  await page.route('**/api/name', (route) => route.fulfill({ json: recorded.cyclohexanol.roundtrip }));
}

// With the stereoisomer panel (merge review): a placed template's stereo is absolute, as
// Ketcher shows it ("abs"), so only the stereoisomer drawn matches, not its mirror image too.
test('a placed Fischer template is absolute stereo: only the drawing matches in the stereoisomer panel', async ({ app }) => {
  const { page } = app;
  await emptyCanvas(app);
  await pick(page, 'fischer-d-glucose');
  const point = await canvasPoint(page, 0.4, 0.5);
  await moveTo(page, point);
  await page.mouse.click(point.x, point.y);
  await expect(page.getByTestId('properties-panel')).toHaveAttribute('data-state', 'ready');
  await page.getByTestId('stereo-show').click();
  await expect(page.getByTestId('stereo-panel')).toHaveAttribute('data-state', 'ready');
  const matching = page.locator('[data-testid="stereo-card"][data-matches="true"]');
  await expect(matching).toHaveCount(1);
  await expect(matching).toHaveAttribute('data-inchikey', await inchiKey(page));
});

test("picking a template puts Add's compound away, and Add puts a template away", async ({ app }) => {
  const { page } = app;
  const changes = await emptyCanvas(app);
  await answerNamesFromRecordings(page);
  const [template] = EXPECTED;
  const point = await canvasPoint(page, 0.4, 0.5);
  // Add's compound in hand, then a template: the compound goes, the template stays.
  await page.getByTestId('name-to-structure-input').fill('cyclohexanol');
  await page.getByTestId('name-to-structure-add').click();
  await expect(page.getByTestId('name-panel')).toHaveAttribute('data-state', 'placing');
  await pick(page, template.id);
  await expect(page.getByTestId('name-panel')).toHaveCount(0);
  await moveTo(page, point);
  expect(await counts(page)).toEqual(sizeOf(template));
  // A template in hand, then Add: the template goes, the compound stays.
  await page.getByTestId('name-to-structure-add').click();
  await expect(page.getByTestId('name-panel')).toHaveAttribute('data-state', 'placing');
  await expect(page.getByTestId('templates-placing')).toHaveCount(0);
  await moveTo(page, await canvasPoint(page, 0.45, 0.55));
  await moveTo(page, point);
  await page.mouse.click(point.x, point.y);
  await expect(page.getByTestId('name-panel')).toHaveAttribute('data-state', 'drawn');
  expect(await changes()).toBe(1);
  expect((await counts(page)).atoms).not.toBe(template.atoms); // cyclohexanol, not the template
});

test('offline: a template is picked and placed with no network', async ({ app }) => {
  const { page } = app;
  await goOffline(app);
  await clearCanvas(page);
  const [template] = EXPECTED;
  await pick(page, template.id);
  const point = await canvasPoint(page, 0.4, 0.5);
  await moveTo(page, point);
  await page.mouse.click(point.x, point.y);
  await expect(page.getByTestId('templates-placing')).toHaveCount(0);
  expect(await counts(page)).toEqual(sizeOf(template));
});

test('a placed template survives a reload, its shapes and text too', async ({ app }) => {
  const { page } = app;
  await emptyCanvas(app);
  const [template] = PICTURES;
  await pick(page, template.id);
  const point = await canvasPoint(page, 0.4, 0.5);
  await moveTo(page, point);
  const saved = await nextAutosave(page);
  await page.mouse.click(point.x, point.y);
  await saved();
  await page.reload();
  await waitForEditor(app);
  expect(await counts(page)).toEqual(sizeOf(template));
});

test("Ketcher's own Haworth sugars (its Structure Library's Sugars group) are hidden; its other groups stay", async ({
  app,
}) => {
  const { page } = app;
  await openEditor(app);
  await page.getByTestId('template-lib').filter({ visible: true }).click();
  const sugars = page.getByTestId('Sugars-accordion-item');
  // Ketcher still makes the group (so the test looks at the right thing); it is not shown.
  await expect(sugars).toBeAttached();
  await expect(sugars).toBeHidden();
  for (const group of ['alpha-D-Sugars', 'beta-D-Sugars', 'D-Sugars', 'Rings']) {
    await expect(page.getByTestId(`${group}-accordion-item`)).toBeVisible();
  }
  // A search that lists the group's sugars shows them only in Ketcher's other groups.
  await page.getByPlaceholder('Search by elements...').fill('Glucopyranose');
  await expect(page.getByTestId('alpha-D-Sugars-accordion-item')).toBeVisible();
  await expect(sugars).toBeAttached();
  await expect(sugars).toBeHidden();
});
