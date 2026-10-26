// ¹H NMR preview (docs/plans/v2-proton-nmr.md), in the built app with the real CSP: the
// panels' RDKit worker predicts from the precached ¹H table. The panel must show exactly what
// the same prediction code gives here in Node (web/scripts/protonNmr.test.ts checks those
// predictions against measured spectra), and the highlighting must work both ways.
import type initRDKit from '@rdkit/rdkit';
import type { Page, Route } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { decodeTable, lookup, PROTON, type ShiftTable } from '../src/chem/carbonTable.ts';
import { predictProton, type ProtonTableInfo, type Signal } from '../src/chem/protonNmr.ts';
import { CARBON_TABLE_LICENCE_FILE, PROTON_TABLE_FILE } from '../src/chem/rdkitFiles.ts';
import { BANNER, PEAK_COLOR } from '../src/panels/nmr.ts';
import { axisRange, carrier, PLOT, sticks, type ShownSignal } from '../src/panels/protonNmr.ts';
import {
  clearCanvas,
  expect,
  fixture,
  highlights,
  holdableRdkitReplies,
  openEditor,
  test,
  type App,
  waitForEditor,
  waitForServiceWorker,
} from './fixtures.ts';

type RDKit = Awaited<ReturnType<typeof initRDKit>>;

interface Compound {
  typed_name: string;
  heavy_atoms: number;
  file: string;
}

const COMPOUNDS = (JSON.parse(fixture('proton_nmr/compounds.json')) as { compounds: Compound[] }).compounds;
// Squalene (30 heavy atoms) is the ¹³C set's: it has no ¹H spectrum to test against.
const SQUALENE = (JSON.parse(fixture('nmr/compounds.json')) as { compounds: Compound[] }).compounds.find((c) => c.typed_name === 'squalene')!;
const compound = (name: string) => (name === 'squalene' ? SQUALENE : COMPOUNDS.find((c) => c.typed_name === name)!);
const molfile = (name: string) => fixture(compound(name).file);

let rdkit: RDKit;
let table: ShiftTable<ProtonTableInfo>;

test.beforeAll(async () => {
  const require = createRequire(import.meta.url);
  rdkit = await (require('@rdkit/rdkit') as typeof initRDKit)();
  rdkit.use_legacy_stereo_perception(false); // as src/chem/compute.ts configureRdkit
  const bytes = readFileSync(new URL(`../public/${PROTON_TABLE_FILE}`, import.meta.url));
  table = decodeTable<ProtonTableInfo>(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, PROTON);
});

const signalsOf = (name: string): Signal[] =>
  predictProton(rdkit, molfile(name), { spheres: table.info.spheres, find: (code) => lookup(table, code) })!;

/** The table the panel must show for a fixture loaded in Molfile order (Ketcher ids equal
 * Molfile indices; loadInOrder checks). */
function expectedRows(name: string) {
  return signalsOf(name).map((s) => ({
    shift: s.shift === null ? '' : String(s.shift),
    hydrogens: String(s.hydrogens),
    on: carrier(s.element, s.perAtom),
    low: String(s.shift !== null && s.sphere <= 2),
    exchangeable: String(s.exchangeable),
    diastereotopic: s.diastereotopic ?? '',
    atoms: [...s.atoms].sort((a, b) => a - b),
  }));
}

/** The signals as the panel holds them (Ketcher ids equal Molfile indices here). */
function shownOf(name: string): ShownSignal[] {
  return signalsOf(name).map((s) => ({
    shift: s.shift,
    low: s.shift !== null && s.sphere <= 2,
    atoms: s.atoms,
    hydrogens: s.hydrogens,
    on: carrier(s.element, s.perAtom),
    exchangeable: s.exchangeable,
    diastereotopic: s.diastereotopic,
    bridged: s.bridged,
  }));
}

