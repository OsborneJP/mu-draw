// Biochem tools (docs/plans/v2-biochem.md, bar B) in the built app with the real CSP: a typed
// sequence in the side panel, its Indigo values from the app's own worker (the same wasm as
// Ketcher's), and the net charge and pI from Bjellqvist's pKa values. What the panel shows must
// be what the generators recorded (tests/fixtures/biochem_*_expected.json).
import type { Page } from '@playwright/test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  isoelectricPoint,
  netCharge,
  parseSequence,
  problemMessage,
  RESIDUES,
  TM_MIN_BASES,
  type Parsed,
} from '../src/chem/biochem.ts';
import { shown } from '../src/chem/properties.ts';
import { NOTES } from '../src/panels/biochem.ts';
import {
  expect,
  fixture,
  goOffline,
  holdableBiochemReplies,
  holdableRdkitReplies,
  openEditor,
  referenceCompound,
  test,
} from './fixtures.ts';

interface IndigoExpected {
  concentrations: { sodium_mM: number; strand_uM: number }[];
  peptides: { name: string; sequence: string; formula: string; mass: number; hydrophobicity: number[] }[];
  nucleic: {
    name: string;
    sequence: string;
    dna: { formula: string; mass: number; tm: number[] | null };
    rna: { formula: string; mass: number };
  }[];
}
interface BiopythonExpected {
  peptides: { sequence: string; extinction: { reduced: number; cystines: number } }[];
}

const indigo = JSON.parse(fixture('biochem_indigo_expected.json')) as IndigoExpected;
const biopython = JSON.parse(fixture('biochem_peptides_expected.json')) as BiopythonExpected;
const extinction = (sequence: string) => biopython.peptides.find((p) => p.sequence === sequence)!.extinction;
const peptide = (name: string) => indigo.peptides.find((p) => p.name === name)!;

// By role and accessible name, so the labels are checked too (bar B.10). Not getByLabel: React
// copies a textarea's value into its text, which then becomes part of the label's text.
const ui = (page: Page) => ({
  section: page.getByTestId('biochem'),
  type: page.getByRole('combobox', { name: 'Sequence type', exact: true }),
  sequence: page.getByRole('textbox', { name: 'Sequence', exact: true }),
  pH: page.getByRole('spinbutton', { name: 'pH', exact: true }),
  sodium: page.getByRole('spinbutton', { name: '[Na⁺] (mM)', exact: true }),
  strand: page.getByRole('spinbutton', { name: 'Strands (µM)', exact: true }),
  values: page.getByTestId('biochem-values'),
});

const hold = (page: Page) => page.evaluate(() => (window as unknown as { __holdBiochem(): void }).__holdBiochem());
const release = (page: Page) => page.evaluate(() => (window as unknown as { __releaseBiochem(): void }).__releaseBiochem());
const held = (page: Page) => page.evaluate(() => (window as unknown as { __heldBiochem(): number }).__heldBiochem());
const workers = (page: Page) => page.evaluate(() => (window as unknown as { __biochemWorkers(): number }).__biochemWorkers());
const requests = (page: Page) => page.evaluate(() => (window as unknown as { __biochemRequests(): number }).__biochemRequests());

/** Draw a reference compound (tests/fixtures/molfiles). */
async function draw(page: Page, name: string): Promise<void> {
  const molfile = fixture(referenceCompound(name).files.find((f) => f.endsWith('.mol'))!);
  await page.evaluate((mol) => window.ketcher!.setMolecule(mol), molfile);
}

const formulaOf = (name: string) => (referenceCompound(name) as ReturnType<typeof referenceCompound> & { formula: string }).formula;

async function openSection(page: Page): Promise<void> {
  await page.getByTestId('biochem').locator('summary').click();
  await expect(page.getByTestId('biochem')).toHaveAttribute('open', '');
}

const formula = (indigoFormula: string) => indigoFormula.replaceAll(' ', '');

