import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NAMING_DEADLINE_MS, nameOutcome, pubchemCompoundPage, requestName } from './api';

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