/** The sticks as drawn: where each line is, how tall, and which signals it carries. */
function drawnSticks(page: Page) {
  return page.getByTestId('proton-stick').evaluateAll((gs) =>
    gs.map((g) => {
      const line = g.querySelector('line')!;
      return {
        x: Number(line.getAttribute('x1')),
        height: Number(line.getAttribute('y1')) - Number(line.getAttribute('y2')),
        signals: g.getAttribute('data-signals')!.split(' ').map(Number),
      };
    }),
  );
}

/** A row as the panel must show it: its attributes and its note. */
function rowOf(r: ReturnType<typeof expectedRows>[number]) {
  const { shift, hydrogens, on, low, exchangeable, diastereotopic } = r;
  const notes = [shift === '' ? 'no match' : low === 'true' ? 'low confidence' : '', exchangeable === 'true' ? 'exchangeable' : '', diastereotopic ? 'diastereotopic' : ''];
  return { shift, hydrogens, on, low, exchangeable, diastereotopic, note: notes.filter((n) => n !== '').join(', ') };
}

async function loadInOrder(page: Page, name: string): Promise<void> {
  await page.evaluate((s) => window.ketcher!.setMolecule(s), molfile(name));
  const ids = await page.evaluate(() => [...window.ketcher!.editor.struct().atoms.keys()]);
  expect(ids).toEqual(ids.map((_, i) => i));
  await expect(page.getByTestId('properties-panel')).toHaveAttribute('data-atoms', String(compound(name).heavy_atoms));
  await expect(page.getByTestId('properties-panel')).toHaveAttribute('data-state', 'ready');
}

/** The rows as the panel shows them. */
function rows(page: Page) {
  return page.getByTestId('proton-signal').evaluateAll((trs) =>
    trs.map((tr) => ({
      shift: tr.getAttribute('data-shift'),
      hydrogens: tr.getAttribute('data-hydrogens'),
      on: tr.getAttribute('data-on'),
      low: tr.getAttribute('data-low'),
      exchangeable: tr.getAttribute('data-exchangeable'),
      diastereotopic: tr.getAttribute('data-diastereotopic'),
      note: tr.querySelector('.nmr-note')?.textContent ?? '',
    })),
  );
}

async function predict(page: Page): Promise<void> {
  await page.getByTestId('proton-predict').click();
  const panel = page.getByTestId('proton-panel');
  await expect(panel).toHaveAttribute('data-state', 'ready');
  // The canvas view has made up for the height the panel takes (Docked).
  await expect(panel).toHaveAttribute('data-docked', String(await panel.evaluate((e) => (e as HTMLElement).offsetHeight)));
}

/** Counts change events and reads the undo history size, to show highlighting is no edit. */
async function editCounter(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __changes: number };
    w.__changes = 0;
    window.ketcher!.changeEvent.add(() => (w.__changes += 1));
  });
  return () =>
    page.evaluate(() => [
      (window as unknown as { __changes: number }).__changes,
      (window.ketcher!.editor as unknown as { historySize(): unknown }).historySize(),
    ]);
}

const colour = (atoms: number[]) => [{ color: PEAK_COLOR, atoms, bonds: [] as number[] }];

/** Where Ketcher draws an atom on the page: its page-to-model transform is linear, so three
 * points give its inverse. */
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

async function clickAtom(page: Page, id: number): Promise<void> {
  const point = await atomOnPage(page, id);
  const hit = await page.evaluate(({ x, y }) => {
    const element = document.elementFromPoint(x, y);
    return element?.closest('[data-testid="ketcher-canvas"]') ? 'canvas' : (element?.outerHTML.slice(0, 80) ?? 'nothing');
  }, point);
  expect(hit, `atom ${id} is on the open canvas`).toBe('canvas');
  await page.mouse.click(point.x, point.y);
}

/** Every state the ¹H panel shows from now on, read back by states(). */
async function recordStates(page: Page): Promise<() => Promise<string[]>> {
  await page.evaluate(() => {
    const now = () => document.querySelector('[data-testid="proton-panel"]')?.getAttribute('data-state') ?? 'closed';
    const seen: string[] = [now()];
    Object.assign(window, { __protonStates: seen });
    new MutationObserver(() => {
      if (seen[seen.length - 1] !== now()) seen.push(now());
    }).observe(document.body, { subtree: true, childList: true, attributes: true });
  });
  return () => page.evaluate(() => (window as unknown as { __protonStates: string[] }).__protonStates);
}

