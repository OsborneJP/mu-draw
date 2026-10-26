// Grouping (docs/plans/v2-grouping.md): Group makes a group of the selection; a click on any
// member with the select tool picks up all of it, which then moves, rotates and deletes as
// one; Ungroup ends it; groups survive a relaunch and end with the drawing. Ketcher's own
// selection and coordinates are read back exactly.
import type { Page } from '@playwright/test';
import { expect, fixture, nextAutosave, openEditor, referenceCompound, test } from './fixtures.ts';

const CANVAS = '[data-testid="ketcher-canvas"][data-canvasmode="molecules-mode"]';

function molfile(name: string): string {
  return fixture(referenceCompound(name).files.find((f) => f.endsWith('.mol'))!);
}

type Snapshot = { atoms: number[][]; texts: number[][]; arrows: number[][] };

/** Every atom's, text's and arrow's position, by id. */
function snapshot(page: Page): Promise<Snapshot> {
  return page.evaluate(() => {
    const s = window.ketcher!.editor.struct() as unknown as {
      atoms: Map<number, { pp: { x: number; y: number } }>;
      texts: Map<number, { position: { x: number; y: number } }>;
      rxnArrows: Map<number, { pos: { x: number; y: number }[] }>;
    };
    return {
      atoms: [...s.atoms].map(([id, a]) => [id, a.pp.x, a.pp.y]),
      texts: [...s.texts].map(([id, t]) => [id, t.position.x, t.position.y]),
      arrows: [...s.rxnArrows].map(([id, r]) => [id, r.pos[0].x, r.pos[0].y]),
    };
  });
}

/** The same items at the same places, to 1e-9 (a bond is 1). */
function same(a: Snapshot, b: Snapshot): boolean {
  const flat = (s: Snapshot) => [...s.atoms, ...s.texts, ...s.arrows];
  const [x, y] = [flat(a), flat(b)];
  return x.length === y.length && x.every((p, i) => p[0] === y[i][0] && Math.abs(p[1] - y[i][1]) < 1e-9 && Math.abs(p[2] - y[i][2]) < 1e-9);
}

function selection(page: Page) {
  return page.evaluate(() => {
    const sel = (window.ketcher!.editor.selection() ?? {}) as Record<string, number[]>;
    const pick = (k: string) => [...(sel[k] ?? [])].sort((a, b) => a - b);
    return { atoms: pick('atoms'), bonds: pick('bonds'), texts: pick('texts'), rxnArrows: pick('rxnArrows') };
  });
}

/** Everything on the canvas, as a selection. */
function everything(page: Page) {
  return page.evaluate(() => {
    const s = window.ketcher!.editor.struct() as unknown as Record<string, Map<number, unknown>>;
    const ids = (k: string) => [...s[k].keys()].sort((a, b) => a - b);
    return { atoms: ids('atoms'), bonds: ids('bonds'), texts: ids('texts'), rxnArrows: ids('rxnArrows') };
  });
}

/** Where Ketcher draws an atom on the page (its page-to-model transform, inverted). */
function atomOnPage(page: Page, id: number): Promise<{ x: number; y: number }> {
  return page.evaluate((atom) => {
    const editor = window.ketcher!.editor as unknown as {
      render: { page2obj(e: { clientX: number; clientY: number }): { x: number; y: number } };
      struct(): { atoms: Map<number, { pp: { x: number; y: number } }> };
    };
    const at = (clientX: number, clientY: number) => editor.render.page2obj({ clientX, clientY });
    const o = at(0, 0);
    const ex = at(100, 0);
    const ey = at(0, 100);
    const [a, b, c, d] = [(ex.x - o.x) / 100, (ey.x - o.x) / 100, (ex.y - o.y) / 100, (ey.y - o.y) / 100];
    const { pp } = editor.struct().atoms.get(atom)!;
    const det = a * d - b * c;
    const [dx, dy] = [pp.x - o.x, pp.y - o.y];
    return { x: (d * dx - b * dy) / det, y: (a * dy - c * dx) / det };
  }, id);
}

