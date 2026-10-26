// Students start in Ketcher's ACS Document 1996 style (src/editor/acsStyle.ts; acceptance
// bar in docs/plans/acs-style-default.md, A and B).
import type { Page } from '@playwright/test';
import { ACS_APPLIED_KEY } from '../src/editor/acsStyle.ts';
import {
  expect,
  expectDrawing,
  fixture,
  history,
  inchiKey,
  ketcherSettings,
  nextAutosave,
  openEditor,
  referenceCompound,
  test,
  waitForEditor,
} from './fixtures.ts';

/** The settings Ketcher's own "Set ACS Settings" changes when pressed now. It is pressed
 * through Ketcher's settings service, as the button does, so the settings change. */
async function changedByAcsButton(page: Page): Promise<string[]> {
  const before = await ketcherSettings(page);
  await page.evaluate(() => window.ketcher!.settingsService!.loadPreset('acs'));
  const after = await ketcherSettings(page);
  return Object.keys(after).filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]));
}

/** The settings ACS sets that the canvas draws with, by name. (Ketcher's render options
 * hold others in another spelling: its stereo label style is 'Iupac' there, 'IUPAC' in
 * its settings.) */
const DRAWN_WITH = [
  'atomColoring',
  'bondLength',
  'bondLengthUnit',
  'bondSpacing',
  'bondThickness',
  'bondThicknessUnit',
  'stereoBondWidth',
  'stereoBondWidthUnit',
  'hashSpacing',
  'hashSpacingUnit',
  'fontsz',
  'fontszUnit',
  'fontszsub',
  'fontszsubUnit',
];

/** What the canvas was first drawn with: Ketcher's render options when the app's onInit
 * first had the editor (the editor is window.ketcher once onInit has run). */
async function recordFirstCanvas(page: Page): Promise<void> {
  await page.context().addInitScript(() => {
    const w = window as unknown as { __firstCanvas?: Record<string, unknown> };
    addEventListener('editor-init', () =>
      queueMicrotask(() => {
        if (w.__firstCanvas) return;
        const options = (window.ketcher!.editor as unknown as { render: { options: Record<string, unknown> } }).render
          .options;
        w.__firstCanvas = Object.fromEntries(
          Object.entries(options).filter(([, value]) => ['string', 'number', 'boolean'].includes(typeof value)),
        );
      }),
    );
  });
}

test('a new browser starts in ACS: what "Set ACS Settings" gives but image resolution, on the first canvas, with nothing to undo', async ({
  app,
}) => {
  const { page } = app;
  await recordFirstCanvas(page);
  await openEditor(app);
  await page.evaluate(() => (window as unknown as { __secondInit: Promise<true> }).__secondInit);

  // Drawn once, in ACS: no second drawing of the canvas, so nothing to undo on a fresh,
  // empty canvas. (Ketcher redraws when its two settings readers disagree, as they do when
  // ACS is written after Ketcher's code has loaded, or with image resolution 600; that
  // redraw goes into the undo history.)
  expect(await history(page)).toEqual({ undo: 0, redo: 0 });
  const settings = await ketcherSettings(page);
  const firstCanvas = await page.evaluate(() => (window as unknown as { __firstCanvas: Record<string, unknown> }).__firstCanvas);
  for (const key of DRAWN_WITH) expect(firstCanvas[key], key).toEqual(settings[key]);

  // Pressing Ketcher's own ACS button now changes nothing but the image resolution.
  expect(await changedByAcsButton(page)).toEqual(['imageResolution']);
});

test('an existing browser: switched to ACS once, with its drawing and the student\'s other settings kept', async ({
  app,
}) => {
  const { page } = app;
  await openEditor(app);
  // Make this browser what the live version leaves: Ketcher's own defaults saved (Ketcher
  // writes all its settings at every start), one the student changed, a saved drawing, and
  // ACS never applied.
  await page.evaluate(async (applied) => {
    const service = window.ketcher!.settingsService!;
    await service.resetToDefaults();
    await service.updateSettings({ carbonExplicitly: true });
    localStorage.removeItem(applied);
  }, ACS_APPLIED_KEY);
  expect((await ketcherSettings(page)).bondLengthUnit).toBe('px'); // Ketcher's defaults, not ACS
  const saved = await nextAutosave(page);
  const caffeine = referenceCompound('caffeine');
  await page.evaluate((mol) => window.ketcher!.setMolecule(mol), fixture(caffeine.files.find((f) => f.endsWith('.mol'))!));
  const drawn = { inchikey: await inchiKey(page), ket: await saved() };
  expect(drawn.inchikey).toBe(caffeine.inchikey);

  await page.reload();
  await waitForEditor(app);
  await expectDrawing(page, drawn);
  expect(await history(page)).toEqual({ undo: 0, redo: 0 }); // Undo can't take the drawing away
  expect((await ketcherSettings(page)).carbonExplicitly).toBe(true);
  expect(await page.evaluate((applied) => localStorage.getItem(applied), ACS_APPLIED_KEY)).not.toBeNull();
  expect(await changedByAcsButton(page)).toEqual(['imageResolution']);
});

test("ACS is applied once: a student's own change in Settings stays after a reload", async ({ app }) => {
  const { page } = app;
  await openEditor(app);
  // Atom colours back on, as Settings' Apply does it (through Ketcher's settings service).
  await page.evaluate(() => window.ketcher!.settingsService!.updateSettings({ atomColoring: true }));

  await page.reload();
  await waitForEditor(app);
  expect((await ketcherSettings(page)).atomColoring).toBe(true);
  // Everything else is still ACS.
  expect((await changedByAcsButton(page)).sort()).toEqual(['atomColoring', 'imageResolution']);
});
