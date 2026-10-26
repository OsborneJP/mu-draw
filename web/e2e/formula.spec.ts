// Formula text in Ketcher's Text Editor (docs/plans/v2-formula-text.md, bars B and C), in the
// built app, typed key by key. Each check compares what the editor shows, or what was saved,
// with the typing rules (src/editor/formula.ts) or with runs fixed here from the plan's table.
import type { Page } from '@playwright/test';
import { formulaScripts, type Script } from '../src/editor/formula.ts';
import {
  clearCanvas,
  expect,
  fixture,
  goOffline,
  holdableRdkitReplies,
  inchiKey,
  ket,
  nextAutosave,
  openEditor,
  openWithDialog,
  referenceCompound,
  saveWithDialog,
  test,
} from './fixtures.ts';

const CANVAS = '[data-testid="ketcher-canvas"][data-canvasmode="molecules-mode"]';
const TYPED = 'H2SO4 Cu2+ (NH4)2SO4 [Fe(CN)6]3-';
/** TYPED as the plan's table formats it, in KET's parts. */
const TYPED_PARTS: Part[] = [
  { text: 'H' },
  { text: '2', subscript: true },
  { text: 'SO' },
  { text: '4', subscript: true },
  { text: ' Cu' },
  { text: '2+', superscript: true },
  { text: ' (NH' },
  { text: '4', subscript: true },
  { text: ')' },
  { text: '2', subscript: true },
  { text: 'SO' },
  { text: '4', subscript: true },
  { text: ' [Fe(CN)' },
  { text: '6', subscript: true },
  { text: ']' },
  { text: '3-', superscript: true },
];

interface Part {
  text: string;
  subscript?: boolean;
  superscript?: boolean;
  bold?: boolean;
  font?: { size: number };
}

interface Line {
  text: string;
  scripts: Script[];
}

const input = (page: Page) => page.getByTestId('text-editor');
const formula = (page: Page) => page.getByTestId('formula-button');

/** A click on the canvas with the Text tool, then one in the Text Editor's text box, as a
 * student does (Ketcher's autofocus doesn't keep the focus there). */
async function newText(page: Page, at = { x: 0.3, y: 0.4 }): Promise<void> {
  await page.getByTestId('text').filter({ visible: true }).click();
  const box = (await page.locator(CANVAS).boundingBox())!;
  const [x, y] = [box.x + box.width * at.x, box.y + box.height * at.y];
  await page.mouse.move(x, y);
  await page.mouse.click(x, y);
  await input(page).click();
  await expect(input(page)).toBeFocused();
}

/** What the editor shows: each line's text, and each character's place in it. */
function shown(page: Page): Promise<Line[]> {
  return input(page).evaluate((root) =>
    [...root.querySelectorAll('p')].map((line) => {
      let text = '';
      const scripts: ('sub' | 'sup' | null)[] = [];
      for (const run of line.querySelectorAll('[data-lexical-text]')) {
        const script = run.closest('sub') ? 'sub' : run.closest('sup') ? 'sup' : null;
        const runText = run.textContent ?? '';
        text += runText;
        for (let i = 0; i < runText.length; i++) scripts.push(script);
      }
      return { text, scripts };
    }),
  );
}

/** The lines as the rules format them. */
function byTheRules(...lines: string[]): Line[] {
  return lines.map((text) => ({ text, scripts: formulaScripts(text) }));
}

/** Lines whose formatting is not what the rules give for their text (none, when Formula
 * has done its work). */
async function offTheRules(page: Page): Promise<Line[]> {
  return (await shown(page)).filter((line) => JSON.stringify(line) !== JSON.stringify(byTheRules(line.text)[0]));
}

/** Each text's lines of parts, in a KET drawing. */
function textParts(drawing: string): Part[][] {
  const nodes = (JSON.parse(drawing) as { root: { nodes: { type: string; paragraphs?: { parts: Part[] }[] }[] } })
    .root.nodes;
  return nodes.filter((node) => node.type === 'text').flatMap((node) => node.paragraphs!.map((line) => line.parts));
}