/** Type a sequence and wait for Indigo's values for it (the formula is unique to each). */
async function show(page: Page, sequence: string, expectedFormula: string): Promise<void> {
  const { sequence: box, values } = ui(page);
  await box.fill(sequence);
  await expect(page.getByTestId('biochem-formula')).toHaveAttribute('data-formula', formula(expectedFormula));
  await expect(values).toHaveAttribute('data-state', 'ready');
}

async function expectPeptide(page: Page, expected: IndigoExpected['peptides'][number], pH = 7): Promise<void> {
  const { sequence } = expected;
  await expect(page.getByTestId('biochem-length')).toHaveText(String(sequence.length));
  await expect(page.getByTestId('biochem-charge')).toHaveText(shown(netCharge(sequence, pH), 2));
  await expect(page.getByTestId('biochem-pi')).toHaveText(shown(isoelectricPoint(sequence), 2));
  await expect(page.getByTestId('biochem-mass')).toHaveText(shown(expected.mass, 2));
  const { reduced, cystines } = extinction(sequence);
  await expect(page.getByTestId('biochem-ext-reduced')).toHaveText(String(reduced));
  await expect(page.getByTestId('biochem-ext-cystines')).toHaveText(String(cystines));
  await expect(page.getByTestId('biochem-no-absorbance')).toHaveCount(reduced === 0 && cystines === 0 ? 1 : 0);
  const bars = page.getByTestId('biochem-hydrophobicity').locator('rect');
  expect(await bars.evaluateAll((rects) => rects.map((r) => Number(r.getAttribute('data-value'))))).toEqual(expected.hydrophobicity);
  const titles = expected.hydrophobicity.map((value, i) => `${RESIDUES[sequence[i]]} ${i + 1}: ${value}`);
  expect(await bars.locator('title').evaluateAll((all) => all.map((t) => t.textContent))).toEqual(titles);
}

test('the section sits closed at the foot of the side panel; its worker starts when it opens; drawing leaves it alone', async ({
  app,
}) => {
  const { page, context } = app;
  await context.addInitScript(holdableBiochemReplies);
  await openEditor(app);
  const { section, values } = ui(page);
  await expect(section).not.toHaveAttribute('open');
  await expect(values).toHaveAttribute('role', 'status');
  expect(await page.getByTestId('properties-panel').evaluate((p) => p.lastElementChild?.getAttribute('data-testid'))).toBe('biochem');
  expect(await workers(page)).toBe(0);
  await openSection(page);
  // The toggle event that starts it comes in a task after the open attribute is set.
  await expect.poll(() => workers(page)).toBe(1);
  const all = peptide('all twenty');
  await show(page, all.sequence, all.formula);
  const before = await values.innerHTML();
  // A drawing, then a change to it: the section keeps its values.
  for (const name of ['ethanol', 'toluene']) {
    await draw(page, name);
    await expect(page.getByTestId('prop-formula')).toHaveAttribute('data-formula', formulaOf(name));
  }
  expect(await values.innerHTML()).toBe(before);
  await expect(section).toHaveAttribute('open', '');
  expect(await page.getByTestId('properties-panel').evaluate((p) => p.lastElementChild?.getAttribute('data-testid'))).toBe('biochem');
  expect(await requests(page)).toBe(1);
});

