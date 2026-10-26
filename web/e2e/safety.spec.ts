// Safety (docs/plans/v2-safety-snapshot.md, bar B). The API's answers are held until the test
// releases them, so every ordering is forced, and they are what the server answered for
// recorded PubChem replies (tests/fixtures/safety_responses.json, server/scripts/record_ghs.py),
// so no test here reaches PubChem and no hazard is typed here.
import type { Page, Request, Route } from '@playwright/test';
import { GHS_PICTOGRAMS, pictogramFile } from '../src/panels/ghsPictograms.ts';
import {
  credit,
  NOT_CLASSIFIED,
  noneListed,
  othersLine,
  REMINDER,
  SAFETY_MESSAGES,
  safetyOutcome,
} from '../src/panels/safetyAnswer.ts';
import { clearCanvas, expect, fixture, openEditor, test, waitForEditor, waitForServiceWorker, type App } from './fixtures.ts';

interface Compound {
  name: string;
  smiles: string;
  files: string[];
}

interface Answer {
  found: boolean;
  cid: number | null;
  classification: { source: string } | null;
}

const RESPONSES = (JSON.parse(fixture('safety_responses.json')) as { responses: Record<string, Answer> }).responses;
const OFFLINE = 'Needs an internet connection';
const EMPTY = 'Draw a structure to look up its hazards';

function compounds(): Compound[] {
  const data = JSON.parse(fixture('reference_expected.json')) as {
    compounds: (Omit<Compound, 'name'> & { typed_name: string })[];
    invented: Compound[];
  };
  return [...data.compounds.map((c) => ({ ...c, name: c.typed_name })), ...data.invented];
}

function compound(name: string): Compound {
  const found = compounds().find((c) => c.name === name);
  if (!found) throw new Error(`${name} is not a test compound`);
  return found;
}

async function load(page: Page, name: string): Promise<void> {
  const molfile = fixture(compound(name).files.find((f) => f.endsWith('.mol'))!);
  await page.evaluate((mol) => window.ketcher!.setMolecule(mol), molfile);
}

/** Wait for `step`, but fail at once if a guard trips first. */
function guarded<T>(app: App, step: Promise<T>): Promise<T> {
  return Promise.race([step, app.failed]);
}

/** The guards' reports of problems this test causes on purpose, then forget them. */
async function expectProblems(app: App, expected: string[]): Promise<void> {
  await expect.poll(() => app.problems).toEqual(expected);
  app.problems.length = 0;
}

interface Held {
  smiles: string;
  request: Request;
  route: Route;
  answer(body: unknown, status?: number): Promise<void>;
}

/** Hold every Safety request until the test answers it; next() gives them in order. */
async function holdSafety(page: Page) {
  const ready: Held[] = [];
  const waiting: ((held: Held) => void)[] = [];
  let count = 0;
  await page.route('**/api/safety', (route) => {
    count += 1;
    const held: Held = {
      smiles: (JSON.parse(route.request().postData()!) as { smiles: string }).smiles,
      request: route.request(),
      route,
      answer: (body, status = 200) => route.fulfill({ status, json: body }),
    };
    const waiter = waiting.shift();
    if (waiter) waiter(held);
    else ready.push(held);
  });
  return {
    next: () => (ready.length ? Promise.resolve(ready.shift()!) : new Promise<Held>((r) => waiting.push(r))),
    count: () => count,
  };
}

function ui(page: Page) {
  const panel = page.getByTestId('safety-panel');
  return {
    button: page.getByTestId('app-safety-button'),
    panel,
    message: page.getByTestId('safety-message'),
  };
}

async function ask(app: App, safety: Awaited<ReturnType<typeof holdSafety>>, name: string): Promise<Held> {
  const { button, panel } = ui(app.page);
  await load(app.page, name);
  await expect(panel).toHaveCount(0); // a change closes any earlier answer
  await expect(button).toBeEnabled();
  await button.click();
  return guarded(app, safety.next());
}

