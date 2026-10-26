import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  conformerOutcome,
  NAMING_DEADLINE_MS,
  nameOutcome,
  pubchemCompoundPage,
  requestConformer,
  requestName,
  requestStructure,
  structureOutcome,
} from './api';

const ANSWER = { found: true, iupac: 'i', title: 't', cid: 7, url: pubchemCompoundPage(7), undefined_stereo: 1 };
const FOUND = { kind: 'found', iupac: 'i', title: 't', cid: 7, url: pubchemCompoundPage(7), undefinedStereo: 1 };
const NOT_RESPONDING = { kind: 'not-responding' };

describe('nameOutcome', () => {
  it('a name', () => {
    expect(nameOutcome(200, ANSWER)).toEqual(FOUND);
  });

  it('a record without names', () => {
    expect(nameOutcome(200, { ...ANSWER, iupac: null, title: null })).toEqual({ ...FOUND, iupac: null, title: null });
  });

  it('no record', () => {
    const answer = { found: false, iupac: null, title: null, cid: null, url: null, undefined_stereo: 0 };
    expect(nameOutcome(200, answer)).toEqual({ kind: 'not-found' });
  });

  it.each([
    [503, { error: 'busy' }, 'busy'],
    [400, { error: 'invalid_structure' }, 'invalid'],
    [503, {}, 'not-responding'],
    [502, { error: 'unavailable' }, 'not-responding'],
    [403, null, 'not-responding'],
    [404, null, 'not-responding'],
    [500, null, 'not-responding'],
    [200, null, 'not-responding'],
    [200, {}, 'not-responding'],
  ])('HTTP %i %j -> %s', (status, body, kind) => {
    expect(nameOutcome(status, body)).toEqual({ kind });
  });

  it.each([
    ['a link to another CID', { url: pubchemCompoundPage(8) }],
    ['a link over http', { url: pubchemCompoundPage(7).replace('https:', 'http:') }],
    ['no link', { url: null }],
    ['CID 0', { cid: 0, url: pubchemCompoundPage(0) }],
    ['a CID that is text', { cid: '7' }],
    ['a CID that is not whole', { cid: 7.5, url: pubchemCompoundPage(7.5) }],
    ['a name that is not text', { iupac: 5 }],
    ['a negative stereo count', { undefined_stereo: -1 }],
  ])('%s is not trusted', (_, change) => {
    expect(nameOutcome(200, { ...ANSWER, ...change })).toEqual(NOT_RESPONDING);
  });
});

interface HeldRequest {
  url: string;
  init: RequestInit;
  answer: (status: number, body: unknown) => void;
}

/** A fetch that answers only when the test says so, and rejects when its request aborts. */
function holdFetch(): HeldRequest[] {
  const requests: HeldRequest[] = [];
  vi.stubGlobal(
    'fetch',
    (url: string, init: RequestInit) =>
      new Promise<Response>((resolve, reject) => {
        init.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        requests.push({ url, init, answer: (status, body) => resolve(new Response(JSON.stringify(body), { status })) });
      }),
  );
  return requests;
}

