// Ketcher's template tool (the rings under the canvas) reaches 12 px from an atom or a bond's
// line (REACH_PX in src/editor/templateReach.ts; docs/plans/template-reach.md). Ketcher alone
// reached about 7 px at ACS size and 100% zoom. Other tools keep Ketcher's own reach.
import type { Page } from '@playwright/test';
import { expect, fixture, nextAutosave, openEditor, referenceCompound, test } from './fixtures.ts';

/** In reach of the app's 12 px, out of Ketcher's own 7 px; and out of both. */
const NEAR = 10;
const FAR = 16;

interface Point {
  x: number;
  y: number;
}

/** (R)-2-butanol (RDKit's Molfile), at ACS size and 100% zoom: one of its terminal atoms, its
 * bond, and directions on the page away from the rest of the molecule. */
async function butanol(page: Page) {
  const reference = referenceCompound('(R)-2-butanol');
  await page.evaluate((mol) => window.ketcher!.setMolecule(mol), fixture(reference.files.find((f) => f.endsWith('.mol'))!));
  const drawing = await page.evaluate(() => {
    const editor = window.ketcher!.editor as unknown as {
      render: { clientArea: HTMLElement; options: { zoom: number; microModeScale: number }; viewBox: { minX: number; minY: number } };
      struct(): { atoms: Map<number, { pp: Point }>; bonds: Map<number, { begin: number; end: number }> };
    };
    const { clientArea, options, viewBox } = editor.render;
    const area = clientArea.getBoundingClientRect();
    const onPage = ({ x, y }: Point) => ({
      x: area.left + (x * options.microModeScale - viewBox.minX) * options.zoom,
      y: area.top + (y * options.microModeScale - viewBox.minY) * options.zoom,
    });
    const struct = editor.struct();
    return {
      atoms: [...struct.atoms].map(([id, atom]) => ({ id, at: onPage(atom.pp) })),
      bonds: [...struct.bonds].map(([id, bond]) => ({ id, begin: bond.begin, end: bond.end })),
    };
  });
  const at = new Map(drawing.atoms.map((atom) => [atom.id, atom.at]));
  const degree = (id: number) => drawing.bonds.filter((bond) => bond.begin === id || bond.end === id).length;
  const bond = drawing.bonds.find((b) => degree(b.begin) === 1 || degree(b.end) === 1)!;
  const [tip, base] = degree(bond.end) === 1 ? [bond.end, bond.begin] : [bond.begin, bond.end];
  const [a, b] = [at.get(tip)!, at.get(base)!];
  const length = Math.hypot(a.x - b.x, a.y - b.y);
  const outward = { x: (a.x - b.x) / length, y: (a.y - b.y) / length };
  const middle = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  // Beside the bond, on the side away from the molecule's centre.
  const centre = drawing.atoms.reduce((sum, atom) => ({ x: sum.x + atom.at.x, y: sum.y + atom.at.y }), { x: 0, y: 0 });
  const sideways = { x: -outward.y, y: outward.x };
  const away = (centre.x / drawing.atoms.length - middle.x) * sideways.x + (centre.y / drawing.atoms.length - middle.y) * sideways.y > 0 ? -1 : 1;
  return {
    atom: tip,
    bond: bond.id,
    beyondAtom: (d: number) => ({ x: a.x + outward.x * d, y: a.y + outward.y * d }),
    besideBond: (d: number) => ({ x: middle.x + sideways.x * away * d, y: middle.y + sideways.y * away * d }),
  };
}

/** What the tool in use highlights under the mouse at `point` (Ketcher keeps it as the tool's ci). */
async function targetAt(page: Page, point: Point): Promise<string | null> {
  await page.mouse.move(point.x, point.y);
  return page.evaluate(() => {
    const tool = (window.ketcher!.editor as unknown as { tool(): { ci?: { map: string; id: number } } }).tool();
    return tool.ci ? `${tool.ci.map} ${tool.ci.id}` : null;
  });
}

/** The drawing's pieces: how many separate molecules, and how many atoms (not counting the
 * template's preview under the mouse). */
function pieces(page: Page) {
  return page.evaluate(() => {
    const struct = window.ketcher!.editor.struct();
    const next = new Map<number, number[]>();
    struct.atoms.forEach((atom, id) => {
      if (!atom.isPreview) next.set(id, []);
    });
    struct.bonds.forEach((bond) => {
      if (bond.isPreview) return;
      next.get(bond.begin)!.push(bond.end);
      next.get(bond.end)!.push(bond.begin);
    });
    const seen = new Set<number>();
    let molecules = 0;
    for (const start of next.keys()) {
      if (seen.has(start)) continue;
      molecules += 1;
      const stack = [start];
      while (stack.length) {
        const id = stack.pop()!;
        if (seen.has(id)) continue;
        seen.add(id);
        stack.push(...next.get(id)!);
      }
    }
    return { molecules, atoms: next.size };
  });
}

/** Ketcher's benzene, the first ring under the canvas. */
async function holdBenzene(page: Page): Promise<void> {
  await page.getByTestId('template-0').click();
}

test('the template tool highlights an atom or a bond 10 px away, and nothing 16 px away', async ({ app }) => {
  const { page } = app;
  await openEditor(app);
  const drawn = await butanol(page);
  await holdBenzene(page);
  expect(await targetAt(page, drawn.beyondAtom(NEAR))).toBe(`atoms ${drawn.atom}`);
  expect(await targetAt(page, drawn.besideBond(NEAR))).toBe(`bonds ${drawn.bond}`);
  expect(await targetAt(page, drawn.beyondAtom(FAR))).toBeNull();
  expect(await targetAt(page, drawn.besideBond(FAR))).toBeNull();
});

type Drawn = Awaited<ReturnType<typeof butanol>>;

for (const [where, away] of [
  ['an atom', (drawn: Drawn, d: number) => drawn.beyondAtom(d)],
  ['a bond', (drawn: Drawn, d: number) => drawn.besideBond(d)],
] as const) {
  test(`a click 10 px from ${where} joins the template to the molecule; 16 px away it stands alone`, async ({ app }) => {
    const { page } = app;
    await openEditor(app);
    const drawn = await butanol(page);
    const before = await pieces(page);
    await holdBenzene(page);
    let saved = await nextAutosave(page);
    const near = away(drawn, NEAR);
    await page.mouse.click(near.x, near.y);
    await saved();
    const joined = await pieces(page);
    expect(joined.molecules).toBe(1);
    expect(joined.atoms).toBeGreaterThan(before.atoms);

    saved = await nextAutosave(page);
    await page.evaluate(() => window.ketcher!.editor.undo());
    await saved();
    expect(await pieces(page)).toEqual(before);
    saved = await nextAutosave(page);
    const far = away(drawn, FAR);
    await page.mouse.click(far.x, far.y);
    await saved();
    expect((await pieces(page)).molecules).toBe(2);
  });
}

test("other tools keep Ketcher's own reach: the select tool highlights nothing 10 px from an atom", async ({ app }) => {
  const { page } = app;
  await openEditor(app);
  const drawn = await butanol(page);
  expect(await targetAt(page, drawn.beyondAtom(4))).toBe(`atoms ${drawn.atom}`);
  expect(await targetAt(page, drawn.beyondAtom(NEAR))).toBeNull();
});
