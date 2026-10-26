import type { Ketcher } from 'ketcher-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { pubchemCompoundPage } from '../api';
import { makeRoomFor } from './belowCanvas';
import { GHS_PICTOGRAMS } from './ghsPictograms';
import { closeSafety, getSafetyState, isAsking, lookUpSafety } from './safety';
import { credit, ECHA_ACKNOWLEDGEMENT, othersLine, safetyOutcome, type GhsClassification } from './safetyAnswer';

// The server's answers for Safety's test compounds (server/scripts/record_ghs.py), and the
// recordings they were built from: no hazard is typed here.
type Answer = Record<string, unknown> & { classification: Record<string, unknown> | null };
const RESPONSES = Object.values(
  import.meta.glob<{ responses: Record<string, Answer> }>('../../../tests/fixtures/safety_responses.json', {
    eager: true,
    import: 'default',
  }),
)[0].responses;
const RECORDINGS = import.meta.glob<{ body: { Record?: { Reference: Record<string, unknown>[] } } }>(
  '../../../tests/fixtures/recorded/pubchem/ghs-*.json',
  { eager: true, import: 'default' },
);

const named = (find: (a: Answer) => boolean) => Object.values(RESPONSES).find(find)!;
const EU = named((a) => a.classification?.source === 'eu');
const ECHA = named((a) => a.classification?.source === 'echa' && a.classification.not_classified === false);

/** A copy of an answer with one change made to it. */
function changed(answer: Answer, change: (copy: Answer) => void): Answer {
  const copy = structuredClone(answer);
  change(copy);
  return copy;
}

describe('safetyOutcome', () => {
  it.each(Object.keys(RESPONSES))('reads the server answer for %s', (name) => {
    const answer = RESPONSES[name];
    const outcome = safetyOutcome(200, answer);
    if (!answer.found) {
      expect(outcome).toEqual({ kind: 'not-found' });
      return;
    }
    expect(outcome).toMatchObject({ kind: 'found', cid: answer.cid, title: answer.title, url: answer.url });
    if (outcome.kind !== 'found') return;
    expect(outcome.others).toEqual(answer.others);
    const c = answer.classification;
    if (c === null) {
      expect(outcome.classification).toBeNull();
      return;
    }
    expect(outcome.classification).toEqual({
      source: c.source,
      sourceName: c.source_name,
      entry: c.entry,
      sourceUrl: c.source_url,
      indexNo: c.index_no,
      notClassified: c.not_classified,
      signal: c.signal,
      pictograms: c.pictograms,
      statements: (c.statements as Record<string, unknown>[]).map((s) => ({
        code: s.code,
        annexNote: s.annex_note,
        share: s.share,
        words: s.words,
        hazardClass: s.hazard_class,
      })),
      notes: c.notes,
      summary: c.summary,
    });
  });

  it('reads busy and invalid, and anything else that is not 200 as not responding', () => {
    expect(safetyOutcome(503, { error: 'busy' })).toEqual({ kind: 'busy' });
    expect(safetyOutcome(400, { error: 'invalid_structure' })).toEqual({ kind: 'invalid' });
    for (const status of [502, 500, 422, 404]) expect(safetyOutcome(status, EU)).toEqual({ kind: 'not-responding' });
  });

  const c = (answer: Answer) => answer.classification as Record<string, unknown>;
  const statement = (answer: Answer) => (c(answer).statements as Record<string, unknown>[])[0];
  const pictogram = (answer: Answer) => (c(answer).pictograms as Record<string, unknown>[])[0];
  it.each<[string, (a: Answer) => void]>([
    ['a pictogram the app does not ship', (a) => (pictogram(a).code = 'GHS10')],
    ['a pictogram without a name', (a) => (pictogram(a).name = '')],
    ['an unknown signal word', (a) => (c(a).signal = 'Caution')],
    ['an unknown source kind', (a) => (c(a).source = 'nite')],
    ['a statement without words', (a) => (statement(a).words = '')],
    ['a statement with an extra field', (a) => (statement(a).extra = 1)],
    ['a classification with a missing field', (a) => delete c(a).summary],
    ['a classification with no statements', (a) => (c(a).statements = [])],
    ['not classified, with statements', (a) => (c(a).not_classified = true)],
    ['a link that is not the CID page', (a) => (a.url = pubchemCompoundPage(1))],
    ['a CID of 0', (a) => (a.cid = 0)],
    ['others that do not count', (a) => ((a.others as Record<string, unknown>).count = -1)],
    ['an extra field', (a) => (a.extra = 1)],
  ])('reads %s as not responding, so nothing partial is shown', (_, change) => {
    expect(safetyOutcome(200, EU)).toMatchObject({ kind: 'found' });
    expect(safetyOutcome(200, changed(EU, change))).toEqual({ kind: 'not-responding' });
  });

  it('reads "no record" only with nothing else in it', () => {
    const none = named((a) => a.found === false);
    expect(safetyOutcome(200, none)).toEqual({ kind: 'not-found' });
    expect(safetyOutcome(200, changed(none, (a) => (a.cid = 7)))).toEqual({ kind: 'not-responding' });
  });

  it('ships every pictogram the fixtures name', () => {
    const codes = Object.values(RESPONSES).flatMap((a) =>
      ((a.classification?.pictograms ?? []) as { code: string }[]).map((p) => p.code),
    );
    expect(codes.length).toBeGreaterThan(0);
    for (const code of codes) expect(GHS_PICTOGRAMS).toContain(code);
  });
});

