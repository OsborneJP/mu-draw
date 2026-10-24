// Functional-group highlighter (spec section 3), in the built app with the real CSP: the
// RDKit worker matches the shipped web/public/functional-groups.json. The list must equal
// the 25-molecule judgement file (tests/fixtures/functional_groups_expected.json), and the
// colours must sit on exactly the atoms and bonds the same matcher finds when run here in
// Node (so this checks the way to the canvas: Ketcher ids, bonds, colours, timing).
import type initRDKit from '@rdkit/rdkit';
import type { Page, Route } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { findGroups, readPatterns, type Patterns } from '../src/chem/functionalGroups.ts';
import { PATTERNS_FILE } from '../src/chem/rdkitFiles.ts';
import {
  clearCanvas,
  expect,
  fixture,
  highlights,
  holdableRdkitReplies,
  openEditor,
  test,
  type App,
  type Highlights,
  waitForEditor,
  waitForServiceWorker,
} from './fixtures.ts';

type RDKit = Awaited<ReturnType<typeof initRDKit>>;

interface Expected {
  molecules: { name: string; checks: string; groups: Record<string, number> }[];
}
interface Compound {
  typed_name: string;
  heavy_atoms: number;
  file: string;
}

const EXPECTED = (JSON.parse(fixture('functional_groups_expected.json')) as Expected).molecules;
const COMPOUNDS = (JSON.parse(fixture('functional_groups/compounds.json')) as { compounds: Compound[] }).compounds;
const PATTERN_TEXT = readFileSync(new URL(`../public/${PATTERNS_FILE}`, import.meta.url), 'utf8');

function compound(name: string): Compound {
  const found = COMPOUNDS.find((c) => c.typed_name === name);
  if (!found) throw new Error(`${name} is not in functional_groups/compounds.json`);
  return found;
}

const molfile = (name: string) => fixture(compound(name).file);
const expectedGroups = (name: string) => EXPECTED.find((m) => m.name === name)!.groups;

let rdkit: RDKit;
let patterns: Patterns;

test.beforeAll(async () => {
  const require = createRequire(import.meta.url);
  rdkit = await (require('@rdkit/rdkit') as typeof initRDKit)();
  rdkit.use_legacy_stereo_perception(false); // as src/chem/compute.ts configureRdkit
  patterns = readPatterns(rdkit, JSON.parse(PATTERN_TEXT));
});

/** Where the colours must be for a fixture loaded in Molfile order (Ketcher ids equal the
 * Molfile's atom and bond indices; loadInOrder checks): one highlight per group. */
function expectedColours(name: string) {
  const mol = rdkit.get_mol(molfile(name), JSON.stringify({ removeHs: false }))!;
  try {
    const parsed = JSON.parse(mol.get_json()) as { molecules: { bonds?: { atoms: [number, number] }[] }[] };
    const bonds = (parsed.molecules[0].bonds ?? []).map((b) => b.atoms);
    return findGroups(mol, bonds, patterns).map((g) => {
      const atoms = g.instances.flatMap((i) => i.atoms).sort((a, b) => a - b);
      const inGroup = new Set(atoms);
      const bondIds = bonds.flatMap(([a, b], id) => (inGroup.has(a) && inGroup.has(b) ? [id] : []));
      return { color: g.color, atoms, bonds: bondIds };
    });
  } finally {
    mol.delete();
  }
}

async function load(page: Page, structure: string): Promise<void> {
  await page.evaluate((s) => window.ketcher!.setMolecule(s), structure);
}

async function loadInOrder(page: Page, name: string): Promise<void> {
  await load(page, molfile(name));
  const ids = await page.evaluate(() => {
    const struct = window.ketcher!.editor.struct();
    return { atoms: [...struct.atoms.keys()], bonds: [...struct.bonds.keys()] };
  });
  expect(ids.atoms).toEqual(ids.atoms.map((_, i) => i));
  expect(ids.bonds).toEqual(ids.bonds.map((_, i) => i));
}

/** The panel's values describe a drawing with this many atoms, as it is now. */
async function expectReady(page: Page, atoms: number): Promise<void> {
  const panel = page.getByTestId('properties-panel');
  await expect(panel).toHaveAttribute('data-atoms', String(atoms));
  await expect(panel).toHaveAttribute('data-state', 'ready');
}