test("while the drawing's values are worked out the panel greys them, never the section's", async ({ app }) => {
  const { page, context } = app;
  await context.addInitScript(holdableRdkitReplies);
  await openEditor(app);
  await openSection(page);
  const all = peptide('all twenty');
  await show(page, all.sequence, all.formula);
  await draw(page, 'ethanol');
  await expect(page.getByTestId('prop-formula')).toHaveAttribute('data-formula', formulaOf('ethanol'));
  await page.evaluate(() => (window as unknown as { __holdRdkit(name: string): void }).__holdRdkit('rdkit'));
  await draw(page, 'toluene');
  await expect(page.getByTestId('properties-panel')).toHaveAttribute('data-state', 'updating');
  const opacity = (element: Element) => getComputedStyle(element).opacity;
  expect(await page.getByTestId('prop-formula').locator('..').evaluate(opacity)).toBe('0.6');
  const lists = await page.getByTestId('biochem').locator('dl').evaluateAll((all) => all.map((e) => getComputedStyle(e).opacity));
  expect(lists.length).toBeGreaterThan(0);
  expect(lists.every((o) => o === '1')).toBe(true);
  await page.evaluate(() => (window as unknown as { __releaseRdkit(name: string): void }).__releaseRdkit('rdkit'));
  await expect(page.getByTestId('prop-formula')).toHaveAttribute('data-formula', formulaOf('toluene'));
});

test("every test peptide shows the generators' values", async ({ app }) => {
  const { page } = app;
  await openEditor(app);
  await openSection(page);
  // The 40 dipeptides (each residue first and last) are checked in Vitest (indigoBiochem.test.ts).
  for (const expected of indigo.peptides.filter((p) => !/ (first|last)$/.test(p.name))) {
    await show(page, expected.sequence, expected.formula);
    await expectPeptide(page, expected);
  }
  // The notes name each method's source (bar B.2).
  const values = page.getByTestId('biochem-values');
  for (const source of [/Bjellqvist/, /Pace et al\. 1995/, /Black and Mould \(1991\)/]) await expect(values).toContainText(source);
});

test('three-letter codes give the same values as one-letter', async ({ app }) => {
  const { page } = app;
  await openEditor(app);
  await openSection(page);
  const { type } = ui(page);
  await type.selectOption('peptide3');
  const all = peptide('all twenty');
  await show(page, [...all.sequence].map((r) => RESIDUES[r]).join('-'), all.formula);
  await expectPeptide(page, all);
});

test('DNA: the Tm the generator recorded, at the defaults and after changing both boxes; short DNA and RNA say why there is none', async ({
  app,
}) => {
  test.slow(); // ten DNA and ten RNA strands, up to 1000 bases, and seven duplexes twice
  const { page } = app;
  await openEditor(app);
  await openSection(page);
  const { type, sodium, strand } = ui(page);
  const [defaults, other] = indigo.concentrations;
  for (const expected of indigo.nucleic) {
    await type.selectOption('dna');
    await show(page, expected.sequence, expected.dna.formula);
    await expect(page.getByTestId('biochem-length')).toHaveText(String(expected.sequence.length));
    await expect(page.getByTestId('biochem-mass')).toHaveText(shown(expected.dna.mass, 2));
    if (expected.dna.tm) {
      await expect(sodium).toHaveValue(String(defaults.sodium_mM));
      await expect(strand).toHaveValue(String(defaults.strand_uM));
      await expect(page.getByTestId('biochem-tm')).toHaveText(shown(expected.dna.tm[0], 1));
      await sodium.fill(String(other.sodium_mM));
      await strand.fill(String(other.strand_uM));
      await expect(page.getByTestId('biochem-tm')).toHaveText(shown(expected.dna.tm[1], 1));
      await sodium.fill(String(defaults.sodium_mM));
      await strand.fill(String(defaults.strand_uM));
      await expect(page.getByTestId('biochem-tm')).toHaveText(shown(expected.dna.tm[0], 1));
      await expect(page.getByTestId('biochem-tm-note')).toHaveCount(0);
      await expect(page.getByTestId('biochem-values')).toContainText(/Khandelwal and Bhyravabhotla \(2010\)/);
    } else {
      const note = expected.sequence.length < TM_MIN_BASES ? NOTES.short : NOTES.long;
      await expect(page.getByTestId('biochem-tm-note')).toHaveText(note);
      await expect(page.getByTestId('biochem-tm')).toHaveCount(0);
    }
    await type.selectOption('rna');
    await show(page, expected.sequence.replaceAll('T', 'U'), expected.rna.formula);
    await expect(page.getByTestId('biochem-mass')).toHaveText(shown(expected.rna.mass, 2));
    await expect(page.getByTestId('biochem-tm-note')).toHaveText(NOTES.rna);
    await expect(page.getByTestId('biochem-tm')).toHaveCount(0);
    await expect(sodium).toHaveCount(0);
  }
});

