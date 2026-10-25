// The stereoisomer panel (docs/plans/v2-stereoisomers.md, bar B): what it lists for every
// test drawing equals what server-side RDKit's EnumerateStereoisomers answered
// (tests/fixtures/stereoisomers_expected.json), Add puts a stereoisomer in hand without
// closing the panel, an answer for an older drawing is never shown, and it works offline.
import type { Page } from '@playwright/test';
import {
  expect,
  fixture,
  holdableRdkitReplies,
  inchiKey,
  openEditor,
  test,
  waitForEditor,
  waitForServiceWorker,
} from './fixtures.ts';

interface Expected {
  name: string;
  file: string;
  elements: number;
  outcome: 'listed' | 'counted' | 'too-many' | 'no-elements';
  count?: number;
  notes?: string[];
  stereoisomers?: {
    number: number;
    inchikey: string;
    labels: { atoms: Record<string, string>; bonds: Record<string, string> };
    relation: { kind: string; of?: number };
    matches: boolean;
    with_drawing_inchikey: string | null;
  }[];
}

const COMPOUNDS = (JSON.parse(fixture('stereoisomers_expected.json')) as { compounds: Expected[] }).compounds;
const CANVAS = '[data-testid="ketcher-canvas"][data-canvasmode="molecules-mode"]';

function compound(name: string): Expected {
  const found = COMPOUNDS.find((c) => c.name === name);
  if (!found) throw new Error(`${name} is not in stereoisomers_expected.json`);
  return found;
}

/** Load a test drawing with Ketcher's atom ids in Molfile order, and wait for its values. */
async function load(page: Page, name: string): Promise<void> {
  await page.evaluate((m) => window.ketcher!.setMolecule(m), fixture(compound(name).file));
  const ids = await page.evaluate(() => [...window.ketcher!.editor.struct().atoms.keys()]);
  expect(ids).toEqual(ids.map((_, i) => i));
  await expect(page.getByTestId('properties-panel')).toHaveAttribute('data-state', 'ready');
}

async function show(page: Page): Promise<void> {
  await page.getByTestId('stereo-show').click();
  await expect(page.getByTestId('stereo-panel')).toHaveAttribute('data-state', 'ready');
}

/** The cards as the panel shows them. */
function cards(page: Page) {
  return page.getByTestId('stereo-card').evaluateAll((items) =>
    items.map((card) => {
      const labels = { atoms: {} as Record<string, string>, bonds: {} as Record<string, string> };
      for (const label of card.querySelectorAll('[data-testid="stereo-label"]')) {
        const atom = label.getAttribute('data-atom');
        if (atom !== null) labels.atoms[atom] = label.textContent!;
        else labels.bonds[label.getAttribute('data-bond')!] = label.textContent!;
      }
      const of = card.getAttribute('data-of');
      const kind = card.getAttribute('data-relation')!;
      return {
        number: Number(card.getAttribute('data-number')),
        inchikey: card.getAttribute('data-inchikey'),
        labels,
        relation: of === null ? { kind } : { kind, of: Number(of) },
        matches: card.getAttribute('data-matches') === 'true',
      };
    }),
  );
}

function notesShown(page: Page) {
  return page.getByTestId('stereo-note').evaluateAll((ps) => ps.map((p) => p.getAttribute('data-note')));
}

const listed = COMPOUNDS.filter((c) => c.outcome === 'listed');