describe('requestName', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("posts only the SMILES, as JSON, to the app's own API", async () => {
    const requests = holdFetch();
    const outcome = requestName('the smiles', new AbortController().signal);
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe(`${import.meta.env.BASE_URL}api/name`);
    expect(requests[0].init.method).toBe('POST');
    expect(requests[0].init.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(requests[0].init.body).toBe(JSON.stringify({ smiles: 'the smiles' }));
    requests[0].answer(200, ANSWER);
    expect(await outcome).toEqual(FOUND);
  });

  it('waits 8 s, the spec says', () => {
    expect(NAMING_DEADLINE_MS).toBe(8000);
  });

  it('shows an answer that comes just before the deadline', async () => {
    const requests = holdFetch();
    const outcome = requestName('s', new AbortController().signal);
    await vi.advanceTimersByTimeAsync(NAMING_DEADLINE_MS - 1);
    requests[0].answer(200, ANSWER);
    expect(await outcome).toEqual(FOUND);
  });

  it('gives up at the deadline and aborts the request', async () => {
    const requests = holdFetch();
    let settled = false;
    const outcome = requestName('s', new AbortController().signal).finally(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(NAMING_DEADLINE_MS - 1);
    expect(settled).toBe(false);
    expect(requests[0].init.signal!.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await outcome).toEqual(NOT_RESPONDING);
    expect(requests[0].init.signal!.aborted).toBe(true);
  });

  it('a late answer changes nothing', async () => {
    const requests = holdFetch();
    const outcome = requestName('s', new AbortController().signal);
    await vi.advanceTimersByTimeAsync(NAMING_DEADLINE_MS);
    requests[0].answer(200, ANSWER);
    expect(await outcome).toEqual(NOT_RESPONDING);
  });

  it("stops when the caller aborts, and clears its timer", async () => {
    const requests = holdFetch();
    const caller = new AbortController();
    const outcome = requestName('s', caller.signal);
    caller.abort();
    expect(await outcome).toEqual(NOT_RESPONDING);
    expect(requests[0].init.signal!.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a network failure is "not responding"', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('Failed to fetch')));
    expect(await requestName('s', new AbortController().signal)).toEqual(NOT_RESPONDING);
  });

  it('an answer that is not JSON is judged by its status', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(new Response('<html>Proxy Error</html>', { status: 502 })));
    expect(await requestName('s', new AbortController().signal)).toEqual(NOT_RESPONDING);
  });
});

const DRAWN_ANSWER = {
  found: true,
  smiles: 'S',
  molfile: 'M',
  source: 'PubChem',
  message: 'opsin said',
  title: 'T',
  cid: 9,
  matches: 2,
  stereo_from_pubchem: true,
};
const DRAWN = {
  kind: 'drawn',
  smiles: 'S',
  molfile: 'M',
  source: 'PubChem',
  opsinMessage: 'opsin said',
  title: 'T',
  cid: 9,
  matches: 2,
  stereoFromPubchem: true,
};

describe('structureOutcome', () => {
  it('a drawn name', () => {
    expect(structureOutcome(200, DRAWN_ANSWER)).toEqual(DRAWN);
  });

  it('drawn by OPSIN: no PubChem record', () => {
    const answer = { ...DRAWN_ANSWER, source: 'OPSIN', message: null, title: null, cid: null, matches: 0 };
    expect(structureOutcome(200, answer)).toMatchObject({ kind: 'drawn', source: 'OPSIN', cid: null });
  });

  it('no compound by that name keeps OPSIN’s words', () => {
    const answer = { ...DRAWN_ANSWER, found: false, smiles: null, molfile: null, source: null, title: null, cid: null, matches: 0, stereo_from_pubchem: false };
    expect(structureOutcome(200, answer)).toEqual({ kind: 'no-compound', opsinMessage: 'opsin said' });
  });

  it.each([
    [503, { error: 'busy' }, 'busy'],
    [422, { detail: [] }, 'bad-name'],
    [502, { error: 'unavailable' }, 'not-responding'],
    [500, null, 'not-responding'],
    [200, null, 'not-responding'],
  ])('HTTP %i %j -> %s', (status, body, kind) => {
    expect(structureOutcome(status, body)).toEqual({ kind });
  });

  it.each([
    ['another source', { source: 'EBI' }],
    ['no molfile', { molfile: null }],
    ['an empty SMILES', { smiles: '' }],
    ['CID 0', { cid: 0 }],
    ['a stereo flag that is not true or false', { stereo_from_pubchem: 'yes' }],
    ['a negative record count', { matches: -1 }],
  ])('%s is not trusted', (_, change) => {
    expect(structureOutcome(200, { ...DRAWN_ANSWER, ...change })).toEqual(NOT_RESPONDING);
  });
});

describe('requestStructure', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("posts only the typed name, as JSON, to the app's own API, with the 8 s deadline", async () => {
    vi.useFakeTimers();
    const requests = holdFetch();
    const outcome = requestStructure('a name', new AbortController().signal);
    expect(requests[0].url).toBe(`${import.meta.env.BASE_URL}api/structure`);
    expect(requests[0].init.method).toBe('POST');
    expect(requests[0].init.body).toBe(JSON.stringify({ name: 'a name' }));
    await vi.advanceTimersByTimeAsync(NAMING_DEADLINE_MS);
    expect(await outcome).toEqual(NOT_RESPONDING);
    expect(requests[0].init.signal!.aborted).toBe(true);
  });
});