/** The panel shows exactly the server's answer (bar B.3, B.4, B.9). */
async function expectShown(app: App, answer: Answer): Promise<void> {
  const { page } = app;
  const { panel, message } = ui(page);
  const outcome = safetyOutcome(200, answer);
  await guarded(app, expect(panel).toHaveAttribute('data-state', outcome.kind));
  await expect(page.getByTestId('safety-reminder')).toHaveText(REMINDER);
  if (outcome.kind !== 'found') {
    expect(outcome.kind).toBe('not-found');
    await expect(message).toHaveText(SAFETY_MESSAGES['not-found']);
    await expect(panel.locator('a')).toHaveCount(0);
    return;
  }
  await expect(page.getByTestId('safety-compound')).toHaveText(`${outcome.title ?? 'Untitled'}, PubChem CID ${outcome.cid}`);
  // The one link: the compound's PubChem page, as Get name gives it; credits are plain text.
  const link = panel.locator('a');
  await expect(link).toHaveCount(1);
  await expect(link).toHaveAttribute('href', outcome.url);
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  const others = page.getByTestId('safety-others');
  if (outcome.others.count === 0) await expect(others).toHaveCount(0);
  else await expect(others).toHaveText(othersLine(outcome.others.count, outcome.others.sources));
  const c = outcome.classification;
  if (c === null) {
    await expect(page.getByTestId('safety-none')).toHaveText(noneListed(outcome.cid));
    await expect(page.getByTestId('safety-credit')).toHaveCount(0);
    return;
  }
  await expect(page.getByTestId('safety-credit')).toHaveText(credit(c, outcome.cid));
  await expect(page.getByTestId('safety-note')).toHaveText(c.notes);
  const summary = page.getByTestId('safety-summary');
  if (c.summary.length === 0) await expect(summary).toHaveCount(0);
  else await expect(summary.locator('p')).toHaveText(c.summary);
  const signal = page.getByTestId('safety-signal');
  if (c.signal === null) await expect(signal).toHaveCount(0);
  else await expect(signal).toHaveText(c.signal);
  await expect(page.getByTestId('safety-not-classified')).toHaveCount(c.notClassified ? 1 : 0);
  if (c.notClassified) await expect(page.getByTestId('safety-not-classified')).toHaveText(NOT_CLASSIFIED);
  const pictograms = page.getByTestId('safety-pictogram');
  await expect(pictograms).toHaveCount(c.pictograms.length);
  for (const [i, p] of c.pictograms.entries()) {
    const item = pictograms.nth(i);
    await expect(item).toHaveAttribute('data-code', p.code);
    await expect(item).toHaveText(p.name);
    const img = item.locator('img');
    await expect(img).toHaveAttribute('alt', p.name);
    await expect(img).toHaveAttribute('src', new RegExp(`/${pictogramFile(p.code)}$`));
    // The image itself loaded (decode() rejects on a broken image).
    expect(await img.evaluate(async (e: HTMLImageElement) => (await e.decode(), e.naturalWidth > 0))).toBe(true);
  }
  const statements = page.getByTestId('safety-statement');
  await expect(statements).toHaveCount(c.statements.length);
  for (const [i, s] of c.statements.entries()) {
    const item = statements.nth(i);
    await expect(item).toHaveAttribute('data-code', s.code);
    await expect(item).toHaveAttribute('data-annex-note', s.annexNote ?? '');
    await expect(item).toHaveAttribute('data-share', s.share ?? '');
    const note = s.annexNote ? ` ${s.annexNote}` : '';
    const share = s.share ? ` (${s.share})` : '';
    await expect(item).toHaveText(`${s.code}${note} ${s.words}${share}${s.hazardClass ?? ''}`);
  }
}

