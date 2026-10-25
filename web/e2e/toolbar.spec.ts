// Ketcher's left toolbar: hand, select and eraser stay put while the tools below them scroll
// (src/editor/editor.css). Every scroll here is waited for by its scrollend event.
import type { Locator, Page } from '@playwright/test';
import { expect, openEditor, test } from './fixtures.ts';

const PINNED = ['hand', 'select-rectangle', 'erase'];

function toolbar(page: Page) {
  const root = page.getByTestId('left-toolbar').filter({ visible: true });
  return {
    root,
    column: root.getByTestId('left-toolbar-buttons'),
    pinned: root.locator('[data-testid="left-toolbar-buttons"] > div:first-child'),
    down: root.getByTestId('arrow-scroll-right-button'),
    up: root.getByTestId('arrow-scroll-left-button'),
  };
}

async function tops(page: Page, ids: string[]): Promise<number[]> {
  const root = toolbar(page).root;
  return Promise.all(ids.map(async (id) => (await root.getByTestId(id).boundingBox())!.y));
}

function scrollTop(column: Locator): Promise<number> {
  return column.evaluate((e) => e.scrollTop);
}

/** Do `act`, and resolve once the column has finished the scroll it starts. */
async function scrolled(column: Locator, act: () => Promise<void>): Promise<void> {
  await column.evaluate((e) => {
    (window as unknown as { __scrollEnd: Promise<void> }).__scrollEnd = new Promise((resolve) =>
      e.addEventListener('scrollend', () => resolve(), { once: true }),
    );
  });
  await act();
  await column.evaluate(() => (window as unknown as { __scrollEnd: Promise<void> }).__scrollEnd);
}

/** The gap below the pinned tools, as pixels: the same whatever has scrolled under it. */
async function gapPixels(page: Page, pinned: Locator): Promise<Buffer> {
  const area = (await pinned.boundingBox())!;
  const group = (await pinned.locator(':scope > div').boundingBox())!;
  const top = group.y + group.height;
  return page.screenshot({ clip: { x: area.x, y: top, width: area.width, height: area.y + area.height - top } });
}

/** Every point of the pinned area hits the pinned tools, never a tool scrolled under them,
 * and its gap looks as it did before the scroll. */
async function nothingShowsThrough(page: Page, pinned: Locator, gapBefore: Buffer): Promise<void> {
  expect((await gapPixels(page, pinned)).equals(gapBefore), 'the gap below the pinned tools is unchanged').toBe(true);
  const misses = await pinned.evaluate((area) => {
    const box = area.getBoundingClientRect();
    const bad: string[] = [];
    // Inside the column's visible part (1px of the area is above its top once scrolled).
    for (let y = Math.ceil(box.top) + 1; y < box.bottom; y += 2) {
      for (const x of [box.left + 1, box.left + box.width / 2, box.right - 1]) {
        const hit = document.elementFromPoint(x, y);
        if (!hit || !area.contains(hit)) bad.push(`${x},${y}: ${hit?.outerHTML.slice(0, 60)}`);
      }
    }
    return bad;
  });
  expect(misses).toEqual([]);
}