const hold = (page: Page) => page.evaluate(() => (window as unknown as { __holdRdkit(name: string): void }).__holdRdkit('rdkit-nmr'));
const held = (page: Page) => page.evaluate(() => (window as unknown as { __heldRdkit(name: string): number }).__heldRdkit('rdkit-nmr'));
const release = (page: Page) => page.evaluate(() => (window as unknown as { __releaseRdkit(name: string): void }).__releaseRdkit('rdkit-nmr'));

test('every test compound: the predicted signals, with the banner, the notes and the licence notice', async ({ app }) => {
  const { page } = app;
  await openEditor(app);
  for (const { typed_name: name } of COMPOUNDS) {
    await clearCanvas(page);
    await expect(page.getByTestId('properties-panel')).toHaveAttribute('data-state', 'empty');
    await loadInOrder(page, name);
    await predict(page);
    const expected = expectedRows(name);
    expect(await rows(page), name).toEqual(expected.map(rowOf));
    // A stick per predicted signal, or one for signals drawn closer than a line's width, as
    // tall as their H together (the integration), at its shift on a reversed axis.
    const shown = shownOf(name);
    const { min, max } = axisRange(shown);
    const drawn = await drawnSticks(page);
    expect(drawn.map((d) => d.signals), name).toEqual(sticks(shown, { min, max }).map((d) => d.signals));
    expect(drawn.flatMap((d) => d.signals).sort((a, b) => a - b), name).toEqual(shown.flatMap((s, i) => (s.shift === null ? [] : [i])));
    const total = (d: (typeof drawn)[number]) => d.signals.reduce((n, i) => n + shown[i].hydrogens, 0);
    for (const d of drawn) {
      expect(d.height / drawn[0].height, name).toBeCloseTo(total(d) / total(drawn[0]), 9);
      // Each signal's place: 0 ppm at the right end, the axis maximum at the left.
      const places = d.signals.map((i) => PLOT.left + ((max - shown[i].shift!) / (max - min)) * (PLOT.width - PLOT.left - PLOT.right));
      expect(d.x, name).toBeGreaterThanOrEqual(Math.min(...places) - 1e-9);
      expect(d.x, name).toBeLessThanOrEqual(Math.max(...places) + 1e-9);
    }
    await expect(page.getByTestId('proton-tick').first()).toHaveText(String(max));
    await expect(page.getByTestId('proton-tick').last()).toHaveText(String(min));
    await expect(page.getByTestId('proton-exchangeable-note')).toHaveCount(expected.some((r) => r.exchangeable === 'true') ? 1 : 0);
    await expect(page.getByTestId('proton-diastereotopic-note')).toHaveCount(expected.some((r) => r.diastereotopic !== '') ? 1 : 0);
    await expect(page.getByTestId('proton-bridged-note')).toHaveCount(shown.some((s) => s.diastereotopic && s.bridged) ? 1 : 0);
    await expect(page.getByTestId('proton-banner')).toHaveText(BANNER);
    await expect(page.getByTestId('proton-notice')).toContainText(
      'Contains information from nmrshiftdb2 (www.nmrshiftdb.org), which is made available here under the nmrshiftdb2 Database License',
    );
  }
  // The set exercises every marking.
  const all = COMPOUNDS.flatMap((c) => expectedRows(c.typed_name));
  for (const marked of [all.some((r) => r.low === 'true'), all.some((r) => r.exchangeable === 'true'), all.some((r) => r.diastereotopic !== '')]) {
    expect(marked).toBe(true);
  }
  // The notice's licence link stays in the app, and the licence is there.
  const link = page.getByTestId('proton-notice').getByRole('link');
  expect(await link.evaluate((a) => (a as HTMLAnchorElement).href)).toBe(new URL(CARBON_TABLE_LICENCE_FILE, app.server.url).href);
});

