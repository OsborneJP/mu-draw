// The lab glassware (docs/plans/v2-glassware.md, bars A3, B and C): pieces picked from the
// Templates menu's Glassware tab follow the mouse until a click places them, as templates do,
// and are then Ketcher images that autosave, KET, Copy image and Export keep, and that the
// chemistry formats leave out. The pieces are web/public/glassware/*.svg, listed in
// src/editor/glassware.json (both made by scripts/build_glassware.py).
import { readFileSync } from 'node:fs';
import type { Page, Route } from '@playwright/test';
import {
  clearCanvas,
  expect,
  fixture,
  goOffline,
  inchiKey,
  nextAutosave,
  openEditor,
  openWithDialog,
  referenceCompound,
  saveWithDialog,
  test,
  type App,
} from './fixtures.ts';

const CANVAS = '[data-testid="ketcher-canvas"][data-canvasmode="molecules-mode"]';
const PLACING = 'Click on the canvas to place it. Esc cancels.';
const FORMATS_NOTE =
  'Glassware is kept by autosave, Ket Format files, Copy image and Export. Molfile, SMILES and ' +
  'other chemistry formats leave it out, and CDXML shows a placeholder.';

interface Piece {
  id: string;
  name: string;
  group: string;
  file: string;
  width: number;
  height: number;
}

const MENU = JSON.parse(readFileSync(new URL('../src/editor/glassware.json', import.meta.url), 'utf8')) as {
  groups: string[];
  credit: string;
  pieces: Piece[];
};
const PIECES = MENU.pieces;
const [FIRST, SECOND] = PIECES;

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

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Every image on the canvas, in model units. */
function images(page: Page): Promise<Box[]> {
  return page.evaluate(() =>
    [...window.ketcher!.editor.struct().images.values()].map((image) => {
      const i = image as unknown as {
        getTopLeftPosition(): { x: number; y: number };
        getBottomRightPosition(): { x: number; y: number };
      };
      const [a, b] = [i.getTopLeftPosition(), i.getBottomRightPosition()];
      return { x: a.x, y: a.y, width: b.x - a.x, height: b.y - a.y };
    }),
  );
}