const MODEL_ANSWER = {
  found: true,
  pubchem: 'found',
  source: 'pubchem',
  cid: 7,
  molblock: 'a model',
  reason: null,
  undefined_stereo: 1,
};
const MODEL = { kind: 'model', molblock: 'a model', source: 'pubchem', cid: 7, pubchem: 'found', undefinedStereo: 1 };
const RDKIT_ANSWER = { ...MODEL_ANSWER, pubchem: 'none', source: 'rdkit', cid: null };
const NO_MODEL = { found: false, pubchem: 'none', source: null, cid: null, molblock: null, undefined_stereo: 0 };

describe('conformerOutcome', () => {
  it("PubChem's model", () => {
    expect(conformerOutcome(200, MODEL_ANSWER)).toEqual(MODEL);
  });

  it.each(['none', 'unusable', 'no_answer'])("RDKit's model, PubChem having said %s", (pubchem) => {
    expect(conformerOutcome(200, { ...RDKIT_ANSWER, pubchem })).toEqual({ ...MODEL, source: 'rdkit', cid: null, pubchem });
  });

  it.each(['too_big', 'no_model'])('no model: %s', (reason) => {
    expect(conformerOutcome(200, { ...NO_MODEL, reason })).toEqual({ kind: 'no-model', reason });
  });

  it.each([
    [503, { error: 'busy' }, 'busy'],
    [400, { error: 'one_structure' }, 'one-structure'],
    [400, { error: 'invalid_structure' }, 'invalid'],
    [503, {}, 'not-responding'],
    [502, null, 'not-responding'],
    [422, null, 'not-responding'],
    [200, null, 'not-responding'],
    [200, {}, 'not-responding'],
  ])('HTTP %i %j -> %s', (status, body, kind) => {
    expect(conformerOutcome(status, body)).toEqual({ kind });
  });

  it.each([
    ["PubChem's model without its CID", { cid: null }],
    ['CID 0', { cid: 0 }],
    ['a CID that is text', { cid: '7' }],
    ['PubChem said it has none', { pubchem: 'none' }],
    ['PubChem said something unknown', { pubchem: 'maybe' }],
    ['an unknown source', { source: 'somewhere' }],
    ['no model', { molblock: '' }],
    ['a model that is not text', { molblock: 5 }],
    ['a reason beside a model', { reason: 'too_big' }],
    ['a negative stereo count', { undefined_stereo: -1 }],
  ])('%s is not trusted', (_, change) => {
    expect(conformerOutcome(200, { ...MODEL_ANSWER, ...change })).toEqual(NOT_RESPONDING);
  });

  it.each([
    ["RDKit's model with a CID", { ...RDKIT_ANSWER, cid: 7 }],
    ["RDKit's model when PubChem had one", { ...RDKIT_ANSWER, pubchem: 'found' }],
    ['an unknown reason', { ...NO_MODEL, reason: 'tired' }],
    ['no model, but a model', { ...NO_MODEL, reason: 'no_model', molblock: 'a model' }],
  ])('%s is not trusted', (_, answer) => {
    expect(conformerOutcome(200, answer)).toEqual(NOT_RESPONDING);
  });
});

describe('requestConformer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("posts only the SMILES, as JSON, to the app's own API", async () => {
    const requests = holdFetch();
    const outcome = requestConformer('the smiles', new AbortController().signal);
    expect(requests[0].url).toBe(`${import.meta.env.BASE_URL}api/conformer`);
    expect(requests[0].init.method).toBe('POST');
    expect(requests[0].init.body).toBe(JSON.stringify({ smiles: 'the smiles' }));
    requests[0].answer(200, MODEL_ANSWER);
    expect(await outcome).toEqual(MODEL);
  });

  it('gives up at the naming deadline', async () => {
    const requests = holdFetch();
    const outcome = requestConformer('s', new AbortController().signal);
    await vi.advanceTimersByTimeAsync(NAMING_DEADLINE_MS);
    expect(await outcome).toEqual(NOT_RESPONDING);
    expect(requests[0].init.signal!.aborted).toBe(true);
  });
});
