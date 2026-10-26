// Autosave (src/editor/autosave.ts): the drawing lives in this browser's storage, is never
// uploaded, and comes back after a reload or relaunch, online or offline.
import type { Page } from '@playwright/test';
import { resolveBase } from '../config/app.ts';
import { autosaveKey } from '../src/editor/autosave.ts';
import {
  expect,
  expectDrawing,
  fixturePath,
  goOffline,
  history,
  inchiKey,
  ket,
  nextAutosave,
  openEditor,
  openWithDialog,
  referenceCompound,
  shape,
  test,
  waitForEditor,
} from './fixtures.ts';

const KEY = autosaveKey(resolveBase());

/** Draw with Ketcher's own tools: the first ring template, placed at a point on the
 * canvas (clear of the middle, where opened files land). */
async function placeRing(page: Page, at: { x: number; y: number }) {
  await page.getByTestId('template-0').click();
  // Ketcher also has a (hidden) macromolecules canvas with the same test id.
  await page.locator('[data-testid="ketcher-canvas"][data-canvasmode="molecules-mode"]').click({ position: at });
}

async function stored(page: Page): Promise<string | null> {
  return page.evaluate((key) => localStorage.getItem(key), KEY);
}

test('autosave: the drawing survives reloads offline, and Undo stops at the restored drawing', async ({
  app,
}) => {
  const { page } = app;
  const butanol = referenceCompound('(R)-2-butanol');
  // Ketcher refreshes these buttons, and whether its Undo/Redo keys work, 100 ms after a
  // change; each key press below first waits for the button state it needs. (The hidden
  // macromolecules toolbar has buttons with the same test ids.)
  const undo = page.getByTestId('undo').filter({ visible: true });
  const redo = page.getByTestId('redo').filter({ visible: true });
  await goOffline(app);

  // Opened with Ketcher's Open dialog: saved, and back after a reload.
  let saved = await nextAutosave(page);
  await openWithDialog(app, fixturePath(butanol.files.find((f) => f.endsWith('.mol'))!));
  const opened = { inchikey: butanol.inchikey, ket: await saved() };
  await expectDrawing(page, opened);
  await page.reload();
  await waitForEditor(app);
  await expectDrawing(page, opened);
  // Loading it went through Ketcher's history; it must not be undoable.
  expect(await history(page)).toEqual({ undo: 0, redo: 0 });

  // Drawn with the toolbar. Undo takes the new ring away, and then stops.
  saved = await nextAutosave(page);
  await placeRing(page, { x: 150, y: 150 });
  const withRing = { inchikey: await inchiKey(page), ket: await saved() };
  expect(withRing.inchikey).not.toBe(butanol.inchikey);
  await expectDrawing(page, withRing);
  await expect(undo).toBeEnabled();
  saved = await nextAutosave(page);
  await page.keyboard.press('ControlOrMeta+KeyZ');
  expect(shape(await saved())).toEqual(shape(opened.ket));
  await expect(redo).toBeEnabled();
  await expect(undo).toBeDisabled();
  expect(await history(page)).toEqual({ undo: 0, redo: 1 });
  await expectDrawing(page, opened);

  // Redo puts the ring back, and a reload keeps it.
  saved = await nextAutosave(page);
  await page.keyboard.press('ControlOrMeta+Shift+KeyZ');
  expect(shape(await saved())).toEqual(shape(withRing.ket));
  await page.reload();
  await waitForEditor(app);
  await expectDrawing(page, withRing);

  // Nothing was uploaded: every request was a download of the app's own files.
  const uploads = app.requests.filter((r) => r.method() !== 'GET').map((r) => `${r.method()} ${r.url()}`);
  expect(uploads).toEqual([]);
});

test('autosave: the drawing survives quitting and relaunching the browser', async ({ app }) => {
  await openEditor(app);
  const saved = await nextAutosave(app.page);
  await placeRing(app.page, { x: 150, y: 150 });
  const drawn = { inchikey: await inchiKey(app.page), ket: await saved() };

  await app.relaunch();
  await openEditor(app);
  await expectDrawing(app.page, drawn);
});

test("autosave starts once, although Ketcher calls the app's onInit twice", async ({ app }) => {
  const { page } = app;
  await openEditor(app);
  await page.evaluate(() => (window as unknown as { __secondInit: Promise<true> }).__secondInit);
  await page.evaluate((key) => {
    const counter = window as unknown as { __writes: number };
    counter.__writes = 0;
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (this: Storage, name: string, value: string) {
      if (name === key) counter.__writes++;
      setItem.call(this, name, value);
    };
  }, KEY);

  // One change, one save. (All saves for a change are written in the same task.)
  const saved = await nextAutosave(page);
  await placeRing(page, { x: 150, y: 150 });
  await saved();
  expect(await page.evaluate(() => (window as unknown as { __writes: number }).__writes)).toBe(1);
});

test('autosave: if the browser refuses to store the drawing, the header says so', async ({ app }) => {
  const { page } = app;
  const badge = page.getByTestId('autosave-failed-badge');
  await openEditor(app);
  let saved = await nextAutosave(page);
  await placeRing(page, { x: 150, y: 150 });
  await saved();
  await expect(badge).toHaveCount(0);
  const kept = await stored(page);

  // Storage full, as a drawing with large placed images could make it.
  await page.evaluate((key) => {
    const setItem = Storage.prototype.setItem;
    Object.assign(window, { __unblockStorage: () => (Storage.prototype.setItem = setItem) });
    Storage.prototype.setItem = function (this: Storage, name: string, value: string) {
      if (name === key) throw new DOMException('storage full', 'QuotaExceededError');
      setItem.call(this, name, value);
    };
  }, KEY);
  await placeRing(page, { x: 150, y: 450 });
  await expect(badge).toHaveText('Not autosaved');
  expect(await stored(page)).toBe(kept);

  // Room again: the next change is saved and the badge goes away.
  await page.evaluate(() => (window as unknown as { __unblockStorage: () => void }).__unblockStorage());
  saved = await nextAutosave(page);
  await placeRing(page, { x: 600, y: 150 }); // inside the canvas, left of the properties panel
  expect(shape(await saved())).toEqual(shape(await ket(page)));
  await expect(badge).toHaveCount(0);
});