test('the pH changes the net charge at once, with Indigo held', async ({ app }) => {
  const { page, context } = app;
  await context.addInitScript(holdableBiochemReplies);
  await openEditor(app);
  await openSection(page);
  const all = peptide('all twenty');
  await show(page, all.sequence, all.formula);
  await hold(page);
  for (const pH of [3, 7.4, 11]) {
    await ui(page).pH.fill(String(pH));
    await expect(page.getByTestId('biochem-charge')).toHaveText(shown(netCharge(all.sequence, pH), 2));
  }
  await expect(ui(page).values).toHaveAttribute('data-state', 'ready');
  expect(await requests(page)).toBe(1);
  await ui(page).pH.fill('15');
  await expect(page.getByTestId('biochem-charge')).toHaveText('pH 0 to 14');
});

test('an answer for an older sequence is never shown, and edits made meanwhile send one request', async ({ app }) => {
  const { page, context } = app;
  await context.addInitScript(holdableBiochemReplies);
  await openEditor(app);
  await openSection(page);
  // Every (state, formula) the section shows from here on.
  await page.evaluate(() => {
    const now = () => {
      const values = document.querySelector('[data-testid="biochem-values"]');
      const formula = document.querySelector('[data-testid="biochem-formula"]')?.getAttribute('data-formula') ?? '';
      return `${values?.getAttribute('data-state')} ${formula}`.trim();
    };
    const seen: string[] = [now()];
    Object.assign(window, { __biochemSeen: seen });
    new MutationObserver(() => {
      if (seen[seen.length - 1] !== now()) seen.push(now());
    }).observe(document.body, { subtree: true, childList: true, attributes: true });
  });
  await hold(page);
  const [first, ...later] = ['G', 'GK', 'GKG', 'GKGW'];
  await ui(page).sequence.fill(first);
  await expect.poll(() => held(page)).toBe(1);
  for (const text of later) await ui(page).sequence.fill(text);
  await expect(ui(page).values).toHaveAttribute('data-state', 'working');
  expect(await requests(page)).toBe(1);
  // Releasing hands over G's answer, which is dropped; GKGW is asked for and answered.
  await release(page);
  await expect(ui(page).values).toHaveAttribute('data-state', 'ready');
  await expect(page.getByTestId('biochem-length')).toHaveText('4');
  expect(await requests(page)).toBe(2);
  const finalFormula = await page.getByTestId('biochem-formula').getAttribute('data-formula');
  const seen = await page.evaluate(() => (window as unknown as { __biochemSeen: string[] }).__biochemSeen);
  expect(seen.filter((s) => s.startsWith('ready'))).toEqual([`ready ${finalFormula}`]);
});

test('an unreadable sequence says why and sends nothing', async ({ app }) => {
  const { page, context } = app;
  await context.addInitScript(holdableBiochemReplies);
  await openEditor(app);
  await openSection(page);
  for (const [type, text] of [
    ['peptide', 'GXG'],
    ['peptide3', 'Ala-Xaa'],
    ['dna', 'ACGU'],
    ['rna', 'ACGT'],
  ] as const) {
    // Emptied first: the last text may be valid as the next type (ACGU is RNA).
    await ui(page).sequence.fill('');
    await ui(page).type.selectOption(type);
    await ui(page).sequence.fill(text);
    const message = problemMessage(type, parseSequence(type, text) as Extract<Parsed, { ok: false }>);
    await expect(page.getByTestId('biochem-problem')).toHaveText(message);
    await expect(ui(page).values).toHaveAttribute('data-state', 'invalid');
  }
  expect(await requests(page)).toBe(0);
});

