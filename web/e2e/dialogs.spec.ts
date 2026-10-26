// Ketcher's Save and Open dialogs without the raw text of the file (src/editor/editor.css):
// Save keeps the file name, the format, its buttons and Ketcher's warnings; Open goes from
// the file straight to "Open as New Project" or "Add to Canvas". The Text Editor notes that
// formatting applies to the highlighted text.
import type { Page } from '@playwright/test';
import { expect, fixture, fixturePath, inchiKey, openEditor, referenceCompound, test, type App } from './fixtures.ts';

const MOLFILE_MARKER = /V2000/; // chem-literal-ok: format marker
const CANVAS = '[data-testid="ketcher-canvas"][data-canvasmode="molecules-mode"]';

function smiles(name: string): string {
  const data = JSON.parse(fixture('reference_expected.json')) as { compounds: { typed_name: string; smiles: string }[] };
  return data.compounds.find((c) => c.typed_name === name)!.smiles;
}

function molfilePath(name: string): string {
  return fixturePath(referenceCompound(name).files.find((f) => f.endsWith('.mol'))!);
}

async function load(page: Page, name: string): Promise<void> {
  const molfile = fixture(referenceCompound(name).files.find((f) => f.endsWith('.mol'))!);
  await page.evaluate((mol) => window.ketcher!.setMolecule(mol), molfile);
}

function fragmentCount(page: Page): Promise<number> {
  return page.evaluate(() => new Set([...window.ketcher!.editor.struct().atoms.values()].map((a) => a.fragment)).size);
}

/** Ketcher's paste tool holds a structure: it is the tool that has one. */
function holdingAStructure(page: Page): Promise<boolean> {
  return page.evaluate(() => 'struct' in ((window.ketcher!.editor as unknown as { tool(): object }).tool() ?? {}));
}

/** Click on the canvas, away from the drawing, after a move there (Ketcher's paste tool
 * shows what it holds on a move, at most once a frame). */
async function clickOnCanvas(page: Page): Promise<void> {
  const box = (await page.locator(CANVAS).boundingBox())!;
  const [x, y] = [box.x + box.width * 0.2, box.y + box.height * 0.75];
  await page.mouse.move(x, y);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
  await page.mouse.click(x, y);
}

async function openFile(app: App, name: string) {
  const { page } = app;
  await page.getByTestId('open-file-button').filter({ visible: true }).click();
  const modal = page.getByTestId('openStructureModal');
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), modal.getByTestId('open-from-file-button').click()]);
  await chooser.setFiles(molfilePath(name));
  return modal;
}

test('the Text Editor says formatting applies to the highlighted text', async ({ app }) => {
  const { page } = app;
  await openEditor(app);
  await page.getByTestId('text').filter({ visible: true }).click();
  await clickOnCanvas(page);
  const toolbar = page.getByRole('toolbar', { name: 'Text formatting toolbar' });
  await expect(toolbar).toBeVisible();
  // The note is the "Text:" label's ::before, on its own line under the toolbar.
  const label = await toolbar.evaluate((bar) => {
    const next = bar.nextElementSibling as HTMLElement;
    const before = getComputedStyle(next, '::before');
    return { text: next.textContent, note: before.content, display: before.display };
  });
  expect(label).toEqual({
    text: 'Text:',
    note: '"Highlight the text first: formatting applies to what is highlighted. Formula formats all of the text as you type."',
    display: 'block',
  });
});

test('Save shows the file name, the format and its buttons, but not the file', async ({ app }) => {
  const { page } = app;
  await openEditor(app);
  await load(page, 'aspirin');
  await page.getByTestId('save-file-button').filter({ visible: true }).click();
  const dialog = page.getByTestId('save-dialog');
  // The preview is still made (it holds the file), only not shown.
  const preview = dialog.getByTestId('preview-area');
  await expect(preview).toHaveValue(MOLFILE_MARKER);
  await expect(preview).toBeHidden();
  await expect(dialog.getByTestId('Preview-tab')).toBeHidden();
  await expect(dialog.getByTestId('copy-to-clipboard')).toBeHidden();
  const format = dialog.getByRole('combobox');
  for (const shown of [
    dialog.getByRole('textbox'),
    format,
    dialog.getByTestId('save-button'),
    dialog.getByRole('button', { name: 'Cancel' }),
    dialog.getByTestId('save-to-templates-button'),
  ]) {
    await expect(shown).toBeVisible();
  }
  // No blank space where the preview was: the buttons come just below the fields.
  const [fields, save] = [(await format.boundingBox())!, (await dialog.getByTestId('save-button').boundingBox())!];
  expect(save.y - (fields.y + fields.height)).toBeLessThan(60);
  // A picture (SVG) or binary (CDX) preview is hidden too.
  for (const option of ['SVG Document', 'CDX']) {
    await format.click();
    await page.getByTestId(`${option}-option`).click();
    await expect(format).toHaveText(option);
    await expect(preview).toHaveCount(1);
    await expect(preview).toBeHidden();
  }
});