test('in a short window the lower tools scroll and hand, select and eraser stay put', async ({ app }) => {
  const { page } = app;
  await page.setViewportSize({ width: 1280, height: 600 });
  await openEditor(app);
  const { column, pinned, down, up } = toolbar(page);
  const [scrollHeight, clientHeight] = await column.evaluate((e) => [e.scrollHeight, e.clientHeight]);
  expect(scrollHeight).toBeGreaterThan(clientHeight); // it really overflows here
  await expect(down).toBeVisible();
  await expect(up).toHaveCount(0);
  // Scrollable now, and still with no scrollbar (Playwright's Chrome never draws one, so
  // this is read from the style).
  expect(await column.evaluate((e) => getComputedStyle(e).scrollbarWidth)).toBe('none');
  // The pinned area covers the column's whole width, its right-hand padding included.
  const [columnBox, pinnedBox] = [(await column.boundingBox())!, (await pinned.boundingBox())!];
  expect([pinnedBox.x, pinnedBox.width]).toEqual([columnBox.x, columnBox.width]);
  const pinnedBefore = await tops(page, PINNED);
  const [textBefore] = await tops(page, ['text']);
  const gapBefore = await gapPixels(page, pinned);

  // Ketcher's down arrow.
  await scrolled(column, () => down.click());
  const byArrow = await scrollTop(column);
  expect(byArrow).toBeGreaterThan(0);
  expect((await tops(page, ['text']))[0]).toBeCloseTo(textBefore - byArrow, 0);
  (await tops(page, PINNED)).forEach((top, i) => expect(Math.abs(top - pinnedBefore[i])).toBeLessThanOrEqual(1));
  await nothingShowsThrough(page, pinned, gapBefore);
  await expect(up).toBeVisible(); // and back up, with Ketcher's up arrow
  await scrolled(column, () => up.click());
  expect(await scrollTop(column)).toBe(0);
  await expect(up).toHaveCount(0);
  expect(await tops(page, PINNED)).toEqual(pinnedBefore);

  // The mouse wheel, over the lower tools.
  const chain = (await toolbar(page).root.getByTestId('chain').boundingBox())!;
  await page.mouse.move(chain.x + chain.width / 2, chain.y + chain.height / 2);
  await scrolled(column, () => page.mouse.wheel(0, 200));
  const byWheel = await scrollTop(column);
  expect(byWheel).toBeGreaterThan(0);
  expect((await tops(page, ['text']))[0]).toBeCloseTo(textBefore - byWheel, 0);
  (await tops(page, PINNED)).forEach((top, i) => expect(Math.abs(top - pinnedBefore[i])).toBeLessThanOrEqual(1));
  await nothingShowsThrough(page, pinned, gapBefore);

  // The wheel went to the end, where the chain tool is under the pinned ones; given the
  // keyboard focus, it scrolls out from under them.
  expect(byWheel).toBe(scrollHeight - clientHeight);
  const chainTool = toolbar(page).root.getByTestId('chain');
  const under = (await chainTool.boundingBox())!;
  const area = (await pinned.boundingBox())!;
  expect(under.y).toBeLessThan(area.y + area.height); // under them before
  await scrolled(column, () => chainTool.focus());
  expect((await chainTool.boundingBox())!.y).toBeGreaterThanOrEqual(area.y + area.height);
});

test('in a very short editor the whole column scrolls, as Ketcher has it', async ({ app }) => {
  const { page } = app;
  await page.setViewportSize({ width: 1280, height: 360 });
  await openEditor(app);
  const { column, pinned } = toolbar(page);
  expect(await pinned.evaluate((e) => getComputedStyle(e).position)).not.toBe('sticky');
  // Every tool can be reached: at the end of the column the last one is in view, unhidden.
  await scrolled(column, () => column.evaluate((e) => (e.scrollTop = e.scrollHeight)).then(() => {}));
  const hand = (await toolbar(page).root.getByTestId('hand').boundingBox())!;
  const columnBox = (await column.boundingBox())!;
  expect(hand.y + hand.height).toBeLessThanOrEqual(columnBox.y); // scrolled away with the rest
  const last = toolbar(page).root.getByTestId('images');
  const box = (await last.boundingBox())!;
  const hit = await page.evaluate(
    ([x, y]) => document.elementFromPoint(x, y)?.closest('[data-testid="images"]') !== null,
    [box.x + box.width / 2, box.y + box.height / 2],
  );
  expect(hit).toBe(true);
});

test('in a tall window nothing scrolls and the tools sit as Ketcher lays them out', async ({ app }) => {
  const { page } = app;
  await page.setViewportSize({ width: 1280, height: 1000 });
  await openEditor(app);
  const { column, pinned, down, up } = toolbar(page);
  const [scrollHeight, clientHeight] = await column.evaluate((e) => [e.scrollHeight, e.clientHeight]);
  expect(scrollHeight).toBe(clientHeight);
  await expect(down).toHaveCount(0);
  await expect(up).toHaveCount(0);
  // Ketcher's 6px gap below the first group, now padding instead of margin.
  const area = (await pinned.boundingBox())!;
  const next = (await column.locator(':scope > div:nth-child(2)').boundingBox())!;
  const group = (await pinned.locator(':scope > div').boundingBox())!;
  expect(next.y - (group.y + group.height)).toBeCloseTo(6, 0);
  expect(next.y).toBeCloseTo(area.y + area.height, 0);
});
