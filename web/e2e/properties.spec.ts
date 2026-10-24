// Properties panel and Lipinski card (spec section 2), in the built app with the real CSP:
// RDKit runs in its own worker and the panel must show exactly what the server's RDKit
// says, as recorded in tests/fixtures/reference_expected.json ("panel"). Every wait is on
// the panel's own state or an exact value.
import type { Page } from '@playwright/test';
import { cspPolicy } from '../config/csp.ts';
import { RDKIT_WORKER_FILE } from '../config/rdkitWasm.ts';
import { lipinskiSummary } from '../src/chem/properties.ts';
import { DEFINED_COLOR, UNDEFINED_COLOR } from '../src/editor/stereoHighlight.ts';
import {
  clearCanvas,
  expect,
  fixture,
  highlights,
  holdableRdkitReplies,
  inchiKey,
  type Highlights,
  openEditor,
  test,
  waitForEditor,
  waitForServiceWorker,
} from './fixtures.ts';

interface Panel {
  formula: string;
  fragments: string;
  average_mw: string;
  exact_mass: string;
  degree_of_unsaturation: string;
  hbd: string;
  hba: string;
  rotatable_bonds: string;
  tpsa: string;
  logp: string;
  lipinski: Record<'mw' | 'logp' | 'hbd' | 'hba', boolean>;
  stereo: { centres: string; double_bonds: string; undefined: string; max_stereoisomers: string };
}

interface Compound {
  typed_name: string;
  smiles: string;
  inchikey: string;
  files: string[];
  stereo: { possible: { type: string; specified: string; centered_on: number }[] };
  properties: { NumHeavyAtoms: number; NumAtoms: number };
  panel: Panel;
}

const COMPOUNDS: Compound[] = (JSON.parse(fixture('reference_expected.json')) as { compounds: Compound[] }).compounds;

function compound(name: string): Compound {
  const found = COMPOUNDS.find((c) => c.typed_name === name);
  if (!found) throw new Error(`${name} is not in reference_expected.json`);
  return found;
}

async function load(page: Page, structure: string): Promise<void> {
  await page.evaluate((s) => window.ketcher!.setMolecule(s), structure);
}

const molfile = (c: Compound) => fixture(c.files[0]);

/** Everything the panel shows, read in one go together with its state. */
function readPanel(page: Page) {
  return page.getByTestId('properties-panel').evaluate((panel) => {
    const text = (id: string) => panel.querySelector(`[data-testid="${id}"]`)?.textContent ?? null;
    const rule = (id: string) => {
      const row = panel.querySelector(`[data-testid="lipinski-${id}"]`);
      return row && { pass: row.getAttribute('data-pass') === 'true', value: row.querySelector('.lipinski-value')?.textContent };
    };
    return {
      state: panel.getAttribute('data-state'),
      atoms: panel.getAttribute('data-atoms'),
      formula: panel.querySelector('[data-testid="prop-formula"]')?.getAttribute('data-formula') ?? null,
      note: text('properties-note'),
      average_mw: text('prop-average-mw'),
      exact_mass: text('prop-exact-mass'),
      degree_of_unsaturation: text('prop-dou'),
      hbd: text('prop-hbd'),
      hba: text('prop-hba'),
      rotatable_bonds: text('prop-rotatable'),
      tpsa: text('prop-tpsa'),
      logp: text('prop-logp'),
      lipinski: { mw: rule('mw'), logp: rule('logp'), hbd: rule('hbd'), hba: rule('hba') },
      summary: text('lipinski-summary'),
      stereo: {
        centres: text('stereo-centres'),
        double_bonds: text('stereo-double-bonds'),
        undefined: text('stereo-undefined'),
        max_stereoisomers: text('stereo-max'),
      },
      undefinedNote: panel.querySelector('[data-testid="stereo-undefined-note"]') !== null,
      mesoNote: panel.querySelector('[data-testid="stereo-meso-note"]') !== null,
    };
  });
}

/** What readPanel must return once the panel shows this compound, drawn with `atoms` atoms
 * (the fixture Molfiles have no hydrogen atoms). */