/** The groups the panel lists, name -> count, in the panel's order. */
function listed(page: Page) {
  return page.getByTestId('group').evaluateAll((items) =>
    items.map((li) => [li.getAttribute('data-name'), Number(li.getAttribute('data-count'))] as const),
  );
}

/** What the panel must list: the judgement file's groups, highest priority first. */
function expectedList(name: string) {
  const groups = expectedGroups(name);
  return patterns.groups.filter((g) => g.name in groups).map((g) => [g.name, groups[g.name]] as const);
}

async function tick(page: Page): Promise<void> {
  const toggle = page.getByTestId('groups-toggle');
  await toggle.check();
  await expect(toggle).toBeChecked();
}

/** Counts change events and reads the undo history size, to show colouring is no edit. */
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

test('every molecule of the test set lists its groups, coloured on their own atoms', async ({ app }) => {
  const { page } = app;
  await openEditor(app);
  // The checkbox is in the panel's values, so draw something first.
  await loadInOrder(page, EXPECTED[0].name);
  await expectReady(page, compound(EXPECTED[0].name).heavy_atoms);
  const edits = await editCounter(page);
  const before = await edits();
  await tick(page);
  expect(await edits()).toEqual(before); // ticking is not an edit
  for (const { name, checks } of EXPECTED) {
    // Empty in between, so the next ready state can only be this molecule's.
    await clearCanvas(page);
    await expect(page.getByTestId('properties-panel')).toHaveAttribute('data-state', 'empty');
    expect(await highlights(page), `${name}: no colours left on the empty canvas`).toEqual([]);
    await loadInOrder(page, name);
    await expectReady(page, compound(name).heavy_atoms);
    expect(await listed(page), `${name}: ${checks}`).toEqual(expectedList(name));
    expect(await highlights(page), name).toEqual(expectedColours(name));
  }
});

test('unticking takes away exactly the group colours; the stereo highlight and the student\'s own stay', async ({ app }) => {
  const { page } = app;
  await openEditor(app);
  const name = 'cholesterol';
  await loadInOrder(page, name);
  await expectReady(page, compound(name).heavy_atoms);
  const own = { color: '#00ff00', atoms: [0], bonds: [] as number[] };
  await page.evaluate(
    (h) => (window.ketcher!.editor as unknown as Highlights).highlights.create({ ...h, rgroupAttachmentPoints: [] }),
    own,
  );
  await page.getByTestId('stereo-centres').click();
  await expect(page.getByTestId('stereo-centres')).toHaveAttribute('aria-pressed', 'true');
  const withStereo = await highlights(page);
  expect(withStereo.length).toBeGreaterThan(1);
  const edits = await editCounter(page);
  const before = await edits();

  await tick(page);
  expect(await highlights(page)).toEqual([...withStereo, ...expectedColours(name)]);
  expect(await page.getByTestId('groups-list').isVisible()).toBe(true);

  await page.getByTestId('groups-toggle').uncheck();
  await expect(page.getByTestId('groups-list')).toHaveCount(0);
  expect(await highlights(page)).toEqual(withStereo);
  expect(await edits()).toEqual(before);
});

test('the colours follow the drawing, and a reply for an older drawing is never coloured', async ({ app }) => {
  const { context, page } = app;
  await context.addInitScript(holdableRdkitReplies);
  await openEditor(app);
  const [first, skipped, last] = ['aspirin', 'paracetamol', 'vanillin'];
  await loadInOrder(page, first);
  await expectReady(page, compound(first).heavy_atoms);
  await tick(page);
  expect(await highlights(page)).toEqual(expectedColours(first));

  // Every highlight state Ketcher redraws from here on.
  await page.evaluate(() => {
    const editor = window.ketcher!.editor as unknown as Highlights & { update: (...args: unknown[]) => unknown };
    const seen: string[] = [];
    const update = editor.update.bind(editor);
    const record = () => {
      const now = JSON.stringify(editor.highlights.getAll().map(({ highlight: h }) => [h.color, [...h.atoms].sort((a, b) => a - b)]));
      if (seen[seen.length - 1] !== now) seen.push(now);
    };
    record();
    editor.update = (...args: unknown[]) => {
      const result = update(...args);
      record();
      return result;
    };
    Object.assign(window, { __highlightStates: seen });
  });

  await page.evaluate(() => (window as unknown as { __holdRdkit(): void }).__holdRdkit());
  await load(page, molfile(skipped));
  // The change took the old colours away at once; the list stays, marked out of date.
  expect(await highlights(page)).toEqual([]);
  await expect(page.getByTestId('properties-panel')).toHaveAttribute('data-state', 'updating');
  await expect(page.getByTestId('groups-list')).toBeVisible();
  // Another change while RDKit still has the first: it waits, as one request.
  await loadInOrder(page, last);
  await page.evaluate(() => (window as unknown as { __releaseRdkit(): void }).__releaseRdkit());
  await expectReady(page, compound(last).heavy_atoms);
  expect(await listed(page)).toEqual(expectedList(last));
  expect(await highlights(page)).toEqual(expectedColours(last));

  const states = (await page.evaluate(() => (window as unknown as { __highlightStates: string[] }).__highlightStates)).map(
    (s) => JSON.parse(s) as [string, number[]][],
  );
  const asStates = (name: string) => expectedColours(name).map((h) => [h.color, h.atoms]);
  expect(states).toEqual([asStates(first), [], asStates(last)]);
});