/** Apply, and the drawing autosave stores for it. */
async function apply(page: Page): Promise<string> {
  const saved = await nextAutosave(page);
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect(input(page)).toHaveCount(0);
  return saved();
}

/** Pastes into the Text Editor, as Ctrl+V does: plain text, and HTML if given. */
function paste(page: Page, text: string, html?: string): Promise<void> {
  return input(page).evaluate(
    (root, [plain, rich]) => {
      const data = new DataTransfer();
      data.setData('text/plain', plain);
      if (rich) data.setData('text/html', rich);
      root.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
    },
    [text, html] as const,
  );
}

/** Opens the first text on the canvas for editing, as a student does: a double-click on it
 * with the selection tool. */
async function reopen(page: Page): Promise<void> {
  await page.getByTestId('select-rectangle').filter({ visible: true }).click();
  const run = (await page.locator('[data-testid="text-label"]').first().boundingBox())!;
  await page.mouse.dblclick(run.x + run.width / 2, run.y + run.height / 2);
  await input(page).click();
  await expect(input(page)).toBeFocused();
}

test('the Formula button is in the Text Editor, off, and Ketcher’s buttons work as before', async ({ app }) => {
  const { page } = app;
  await openEditor(app);
  await newText(page);
  const toolbar = page.getByRole('toolbar', { name: 'Text formatting toolbar' });
  await expect(toolbar.getByTestId('formula-button')).toHaveAttribute('aria-pressed', 'false');
  const scriptButtons = [toolbar.getByTestId('text-subscript'), toolbar.getByTestId('text-superscript')];
  for (const button of scriptButtons) await expect(button).toBeEnabled();
  // It takes no room from Ketcher's buttons (28 px each) and stays inside the toolbar.
  const layout = await toolbar.evaluate((bar) => {
    const box = (el: Element) => el.getBoundingClientRect();
    const inside = (inner: DOMRect, outer: DOMRect) =>
      inner.left >= outer.left && inner.right <= outer.right && inner.top >= outer.top && inner.bottom <= outer.bottom;
    const formulaBox = box(bar.querySelector('[data-testid="formula-button"]')!);
    const others = [...bar.querySelectorAll('button')].filter((b) => b.dataset.testid !== 'formula-button');
    return {
      ketcherWidths: [...bar.querySelectorAll('button[data-testid^="text-"]')].map((b) => Math.round(box(b).width)),
      formulaInside: inside(formulaBox, box(bar)) && inside(box(bar), box(bar.closest('dialog')!)),
      overlaps: others.filter((b) => {
        const o = box(b);
        return o.left < formulaBox.right && o.right > formulaBox.left && o.top < formulaBox.bottom && o.bottom > formulaBox.top;
      }).length,
    };
  });
  expect(layout).toEqual({ ketcherWidths: [28, 28, 28, 28], formulaInside: true, overlaps: 0 });

  // With Formula off, typing is plain, and Ketcher's subscript button formats the highlight.
  // (Highlighted with Ctrl+A, which Lexical takes at once. A highlight made with Shift and
  // the arrows reaches Lexical only on the browser's selectionchange, which Chrome may run
  // after the click.)
  await page.keyboard.type('H2O');
  await expect.poll(() => shown(page)).toEqual([{ text: 'H2O', scripts: [null, null, null] }]);
  await page.keyboard.press('Control+a');
  await toolbar.getByTestId('text-subscript').click();
  await expect.poll(() => shown(page)).toEqual([{ text: 'H2O', scripts: ['sub', 'sub', 'sub'] }]);

  // While Formula is on, Ketcher's superscript and subscript buttons are greyed out.
  await formula(page).click();
  await expect(formula(page)).toHaveAttribute('aria-pressed', 'true');
  for (const button of scriptButtons) {
    await expect(button).toBeDisabled();
    await expect(button).toHaveCSS('opacity', '0.4');
  }
  await formula(page).click();
  await expect(formula(page)).toHaveAttribute('aria-pressed', 'false');
  for (const button of scriptButtons) await expect(button).toBeEnabled();
});