function expected(c: Compound, atoms = c.properties.NumHeavyAtoms) {
  const p = c.panel;
  const breaks = Object.values(p.lipinski).filter((pass) => !pass).length;
  return {
    state: 'ready',
    atoms: String(atoms),
    formula: p.formula,
    note: p.fragments === '1' ? null : `${p.fragments} structures drawn: the values are for the whole drawing.`,
    average_mw: p.average_mw,
    exact_mass: p.exact_mass,
    degree_of_unsaturation: p.degree_of_unsaturation,
    hbd: p.hbd,
    hba: p.hba,
    rotatable_bonds: p.rotatable_bonds,
    tpsa: p.tpsa,
    logp: p.logp,
    lipinski: {
      mw: { pass: p.lipinski.mw, value: p.average_mw },
      logp: { pass: p.lipinski.logp, value: p.logp },
      hbd: { pass: p.lipinski.hbd, value: p.hbd },
      hba: { pass: p.lipinski.hba, value: p.hba },
    },
    summary: lipinskiSummary(breaks),
    stereo: p.stereo,
    // Undefined ones are flagged; with two or more elements, meso forms may make fewer.
    undefinedNote: p.stereo.undefined !== '0',
    mesoNote: Number(p.stereo.centres) + Number(p.stereo.double_bonds) >= 2,
  };
}

async function expectShows(page: Page, c: Compound, atoms?: number): Promise<void> {
  await expect.poll(() => readPanel(page), { message: c.typed_name }).toEqual(expected(c, atoms));
}

async function expectMessage(page: Page, state: string, message: string): Promise<void> {
  const panel = page.getByTestId('properties-panel');
  await expect(panel).toHaveAttribute('data-state', state);
  await expect(page.getByTestId('properties-message')).toHaveText(message);
  await expect(panel.getByTestId('prop-formula')).toHaveCount(0);
}

const EMPTY = 'Draw a structure to see its properties';

// Includes the testing checklist's stereo lines, read from the fixtures, never typed:
// (R)-2-butanol, open-chain glucose (aldehydo-D-glucose), cyclic glucose (one undefined
// anomeric centre) and ibuprofen (undefined).
test("every reference compound shows the server's values", async ({ app }) => {
  const { page } = app;
  await openEditor(app);
  for (const c of COMPOUNDS) {
    // Empty in between, so the next ready state can only be this compound's.
    await clearCanvas(page);
    await expectMessage(page, 'empty', EMPTY);
    await load(page, molfile(c));
    await expectShows(page, c);
  }
  // The fixtures include the cases the spec names (tests/test_reference_fixtures.py).
  expect(COMPOUNDS.some((c) => c.panel.fragments !== '1')).toBe(true);
  expect(COMPOUNDS.some((c) => !Object.values(c.panel.lipinski).every(Boolean))).toBe(true);
});

test('offline: after one visit the panel works with no network and no server', async ({ app }) => {
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
  // The worker fetches RDKit's wasm itself; Playwright reports fetches from a running worker.
  const rdkitWasm = context.waitForEvent('response', (r) => r.url().endsWith('/rdkit/RDKit_minimal.wasm'));
  await page.reload();
  await waitForEditor(app);

  const cholesterol = compound('cholesterol'); // breaks one Lipinski rule
  await load(page, molfile(cholesterol));
  await expectShows(page, cholesterol);
  expect((await rdkitWasm).fromServiceWorker(), 'RDKit wasm from the cache').toBe(true);
  expect(notFromCache).toEqual([]);
});