/** The first atom with one bond. */
function endAtom(page: Page): Promise<number> {
  return page.evaluate(() => {
    const s = window.ketcher!.editor.struct() as unknown as { atoms: Map<number, unknown>; bonds: Map<number, { begin: number; end: number }> };
    const ends = [...s.bonds.values()].flatMap((b) => [b.begin, b.end]);
    return [...s.atoms.keys()].find((a) => ends.filter((e) => e === a).length === 1)!;
  });
}

/** The drawing's average bond length. */
function averageBond(page: Page): Promise<number> {
  return page.evaluate(() => {
    const s = window.ketcher!.editor.struct() as unknown as {
      atoms: Map<number, { pp: { x: number; y: number } }>;
      bonds: Map<number, { begin: number; end: number }>;
    };
    const lengths = [...s.bonds.values()].map((b) => {
      const [p, q] = [s.atoms.get(b.begin)!.pp, s.atoms.get(b.end)!.pp];
      return Math.hypot(p.x - q.x, p.y - q.y);
    });
    return lengths.reduce((a, b) => a + b, 0) / lengths.length;
  });
}

/** How many atoms, bonds, texts and arrows there are. */
async function counts(page: Page) {
  const all = await everything(page);
  return Object.fromEntries(Object.entries(all).map(([kind, ids]) => [kind, ids.length]));
}

async function canvasPoint(page: Page, fx: number, fy: number) {
  const box = (await page.locator(CANVAS).boundingBox())!;
  return { x: box.x + box.width * fx, y: box.y + box.height * fy };
}

async function selectTool(page: Page) {
  // The left toolbar's: in a narrow window its tool menu shows the same button too.
  await page.getByTestId('select-rectangle').filter({ visible: true }).first().click();
}

/** Two molecules, a text and an arrow, each made as a student would. */
async function drawing(page: Page, { text = true } = {}) {
  await page.evaluate(
    async ([a, b]) => {
      await window.ketcher!.setMolecule(a);
      await window.ketcher!.addFragment(b);
    },
    [molfile('aspirin'), molfile('caffeine')],
  );
  // A text, with the Text tool.
  if (text) {
    await page.getByTestId('text').filter({ visible: true }).click();
    const textAt = await canvasPoint(page, 0.15, 0.85);
    await page.mouse.click(textAt.x, textAt.y);
    await page.getByTestId('text-editor').click();
    await page.keyboard.type('note');
    await page.getByRole('button', { name: 'Apply' }).click();
  }
  // An arrow, with the arrow tool.
  await page.getByTestId('reaction-arrow-open-angle').filter({ visible: true }).click();
  const [from, to] = [await canvasPoint(page, 0.4, 0.88), await canvasPoint(page, 0.6, 0.88)];
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 5 });
  await page.mouse.up();
  await expect.poll(async () => (await snapshot(page)).arrows.length).toBe(1);
  expect((await snapshot(page)).texts.length).toBe(text ? 1 : 0);
  await selectTool(page);
}

/** Select everything through Ketcher, then press Group. */
async function groupEverything(page: Page) {
  const all = await everything(page);
  await page.evaluate((sel) => window.ketcher!.editor.selection(sel), all);
  const button = page.getByTestId('group-button');
  await expect(button).toHaveAttribute('data-offer', 'group');
  await button.click();
  await expect(button).toHaveAttribute('data-offer', 'ungroup');
  await expect(button).toHaveText('Ungroup');
  return all;
}

async function deselect(page: Page) {
  await page.evaluate(() => window.ketcher!.editor.selection(null));
  await expect(page.getByTestId('group-button')).toHaveCount(0);
}

async function clickAtom(page: Page, id: number) {
  const at = await atomOnPage(page, id);
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.up();
}

test('Group makes a group; a click on one member selects all of it, and Ungroup ends it', async ({ app }) => {
  const { page } = app;
  await openEditor(app);
  await drawing(page);
  // One item selected: nothing to group.
  await page.evaluate(() => window.ketcher!.editor.selection({ texts: [0] }));
  await expect(page.getByTestId('group-button')).toHaveCount(0);
  const all = await groupEverything(page);
  await deselect(page);
  await clickAtom(page, 0);
  await expect.poll(() => selection(page)).toEqual(all);
  // Beside Ketcher's floating tools.
  await expect(page.getByTestId('group-button')).toHaveAttribute('data-anchored', 'true');
  const tools = (await page.getByTestId('floating-tools').boundingBox())!;
  const button = (await page.getByTestId('group-button').boundingBox())!;
  expect(button.x).toBeGreaterThanOrEqual(tools.x + tools.width);
  expect(button.x).toBeLessThan(tools.x + tools.width + 20);
  // Ungroup: a click then selects only the atom clicked.
  await page.getByTestId('group-button').click();
  await expect(page.getByTestId('group-button')).toHaveAttribute('data-offer', 'group');
  await deselect(page);
  await clickAtom(page, 0);
  await expect.poll(() => selection(page)).toEqual({ atoms: [0], bonds: [], texts: [], rxnArrows: [] });
});