test('every test drawing: the stereoisomers RDKit lists, in order, labelled, paired and matched', async ({ app }) => {
  const { page } = app;
  await openEditor(app);
  expect(listed.length).toBeGreaterThan(20);
  for (const c of listed) {
    await load(page, c.name);
    await show(page);
    const expected = c.stereoisomers!.map(({ number, inchikey, labels, relation, matches }) => ({
      number,
      inchikey,
      labels,
      relation,
      matches,
    }));
    expect(await cards(page), c.name).toEqual(expected);
    const pseudo = expected.some((s) => Object.values(s.labels.atoms).some((l) => l === 'r' || l === 's'));
    expect(await notesShown(page), c.name).toEqual([...c.notes!, ...(pseudo ? ['pseudo-asymmetric'] : [])]);
    // Where RDKit can't judge chirality, nothing is called achiral or meso.
    if (c.notes!.includes('axial-planar')) {
      await expect(page.getByTestId('stereo-panel').getByText(/^(Achiral|Meso)$/)).toHaveCount(0);
    }
    await page.getByTestId('stereo-close').click();
    await expect(page.getByTestId('stereo-panel')).toHaveCount(0);
  }
});

test('too many to draw, too many to list, and nothing to list', async ({ app }) => {
  const { page } = app;
  await openEditor(app);
  const counted = compound('cholesterol');
  await load(page, counted.name);
  await show(page);
  await expect(page.getByTestId('stereo-message')).toHaveText(`${counted.count} stereoisomers: too many to draw here.`);
  const tooMany = compound('erythromycin');
  await load(page, tooMany.name);
  await show(page);
  await expect(page.getByTestId('stereo-message')).toHaveText(
    `${tooMany.elements} stereocentres and stereogenic double bonds: too many to list here.`,
  );
  for (const none of COMPOUNDS.filter((c) => c.outcome === 'no-elements')) {
    await load(page, none.name);
    await expect(page.getByTestId('stereo-show'), none.name).toHaveCount(0);
  }
});

test('more than one structure: one at a time', async ({ app }) => {
  const { page } = app;
  await openEditor(app);
  await load(page, 'L-threonine');
  await page.evaluate((m) => window.ketcher!.addFragment(m), fixture(compound('(E)-cinnamic acid').file));
  await expect(page.getByTestId('properties-panel')).toHaveAttribute('data-state', 'ready');
  await page.getByTestId('stereo-show').click();
  await expect(page.getByTestId('stereo-message')).toHaveText('Stereoisomers are listed for one structure at a time.');
});

/** Click on the canvas away from the drawing, after a move there (Ketcher's paste tool shows
 * what it holds on a move, at most once a frame). */
async function clickOnCanvas(page: Page, fx: number): Promise<void> {
  const box = (await page.locator(CANVAS).boundingBox())!;
  const [x, y] = [box.x + box.width * fx, box.y + box.height * 0.3];
  await page.mouse.move(x, y);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
  await page.mouse.click(x, y);
}

function fragmentCount(page: Page): Promise<number> {
  return page.evaluate(() => new Set([...window.ketcher!.editor.struct().atoms.values()].map((a) => a.fragment)).size);
}

test('Add places a stereoisomer beside the drawing, keeping its stereo, and the panel stays open', async ({ app }) => {
  const { page } = app;
  await openEditor(app);
  const c = compound('L-threonine');
  await load(page, c.name);
  await show(page);
  const mirror = c.stereoisomers!.find((s) => !s.matches)!;
  const card = page.locator(`[data-testid="stereo-card"][data-number="${mirror.number}"]`);
  await card.getByTestId('stereo-add').click();
  await expect(card).toHaveAttribute('data-in-hand', 'true');
  await clickOnCanvas(page, 0.15);
  await expect(card).toHaveAttribute('data-in-hand', 'false');
  expect(await fragmentCount(page)).toBe(2);
  // Ketcher (Indigo) reads the drawing and the placed stereoisomer as RDKit did.
  expect(await inchiKey(page)).toBe(mirror.with_drawing_inchikey);
  await expect(page.getByTestId('stereo-panel')).toHaveAttribute('data-state', 'ready');
  // And another.
  const third = page.locator('[data-testid="stereo-card"][data-number="3"]');
  await third.getByTestId('stereo-add').click();
  await clickOnCanvas(page, 0.85);
  await expect(third).toHaveAttribute('data-in-hand', 'false');
  expect(await fragmentCount(page)).toBe(3);
  await expect(page.getByTestId('stereo-panel')).toHaveAttribute('data-state', 'ready');
});