test('the panel says why it shows no numbers, and shows them again once it can', async ({ app }) => {
  const { page } = app;
  await openEditor(app);
  await expectMessage(page, 'empty', EMPTY);

  const aspirin = compound('aspirin');
  await load(page, molfile(aspirin));
  await expectShows(page, aspirin);

  // Text alone is no structure.
  const textOnly = { root: { nodes: [{ type: 'text', boundingBox: { x: 1, y: -1, width: 1, height: 0.4 }, paragraphs: [{ parts: [{ text: 'note' }] }] }] } };
  await load(page, JSON.stringify(textOnly));
  expect(await page.evaluate(() => [window.ketcher!.editor.struct().texts.size, window.ketcher!.editor.struct().atoms.size])).toEqual([1, 0]);
  await expectMessage(page, 'empty', EMPTY);

  // A reaction: two reference compounds joined by an arrow.
  await load(page, `${compound('ethanol').smiles}>>${compound('acetone').smiles}`);
  expect(await page.evaluate(() => window.ketcher!.editor.struct().rxnArrows.size)).toBe(1);
  await expectMessage(page, 'reaction', 'Properties are shown for structures, not reactions');
  await load(page, molfile(aspirin));
  await expectShows(page, aspirin);

  // A carbon with five bonds: Ketcher's valence warning instead of numbers.
  const carbons = (n: number) => ({
    root: { nodes: [{ $ref: 'mol0' }] },
    mol0: {
      type: 'molecule',
      atoms: Array.from({ length: n + 1 }, (_, i) => ({
        label: 'C',
        location: i === 0 ? [0, 0, 0] : [Math.cos((2 * Math.PI * i) / n), Math.sin((2 * Math.PI * i) / n), 0],
      })),
      bonds: Array.from({ length: n }, (_, i) => ({ type: 1, atoms: [0, i + 1] })),
    },
  });
  await load(page, JSON.stringify(carbons(5)));
  expect(await page.evaluate(() => [...window.ketcher!.editor.struct().atoms.values()].filter((a) => a.badConn).length)).toBe(1);
  await expectMessage(page, 'invalid', '1 atom has an impossible valence (underlined in red). Fix it to see the properties.');
  await load(page, JSON.stringify(carbons(4)));
  await expect(page.getByTestId('properties-panel')).toHaveAttribute('data-state', 'ready');
  await expect(page.getByTestId('prop-formula')).toHaveCount(1);

  // Ketcher also underlines a sodium ion that a Molfile gives an explicit valence of 0 (as
  // RDKit's writer does). RDKit reads it as the valid ion it is, so the values still show.
  const salt = compound('sodium benzoate');
  await load(page, molfile(salt));
  expect(await page.evaluate(() => [...window.ketcher!.editor.struct().atoms.values()].filter((a) => a.badConn).map((a) => a.label))).toEqual(['Na']);
  await expectShows(page, salt);

  // An R-group: not every atom is an element.
  await load(page, `[*:1]${compound('ethanol').smiles}`);
  expect(await page.evaluate(() => [...window.ketcher!.editor.struct().atoms.values()].some((a) => a.rglabel !== null))).toBe(true);
  await expectMessage(page, 'not-elements', 'Properties need every atom to be an element, so R-groups, atom lists and query atoms show none.');

  await clearCanvas(page);
  await expectMessage(page, 'empty', EMPTY);
});

test("explicit hydrogens drawn by Ketcher don't change the values", async ({ app }) => {
  const { page } = app;
  await openEditor(app);
  // Ibuprofen has methyl groups: with its hydrogens as atoms, RDKit would count the bonds
  // to them as rotatable unless they are folded back in (src/chem/compute.ts).
  const ibuprofen = compound('ibuprofen');
  await load(page, molfile(ibuprofen));
  await expectShows(page, ibuprofen);
  await page.getByTestId('Add/Remove explicit hydrogens button').filter({ visible: true }).click();
  // The same values, now for the drawing with every hydrogen an atom.
  await expectShows(page, ibuprofen, ibuprofen.properties.NumAtoms);
});

test('if RDKit cannot start, the panel says so and the editor carries on', async ({ app }) => {
  const { context, page } = app;
  test.skip(!app.server.local, 'changes what the server sends');
  // Serve the RDKit worker with the page's policy: RDKit's bindings need 'unsafe-eval',
  // so RDKit fails to start (as it would if Apache lost the worker's own header).
  await context.route(`**/${RDKIT_WORKER_FILE}`, async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, headers: { ...response.headers(), 'content-security-policy': cspPolicy() } });
  });
  await openEditor(app);
  await expectMessage(page, 'unavailable', 'Properties are unavailable: RDKit could not start.');
  await load(page, molfile(compound('aspirin')));
  expect(await page.evaluate(() => window.ketcher!.editor.struct().atoms.size)).toBe(compound('aspirin').properties.NumHeavyAtoms);
  await expectMessage(page, 'unavailable', 'Properties are unavailable: RDKit could not start.');
});