describe('credit', () => {
  const read = (answer: Answer) => {
    const outcome = safetyOutcome(200, answer);
    if (outcome.kind !== 'found' || !outcome.classification) throw new Error('no classification');
    return [outcome.classification, outcome.cid] as [GhsClassification, number];
  };

  it("gives ECHA's acknowledgement exactly as its licence note asks", () => {
    const notes = Object.values(RECORDINGS).flatMap((r) =>
      (r.body.Record?.Reference ?? []).filter((x) => x.SourceName === 'European Chemicals Agency (ECHA)'),
    );
    const asked = new Set(notes.map((x) => /"(Source: European Chemicals Agency, [^"]+)"/.exec(String(x.LicenseNote))![1]));
    expect([...asked]).toEqual([ECHA_ACKNOWLEDGEMENT]);
    const [classification, cid] = read(ECHA);
    expect(credit(classification, cid)).toContain(ECHA_ACKNOWLEDGEMENT);
    expect(credit(classification, cid)).toContain(`CID ${cid}`);
  });

  it("names the EU regulation, its entry and licence, and PubChem's CID", () => {
    const [classification, cid] = read(EU);
    const text = credit(classification, cid);
    expect(text).toContain(`entry ${classification.indexNo}`);
    expect(text).toContain(classification.sourceUrl!);
    expect(text).toContain('CC BY 4.0');
    expect(text).toContain(`via PubChem, CID ${cid}`);
  });

  it('names any other source with its entry and address, and says NITE-CMC is shown in part', () => {
    const [eu, cid] = read(EU);
    const other = { ...eu, source: 'other' as const, sourceName: 'NITE-CMC', indexNo: null };
    expect(credit(other, cid)).toBe(`Source: NITE-CMC, ${eu.entry}, ${eu.sourceUrl}; via PubChem, CID ${cid}, shown in part.`);
    const hsdb = { ...other, sourceName: 'Hazardous Substances Data Bank (HSDB)', entry: null };
    expect(credit(hsdb, cid)).toBe(`Source: Hazardous Substances Data Bank (HSDB), ${eu.sourceUrl}; via PubChem, CID ${cid}.`);
  });
});

describe('othersLine', () => {
  it('counts one or many', () => {
    expect(othersLine(1, ['a'])).toBe('PubChem lists 1 more classification for this compound (a). They may differ.');
    expect(othersLine(3, ['a', 'b'])).toBe('PubChem lists 3 more classifications for this compound (a, b). They may differ.');
  });
});

/** A Ketcher with just what Safety uses; getSmiles answers when the test says so. */
function fakeKetcher(reaction = false) {
  let give: (smiles: string) => void = () => {};
  const ketcher = {
    containsReaction: () => reaction,
    getSmiles: vi.fn(() => new Promise<string>((resolve) => (give = resolve))),
  };
  return { ketcher: ketcher as unknown as Ketcher, give: (s: string) => give(s) };
}

/** A fetch that answers only when the test says so. */
function holdFetch() {
  const waiting: ((r: { url: string; body: unknown; signal: AbortSignal; answer: (b: unknown) => void }) => void)[] = [];
  const fetch = vi.fn(
    (url: string, init: RequestInit) =>
      new Promise<Response>((resolve, reject) => {
        init.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        waiting.shift()!({
          url,
          body: JSON.parse(init.body as string) as unknown,
          signal: init.signal!,
          answer: (body) => resolve(new Response(JSON.stringify(body))),
        });
      }),
  );
  const requests: Promise<Parameters<(typeof waiting)[number]>[0]>[] = [];
  const next = () => {
    const request = new Promise<Parameters<(typeof waiting)[number]>[0]>((resolve) => waiting.push(resolve));
    requests.push(request);
    return request;
  };
  vi.stubGlobal('fetch', fetch);
  return { fetch, next };
}

describe('lookUpSafety', () => {
  afterEach(() => {
    closeSafety();
    vi.unstubAllGlobals();
  });

  it('asks with the SMILES in the body, shows "asking", then the answer', async () => {
    const { next } = holdFetch();
    const { ketcher, give } = fakeKetcher();
    const request = next();
    const done = lookUpSafety(ketcher);
    expect(getSafetyState()).toEqual({ kind: 'asking' });
    expect(isAsking()).toBe(true);
    give('drawing-smiles');
    const held = await request;
    expect(held.url).toMatch(/api\/safety$/);
    expect(held.body).toEqual({ smiles: 'drawing-smiles' });
    held.answer(EU);
    await done;
    expect(getSafetyState()).toMatchObject({ kind: 'found', cid: EU.cid });
    expect(isAsking()).toBe(false);
  });

  it('a reaction is not sent', async () => {
    const { fetch } = holdFetch();
    await lookUpSafety(fakeKetcher(true).ketcher);
    expect(getSafetyState()).toEqual({ kind: 'reaction' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('a change while the answer is on its way drops it and aborts the request', async () => {
    const { next } = holdFetch();
    const { ketcher, give } = fakeKetcher();
    const request = next();
    const done = lookUpSafety(ketcher);
    give('s');
    const held = await request;
    closeSafety(); // what the drawing's change event calls
    expect(held.signal.aborted).toBe(true);
    held.answer(EU);
    await done;
    expect(getSafetyState()).toEqual({ kind: 'idle' });
  });

  it('another panel below the canvas closes it, and drops its answer', async () => {
    const { next } = holdFetch();
    const { ketcher, give } = fakeKetcher();
    const request = next();
    const done = lookUpSafety(ketcher);
    give('s');
    const held = await request;
    makeRoomFor('nmr');
    expect(getSafetyState()).toEqual({ kind: 'idle' });
    expect(held.signal.aborted).toBe(true);
    held.answer(EU);
    await done;
    expect(getSafetyState()).toEqual({ kind: 'idle' });
  });
});