test("the colours land on the right atoms when Ketcher's atom ids are out of order", async ({ app }) => {
  const { page } = app;
  await openEditor(app);
  // First a structure with none of the groups (a reference compound with only C and H).
  await load(page, fixture('molfiles/1-4-dimethylcyclohexane.mol'));
  await expect(page.getByTestId('properties-panel')).toHaveAttribute('data-state', 'ready');
  await tick(page);
  await expect(page.getByTestId('groups-message')).toHaveText('None of the groups this app looks for is in the drawing.');
  expect(await highlights(page)).toEqual([]);

  const name = '2-butanol';
  await loadInOrder(page, name);
  await expectReady(page, compound(name).heavy_atoms);
  const [alcohol] = expectedColours(name);
  expect(alcohol.atoms.length).toBe(1);
  expect(await highlights(page)).toEqual([alcohol]);
  // Delete the O and undo: Ketcher restores it under its old id, last in its atom list, so
  // the Molfile's atom order no longer matches the ids. Ketcher takes keys only once it has
  // been clicked since the checkbox was (an empty corner of the canvas).
  await page.locator('[data-testid="ketcher-canvas"][data-canvasmode="molecules-mode"]').click({ position: { x: 20, y: 20 } });
  const oxygen = alcohol.atoms[0];
  await page.evaluate((id) => window.ketcher!.editor.selection({ atoms: [id] }), oxygen);
  await page.keyboard.press('Delete');
  await expectReady(page, compound(name).heavy_atoms - 1);
  await expect(page.getByTestId('groups-message')).toHaveText('None of the groups this app looks for is in the drawing.');
  expect(await highlights(page)).toEqual([]);
  const undo = page.getByTestId('undo').filter({ visible: true });
  await expect(undo).toBeEnabled();
  await page.keyboard.press('Control+z');
  await expectReady(page, compound(name).heavy_atoms);
  const ids = await page.evaluate(() => [...window.ketcher!.editor.struct().atoms.keys()]);
  expect(ids[ids.length - 1]).toBe(oxygen);
  expect(await listed(page)).toEqual(expectedList(name));
  expect(await highlights(page)).toEqual([alcohol]);
});

test('with every hydrogen drawn as an atom, the same groups, on heavy atoms only', async ({ app }) => {
  const { page } = app;
  await openEditor(app);
  const name = 'lidocaine';
  await loadInOrder(page, name);
  await expectReady(page, compound(name).heavy_atoms);
  await tick(page);
  expect(await highlights(page)).toEqual(expectedColours(name));
  // Ketcher rebuilds the drawing for this (dropping every highlight); the panel colours the
  // new drawing's groups when its values arrive.
  await page.getByTestId('Add/Remove explicit hydrogens button').filter({ visible: true }).click();
  // Every atom, hydrogens included, as RDKit counts them for this Molfile.
  const mol = rdkit.get_mol(molfile(name))!;
  mol.add_hs_in_place();
  const atoms = mol.get_num_atoms();
  mol.delete();
  expect(atoms).toBeGreaterThan(compound(name).heavy_atoms);
  await expectReady(page, atoms);
  expect(await listed(page)).toEqual(expectedList(name));
  const coloured = await page.evaluate(() => {
    const struct = window.ketcher!.editor.struct();
    return (window.ketcher!.editor as unknown as Highlights).highlights
      .getAll()
      .flatMap(({ highlight: h }) => h.atoms.map((id) => struct.atoms.get(id)!.label));
  });
  expect(coloured.length).toBe(expectedColours(name).reduce((n, h) => n + h.atoms.length, 0));
  expect(coloured).not.toContain('H');
});