test('the axis runs 12 to 0 ppm, wider when a signal lies beyond 12', async ({ app }) => {
  const { page } = app;
  await openEditor(app);
  const highest = (name: string) => Math.max(...signalsOf(name).map((s) => s.shift ?? 0));
  const beyond = COMPOUNDS.find((c) => highest(c.typed_name) > 12)!.typed_name;
  const within = COMPOUNDS.find((c) => highest(c.typed_name) <= 12)!.typed_name;
  for (const [name, max] of [
    [within, 12],
    [beyond, Math.ceil(highest(beyond))],
  ] as const) {
    await clearCanvas(page);
    await loadInOrder(page, name);
    await predict(page);
    await expect(page.getByTestId('proton-spectrum'), name).toHaveAttribute('data-max', String(max));
    await page.getByTestId('proton-close').click();
  }
});

test('a signal colours the atoms carrying its H, an atom selects its signal, and a change takes the colour away', async ({ app }) => {
  const { page } = app;
  await openEditor(app);
  const name = 'toluene';
  await loadInOrder(page, name);
  await predict(page);
  // The panel below the canvas leaves the whole drawing in view.
  for (let atom = 0; atom < compound(name).heavy_atoms; atom += 1) {
    const point = await atomOnPage(page, atom);
    expect(await page.evaluate(({ x, y }) => Boolean(document.elementFromPoint(x, y)?.closest('[data-testid="ketcher-canvas"]')), point), `atom ${atom}`).toBe(true);
  }
  const expected = expectedRows(name);
  const edits = await editCounter(page);
  const before = await edits();
  const row = (i: number) => page.getByTestId('proton-signal').nth(i);
  const stick = (i: number) => page.locator(`[data-testid="proton-stick"][data-signals~="${i}"]`);

  // A row: its atoms (two equivalent ring CH here) are coloured; again: no longer.
  const pair = expected.findIndex((r) => r.atoms.length === 2);
  await row(pair).click();
  await expect(row(pair)).toHaveAttribute('aria-selected', 'true');
  await expect(stick(pair)).toHaveAttribute('data-selected', 'true');
  expect(await highlights(page)).toEqual(colour(expected[pair].atoms));
  await row(pair).click();
  await expect(row(pair)).toHaveAttribute('aria-selected', 'false');
  expect(await highlights(page)).toEqual([]);

  // A stick: the methyl's, far from the ring's.
  const methyl = expected.findIndex((r) => r.on === 'CH₃');
  await stick(methyl).click();
  await expect(row(methyl)).toHaveAttribute('aria-selected', 'true');
  expect(await highlights(page)).toEqual(colour(expected[methyl].atoms));
  expect(await edits()).toEqual(before); // colouring is no edit

  // An atom on the canvas (the second of two equivalent ones): its signal is selected and
  // both its atoms coloured.
  await clickAtom(page, expected[pair].atoms[1]);
  await expect(row(pair)).toHaveAttribute('aria-selected', 'true');
  expect(await highlights(page)).toEqual(colour(expected[pair].atoms));
  expect((await edits())[0]).toBe(0);

  // Any change: the prediction is out of date and its colour goes at once.
  await page.evaluate((s) => window.ketcher!.setMolecule(s), molfile('2-butanol'));
  await expect(page.getByTestId('proton-panel')).toHaveAttribute('data-state', 'stale');
  expect(await highlights(page)).toEqual([]);
  await page.getByTestId('proton-again').click();
  await expect(page.getByTestId('proton-panel')).toHaveAttribute('data-state', 'ready');

  // A diastereotopic CH₂: both its rows colour its carbon, and the carbon selects the first.
  const butanol = expectedRows('2-butanol');
  const higher = butanol.findIndex((r) => r.diastereotopic === 'higher');
  const lower = butanol.findIndex((r) => r.diastereotopic === 'lower');
  expect(butanol[higher].atoms).toEqual(butanol[lower].atoms);
  await row(lower).click();
  expect(await highlights(page)).toEqual(colour(butanol[lower].atoms));
  await clickAtom(page, butanol[higher].atoms[0]);
  await expect(row(higher)).toHaveAttribute('aria-selected', 'true');
  expect(await highlights(page)).toEqual(colour(butanol[higher].atoms));

  // Closing removes the panel and any colour.
  await page.getByTestId('proton-close').click();
  await expect(page.getByTestId('proton-panel')).toHaveCount(0);
  expect(await highlights(page)).toEqual([]);
});