test('Safety: every test compound shows what the server answered for it', async ({ app }) => {
  await openEditor(app);
  const safety = await holdSafety(app.page);
  const names = Object.keys(RESPONSES);
  // Every outcome is among them: EU, ECHA, not classified, none listed, no record.
  const kinds = new Set(names.map((n) => RESPONSES[n].classification?.source ?? String(RESPONSES[n].found)));
  expect([...kinds].sort()).toEqual(['echa', 'eu', 'false', 'true']);
  for (const name of names) {
    const held = await ask(app, safety, name);
    expect(held.smiles.length, name).toBeGreaterThan(0);
    await held.answer(RESPONSES[name]);
    await expectShown(app, RESPONSES[name]);
  }
  expect(safety.count()).toBe(names.length);
});

test('Safety: nothing shows until the answer comes, and only for the drawing it was asked about', async ({ app }) => {
  const { page } = app;
  const { button, panel, message } = ui(page);
  await openEditor(app);
  const safety = await holdSafety(page);
  const first = await ask(app, safety, 'ethanol');
  await expect(panel).toHaveAttribute('data-state', 'asking');
  await expect(message).toHaveText(SAFETY_MESSAGES.asking);
  await expect(button).toBeDisabled();
  await expect(button).toHaveText('Looking up…');
  await first.answer(RESPONSES.ethanol);
  await expectShown(app, RESPONSES.ethanol);
  await expect(button).toBeEnabled();

  // A change while the answer is on its way aborts the request; its answer can never show.
  await load(page, 'caffeine');
  await expect(panel).toHaveCount(0);
  await button.click();
  const second = await guarded(app, safety.next());
  const aborted = page.waitForEvent('requestfailed', (r) => r === second.request);
  await load(page, 'aspirin');
  await guarded(app, aborted);
  await expect(panel).toHaveCount(0);
  await second.answer(RESPONSES.caffeine).catch(() => {}); // already aborted
  await expect(panel).toHaveCount(0);
  await expect(button).toBeEnabled();

  // Closing it does the same.
  await button.click();
  const third = await guarded(app, safety.next());
  await page.getByTestId('safety-close').click();
  await expect(panel).toHaveCount(0);
  await third.answer(RESPONSES.aspirin).catch(() => {});
  await expect(panel).toHaveCount(0);
  expect(safety.count()).toBe(3);
});

test('Safety: no answer within 8 s means "not responding", and a late answer is dropped', async ({ app }) => {
  const { page } = app;
  const { button, panel, message } = ui(page);
  await openEditor(app);
  const safety = await holdSafety(page);
  await load(page, 'ethanol');
  await expect(button).toBeEnabled();
  const start = Date.now();
  await page.clock.install({ time: start });
  await page.clock.pauseAt(start + 1000);
  await button.click();
  const held = await guarded(app, safety.next());
  await page.clock.runFor(7999);
  await expect(panel).toHaveAttribute('data-state', 'asking');
  const aborted = page.waitForEvent('requestfailed', (r) => r === held.request);
  await page.clock.runFor(1);
  await guarded(app, expect(message).toHaveText(SAFETY_MESSAGES['not-responding']));
  await guarded(app, aborted);
  await held.answer(RESPONSES.ethanol).catch(() => {});
  await expect(panel).toHaveAttribute('data-state', 'not-responding');
});

test('Safety: a failed request means "not responding"', async ({ app }) => {
  await openEditor(app);
  const safety = await holdSafety(app.page);
  const failed = await ask(app, safety, 'ethanol');
  await failed.route.abort('connectionrefused');
  await guarded(app, expect(ui(app.page).message).toHaveText(SAFETY_MESSAGES['not-responding']));
});

test('Safety: an answer with part of a classification missing means "not responding"', async ({ app }) => {
  await openEditor(app);
  const safety = await holdSafety(app.page);
  const partial = await ask(app, safety, 'aspirin');
  const broken = structuredClone(RESPONSES.aspirin) as Answer & { classification: { statements: unknown[] } };
  expect(broken.classification.statements.length).toBeGreaterThan(0);
  broken.classification.statements = [];
  await partial.answer(broken);
  await guarded(app, expect(ui(app.page).message).toHaveText(SAFETY_MESSAGES['not-responding']));
  await expect(app.page.getByTestId('safety-statement')).toHaveCount(0);
});