test('Esc puts the stereoisomer in hand away; any other change closes the panel', async ({ app }) => {
  const { page } = app;
  await openEditor(app);
  await load(page, 'L-threonine');
  await show(page);
  const card = page.locator('[data-testid="stereo-card"][data-number="2"]');
  await card.getByTestId('stereo-add').click();
  await expect(card).toHaveAttribute('data-in-hand', 'true');
  await page.keyboard.press('Escape');
  await expect(card).toHaveAttribute('data-in-hand', 'false');
  await expect(page.getByTestId('stereo-panel')).toHaveAttribute('data-state', 'ready');
  expect(await fragmentCount(page)).toBe(1);
  // The student's own change (not the panel's): the list was about the drawing before it.
  await page.evaluate((m) => window.ketcher!.addFragment(m), fixture(compound('(E)-cinnamic acid').file));
  await expect(page.getByTestId('stereo-panel')).toHaveCount(0);
});

test('an answer for an older drawing is never shown, and the properties keep up meanwhile', async ({ app }) => {
  const { context, page } = app;
  await context.addInitScript(holdableRdkitReplies);
  await openEditor(app);
  await load(page, 'L-threonine');
  await page.evaluate(() => (window as unknown as { __holdRdkit(name: string): void }).__holdRdkit('rdkit-nmr'));
  await page.getByTestId('stereo-show').click();
  await expect(page.getByTestId('stereo-panel')).toHaveAttribute('data-state', 'working');
  // While the stereoisomers are held, a change still gets its properties (the other copy).
  await load(page, 'tartaric acid');
  await expect(page.getByTestId('stereo-panel')).toHaveCount(0);
  const held = () => page.evaluate(() => (window as unknown as { __heldRdkit(name: string): number }).__heldRdkit('rdkit-nmr'));
  await expect.poll(held).toBe(1);
  await page.evaluate(() => (window as unknown as { __releaseRdkit(name: string): void }).__releaseRdkit('rdkit-nmr'));
  expect(await held()).toBe(0);
  await expect(page.getByTestId('stereo-panel')).toHaveCount(0);
  await show(page);
  expect((await cards(page)).map((s) => s.inchikey)).toEqual(compound('tartaric acid').stereoisomers!.map((s) => s.inchikey));
});

test("cholesterol's 256 combinations take under 2 seconds, the first time and again", async ({ app }) => {
  const { page } = app;
  await openEditor(app);
  await load(page, 'cholesterol');
  for (const time of ['first (worker start included)', 'again']) {
    const started = Date.now();
    await show(page);
    expect(Date.now() - started, time).toBeLessThan(2000);
    await page.getByTestId('stereo-close').click();
  }
});

test('one panel below the canvas at a time: stereoisomers or the ¹³C NMR preview', async ({ app }) => {
  const { page } = app;
  await openEditor(app);
  await load(page, 'L-threonine');
  await show(page);
  await page.getByTestId('nmr-predict').click();
  await expect(page.getByTestId('nmr-panel')).toHaveAttribute('data-state', 'ready');
  await expect(page.getByTestId('stereo-panel')).toHaveCount(0);
  await show(page);
  await expect(page.getByTestId('nmr-panel')).toHaveCount(0);
});

test('offline: after one visit the stereoisomers are listed with no network and no server', async ({ app }) => {
  const { context, page, server } = app;
  await openEditor(app);
  await waitForServiceWorker(app);
  if (server.local) await server.close();
  await context.setOffline(true);
  await page.reload();
  await waitForEditor(app);
  const c = compound('2,3-dibromobutane');
  await load(page, c.name);
  await show(page);
  expect((await cards(page)).map((s) => s.inchikey)).toEqual(c.stereoisomers!.map((s) => s.inchikey));
});