/** The fixture's stereo elements as the highlight should show them, for a drawing whose
 * Ketcher atom ids equal the Molfile's atom indices (checked by the caller). */
function expectedHighlight(c: Compound, bondIds: Map<number, number>) {
  const ofKind = (defined: boolean, color: string) => {
    const els = c.stereo.possible.filter((e) => (e.specified === 'Specified') === defined);
    const atoms = els.filter((e) => e.type.startsWith('Atom_')).map((e) => e.centered_on);
    const bonds = els.filter((e) => e.type.startsWith('Bond_')).map((e) => bondIds.get(e.centered_on)!);
    return { color, atoms: atoms.sort((a, b) => a - b), bonds: bonds.sort((a, b) => a - b) };
  };
  return [ofKind(true, DEFINED_COLOR), ofKind(false, UNDEFINED_COLOR)].filter(
    (g) => g.atoms.length + g.bonds.length > 0,
  );
}

/** Load a fixture compound and check Ketcher numbered its atoms and bonds in Molfile order,
 * so fixture indices are Ketcher ids. */
async function loadInOrder(page: Page, c: Compound): Promise<void> {
  await load(page, molfile(c));
  const ids = await page.evaluate(() => {
    const struct = window.ketcher!.editor.struct();
    return { atoms: [...struct.atoms.keys()], bonds: [...struct.bonds.keys()] };
  });
  expect(ids.atoms).toEqual(ids.atoms.map((_, i) => i));
  expect(ids.bonds).toEqual(ids.bonds.map((_, i) => i));
}

const identity = (c: Compound) => new Map(c.stereo.possible.map((e) => [e.centered_on, e.centered_on]));

test('clicking a stereo count highlights exactly those elements, and clicking again removes them', async ({ app }) => {
  const { page } = app;
  await openEditor(app);
  for (const name of ['glucose', '(E)-cinnamic acid']) {
    const c = compound(name);
    await clearCanvas(page);
    await loadInOrder(page, c);
    await expectShows(page, c);
    const history = await page.evaluate(() => {
      const w = window as unknown as { __changes: number };
      w.__changes = 0;
      window.ketcher!.changeEvent.add(() => (w.__changes += 1));
      return (window.ketcher!.editor as unknown as { historySize(): unknown }).historySize();
    });
    const button = page.getByTestId(c.panel.stereo.centres !== '0' ? 'stereo-centres' : 'stereo-double-bonds');
    await button.click();
    await expect(button).toHaveAttribute('aria-pressed', 'true');
    expect(await highlights(page)).toEqual(expectedHighlight(c, identity(c)));
    // Highlighting is not an edit: no change event (so no autosave), nothing to undo.
    const after = () =>
      page.evaluate(() => [
        (window as unknown as { __changes: number }).__changes,
        (window.ketcher!.editor as unknown as { historySize(): unknown }).historySize(),
      ]);
    expect(await after()).toEqual([0, history]);
    await button.click();
    await expect(button).toHaveAttribute('aria-pressed', 'false');
    expect(await highlights(page)).toEqual([]);
    expect(await after()).toEqual([0, history]);
  }
});

test("a change to the drawing takes the highlight away, and the student's own highlights stay", async ({ app }) => {
  const { page } = app;
  await openEditor(app);
  const glucose = compound('glucose');
  await loadInOrder(page, glucose);
  await expectShows(page, glucose);
  // A highlight the student made (Ketcher's own Highlight menu uses the same list).
  const own = { color: '#00ff00', atoms: [0], bonds: [] as number[] };
  await page.evaluate(
    (h) => (window.ketcher!.editor as unknown as Highlights).highlights.create({ ...h, rgroupAttachmentPoints: [] }),
    own,
  );
  await page.getByTestId('stereo-centres').click();
  expect(await highlights(page)).toEqual([own, ...expectedHighlight(glucose, identity(glucose))]);

  // Any edit: here, a benzene ring placed with Ketcher's template tool, away from glucose.
  // (Not Add explicit hydrogens: Ketcher rebuilds the drawing for that and drops every
  // highlight, the student's too.)
  await page.getByTestId('template-0').click();
  await page.locator('[data-testid="ketcher-canvas"][data-canvasmode="molecules-mode"]').click({ position: { x: 120, y: 120 } });
  const atoms = await page.evaluate(() => window.ketcher!.editor.struct().atoms.size);
  expect(atoms).toBeGreaterThan(glucose.properties.NumHeavyAtoms);
  await expect(page.getByTestId('properties-panel')).toHaveAttribute('data-atoms', String(atoms));
  await expect(page.getByTestId('properties-panel')).toHaveAttribute('data-state', 'ready');
  await expect(page.getByTestId('stereo-centres')).toHaveAttribute('aria-pressed', 'false');
  expect(await highlights(page)).toEqual([own]);
});