test('offline: after one visit the values come with no network and no server', async ({ app }) => {
  const { page, context, server } = app;
  await goOffline(app);
  const notFromCache: string[] = [];
  const origin = new URL(server.url).origin;
  context.on('response', (r) => {
    if (new URL(r.url()).origin === origin && !r.fromServiceWorker()) notFromCache.push(r.url());
  });
  context.on('requestfailed', (r) => notFromCache.push(`failed ${r.url()}`));
  const workerScript = context.waitForEvent('response', (r) => /biochemWorker/.test(r.url()));
  await openSection(page);
  expect((await workerScript).fromServiceWorker(), 'the worker from the cache').toBe(true);
  const all = peptide('all twenty');
  await show(page, all.sequence, all.formula);
  await expectPeptide(page, all);
  const dna = indigo.nucleic.find((n) => n.dna.tm)!;
  await ui(page).type.selectOption('dna');
  await show(page, dna.sequence, dna.dna.formula);
  await expect(page.getByTestId('biochem-tm')).toHaveText(shown(dna.dna.tm![0], 1));
  expect(notFromCache).toEqual([]);
});

/** Start a clock in the page; the function returned resolves with the milliseconds from now
 * until the section shows the values with this formula. */
async function startClock(page: Page, indigoFormula: string): Promise<() => Promise<number>> {
  await page.evaluate((wanted) => {
    const start = performance.now();
    const done = new Promise<number>((resolve) => {
      const observer = new MutationObserver(() => {
        const values = document.querySelector('[data-testid="biochem-values"]');
        const shownFormula = document.querySelector('[data-testid="biochem-formula"]')?.getAttribute('data-formula');
        if (values?.getAttribute('data-state') === 'ready' && shownFormula === wanted) {
          observer.disconnect();
          resolve(performance.now() - start);
        }
      });
      observer.observe(document.body, { subtree: true, childList: true, attributes: true });
    });
    Object.assign(window, { __clock: done });
  }, formula(indigoFormula));
  return () => page.evaluate(() => (window as unknown as { __clock: Promise<number> }).__clock);
}

test('the first values come within 5 s of opening, and 1000 residues within 2 s', async ({ app }) => {
  const { page } = app;
  await openEditor(app);
  const short = peptide('YGGFL');
  const first = await startClock(page, short.formula);
  await openSection(page);
  await ui(page).sequence.fill(short.sequence);
  const firstTime = await first();
  const long = peptide('1000 residues (the limit)');
  const thousand = await startClock(page, long.formula);
  await ui(page).sequence.fill(long.sequence);
  const thousandTime = await thousand();
  console.log(`biochem timing: first values ${firstTime.toFixed(0)} ms, 1000 residues ${thousandTime.toFixed(0)} ms`);
  expect(firstTime).toBeLessThan(5000);
  expect(thousandTime).toBeLessThan(2000);
});

test('the build ships one Indigo wasm and one copy of the monomer library', async () => {
  test.skip(Boolean(process.env.SMOKE_URL), 'reads the local build');
  const dist = join(fileURLToPath(new URL('..', import.meta.url)), process.env.DIST_DIR ?? 'dist', 'assets');
  const files = readdirSync(dist);
  expect(files.filter((f) => /^indigo-ketcher.*\.wasm$/.test(f))).toHaveLength(1);
  const scripts = files.filter((f) => f.endsWith('.js'));
  const withLibrary = scripts.filter((f) => readFileSync(join(dist, f), 'utf8').includes('A___Alanine'));
  expect(withLibrary).toHaveLength(1);
  expect(scripts.filter((f) => f.startsWith('biochemWorker'))).toHaveLength(1);
  // indigo-ketcher's default entry carries the wasm inside the script, as base64: a second
  // Indigo that no .wasm count would see. "AGFzbQ" is the base64 of a wasm file's first bytes.
  expect(scripts.filter((f) => readFileSync(join(dist, f), 'utf8').includes('AGFzbQ'))).toEqual([]);
});