test('a group moves as one, in one Undo step; deletes as one, and Undo brings it back', async ({ app }) => {
  const { page } = app;
  await openEditor(app);
  await drawing(page);
  await groupEverything(page);
  await deselect(page);
  const before = await snapshot(page);
  // Press on one atom and drag: everything moves by the same offset.
  const at = await atomOnPage(page, 0);
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.move(at.x + 40, at.y + 25, { steps: 5 });
  await page.mouse.move(at.x + 80, at.y + 50, { steps: 5 });
  await page.mouse.up();
  const after = await snapshot(page);
  const shifts = (b: number[][], a: number[][]) => a.map((p, i) => `${(p[1] - b[i][1]).toFixed(4)},${(p[2] - b[i][2]).toFixed(4)}`);
  const all = [...shifts(before.atoms, after.atoms), ...shifts(before.texts, after.texts), ...shifts(before.arrows, after.arrows)];
  expect(new Set(all).size).toBe(1);
  expect(all[0]).not.toBe('0.0000,0.0000');
  // One Undo puts everything back (Ketcher moves back by subtracting: equal to 1e-9).
  const undo = page.getByTestId('undo').filter({ visible: true });
  await expect(undo).toBeEnabled();
  await undo.click();
  await expect.poll(async () => same(await snapshot(page), before)).toBe(true);

  // Delete with the group selected: all of it goes. Undo brings it back, still a group.
  // Ungroup and Group again first: Ketcher's keys work straight after the button.
  await clickAtom(page, 0);
  const whole = await everything(page);
  const button = page.getByTestId('group-button');
  await button.click();
  await expect(button).toHaveAttribute('data-offer', 'group');
  await button.click();
  await expect(button).toHaveAttribute('data-offer', 'ungroup');
  await page.keyboard.press('Delete');
  await expect.poll(() => everything(page)).toEqual({ atoms: [], bonds: [], texts: [], rxnArrows: [] });
  await expect(undo).toBeEnabled();
  await undo.click();
  await expect.poll(() => everything(page)).toEqual(whole);
  await deselect(page);
  await clickAtom(page, 0);
  await expect.poll(() => selection(page)).toEqual(whole);
});

// Without the text: Ketcher 3.18 can't rotate a selection that holds a text, with or without
// groups (its ReText.getRelBox throws and the turn stops after the text; measured).
test('a group rotates as one', async ({ app }) => {
  const { page } = app;
  await openEditor(app);
  await drawing(page, { text: false });
  await groupEverything(page);
  await deselect(page);
  const before = await snapshot(page);
  await clickAtom(page, 0);
  // Ketcher's rotate handle, turned: every member turns, so distances between them stay.
  await expect(page.getByTestId('group-button')).toHaveAttribute('data-anchored', 'true');
  const box = (await page.getByTestId('rotation-handle').boundingBox())!;
  const handle = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(handle.x, handle.y);
  await page.mouse.down();
  await page.mouse.move(handle.x + 60, handle.y + 20, { steps: 5 });
  await page.mouse.move(handle.x + 120, handle.y + 80, { steps: 5 });
  await page.mouse.up();
  const turned = await snapshot(page);
  const points = (s: Snapshot) => [...s.atoms, ...s.arrows].map((p) => [p[1], p[2]]);
  const [p0, p1] = [points(before), points(turned)];
  expect(p1.length).toBe(p0.length);
  expect(Math.hypot(p1[0][0] - p0[0][0], p1[0][1] - p0[0][1])).toBeGreaterThan(0.5);
  const distance = (p: number[][], i: number, j: number) => Math.hypot(p[i][0] - p[j][0], p[i][1] - p[j][1]);
  for (let i = 1; i < p0.length; i++) expect(Math.abs(distance(p1, 0, i) - distance(p0, 0, i))).toBeLessThan(1e-6);
});