test('a click on a stick selects its own signal, however close its neighbours', async ({ app }) => {
  const { page } = app;
  await openEditor(app);
  // The compounds with sticks closer than two click targets: before the targets stopped
  // halfway to each neighbour, a later stick's covered an earlier one (the review).
  const close = COMPOUNDS.map((c) => c.typed_name).filter((name) => {
    const shown = shownOf(name);
    const drawn = sticks(shown, axisRange(shown));
    return drawn.some((d, k) => k > 0 && d.x - drawn[k - 1].x < 8);
  });
  expect(close.length).toBeGreaterThan(3);
  for (const name of close) {
    await clearCanvas(page);
    await loadInOrder(page, name);
    await predict(page);
    const lines = page.locator('[data-testid="proton-stick"] line');
    const count = await lines.count();
    for (let k = 0; k < count; k += 1) {
      const signal = Number(await page.getByTestId('proton-stick').nth(k).getAttribute('data-index'));
      const box = (await lines.nth(k).boundingBox())!;
      // On the line itself, a third of the way up from the axis.
      await page.mouse.click(box.x + box.width / 2, box.y + (2 * box.height) / 3);
      await expect(page.getByTestId('proton-signal').nth(signal), `${name}: stick ${k}`).toHaveAttribute('aria-selected', 'true');
    }
    await page.getByTestId('proton-close').click();
  }
});

test("signals land on the right atoms when Ketcher's atom ids are out of order", async ({ app }) => {
  const { page } = app;
  await openEditor(app);
  const name = 'toluene';
  await loadInOrder(page, name);
  const methyl = expectedRows(name).find((r) => r.on === 'CH₃')!.atoms[0];
  // Delete the methyl and undo: Ketcher restores it under its old id, last in its list.
  await page.evaluate((id) => window.ketcher!.editor.selection({ atoms: [id] }), methyl);
  await page.locator('.Ketcher-root').focus();
  await page.keyboard.press('Delete');
  await expect(page.getByTestId('properties-panel')).toHaveAttribute('data-atoms', String(compound(name).heavy_atoms - 1));
  await expect(page.getByTestId('undo').filter({ visible: true })).toBeEnabled();
  await page.keyboard.press('Control+z');
  await expect(page.getByTestId('properties-panel')).toHaveAttribute('data-atoms', String(compound(name).heavy_atoms));
  await expect(page.getByTestId('properties-panel')).toHaveAttribute('data-state', 'ready');
  const ids = await page.evaluate(() => [...window.ketcher!.editor.struct().atoms.keys()]);
  expect(ids[ids.length - 1]).toBe(methyl);
  await predict(page);
  await page.locator('[data-testid="proton-signal"][data-on="CH₃"]').click();
  expect(await highlights(page)).toEqual(colour([methyl]));
});

test('a prediction for a drawing that has since changed is never shown', async ({ app }) => {
  const { context, page } = app;
  await context.addInitScript(holdableRdkitReplies);
  await openEditor(app);
  await loadInOrder(page, 'acetophenone');
  const states = await recordStates(page);
  // The panels' worker starts on the first prediction; hold its answers from then on.
  await hold(page);
  await page.getByTestId('proton-predict').click();
  await expect(page.getByTestId('proton-panel')).toHaveAttribute('data-state', 'predicting');
  await loadInOrder(page, 'benzyl alcohol');
  await expect(page.getByTestId('proton-panel')).toHaveAttribute('data-state', 'stale');
  // Acetophenone's answer has come and is held: it arrives only after the change.
  await expect.poll(() => held(page)).toBe(1);
  await release(page);
  expect(await held(page)).toBe(0);
  await expect(page.getByTestId('proton-panel')).toHaveAttribute('data-state', 'stale');
  await page.getByTestId('proton-again').click();
  await expect(page.getByTestId('proton-panel')).toHaveAttribute('data-state', 'ready');
  expect((await rows(page)).map((r) => r.shift)).toEqual(expectedRows('benzyl alcohol').map((r) => r.shift));
  expect(await states()).toEqual(['closed', 'predicting', 'stale', 'predicting', 'ready']);
});