test('a click on a greyed button leaves the student typing in the text', async ({ app }) => {
  const { page } = app;
  await openEditor(app);
  await newText(page);
  await formula(page).click();
  await page.keyboard.type('H2');
  // Out of habit: the subscript button, greyed while Formula is on.
  await page.getByTestId('text-subscript').click({ force: true });
  await page.keyboard.type('O');
  await expect.poll(() => shown(page)).toEqual(byTheRules('H2O'));
  // Enter is a new line, not Ketcher's Apply (which it is while the focus is elsewhere).
  await page.keyboard.press('Enter');
  await page.keyboard.type('Cu2+');
  await expect.poll(() => shown(page)).toEqual(byTheRules('H2O', 'Cu2+'));
  await expect(input(page)).toBeVisible();
});

test('with Formula on, typing comes out formatted, and Apply saves exactly those runs', async ({ app }) => {
  const { page } = app;
  await openEditor(app);
  await newText(page);
  await formula(page).click();
  await expect(input(page)).toBeFocused();
  await page.keyboard.type('H2SO4 Cu2');
  // Cu2 could still be Cu₂ ...
  await expect.poll(() => shown(page)).toEqual(byTheRules('H2SO4 Cu2'));
  expect(byTheRules('H2SO4 Cu2')[0].scripts.at(-1)).toBe('sub');
  // ... until the + arrives.
  await page.keyboard.type(TYPED.slice('H2SO4 Cu2'.length));
  await expect.poll(() => shown(page)).toEqual(byTheRules(TYPED));
  const saved = await apply(page);
  expect(textParts(saved)).toEqual([TYPED_PARTS]);
  expect(textParts(await ket(page))).toEqual([TYPED_PARTS]);
});

test('typing in the middle, deleting, pasting, a new line, Undo and Redo keep to the rules', async ({ app }) => {
  const { page } = app;
  await openEditor(app);
  await newText(page);
  // After each key: the text changed, and keeps to the rules. (How much one Undo takes back
  // depends on Lexical's 1 s typing timer, so only that is checked after an Undo or Redo.)
  const press = async (key: string) => {
    const before = JSON.stringify(await shown(page));
    await page.keyboard.press(key);
    await expect
      .poll(async () => ({ changed: JSON.stringify(await shown(page)) !== before, offTheRules: await offTheRules(page) }))
      .toEqual({ changed: true, offTheRules: [] });
    return (await shown(page)).map((line) => line.text);
  };

  // Formula off: three history steps (a new line is a step of its own), and an Undo, so
  // Redo has a step to put back that Formula never formatted.
  await page.keyboard.type('H2O');
  await page.keyboard.press('Enter');
  await page.keyboard.type('NaCl');
  await page.keyboard.press('Control+z');
  await formula(page).click();
  await expect.poll(async () => (await offTheRules(page)).length).toBe(0);
  expect((await press('Control+y'))[1]).toBe('NaCl');

  // Typed between two runs: a count after the H, though the H's run is on the line.
  await page.keyboard.press('Control+Home');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.type('3');
  await expect.poll(() => shown(page)).toEqual(byTheRules('H32O', 'NaCl'));
  // Deleting the + of a charge: its 2 is a count again. (Backspace and Enter come straight
  // after typing: Lexical acts on them with its own caret, which follows typing at once but
  // follows an arrow key only on the browser's selectionchange.)
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('End');
  await page.keyboard.type(' Cu2+');
  await expect.poll(() => shown(page)).toEqual(byTheRules('H32O', 'NaCl Cu2+'));
  await page.keyboard.press('Backspace');
  await expect.poll(() => shown(page)).toEqual(byTheRules('H32O', 'NaCl Cu2'));
  // Pasted on a new line, then its minus taken back.
  await page.keyboard.press('Enter');
  await paste(page, 'SO42-');
  await expect.poll(() => shown(page)).toEqual(byTheRules('H32O', 'NaCl Cu2', 'SO42-'));
  await page.keyboard.press('Backspace');
  await expect.poll(() => shown(page)).toEqual(byTheRules('H32O', 'NaCl Cu2', 'SO42'));

  // Undo back to the first step, typed with Formula off.
  let lines: string[] = [];
  for (let undos = 0; lines.join('\n') !== 'H2O'; undos++) {
    expect(undos, 'Undo never got back to the first line').toBeLessThan(16);
    lines = await press('Control+z');
  }
});