test('a bond drawn onto a grouped molecule joins the group', async ({ app }) => {
  const { page } = app;
  await openEditor(app);
  await drawing(page);
  await groupEverything(page);
  await deselect(page);
  const atomsBefore = (await everything(page)).atoms;
  // The bond tool, clicked on atom 0: a new atom bonded to it.
  await page.getByTestId('bonds').filter({ visible: true }).click();
  await clickAtom(page, 0);
  await expect.poll(async () => (await everything(page)).atoms.length).toBe(atomsBefore.length + 1);
  await selectTool(page);
  await deselect(page);
  await clickAtom(page, 0);
  await expect.poll(async () => (await selection(page)).atoms).toEqual((await everything(page)).atoms);
});

test('groups survive a relaunch, and end when the drawing is replaced or cleared', async ({ app }) => {
  const { page } = app;
  await openEditor(app);
  await drawing(page);
  // Stretch a bond (an end atom, nudged with arrow keys), so that Ketcher rescales the
  // drawing when it loads it again.
  await clickAtom(page, await endAtom(page));
  for (let i = 0; i < 10; i++) await page.keyboard.press('ArrowRight');
  const bondBefore = await averageBond(page);
  await deselect(page);
  const saved = await nextAutosave(page);
  await groupEverything(page);
  const counted = await counts(page);
  await deselect(page);
  // Grouping changes nothing in the drawing; a nudge with an arrow key does, so the autosave
  // writes the drawing the groups are saved with.
  await clickAtom(page, 0);
  await page.keyboard.press('ArrowRight');
  await saved();
  await app.relaunch();
  // A smaller window: Ketcher centres the drawing it loads in the middle of it.
  await app.page.setViewportSize({ width: 1000, height: 640 });
  await openEditor(app);
  // Ketcher did scale the drawing (its bonds to length 1) as it loaded it.
  expect(Math.abs((await averageBond(app.page)) / bondBefore - 1)).toBeGreaterThan(1e-3);
  expect(Math.abs((await averageBond(app.page)) - 1)).toBeLessThan(1e-9);
  await selectTool(app.page);
  // Ketcher puts back the selection saved with the drawing; start from none.
  await deselect(app.page);
  await clickAtom(app.page, 0);
  // Ketcher numbers a reloaded drawing afresh: the same items, maybe under other ids.
  expect(await counts(app.page)).toEqual(counted);
  await expect.poll(() => selection(app.page)).toEqual(await everything(app.page));

  // A drawing loaded afresh has no groups, even where ids repeat.
  await app.page.evaluate(
    async ([a, b]) => {
      await window.ketcher!.setMolecule(a);
      await window.ketcher!.addFragment(b);
    },
    [molfile('aspirin'), molfile('caffeine')],
  );
  await selectTool(app.page);
  await clickAtom(app.page, 0);
  await expect.poll(() => selection(app.page)).toEqual({ atoms: [0], bonds: [], texts: [], rxnArrows: [] });
});

test('Clear Canvas ends the groups, and Undo brings them back', async ({ app }) => {
  const { page } = app;
  await openEditor(app);
  await drawing(page);
  await groupEverything(page);
  await deselect(page);
  const whole = await everything(page);
  const empty = { atoms: [], bonds: [], texts: [], rxnArrows: [] };
  const clear = page.getByTestId('clear-canvas').filter({ visible: true });
  await clear.click();
  await expect.poll(() => everything(page)).toEqual(empty);
  const undo = page.getByTestId('undo').filter({ visible: true });
  await undo.click();
  await expect.poll(() => everything(page)).toEqual(whole);
  await clickAtom(page, 0);
  await expect.poll(() => selection(page)).toEqual(whole);
  // Cleared again, and two bonds drawn by hand: their atoms are numbered from 0 again, but
  // they are in no group.
  await clear.click();
  await expect.poll(() => everything(page)).toEqual(empty);
  await page.getByTestId('bonds').filter({ visible: true }).click();
  for (const [fx, fy] of [[0.3, 0.4], [0.7, 0.6]]) {
    const at = await canvasPoint(page, fx, fy);
    await page.mouse.click(at.x, at.y);
  }
  await expect.poll(async () => (await everything(page)).atoms).toEqual([0, 1, 2, 3]);
  await selectTool(page);
  await clickAtom(page, 0);
  await expect.poll(() => selection(page)).toEqual({ atoms: [0], bonds: [], texts: [], rxnArrows: [] });
});

