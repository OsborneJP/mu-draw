// The tautomer and resonance panels (docs/plans/v2-tautomers-resonance.md, bar B): what each
// lists for every test drawing equals what server-side RDKit answered
// (tests/fixtures/tautomers_expected.json, resonance_expected.json), with what differs from
// the drawing highlighted; Add puts a structure in hand without closing the panel; an answer
// for an older drawing is never shown; only one panel is below the canvas; both work offline.
import type { Page } from '@playwright/test';
import { expect, fixture, holdableRdkitReplies, openEditor, test, waitForEditor, waitForServiceWorker } from './fixtures.ts';

type Kind = 'tautomers' | 'resonance';

interface Tautomer {
  smiles: string;
  drawing: boolean;
  hydrogens: number[];
  changed_atoms: number[];
  changed_bonds: number[];
}

interface Structure {
  bonds: number[];
  charges: number[];
  drawing: boolean;
  changed_atoms: number[];
  changed_bonds: number[];
}

interface Compound {
  name: string;
  file: string;
  outcome: 'listed' | 'too-many' | 'several' | 'counted' | 'too-large';
  count?: number;
  largest_group?: number;
  stereo_dropped?: boolean;
  tautomers?: Tautomer[];
  structures?: Structure[];
}

const COMPOUNDS: Record<Kind, Compound[]> = {
  tautomers: (JSON.parse(fixture('tautomers_expected.json')) as { compounds: Compound[] }).compounds,
  resonance: (JSON.parse(fixture('resonance_expected.json')) as { compounds: Compound[] }).compounds,
};
const CANVAS = '[data-testid="ketcher-canvas"][data-canvasmode="molecules-mode"]';
// The panel's highlight, as RDKit writes it (formPictures.ts).
const HIGHLIGHT = '#FFCC66';

function compound(kind: Kind, name: string): Compound {
  const found = COMPOUNDS[kind].find((c) => c.name === name);
  if (!found) throw new Error(`${name} is not among the ${kind} test drawings`);
  return found;
}

/** Load a test drawing with Ketcher's atom ids in Molfile order, and wait for its values. */
async function load(page: Page, c: Compound): Promise<void> {
  await page.evaluate((m) => window.ketcher!.setMolecule(m), fixture(c.file));
  const ids = await page.evaluate(() => [...window.ketcher!.editor.struct().atoms.keys()]);
  expect(ids).toEqual(ids.map((_, i) => i));
  await expect(page.getByTestId('properties-panel')).toHaveAttribute('data-state', 'ready');
}

async function show(page: Page, kind: Kind): Promise<void> {
  await page.getByTestId(`${kind}-show`).click();
  await expect(page.getByTestId(`${kind}-panel`)).toHaveAttribute('data-state', 'ready');
}

/** The cards as the panel shows them, with what each picture highlights, read from its SVG. */
function cards(page: Page, kind: Kind) {
  return page.getByTestId(`${kind}-card`).evaluateAll(
    (items, colour) =>
      items.map((card) => {
        const svg = decodeURIComponent(card.querySelector('img')!.getAttribute('src')!.replace(/^data:[^,]*,/, ''));
        const atoms = new Set<number>();
        const bonds = new Set<number>();
        for (const m of svg.matchAll(/<(ellipse|path)[^>]*class='([^']*)'[^>]*style='fill:(#[0-9A-F]{6})/g)) {
          if (m[3] !== colour) continue;
          const bond = /^bond-(\d+)/.exec(m[2]);
          const atom = /^atom-(\d+)$/.exec(m[2]);
          if (bond) bonds.add(Number(bond[1]));
          else if (atom) atoms.add(Number(atom[1]));
        }
        const json = (name: string) => JSON.parse(card.getAttribute(name) ?? 'null') as unknown;
        return {
          number: Number(card.getAttribute('data-number')),
          drawing: card.getAttribute('data-drawing') === 'true',
          mark: card.querySelector('.forms-drawing')?.textContent ?? null,
          changedAtoms: json('data-changed-atoms'),
          changedBonds: json('data-changed-bonds'),
          highlighted: { atoms: [...atoms].sort((a, b) => a - b), bonds: [...bonds].sort((a, b) => a - b) },
          smiles: card.getAttribute('data-smiles'),
          hydrogens: json('data-hydrogens'),
          bonds: json('data-bonds'),
          charges: json('data-charges'),
          rank: card.getAttribute('data-rank'),
          add: card.querySelector('button')!.textContent,
        };
      }),
    HIGHLIGHT,
  );
}