test('Formula on formats the text there; off leaves it; bold, italic and size stay', async ({ app }) => {
  const { page } = app;
  await openEditor(app);
  await newText(page);
  await page.keyboard.type('H2O Cu2+');
  await page.keyboard.press('Control+a');
  const toolbar = page.getByRole('toolbar', { name: 'Text formatting toolbar' });
  await toolbar.getByTestId('text-bold').click();
  await toolbar.getByTestId('text-italic').click();
  await toolbar.getByTestId('font-size-button').click();
  await page.getByTestId('20-option').click();
  await formula(page).click();
  await expect.poll(() => shown(page)).toEqual(byTheRules('H2O Cu2+'));
  await formula(page).click();
  await expect(formula(page)).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(() => shown(page)).toEqual(byTheRules('H2O Cu2+'));
  const bold = { bold: true, italic: true, font: { size: 20 } };
  expect(textParts(await apply(page))).toEqual([
    [
      { text: 'H', ...bold },
      { text: '2', subscript: true, ...bold },
      { text: 'O Cu', ...bold },
      { text: '2+', superscript: true, ...bold },
    ],
  ]);
});

test('a Formula text reopens with Formula on; Cancel changes nothing', async ({ app }) => {
  const { page } = app;
  await openEditor(app);
  await newText(page);
  await formula(page).click();
  await page.keyboard.type(TYPED);
  const saved = await apply(page);

  await reopen(page);
  await expect(formula(page)).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('text-subscript')).toBeDisabled();
  await expect(page.getByTestId('text-superscript')).toBeDisabled();
  await expect.poll(() => shown(page)).toEqual(byTheRules(TYPED));
  await page.keyboard.press('Control+End');
  await page.keyboard.type(' Fe3+');
  await expect.poll(() => shown(page)).toEqual(byTheRules(`${TYPED} Fe3+`));
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(input(page)).toHaveCount(0);
  expect(textParts(await ket(page))).toEqual(textParts(saved));

  // A new box straight after a Formula one starts with Formula off (decision 5).
  await newText(page, { x: 0.6, y: 0.7 });
  await expect(formula(page)).toHaveAttribute('aria-pressed', 'false');
});

test('plain or hand-formatted text reopens with Formula off', async ({ app }) => {
  const { page } = app;
  await openEditor(app);
  // Plain: Formula would format it, so it is not a Formula text.
  await newText(page);
  await page.keyboard.type('H2O');
  await apply(page);
  await reopen(page);
  await expect(formula(page)).toHaveAttribute('aria-pressed', 'false');
  await page.getByRole('button', { name: 'Cancel' }).click();

  // Hand-formatted: ¹³CO₂, an isotope that Formula leaves on the line.
  await clearCanvas(page);
  await newText(page);
  await paste(page, '13CO2', '<sup>13</sup>CO<sub>2</sub>');
  await expect.poll(() => shown(page)).toEqual([{ text: '13CO2', scripts: ['sup', 'sup', null, null, 'sub'] }]);
  await apply(page);
  await reopen(page);
  await expect(formula(page)).toHaveAttribute('aria-pressed', 'false');
  await expect
    .poll(() => shown(page))
    .toEqual([{ text: '13CO2', scripts: ['sup', 'sup', null, null, 'sub'] }]);
});