function expectPlaced(box: Box, piece: Piece, at: CanvasPoint): void {
  expect(box.width).toBeCloseTo(piece.width, 3);
  expect(box.height).toBeCloseTo(piece.height, 3);
  const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  expect(Math.hypot(centre.x - at.model.x, centre.y - at.model.y)).toBeLessThan(0.5);
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

function menu(page: Page) {
  return page.getByRole('dialog', { name: 'Templates' });
}

/** Open the Templates menu on its Glassware tab. */
async function openGlassware(page: Page): Promise<void> {
  if (!(await menu(page).isVisible())) await page.getByTestId('templates-button').click();
  await page.getByRole('tab', { name: 'Glassware' }).click();
  await expect(page.getByRole('tab', { name: 'Glassware' })).toHaveAttribute('aria-selected', 'true');
}

/** Pick a piece from the menu: it is then in hand. */
async function pick(page: Page, piece: Piece): Promise<void> {
  await openGlassware(page);
  await page.getByTestId(`glassware-item-${piece.id}`).click();
  await expect(menu(page)).toHaveCount(0);
  await expect(page.getByTestId('templates-placing')).toHaveText(PLACING);
}

/** Pick `piece` and click it down at `fx`, `fy` of the canvas; returns where. */
async function place(page: Page, piece: Piece, fx = 0.5, fy = 0.5): Promise<CanvasPoint> {
  await pick(page, piece);
  const point = await canvasPoint(page, fx, fy);
  await moveTo(page, point);
  await page.mouse.click(point.x, point.y);
  await expect(page.getByTestId('templates-placing')).toHaveCount(0);
  return point;
}

async function emptyCanvas(app: App): Promise<() => Promise<number>> {
  await openEditor(app);
  await clearCanvas(app.page);
  return changeCounter(app.page);
}

/** A reference compound's Molfile, generated by RDKit (tests/fixtures/). */
function molfile(typedName: string): string {
  return fixture(referenceCompound(typedName).files.find((f) => f.endsWith('.mol'))!);
}

test('the Glassware tab lists every piece under its group, each with its picture, and says what formats keep it', async ({
  app,
}) => {
  const { page } = app;
  const changes = await emptyCanvas(app);
  await page.getByTestId('templates-button').click();
  // The Structures tab comes first and still holds the templates.
  await expect(page.getByRole('tab')).toHaveText(['Structures', 'Glassware']);
  await expect(page.getByRole('tab', { name: 'Structures' })).toHaveAttribute('aria-selected', 'true');
  await expect(menu(page).getByRole('heading')).toHaveText(['Chair', 'Newman', 'Fischer', 'Haworth']);
  // Right arrow on the tabs shows Glassware.
  await page.getByRole('tab', { name: 'Structures' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Glassware' })).toBeFocused();
  await expect(menu(page).getByRole('heading')).toHaveText(MENU.groups);
  for (const group of MENU.groups) {
    const items = PIECES.filter((p) => p.group === group);
    const buttons = menu(page).getByRole('region', { name: group }).getByRole('button');
    await expect(buttons).toHaveCount(items.length);
    for (const [i, piece] of items.entries()) {
      await expect(buttons.nth(i)).toHaveAccessibleName(piece.name);
      const picture = page.getByTestId(`glassware-picture-${piece.id}`);
      await expect(picture).toHaveAttribute('src', `${new URL(app.server.url).pathname}${piece.file}`);
      await expect.poll(() => picture.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
    }
  }
  await expect(page.getByTestId('glassware-note')).toHaveText(FORMATS_NOTE);
  await expect(page.getByTestId('glassware-credit')).toHaveText(`${MENU.credit} Details: About.`);
  await expect(menu(page).locator('a')).toHaveCount(0); // plain text only
  // Esc closes it, adding nothing; the About box carries the same credit.
  await page.keyboard.press('Escape');
  await expect(menu(page)).toHaveCount(0);
  await page.getByTestId('app-about-button').click();
  await expect(page.getByTestId('about-glassware-credit')).toHaveText(`Lab glassware: ${MENU.credit}`);
  expect(await images(page)).toEqual([]);
  expect(await changes()).toBe(0);
});

test('every piece follows the mouse, a click places it there at its size as one change, and one Undo removes it', async ({
  app,
}) => {
  const { page } = app;
  const changes = await emptyCanvas(app);
  for (const piece of PIECES) {
    await page.getByTestId('bonds').filter({ visible: true }).click();
    await pick(page, piece);
    const a = await canvasPoint(page, 0.3, 0.4);
    await moveTo(page, a);
    expectPlaced((await images(page))[0], piece, a); // shown under the mouse...
    const before = await changes();
    const b = await canvasPoint(page, 0.55, 0.5);
    await moveTo(page, b);
    await page.mouse.click(b.x, b.y);
    await expect(page.getByTestId('templates-placing')).toHaveCount(0);
    const placed = await images(page);
    expect(placed).toHaveLength(1);
    expectPlaced(placed[0], piece, b);
    expect(await changes()).toBe(before + 1); // ...and placed as one change
    // The selection tool is back (the bond tool chosen before would draw a bond).
    await expect.poll(() => chosenTools(page)).toEqual(['select-rectangle']);
    await undo(page);
    await expect.poll(() => images(page)).toEqual([]);
  }
});

test('Esc or another tool puts a piece away with nothing added', async ({ app }) => {
  const { page } = app;
  const changes = await emptyCanvas(app);
  await pick(page, FIRST);
  await moveTo(page, await canvasPoint(page, 0.5, 0.5));
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('templates-placing')).toHaveCount(0);
  await expect.poll(() => images(page)).toEqual([]);
  await pick(page, SECOND);
  await page.getByTestId('bonds').filter({ visible: true }).click();
  await expect(page.getByTestId('templates-placing')).toHaveCount(0);
  const point = await canvasPoint(page, 0.5, 0.5);
  await page.mouse.click(point.x, point.y); // draws a bond, not the piece
  expect(await images(page)).toEqual([]);
  expect(await changes()).toBe(1);
});

test('a piece and a template put each other away; the one picked last is placed', async ({ app }) => {
  const { page } = app;
  await emptyCanvas(app);
  await page.getByTestId('templates-button').click();
  await page.getByTestId('template-item-chair').click();
  await expect(page.getByTestId('templates-placing')).toHaveText(PLACING);
  const point = await place(page, FIRST);
  const placed = await images(page);
  expect(placed).toHaveLength(1);
  expectPlaced(placed[0], FIRST, point);
  expect(await page.evaluate(() => window.ketcher!.editor.struct().atoms.size)).toBe(0);
  // And the other way round.
  await pick(page, SECOND);
  await page.getByTestId('templates-button').click();
  await page.getByRole('tab', { name: 'Structures' }).click();
  await page.getByTestId('template-item-chair').click();
  const there = await canvasPoint(page, 0.3, 0.3);
  await moveTo(page, there);
  await page.mouse.click(there.x, there.y);
  await expect(page.getByTestId('templates-placing')).toHaveCount(0);
  expect(await images(page)).toHaveLength(1);
  expect(await page.evaluate(() => window.ketcher!.editor.struct().atoms.size)).toBeGreaterThan(0);
});

/** Holds the app's fetch of `piece`'s file (the tab's pictures load the same file as
 * images; those go through). The first visit isn't controlled by the service worker yet, so
 * the file comes over the network, where the test can hold it. `asked` resolves once the
 * fetch is held; `release` lets it go. */
async function holdFile(page: Page, piece: Piece) {
  let held: Route | null = null;
  const asked = new Promise<void>((resolve) =>
    page.route(`**/${piece.file}`, (route) => {
      if (route.request().resourceType() !== 'fetch') return route.continue();
      held = route;
      resolve();
    }),
  );
  return { asked, release: () => held!.continue() };
}

/** Resolves once the page has read the body of `url` (Response.arrayBuffer): the pick that
 * asked for it has then run on from there before the test's next step. Call before the read. */
async function bodyRead(page: Page, url: string): Promise<Promise<void>> {
  await page.evaluate(() => {
    const w = window as unknown as { __readOf?: (url: string) => Promise<void> };
    if (w.__readOf) return;
    const read = new Map<string, () => void>();
    const reads = new Map<string, Promise<void>>();
    const arrayBuffer = Response.prototype.arrayBuffer;
    Response.prototype.arrayBuffer = async function (this: Response) {
      const body = await arrayBuffer.call(this);
      read.get(this.url)?.();
      return body;
    };
    w.__readOf = (u) => {
      if (!reads.has(u)) reads.set(u, new Promise((resolve) => read.set(u, resolve)));
      return reads.get(u)!;
    };
  });
  return page.evaluate((u) => (window as unknown as { __readOf: (u: string) => Promise<void> }).__readOf(u), url);
}

test("a piece whose file arrives after a later pick is put away, and the later one stays in hand", async ({ app }) => {
  const { page } = app;
  await emptyCanvas(app);
  const file = await holdFile(page, FIRST);
  const firstRead = bodyRead(page, new URL(FIRST.file, app.server.url).href);
  await openGlassware(page);
  await page.getByTestId(`glassware-item-${FIRST.id}`).click();
  await file.asked; // the first piece's file is on its way, and held
  await expect(page.getByTestId('templates-placing')).toHaveCount(0);
  await pick(page, SECOND); // the second is in hand
  await file.release();
  await firstRead; // the first piece's file is read; its pick has run on from there
  await expect(page.getByTestId('templates-placing')).toHaveText(PLACING);
  const point = await canvasPoint(page, 0.5, 0.5);
  await moveTo(page, point);
  await page.mouse.click(point.x, point.y);
  const placed = await images(page);
  expect(placed).toHaveLength(1);
  expectPlaced(placed[0], SECOND, point);
});

test('Esc, or another tool, while a piece is loading: it never arrives in hand', async ({ app }) => {
  const { page } = app;
  const changes = await emptyCanvas(app);
  // Esc.
  let file = await holdFile(page, FIRST);
  let read = bodyRead(page, new URL(FIRST.file, app.server.url).href);
  await openGlassware(page);
  await page.getByTestId(`glassware-item-${FIRST.id}`).click();
  await file.asked;
  await page.keyboard.press('Escape');
  await file.release();
  await read;
  await expect(page.getByTestId('templates-placing')).toHaveCount(0);
  const point = await canvasPoint(page, 0.5, 0.5);
  await moveTo(page, point);
  await page.mouse.click(point.x, point.y);
  expect(await images(page)).toEqual([]);
  expect(await changes()).toBe(0);
  // The bond tool: the next click draws a bond, not the piece.
  file = await holdFile(page, SECOND);
  read = bodyRead(page, new URL(SECOND.file, app.server.url).href);
  await openGlassware(page);
  await page.getByTestId(`glassware-item-${SECOND.id}`).click();
  await file.asked;
  await page.getByTestId('bonds').filter({ visible: true }).click();
  await file.release();
  await read;
  await expect(page.getByTestId('templates-placing')).toHaveCount(0);
  await page.mouse.click(point.x, point.y);
  expect(await images(page)).toEqual([]);
  expect(await page.evaluate(() => window.ketcher!.editor.struct().bonds.size)).toBe(1);
});

test('offline: a piece is picked and placed from the precache', async ({ app }) => {
  const { page } = app;
  await goOffline(app);
  await clearCanvas(page);
  const point = await place(page, FIRST);
  const placed = await images(page);
  expect(placed).toHaveLength(1);
  expectPlaced(placed[0], FIRST, point);
});

test('placing a piece asks only for its own file, and the app reads it as a picture, not a structure', async ({
  app,
}) => {
  const { page } = app;
  await emptyCanvas(app);
  const from = app.requests.length;
  await place(page, FIRST);
  // The app's own fetches of glassware (the tab's pictures load as images, and the service
  // worker precaches every file in the background): just this piece's file.
  const fetched = app.requests
    .slice(from)
    .filter((r) => r.resourceType() === 'fetch' && !r.serviceWorker() && r.url().includes('/glassware/'))
    .map((r) => r.url());
  expect(fetched).toEqual([new URL(FIRST.file, app.server.url).href]);
  await expect(page.getByTestId('properties-message')).toHaveText('Draw a structure to see its properties');
  // Molfile and SMILES leave it out, and CDXML holds Indigo's placeholder for an SVG image
  // (decision 5): these fail if a Ketcher upgrade changes what happens.
  const formats = await page.evaluate(async () => {
    const k = window.ketcher!;
    return { smiles: await k.getSmiles(), molfile: await k.getMolfile('v2000'), cdxml: await k.getCDXml() };
  });
  expect(formats.smiles).toBe('');
  // The counts line (the fourth): no atoms, no bonds.
  const counts = formats.molfile.split('\n')[3];
  expect([Number(counts.slice(0, 3)), Number(counts.slice(3, 6))]).toEqual([0, 0]);
  const embedded = [...formats.cdxml.matchAll(/<embeddedobject [^>]*PNG="([0-9a-f]+)"/g)].map((m) =>
    Buffer.from(m[1], 'hex'),
  );
  expect(embedded).toHaveLength(1);
  // Indigo's "image not available" icon: a 1024 × 1024 palette PNG, whatever the piece.
  expect([embedded[0].readUInt32BE(16), embedded[0].readUInt32BE(20), embedded[0][25]]).toEqual([1024, 1024, 3]);
});

test('next to a structure, a piece changes nothing the app works out, and is drawn behind it', async ({ app }) => {
  const { page } = app;
  await emptyCanvas(app);
  await page.evaluate((mol) => window.ketcher!.setMolecule(mol), molfile('aspirin'));
  const panel = page.getByTestId('properties-panel');
  await expect(panel).toHaveAttribute('data-state', 'ready');
  const formula = await page.getByTestId('prop-formula').getAttribute('data-formula');
  const key = await inchiKey(page);
  await place(page, FIRST, 0.3, 0.5);
  await expect(panel).toHaveAttribute('data-state', 'ready');
  await expect(page.getByTestId('prop-formula')).toHaveAttribute('data-formula', formula!);
  expect(await inchiKey(page)).toBe(key);
  // Ketcher draws images in a layer under the structure: every atom label (aspirin's O and
  // OH) comes after it. Only labels are judged: after a placement by hand the canvas also
  // held one other <text>, before the image.
  const order = await page.evaluate(() => {
    const image = document.querySelector('[data-testid="ketcher-canvas"] image')!;
    const labels = [...document.querySelectorAll('[data-testid="ketcher-canvas"] text')].filter((t) =>
      /^O/.test(t.textContent ?? ''),
    );
    return { labels: labels.length, after: labels.filter((t) => image.compareDocumentPosition(t) & Node.DOCUMENT_POSITION_FOLLOWING).length };
  });
  expect(order.labels).toBeGreaterThan(0);
  expect(order.after).toBe(order.labels);
});

test('a placed piece comes back after a relaunch, and through a KET file', async ({ app }) => {
  const { page } = app;
  await emptyCanvas(app);
  const saved = await nextAutosave(page);
  await place(page, FIRST);
  const file = readFileSync(new URL(`../public/${FIRST.file}`, import.meta.url));
  expect(await saved()).toContain(file.toString('base64'));
  await app.relaunch();
  await openEditor(app);
  // Ketcher may move a restored drawing (AGENTS.md), so its size is what is compared.
  const restored = await images(app.page);
  expect(restored).toHaveLength(1);
  expect(restored[0].width).toBeCloseTo(FIRST.width, 3);
  expect(restored[0].height).toBeCloseTo(FIRST.height, 3);
  const path = test.info().outputPath('glassware.ket');
  const ket = await saveWithDialog(app, 'Ket Format', /"type":\s*"image"/, path);
  expect(JSON.parse(ket).root.nodes.filter((n: { type: string }) => n.type === 'image')).toHaveLength(1);
  await clearCanvas(app.page);
  expect(await images(app.page)).toEqual([]);
  await openWithDialog(app, path);
  expect(await images(app.page)).toHaveLength(1);
});

test('Export and Copy image include the piece, drawn from its 4× picture', async ({ app }) => {
  const { page } = app;
  await app.context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(app.server.url).origin });
  await emptyCanvas(app);
  await place(page, FIRST);
  await page.getByTestId('app-export-button').click();
  const dialog = page.getByRole('dialog', { name: 'Export image' });
  const [svgDownload] = await Promise.all([
    page.waitForEvent('download'),
    dialog.getByRole('button', { name: 'Download SVG' }).click(),
  ]);
  const svg = readFileSync((await svgDownload.path())!, 'utf8');
  // Indigo draws the piece as a PNG of the shipped SVG's own size (4× its placed size).
  const tags = [...svg.matchAll(/<image [^>]*width="([\d.]+)" height="([\d.]+)"[^>]*xlink:href="data:image\/png;base64,/g)];
  expect(tags).toHaveLength(1);
  expect(Math.abs(Number(tags[0][1]) - FIRST.width * 160)).toBeLessThanOrEqual(1);
  expect(Math.abs(Number(tags[0][2]) - FIRST.height * 160)).toBeLessThanOrEqual(1);
  const [pngDownload] = await Promise.all([
    page.waitForEvent('download'),
    dialog.getByRole('button', { name: 'Download PNG' }).click(),
  ]);
  expect(await inked(page, readFileSync((await pngDownload.path())!))).toBeGreaterThan(0);
  await page.keyboard.press('Escape');
  const status = page.getByTestId('copy-status');
  await page.getByTestId('app-copy-image-button').click();
  await expect(status).toHaveText('Image copied');
  const copied = await page.evaluate(async () => {
    const [item] = await navigator.clipboard.read();
    const bytes = new Uint8Array(await (await item.getType('image/png')).arrayBuffer());
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  });
  expect(await inked(page, Buffer.from(copied, 'base64'))).toBeGreaterThan(0);
});

/** How many of a PNG's pixels are drawn on (neither white nor transparent). */
function inked(page: Page, png: Buffer): Promise<number> {
  return page.evaluate(async (base64) => {
    const data = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([data], { type: 'image/png' }));
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext('2d', { willReadFrequently: true })!;
    context.drawImage(bitmap, 0, 0);
    const rgba = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
    let count = 0;
    for (let i = 0; i < rgba.length; i += 4) {
      if (rgba[i + 3] > 0 && (rgba[i] < 250 || rgba[i + 1] < 250 || rgba[i + 2] < 250)) count++;
    }
    return count;
  }, png.toString('base64'));
}

test("each piece's crop box holds all of its ink, tight to within 2 placed px on every side", async ({ app }) => {
  const { page } = app;
  await page.goto(app.server.url);
  const results = [];
  for (const piece of PIECES) {
    const text = readFileSync(new URL(`../public/${piece.file}`, import.meta.url), 'utf8');
    results.push({
      id: piece.id,
      ...(await page.evaluate(async (svg) => {
        // Drawn at its shipped size (4 px per placed px), inside a box 20% wider each way.
        const doc = new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement;
        const [x, y, w, h] = doc.getAttribute('viewBox')!.split(' ').map(Number);
        const [width, height] = [Number(doc.getAttribute('width')), Number(doc.getAttribute('height'))];
        const [mx, my] = [w * 0.2, h * 0.2];
        doc.setAttribute('viewBox', `${x - mx} ${y - my} ${w + 2 * mx} ${h + 2 * my}`);
        const [cw, ch] = [Math.round(width * 1.4), Math.round(height * 1.4)];
        doc.setAttribute('width', String(cw));
        doc.setAttribute('height', String(ch));
        const image = new Image();
        image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(doc))}`;
        await image.decode();
        const canvas = new OffscreenCanvas(cw, ch);
        const context = canvas.getContext('2d', { willReadFrequently: true })!;
        context.drawImage(image, 0, 0, cw, ch);
        const rgba = context.getImageData(0, 0, cw, ch).data;
        let [x0, y0, x1, y1] = [cw, ch, -1, -1];
        for (let py = 0; py < ch; py++) {
          for (let px = 0; px < cw; px++) {
            if (rgba[(py * cw + px) * 4 + 3] > 8) {
              x0 = Math.min(x0, px);
              x1 = Math.max(x1, px + 1);
              y0 = Math.min(y0, py);
              y1 = Math.max(y1, py + 1);
            }
          }
        }
        // The box's edges on this canvas, and the gap from each edge to the ink, in placed
        // px (4 canvas px each); negative is ink outside the box.
        const [left, top] = [(cw * 0.2) / 1.4, (ch * 0.2) / 1.4];
        const [right, bottom] = [cw - left, ch - top];
        return { gaps: [x0 - left, y0 - top, right - x1, bottom - y1].map((g) => Math.round((g / 4) * 100) / 100) };
      }, text)),
    });
  }
  for (const { id, gaps } of results) {
    for (const gap of gaps) {
      expect(gap, `${id}: ${gaps}`).toBeGreaterThanOrEqual(-0.25);
      expect(gap, `${id}: ${gaps}`).toBeLessThanOrEqual(2);
    }
  }
});