// Each error status is a test of its own: the guards report it, and once they have, every
// later guarded() wait fails (expectProblems comes last).
for (const [status, body, shown] of [
  [502, { error: 'unavailable' }, SAFETY_MESSAGES['not-responding']],
  [503, { error: 'busy' }, SAFETY_MESSAGES.busy],
  [400, { error: 'invalid_structure' }, SAFETY_MESSAGES.invalid],
] as const) {
  test(`Safety: HTTP ${status} ${body.error} is explained`, async ({ app }) => {
    await openEditor(app);
    const safety = await holdSafety(app.page);
    const held = await ask(app, safety, 'ethanol');
    await held.answer(body, status);
    await expect(ui(app.page).message).toHaveText(shown);
    await expectProblems(app, [`HTTP ${status}: ${held.request.url()}`]);
  });
}

test('Safety: a reaction is not sent; an empty canvas and offline grey the button', async ({ app }) => {
  const { page, context } = app;
  const { button, message } = ui(page);
  await openEditor(app);
  const safety = await holdSafety(page);
  const reaction = `${compound('ethanol').smiles}>>${compound('acetone').smiles}`;
  await page.evaluate((r) => window.ketcher!.setMolecule(r), reaction);
  await button.click();
  await guarded(app, expect(message).toHaveText(SAFETY_MESSAGES.reaction));

  await clearCanvas(page);
  await expect(button).toBeDisabled();
  await expect(button).toHaveAttribute('title', EMPTY);
  await load(page, 'ethanol');
  await expect(button).toBeEnabled();
  await context.setOffline(true);
  await expect(button).toBeDisabled();
  await expect(button).toHaveAttribute('title', OFFLINE);
  await context.setOffline(false);
  await expect(button).toBeEnabled();
  expect(safety.count()).toBe(0);
});

test('Safety: one panel below the canvas at a time, with the ¹³C NMR preview', async ({ app }) => {
  const { page } = app;
  const { button, panel } = ui(page);
  await openEditor(app);
  const safety = await holdSafety(page);
  await load(page, 'ethanol');
  await page.getByTestId('nmr-predict').click();
  await expect(page.getByTestId('nmr-panel')).toHaveAttribute('data-state', 'ready');
  await button.click();
  await expect(page.getByTestId('nmr-panel')).toHaveCount(0);
  const held = await guarded(app, safety.next());
  await held.answer(RESPONSES.ethanol);
  await expectShown(app, RESPONSES.ethanol);
  await page.getByTestId('nmr-predict').click();
  await expect(page.getByTestId('nmr-panel')).toHaveAttribute('data-state', 'ready');
  await expect(panel).toHaveCount(0);
});

test('Safety: all nine pictograms are the app\'s own images', async ({ app }) => {
  await openEditor(app);
  const loaded = await app.page.evaluate(async (files) => {
    const base = document.baseURI;
    return Promise.all(
      files.map(async (file) => {
        const response = await fetch(new URL(file, base));
        const img = new Image();
        img.src = new URL(file, base).href;
        await img.decode();
        return [response.status, response.headers.get('content-type'), img.naturalWidth > 0];
      }),
    );
  }, GHS_PICTOGRAMS.map(pictogramFile));
  expect(loaded).toEqual(GHS_PICTOGRAMS.map(() => [200, 'image/svg+xml', true]));
});

test('offline: Safety says it needs a connection and sends nothing', async ({ app }) => {
  const { context, page, server } = app;
  await openEditor(app);
  await waitForServiceWorker(app);
  if (server.local) await server.close();
  await context.setOffline(true);
  await page.reload();
  await waitForEditor(app);
  await load(page, 'ethanol');
  const { button, panel } = ui(page);
  await expect(button).toBeDisabled();
  await expect(button).toHaveAttribute('title', OFFLINE);
  await expect(panel).toHaveCount(0);
  expect(app.requests.filter((r) => r.url().includes('/api/safety'))).toEqual([]);
});