test('a Formula text survives a relaunch, and Save and Open as KET and CDXML', async ({ app }, testInfo) => {
  const { page } = app;
  await openEditor(app);
  await newText(page);
  await formula(page).click();
  await page.keyboard.type(TYPED);
  await apply(page);

  await app.relaunch();
  await openEditor(app);
  expect(textParts(await ket(app.page))).toEqual([TYPED_PARTS]);

  const ketPath = testInfo.outputPath('formula.ket');
  await saveWithDialog(app, 'Ket Format', /"paragraphs"/, ketPath);
  await clearCanvas(app.page);
  await openWithDialog(app, ketPath);
  expect(textParts(await ket(app.page))).toEqual([TYPED_PARTS]);

  // ChemDraw's own encoding: face 32 is subscript, 64 superscript.
  const cdxmlPath = testInfo.outputPath('formula.cdxml');
  const cdxml = await saveWithDialog(app, 'CDXML', /face="64"/, cdxmlPath);
  const faces = [...cdxml.matchAll(/<s [^>]*face="(\d+)"[^>]*>([^<]*)<\/s>/g)].map((m) => [m[2], m[1]]);
  expect(faces).toEqual(
    TYPED_PARTS.map((part) => [
      part.text.replaceAll('&', '&amp;'),
      part.subscript ? '32' : part.superscript ? '64' : '0',
    ]),
  );
  await clearCanvas(app.page);
  await openWithDialog(app, cdxmlPath);
  expect(textParts(await ket(app.page))).toEqual([TYPED_PARTS]);
});

test('a Formula text is not chemistry: beside a structure it changes nothing, alone it is an empty drawing', async ({
  app,
}) => {
  const { page } = app;
  const butanol = referenceCompound('(R)-2-butanol');
  await app.context.addInitScript(holdableRdkitReplies);
  await openEditor(app);
  await page.evaluate((mol) => window.ketcher!.setMolecule(mol), fixture(butanol.files.find((f) => f.endsWith('.mol'))!));
  const panel = page.getByTestId('properties-panel');
  await expect(panel).toHaveAttribute('data-state', 'ready');
  const alone = await panel.innerText();

  // RDKit's reply is held, so the panel must show it is working the new drawing out.
  await page.evaluate(() => (window as unknown as { __holdRdkit(): void }).__holdRdkit());
  await newText(page, { x: 0.8, y: 0.8 });
  await formula(page).click();
  await page.keyboard.type(TYPED);
  const drawn = await apply(page);
  await expect(panel).toHaveAttribute('data-state', 'updating');
  await page.evaluate(() => (window as unknown as { __releaseRdkit(): void }).__releaseRdkit());
  await expect(panel).toHaveAttribute('data-state', 'ready');
  expect(await panel.innerText()).toBe(alone);
  expect(await inchiKey(page)).toBe(butanol.inchikey);

  // The same text with the structure gone: nothing to work out.
  const textOnly = JSON.parse(drawn) as { root: { nodes: { type?: string }[] } } & Record<string, unknown>;
  textOnly.root.nodes = textOnly.root.nodes.filter((node) => node.type === 'text');
  for (const key of Object.keys(textOnly)) if (key.startsWith('mol')) delete textOnly[key];
  await page.evaluate((text) => window.ketcher!.setMolecule(text), JSON.stringify(textOnly));
  await expect(page.getByTestId('properties-message')).toHaveText('Draw a structure to see its properties');
  expect(textParts(await ket(page))).toEqual([TYPED_PARTS]);
});

test('offline: Formula works with the network off, and asks for no file', async ({ app }) => {
  const { page } = app;
  await goOffline(app);
  await newText(page);
  const requested = app.requests.length;
  await formula(page).click();
  await page.keyboard.type(TYPED);
  await expect.poll(() => shown(page)).toEqual(byTheRules(TYPED));
  expect(textParts(await apply(page))).toEqual([TYPED_PARTS]);
  expect(app.requests.slice(requested).map((request) => request.url())).toEqual([]);
});