test('offline: after one visit the groups work with no network and no server', async ({ app }) => {
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
  // The RDKit worker fetches the patterns itself; Playwright reports a running worker's fetches.
  const patternFile = context.waitForEvent('response', (r) => r.url().endsWith(`/${PATTERNS_FILE}`));
  await page.reload();
  await waitForEditor(app);

  const name = 'procaine';
  await loadInOrder(page, name);
  await expectReady(page, compound(name).heavy_atoms);
  await tick(page);
  expect(await listed(page)).toEqual(expectedList(name));
  expect(await highlights(page)).toEqual(expectedColours(name));
  expect((await patternFile).fromServiceWorker(), 'patterns from the cache').toBe(true);
  expect(notFromCache).toEqual([]);
});

/** The guards' reports of problems this test causes on purpose, then forget them. Call it
 * last: the first problem also fails every later wait raced against app.failed. */
async function expectProblems(app: App, expected: string[]): Promise<void> {
  await expect.poll(() => app.problems).toEqual(expected);
  app.problems.length = 0;
}

test('a pattern file the server cannot find: the section says so and the properties still show', async ({ app }) => {
  const { context, page, server } = app;
  test.skip(!server.local, 'changes what the server sends');
  // The RDKit worker's request is held until the editor is up, so the 404 (which the guards
  // report) can't fail the start. The service worker's precache request goes through.
  const asked = new Promise<Route>((resolve) => {
    void context.route(`**/${PATTERNS_FILE}`, (route) =>
      route.request().serviceWorker() ? route.continue() : resolve(route),
    );
  });
  await openEditor(app);
  await (await asked).fulfill({ status: 404, body: 'Not Found' });
  const name = 'aspirin';
  await loadInOrder(page, name);
  await expectReady(page, compound(name).heavy_atoms);
  await expect(page.getByTestId('prop-formula')).toHaveCount(1);
  await tick(page);
  await expect(page.getByTestId('groups-message')).toHaveText(
    `Functional groups are unavailable: ${PATTERNS_FILE} could not be loaded (Error: HTTP 404).`,
  );
  expect(await highlights(page)).toEqual([]);
  await expectProblems(app, [`HTTP 404: ${server.url}${PATTERNS_FILE}`]);
});

test.describe('a pattern file that is changed or broken', () => {
  // Each test serves its own copy of the build and edits the pattern file in it, as a
  // person editing it on the server would.
  test.use({ buildCopy: true });

  async function publishPatterns(app: App, text: string): Promise<void> {
    test.skip(!app.server.local, 'changes what the server sends');
    writeFileSync(join(app.server.copy!, PATTERNS_FILE), text);
  }

  test('an entry RDKit cannot read is skipped and named; the others still work', async ({ app }) => {
    const file = JSON.parse(PATTERN_TEXT) as { groups: { name: string; smarts: string }[] };
    for (const g of file.groups) if (g.name === 'Ether') g.smarts = '[O';
    await publishPatterns(app, JSON.stringify(file));
    const { page } = app;
    await openEditor(app);
    const name = 'vanillin';
    await loadInOrder(page, name);
    await expectReady(page, compound(name).heavy_atoms);
    await tick(page);
    await expect(page.getByTestId('groups-problems')).toHaveText(
      `Skipped in ${PATTERNS_FILE}:"Ether": RDKit can't read its SMARTS`,
    );
    expect(await listed(page)).toEqual(expectedList(name).filter(([g]) => g !== 'Ether'));
  });

  test('a file that is not JSON: the section says so and the properties still show', async ({ app }) => {
    await publishPatterns(app, PATTERN_TEXT.replace(/\]\s*\}\s*$/, '],}'));
    const { page } = app;
    await openEditor(app);
    const name = 'aspirin';
    await loadInOrder(page, name);
    await expectReady(page, compound(name).heavy_atoms);
    await expect(page.getByTestId('prop-formula')).toHaveCount(1);
    await tick(page);
    await expect(page.getByTestId('groups-message')).toHaveText(
      new RegExp(`^Functional groups are unavailable: ${PATTERNS_FILE.replace('.', '\\.')} could not be loaded \\(SyntaxError: .+\\)\\.$`),
    );
    expect(await highlights(page)).toEqual([]);
  });
});