test('the worker answers both previews: a ¹³C answer never reaches the ¹H panel, nor the other way round', async ({ app }) => {
  const { context, page } = app;
  await context.addInitScript(holdableRdkitReplies);
  await openEditor(app);
  await loadInOrder(page, 'ethyl acetate');
  const states = await recordStates(page);
  // Each preview numbers its own requests, so both first ones are 1. The ¹³C answer is held
  // before the ¹H request is made, so it is released first, to a ¹H panel waiting on id 1.
  await hold(page);
  await page.getByTestId('nmr-predict').click(); // starts the worker
  await expect.poll(() => held(page)).toBe(1);
  await page.getByTestId('proton-predict').click(); // closes the ¹³C panel
  await expect(page.getByTestId('nmr-panel')).toHaveCount(0);
  await expect.poll(() => held(page)).toBe(2);
  await release(page);
  await expect(page.getByTestId('proton-panel')).toHaveAttribute('data-state', 'ready');
  expect((await rows(page)).map((r) => r.shift)).toEqual(expectedRows('ethyl acetate').map((r) => r.shift));
  expect(await states()).toEqual(['closed', 'predicting', 'ready']);

  // The other way round: a ¹H answer for an id (2) the ¹³C panel is waiting on.
  await page.getByTestId('proton-close').click();
  await hold(page);
  await page.getByTestId('proton-predict').click();
  await expect.poll(() => held(page)).toBe(1);
  await page.getByTestId('nmr-predict').click(); // closes the ¹H panel
  await expect.poll(() => held(page)).toBe(2);
  await release(page);
  await expect(page.getByTestId('nmr-panel')).toHaveAttribute('data-state', 'ready');
  await expect(page.getByTestId('proton-panel')).toHaveCount(0);
  await expect(page.getByTestId('nmr-peak').first()).toHaveAttribute('data-type', /^C/);
});

test('a 30-heavy-atom molecule is predicted in under 2 seconds, the first time and again', async ({ app }) => {
  const { page } = app;
  await openEditor(app);
  expect(SQUALENE.heavy_atoms).toBe(30);
  await loadInOrder(page, 'squalene');
  for (const time of ['first (worker start and table load included)', 'again']) {
    const started = Date.now();
    await predict(page);
    expect(Date.now() - started, time).toBeLessThan(2000);
    await page.getByTestId('proton-close').click();
  }
});

test('the TMS line can be switched off', async ({ app }) => {
  const { page } = app;
  await openEditor(app);
  await loadInOrder(page, 'ethyl acetate');
  await predict(page);
  await expect(page.getByTestId('proton-tms')).toHaveCount(1);
  await page.getByTestId('proton-tms-toggle').uncheck();
  await expect(page.getByTestId('proton-tms')).toHaveCount(0);
});

test('one panel below the canvas at a time: ¹H, ¹³C, the stereoisomers and Practice', async ({ app }) => {
  const { page } = app;
  await openEditor(app);
  await loadInOrder(page, '2-butanol');
  const proton = page.getByTestId('proton-panel');
  const others = [
    { open: () => page.getByTestId('nmr-predict').click(), panel: page.getByTestId('nmr-panel') },
    { open: () => page.getByTestId('stereo-show').click(), panel: page.getByTestId('stereo-panel') },
    { open: () => page.getByTestId('app-practice-button').click(), panel: page.getByTestId('practice-panel') },
  ];
  for (const other of others) {
    await predict(page);
    await other.open();
    await expect(other.panel).toBeVisible();
    await expect(proton).toHaveCount(0);
    await predict(page);
    await expect(other.panel).toHaveCount(0);
    // Practice's Next would clear the canvas; nothing here presses it, so 2-butanol stays.
    await expect(page.getByTestId('properties-panel')).toHaveAttribute('data-atoms', String(compound('2-butanol').heavy_atoms));
  }
});