/** Press one of Ketcher's buttons that puts a new drawing in place, and wait for it. Ketcher
 * then selects what Indigo marked selected: start again from no selection. */
async function replacing(page: Page, testId: string) {
  await page.evaluate(() => ((window as unknown as { before: unknown }).before = window.ketcher!.editor.struct()));
  await page.getByTestId(testId).filter({ visible: true }).click();
  await expect.poll(() => page.evaluate(() => window.ketcher!.editor.struct() !== (window as unknown as { before: unknown }).before)).toBe(true);
  await deselect(page);
}

// Ketcher (Indigo) makes a new drawing for Aromatize, the same items where they were. (Whether
// Layout or Clean Up keep a group depends on whether they move its items together; the rule,
// a group carried only when found whole, is in groups.test.ts.)
test('Aromatize keeps the groups, and so does its Undo', async ({ app }) => {
  const { page } = app;
  await openEditor(app);
  await drawing(page);
  await groupEverything(page);
  await deselect(page);
  await replacing(page, 'Aromatize button');
  await clickAtom(page, 0);
  const whole = await everything(page);
  await expect.poll(() => selection(page)).toEqual(whole);
  await deselect(page);
  // The drawing from before, with its own ids (Indigo numbered the arrow afresh).
  await replacing(page, 'undo');
  await clickAtom(page, 0);
  await expect.poll(() => selection(page)).toEqual(await everything(page));
});

test('a double-click on a grouped atom edits that atom only', async ({ app }) => {
  const { page } = app;
  await openEditor(app);
  await drawing(page);
  await groupEverything(page);
  await deselect(page);
  const labels = () =>
    page.evaluate(() => [...(window.ketcher!.editor.struct() as unknown as { atoms: Map<number, { label: string }> }).atoms].map(([id, a]) => [id, a.label]));
  const before = await labels();
  const at = await atomOnPage(page, 0);
  await page.mouse.dblclick(at.x, at.y);
  const label = page.getByTestId('label-input');
  await expect(label).toBeVisible();
  await label.fill('N');
  await page.getByTestId('OK').click();
  await expect.poll(labels).toEqual(before.map(([id, l]) => [id, id === 0 ? 'N' : l]));
  // Only that atom is selected, so Ketcher's rotate frame and floating tools (drawn round the
  // group by the press before) are gone: no handle left to turn one atom on its own.
  await expect.poll(() => selection(page)).toEqual({ atoms: [0], bonds: [], texts: [], rxnArrows: [] });
  await expect(page.getByTestId('floating-tools')).toHaveCount(0);
  await expect(page.getByTestId('rotation-handle')).toHaveCount(0);
});

// A guard: on 6e1cbea, before the store narrowed only a select tool's selection, this already
// passed (Ketcher's own handling left nothing selected); groupStore.test.ts holds the rule.
test('a double-click with the bond tool on a grouped bond leaves nothing selected', async ({ app }) => {
  const { page } = app;
  await openEditor(app);
  await drawing(page);
  await groupEverything(page);
  await deselect(page);
  // A bond of atom 0, clicked twice with the single-bond tool (Ketcher steps its order).
  const [begin, end] = await page.evaluate(() => {
    const s = window.ketcher!.editor.struct() as unknown as { bonds: Map<number, { begin: number; end: number }> };
    const bond = [...s.bonds.values()].find((b) => b.begin === 0 || b.end === 0)!;
    return [bond.begin, bond.end];
  });
  const [p, q] = [await atomOnPage(page, begin), await atomOnPage(page, end)];
  await page.getByTestId('bonds').filter({ visible: true }).click();
  await page.mouse.dblclick((p.x + q.x) / 2, (p.y + q.y) / 2);
  await expect(page.getByTestId('bonds').filter({ visible: true })).toHaveCount(1);
  // The next tool picked would act on anything left selected.
  await expect.poll(() => selection(page)).toEqual({ atoms: [], bonds: [], texts: [], rxnArrows: [] });
});