function notesShown(page: Page, kind: Kind) {
  return page.getByTestId(`${kind}-note`).evaluateAll((ps) => ps.map((p) => p.getAttribute('data-note')));
}

test('every tautomer test drawing: RDKit’s tautomers, the drawing’s first, what differs highlighted', async ({ app }) => {
  const { page } = app;
  await openEditor(app);
  const listed = COMPOUNDS.tautomers.filter((c) => c.outcome === 'listed');
  expect(listed.length).toBeGreaterThan(25);
  for (const c of listed) {
    await load(page, c);
    await show(page, 'tautomers');
    const ordered = [...c.tautomers!.filter((t) => t.drawing), ...c.tautomers!.filter((t) => !t.drawing)];
    expect(await cards(page, 'tautomers'), c.name).toEqual(
      ordered.map((t, i) => ({
        number: i + 1,
        drawing: t.drawing,
        mark: t.drawing ? 'Your drawing' : null,
        changedAtoms: t.changed_atoms,
        changedBonds: t.changed_bonds,
        highlighted: { atoms: t.changed_atoms, bonds: t.changed_bonds },
        smiles: t.smiles,
        hydrogens: t.hydrogens,
        bonds: null,
        charges: null,
        rank: null,
        add: 'Add',
      })),
    );
    const n = ordered.length;
    await expect(page.getByTestId('tautomers-summary')).toHaveText(n === 1 ? '1 tautomer: RDKit finds no other.' : `${n} tautomers.`);
    expect(await notesShown(page, 'tautomers'), c.name).toEqual(n === 1 ? [] : ['rules', ...(c.stereo_dropped ? ['stereo'] : [])]);
    await page.getByTestId('tautomers-close').click();
    await expect(page.getByTestId('tautomers-panel')).toHaveCount(0);
  }
});

test('every resonance test drawing: RDKit’s structures in its order, what differs highlighted', async ({ app }) => {
  const { page } = app;
  await openEditor(app);
  const listed = COMPOUNDS.resonance.filter((c) => c.outcome === 'listed');
  expect(listed.length).toBeGreaterThan(30);
  const key = (bonds: unknown, charges: unknown) => JSON.stringify([bonds, charges]);
  for (const c of listed) {
    await load(page, c);
    await show(page, 'resonance');
    const shown = await cards(page, 'resonance');
    // RDKit's order, except among structures it ranks equal on every measure.
    const rank = new Map(shown.map((s) => [key(s.bonds, s.charges), s.rank]));
    expect(c.structures!.map((s) => rank.get(key(s.bonds, s.charges))), c.name).toEqual(shown.map((s) => s.rank));
    const byKey = new Map(c.structures!.map((s) => [key(s.bonds, s.charges), s]));
    expect(shown, c.name).toEqual(
      shown.map((s, i) => {
        const e = byKey.get(key(s.bonds, s.charges))!;
        return {
          ...s,
          number: i + 1,
          drawing: e.drawing,
          mark: e.drawing ? 'Your drawing' : null,
          changedAtoms: e.changed_atoms,
          changedBonds: e.changed_bonds,
          highlighted: { atoms: e.changed_atoms, bonds: e.changed_bonds },
          add: 'Add',
        };
      }),
    );
    const n = shown.length;
    const drawn = c.structures!.some((s) => s.drawing);
    await expect(page.getByTestId('resonance-summary')).toHaveText(
      n === 1 ? '1 resonance structure: RDKit finds no other.' : `${n} resonance structures.`,
    );
    expect(await notesShown(page, 'resonance'), c.name).toEqual([...(n > 1 ? ['order'] : []), ...(drawn ? [] : ['notListed']), 'limits']);
    await page.getByTestId('resonance-close').click();
  }
});