test('offline: after one visit the prediction works with no network and no server', async ({ app }) => {
  const { context, page, server } = app;
  await openEditor(app);
  await waitForServiceWorker(app);
  if (server.local) await server.close();
  await context.setOffline(true);
  const notFromCache: string[] = [];
  const origin = new URL(server.url).origin;
  context.on('response', (r) => {
    if (new URL(r.url()).origin === origin && !r.fromServiceWorker()) notFromCache.push(r.url());
  });
  context.on('requestfailed', (r) => notFromCache.push(`failed ${r.url()}`));
  await page.reload();
  await waitForEditor(app);
  const name = 'ibuprofen';
  await loadInOrder(page, name);
  // The panels' worker fetches the table on its first ¹H prediction.
  const tableFile = context.waitForEvent('response', (r) => r.url().endsWith(`/${PROTON_TABLE_FILE}`));
  await predict(page);
  expect((await rows(page)).map((r) => r.shift)).toEqual(expectedRows(name).map((r) => r.shift));
  expect((await tableFile).fromServiceWorker(), 'the table from the cache').toBe(true);
  expect(notFromCache).toEqual([]);
});

/** The guards' reports of problems this test causes on purpose, then forget them. */
async function expectProblems(app: App, expected: string[]): Promise<void> {
  await expect.poll(() => app.problems).toEqual(expected);
  app.problems.length = 0;
}

test('a table the server cannot find: the panel says so, and the properties carry on', async ({ app }) => {
  const { context, page, server } = app;
  test.skip(!server.local, 'changes what the server sends');
  // Missing for the service worker's precache too (see nmr.spec.ts): its request is held
  // until the editor is up, so its 404 (which the guards report) can't fail the start.
  const precache = new Promise<Route>((resolve) => {
    void context.route(`**/${PROTON_TABLE_FILE}`, (route: Route) =>
      route.request().serviceWorker() ? resolve(route) : route.fulfill({ status: 404, body: 'Not Found' }),
    );
  });
  await openEditor(app);
  await (await precache).fulfill({ status: 404, body: 'Not Found' });
  await loadInOrder(page, 'toluene');
  await page.getByTestId('proton-predict').click();
  await expect(page.getByTestId('proton-message')).toHaveText(
    `The ¹H NMR preview is unavailable: ${PROTON_TABLE_FILE} could not be loaded (Error: HTTP 404).`,
  );
  await expect(page.getByTestId('prop-formula')).toHaveCount(1);
  const missing = `HTTP 404: ${server.url}${PROTON_TABLE_FILE}`;
  await expectProblems(app, [missing, missing]); // the service worker's request, then the worker's
});

test.describe('a damaged table', () => {
  // A deployed site can't serve an edited copy of the build; skip before the copy is made.
  test.skip(Boolean(process.env.SMOKE_URL), 'needs a server the test owns, to serve an edited copy of the build');
  test.use({ buildCopy: true });

  test('the ¹³C table in its place: the panel says so', async ({ app }) => {
    const copy = app.server.copy!;
    writeFileSync(join(copy, PROTON_TABLE_FILE), readFileSync(join(copy, 'nmr/carbon-shifts.bin')));
    const { page } = app;
    await openEditor(app);
    await loadInOrder(page, 'toluene');
    await page.getByTestId('proton-predict').click();
    await expect(page.getByTestId('proton-message')).toHaveText(
      `The ¹H NMR preview is unavailable: ${PROTON_TABLE_FILE} could not be loaded (Error: not a ¹H shift table).`,
    );
  });
});