test("Save still shows Ketcher's warnings", async ({ app }) => {
  const { page } = app;
  await openEditor(app);
  // Two reactions, so two arrows: Ketcher warns that a Molfile keeps only one.
  await page.evaluate(
    async ([first, second]) => {
      await window.ketcher!.setMolecule(first);
      await window.ketcher!.addFragment(second);
    },
    [`${smiles('ethanol')}>>${smiles('acetone')}`, `${smiles('aspirin')}>>${smiles('caffeine')}`],
  );
  expect(await page.evaluate(() => window.ketcher!.editor.struct().rxnArrows.size)).toBe(2);
  await page.getByTestId('save-file-button').filter({ visible: true }).click();
  const dialog = page.getByTestId('save-dialog');
  const warnings = dialog.getByTestId('Warnings-tab');
  await expect(warnings).toBeVisible();
  await warnings.click();
  await expect(dialog).toContainText('reaction arrows will be lost');
});

test('Open goes from the file straight to the choice, without the file', async ({ app }) => {
  const { page } = app;
  await openEditor(app);
  await load(page, 'ethanol');
  await page.getByTestId('open-file-button').filter({ visible: true }).click();
  const modal = page.getByTestId('openStructureModal');
  await expect(modal.getByTestId('paste-from-clipboard-button')).toHaveCount(1);
  await expect(modal.getByTestId('paste-from-clipboard-button')).toBeHidden();
  await expect(modal.getByTestId('open-from-file-button')).toBeVisible();
  // The one tile left sits in the middle of the dialog.
  const offCentre = await modal.getByTestId('open-from-file-button').evaluate((tile) => {
    const [own, dialog] = [tile.getBoundingClientRect(), tile.closest('dialog')!.getBoundingClientRect()];
    return Math.abs(own.x + own.width / 2 - (dialog.x + dialog.width / 2));
  });
  expect(offCentre).toBeLessThan(2);
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), modal.getByTestId('open-from-file-button').click()]);
  await chooser.setFiles(molfilePath('aspirin'));
  // The file is read (the box holds it), only not shown.
  const text = modal.getByTestId('open-structure-textarea');
  await expect(text).toHaveValue(MOLFILE_MARKER);
  await expect(text).toBeHidden();
  for (const id of ['cancel-button', 'open-as-new-button', 'add-to-canvas-button']) {
    await expect(modal.getByTestId(id)).toBeVisible();
  }
  await modal.getByTestId('open-as-new-button').click();
  await modal.waitFor({ state: 'detached' });
  expect(await inchiKey(page)).toBe(referenceCompound('aspirin').inchikey);
  expect(await fragmentCount(page)).toBe(1);
});

test("Add to Canvas puts the file's structure beside the drawing", async ({ app }) => {
  const { page } = app;
  await openEditor(app);
  await load(page, 'ethanol');
  const modal = await openFile(app, 'aspirin');
  await modal.getByTestId('add-to-canvas-button').click();
  await modal.waitFor({ state: 'detached' });
  await expect.poll(() => holdingAStructure(page)).toBe(true);
  // Ketcher's paste tool: the structure follows the mouse until a click puts it down.
  await clickOnCanvas(page);
  await expect.poll(() => fragmentCount(page)).toBe(2);
});

test('Ctrl+V on the canvas still pastes, without the dialog', async ({ app }) => {
  const { page } = app;
  await openEditor(app);
  await app.context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(page.url()).origin });
  await load(page, 'ethanol');
  await page.evaluate((text) => navigator.clipboard.writeText(text), smiles('aspirin'));
  await page.locator('.Ketcher-root').focus();
  await page.keyboard.press('ControlOrMeta+v');
  await expect.poll(() => holdingAStructure(page)).toBe(true);
  await clickOnCanvas(page);
  await expect.poll(() => fragmentCount(page)).toBe(2);
});