test('the limits: too many tautomers, resonance structures counted, a system too large', async ({ app }) => {
  const { page } = app;
  await openEditor(app);
  await load(page, compound('tautomers', 'curcumin'));
  await show(page, 'tautomers');
  await expect(page.getByTestId('tautomers-message')).toHaveText('More than 32 tautomers: too many to list here.');
  const counted = compound('resonance', 'kekulene');
  await load(page, counted);
  await show(page, 'resonance');
  await expect(page.getByTestId('resonance-message')).toHaveText(`${counted.count} resonance structures: too many to draw here.`);
  const large = compound('resonance', 'buckminsterfullerene');
  await load(page, large);
  await show(page, 'resonance');
  await expect(page.getByTestId('resonance-message')).toHaveText(
    `A conjugated system of ${large.largest_group} bonds: too large for RDKit to list its resonance structures here (at most 60).`,
  );
  await load(page, compound('resonance', 'hexaglycine'));
  await show(page, 'resonance');
  await expect(page.getByTestId('resonance-card')).toHaveCount(32);
});

test('more than one structure: no buttons, and a note saying one at a time', async ({ app }) => {
  const { page } = app;
  await openEditor(app);
  await load(page, compound('tautomers', 'acetone'));
  await expect(page.getByTestId('tautomers-show')).toBeVisible();
  await expect(page.getByTestId('resonance-show')).toBeVisible();
  await page.evaluate((m) => window.ketcher!.addFragment(m), fixture(compound('resonance', 'benzene').file));
  await expect(page.getByTestId('forms-one-at-a-time')).toHaveText(
    'Tautomers and resonance structures are listed for one structure at a time.',
  );
  await expect(page.getByTestId('tautomers-show')).toHaveCount(0);
  await expect(page.getByTestId('resonance-show')).toHaveCount(0);
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

/** Each structure on the canvas, its atoms in Ketcher's id order (a placed one's are in its
 * Molfile's order): charge and H count by atom, and each bond's type. */
function placed(page: Page) {
  return page.evaluate(() => {
    const struct = window.ketcher!.editor.struct();
    const pieces = new Map<number, { atoms: number[]; charges: number[]; hydrogens: number[]; bonds: number[] }>();
    for (const [id, atom] of struct.atoms) {
      const piece = pieces.get(atom.fragment) ?? { atoms: [], charges: [], hydrogens: [], bonds: [] };
      piece.atoms.push(id);
      piece.charges.push(atom.charge ?? 0);
      piece.hydrogens.push(atom.implicitH ?? 0);
      pieces.set(atom.fragment, piece);
    }
    for (const bond of struct.bonds.values()) pieces.get(struct.atoms.get(bond.begin)!.fragment)!.bonds.push(bond.type);
    return [...pieces.values()];
  });
}

test('Add places a tautomer beside the drawing, as listed, and the panel stays open', async ({ app }) => {
  const { page } = app;
  await openEditor(app);
  const c = compound('tautomers', '2-butanone');
  await load(page, c);
  await show(page, 'tautomers');
  const others = c.tautomers!.filter((t) => !t.drawing);
  const card = page.locator('[data-testid="tautomers-card"][data-number="2"]');
  await page.getByRole('button', { name: 'Add: tautomer 2' }).click();
  await expect(card).toHaveAttribute('data-in-hand', 'true');
  await expect(card.getByTestId('tautomers-add')).toHaveText('In hand');
  await expect(page.getByTestId('tautomers-hint')).toHaveText('Tautomer 2 is in hand: click the canvas to place it, or press Esc.');
  await clickOnCanvas(page, 0.15);
  await expect(card).toHaveAttribute('data-in-hand', 'false');
  await expect(page.getByTestId('tautomers-hint')).toHaveCount(0);
  let pieces = await placed(page);
  expect(pieces.length).toBe(2);
  expect(pieces[1].hydrogens).toEqual(others[0].hydrogens);
  await expect(page.getByTestId('tautomers-panel')).toHaveAttribute('data-state', 'ready');
  // And another.
  const third = page.locator('[data-testid="tautomers-card"][data-number="3"]');
  await third.getByTestId('tautomers-add').click();
  await clickOnCanvas(page, 0.85);
  await expect(third).toHaveAttribute('data-in-hand', 'false');
  pieces = await placed(page);
  expect(pieces.length).toBe(3);
  expect(pieces[2].hydrogens).toEqual(others[1].hydrogens);
  await expect(page.getByTestId('tautomers-panel')).toHaveAttribute('data-state', 'ready');
});

test('Add places a resonance structure with its own bonds and charges', async ({ app }) => {
  const { page } = app;
  await openEditor(app);
  const c = compound('resonance', 'phenolate');
  await load(page, c);
  await show(page, 'resonance');
  const shown = await cards(page, 'resonance');
  const other = shown.find((s) => !s.drawing)!;
  await page.getByRole('button', { name: `Add: resonance structure ${other.number}` }).click();
  await clickOnCanvas(page, 0.15);
  await expect(page.locator(`[data-testid="resonance-card"][data-number="${other.number}"]`)).toHaveAttribute('data-in-hand', 'false');
  const pieces = await placed(page);
  expect(pieces.length).toBe(2);
  expect({ bonds: pieces[1].bonds, charges: pieces[1].charges }).toEqual({ bonds: other.bonds, charges: other.charges });
  await expect(page.getByTestId('resonance-panel')).toHaveAttribute('data-state', 'ready');
});

test('Esc puts the structure in hand away; any other change closes the panel', async ({ app }) => {
  const { page } = app;
  await openEditor(app);
  for (const kind of ['tautomers', 'resonance'] as const) {
    await load(page, compound(kind, kind === 'tautomers' ? 'acetone' : 'acetate'));
    await show(page, kind);
    const card = page.locator(`[data-testid="${kind}-card"][data-number="2"]`);
    await card.getByTestId(`${kind}-add`).click();
    await expect(card).toHaveAttribute('data-in-hand', 'true');
    await page.keyboard.press('Escape');
    await expect(card).toHaveAttribute('data-in-hand', 'false');
    await expect(page.getByTestId(`${kind}-panel`)).toHaveAttribute('data-state', 'ready');
    expect((await placed(page)).length).toBe(1);
    // The student's own change (not the panel's): the list was about the drawing before it.
    await page.evaluate((m) => window.ketcher!.addFragment(m), fixture(compound('resonance', 'benzene').file));
    await expect(page.getByTestId(`${kind}-panel`)).toHaveCount(0);
  }
});

test('an answer for an older drawing is never shown, and the properties keep up meanwhile', async ({ app }) => {
  const { context, page } = app;
  await context.addInitScript(holdableRdkitReplies);
  await openEditor(app);
  const hold = (f: '__holdRdkit' | '__releaseRdkit') =>
    page.evaluate((name) => (window as unknown as Record<string, (n: string) => void>)[name]('rdkit-nmr'), f);
  const held = () => page.evaluate(() => (window as unknown as { __heldRdkit(name: string): number }).__heldRdkit('rdkit-nmr'));
  for (const kind of ['tautomers', 'resonance'] as const) {
    const [first, second] = kind === 'tautomers' ? ['acetone', 'phenol'] : ['acetate', 'phenolate'];
    await load(page, compound(kind, first));
    await hold('__holdRdkit');
    await page.getByTestId(`${kind}-show`).click();
    await expect(page.getByTestId(`${kind}-panel`)).toHaveAttribute('data-state', 'working');
    // While the answer is held, a change still gets its properties (the other copy).
    await load(page, compound(kind, second));
    await expect(page.getByTestId(`${kind}-panel`)).toHaveCount(0);
    await expect.poll(held).toBe(1);
    await hold('__releaseRdkit');
    expect(await held()).toBe(0);
    await expect(page.getByTestId(`${kind}-panel`)).toHaveCount(0);
    await show(page, kind);
    const expected = compound(kind, second);
    const shown = await cards(page, kind);
    if (kind === 'tautomers') expect(shown.map((s) => s.smiles).sort()).toEqual(expected.tautomers!.map((t) => t.smiles).sort());
    else expect(shown.length).toBe(expected.structures!.length);
  }
});

test('guanine’s tautomers and resonance structures, and kekulene’s count, each take under 2 seconds', async ({ app }) => {
  const { page } = app;
  await openEditor(app);
  for (const [kind, name] of [
    ['tautomers', 'guanine'],
    ['resonance', 'kekulene'],
  ] as const) {
    await load(page, compound(kind, name));
    for (const time of ['first', 'again']) {
      const started = Date.now();
      await show(page, kind);
      expect(Date.now() - started, `${name} ${time}`).toBeLessThan(2000);
      await page.getByTestId(`${kind}-close`).click();
    }
  }
  // Guanine is drawn the tautomer test's way; its resonance structures from the same drawing.
  await load(page, compound('tautomers', 'guanine'));
  const started = Date.now();
  await show(page, 'resonance');
  expect(Date.now() - started).toBeLessThan(2000);
});

test('one panel below the canvas at a time: tautomers, resonance, stereoisomers, ¹³C NMR, Practice', async ({ app }) => {
  const { page } = app;
  await openEditor(app);
  await load(page, compound('tautomers', 'histidine')); // has a stereocentre, for the stereoisomer button
  const open = {
    tautomers: () => show(page, 'tautomers'),
    resonance: () => show(page, 'resonance'),
    stereo: async () => {
      await page.getByTestId('stereo-show').click();
      await expect(page.getByTestId('stereo-panel')).toHaveAttribute('data-state', 'ready');
    },
    nmr: async () => {
      await page.getByTestId('nmr-predict').click();
      await expect(page.getByTestId('nmr-panel')).toHaveAttribute('data-state', 'ready');
    },
  };
  const panels = { tautomers: 'tautomers-panel', resonance: 'resonance-panel', stereo: 'stereo-panel', nmr: 'nmr-panel' };
  for (const [name, opening] of Object.entries(open)) {
    await opening();
    for (const [other, id] of Object.entries(panels)) {
      if (other === name) await expect(page.getByTestId(id)).toBeVisible();
      else await expect(page.getByTestId(id), `${name} open, ${other} closed`).toHaveCount(0);
    }
  }
  await page.getByTestId('app-practice-button').click();
  await expect(page.getByTestId('practice-panel')).toBeVisible();
  for (const id of Object.values(panels)) await expect(page.getByTestId(id)).toHaveCount(0);
});

test('offline: after one visit both panels list with no network and no server', async ({ app }) => {
  const { context, page, server } = app;
  await openEditor(app);
  await waitForServiceWorker(app);
  if (server.local) await server.close();
  await context.setOffline(true);
  await page.reload();
  await waitForEditor(app);
  const tautomers = compound('tautomers', 'acetylacetone');
  await load(page, tautomers);
  await show(page, 'tautomers');
  expect((await cards(page, 'tautomers')).map((s) => s.smiles).sort()).toEqual(tautomers.tautomers!.map((t) => t.smiles).sort());
  const resonance = compound('resonance', 'nitrate');
  await load(page, resonance);
  await show(page, 'resonance');
  expect((await cards(page, 'resonance')).length).toBe(resonance.structures!.length);
});