test("highlights land on the right atoms when Ketcher's atom ids are out of order", async ({ app }) => {
  const { page } = app;
  await openEditor(app);
  const butanol = compound('(R)-2-butanol');
  await loadInOrder(page, butanol);
  await expectShows(page, butanol);
  const [centre] = butanol.stereo.possible.map((e) => e.centered_on);
  // Delete the stereocentre and undo: Ketcher restores the atom under its old id but at
  // the end of its atom list, so Molfile atom order no longer matches the ids.
  await page.evaluate((id) => window.ketcher!.editor.selection({ atoms: [id] }), centre);
  await page.locator('.Ketcher-root').focus();
  await page.keyboard.press('Delete');
  await expect(page.getByTestId('properties-panel')).toHaveAttribute('data-atoms', String(butanol.properties.NumHeavyAtoms - 1));
  const undo = page.getByTestId('undo').filter({ visible: true });
  await expect(undo).toBeEnabled();
  await page.keyboard.press('Control+z');
  await expectShows(page, butanol);
  const ids = await page.evaluate(() => [...window.ketcher!.editor.struct().atoms.keys()]);
  expect(ids[ids.length - 1]).toBe(centre);
  expect(await inchiKey(page)).toBe(butanol.inchikey);
  await page.getByTestId('stereo-centres').click();
  expect(await highlights(page)).toEqual(expectedHighlight(butanol, identity(butanol)));
});

test('while RDKit works on a newer drawing, older values can\'t be highlighted and a late reply is never shown', async ({ app }) => {
  const { context, page } = app;
  await context.addInitScript(holdableRdkitReplies);
  await openEditor(app);
  const glucose = compound('glucose');
  const aspirin = compound('aspirin');
  const butanol = compound('(R)-2-butanol');
  await load(page, molfile(glucose));
  await expectShows(page, glucose);
  const panel = page.getByTestId('properties-panel');
  const count = page.getByTestId('stereo-centres');
  await expect(count).toBeEnabled();

  // Every formula the panel shows from here on, starting with glucose's.
  await page.evaluate(() => {
    const formula = () => document.querySelector('[data-testid="prop-formula"]')?.getAttribute('data-formula') ?? null;
    const seen: (string | null)[] = [formula()];
    Object.assign(window, { __formulas: seen });
    new MutationObserver(() => {
      const shown = formula();
      if (seen[seen.length - 1] !== shown) seen.push(shown);
    }).observe(document.querySelector('[data-testid="properties-panel"]')!, { subtree: true, childList: true, attributes: true });
  });

  await page.evaluate(() => (window as unknown as { __holdRdkit(): void }).__holdRdkit());
  await load(page, molfile(aspirin));
  // Glucose's values stay, marked out of date, and can't be highlighted on aspirin.
  await expect(panel).toHaveAttribute('data-state', 'updating');
  await expect(panel.getByTestId('prop-formula')).toHaveAttribute('data-formula', glucose.panel.formula);
  await expect(count).toBeDisabled();
  // Another change while RDKit still has aspirin: it waits, as one request.
  await load(page, molfile(butanol));
  await expect(panel).toHaveAttribute('data-state', 'updating');

  await page.evaluate(() => (window as unknown as { __releaseRdkit(): void }).__releaseRdkit());
  await expectShows(page, butanol);
  await expect(count).toBeEnabled();
  // Aspirin's reply came after the drawing had moved on: never shown.
  expect(await page.evaluate(() => (window as unknown as { __formulas: (string | null)[] }).__formulas)).toEqual([
    glucose.panel.formula,
    butanol.panel.formula,
  ]);
});
