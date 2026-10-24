import type { Ketcher } from 'ketcher-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { pubchemCompoundPage } from '../api';
import { closeName, getNameState, nameDrawing, stereoNote } from './naming';

const ANSWER = { found: true, iupac: 'i', title: 't', cid: 7, url: pubchemCompoundPage(7), undefined_stereo: 0 };

/** A Ketcher with just what Get name uses; getSmiles answers when the test says so. */
function fakeKetcher(reaction = false) {
  let give: (smiles: string) => void = () => {};
  let fail: (error: Error) => void = () => {};
  const ketcher = {
    containsReaction: () => reaction,
    getSmiles: vi.fn(
      () =>
        new Promise<string>((resolve, reject) => {
          give = resolve;
          fail = reject;
        }),
    ),
  };
  return { ketcher: ketcher as unknown as Ketcher, give: (s: string) => give(s), fail: (e: Error) => fail(e) };
}

interface HeldRequest {
  signal: AbortSignal;
  answer: (body: unknown) => void;
}

/** A fetch that answers only when the test says so. `next()` resolves when it is called. */
function holdFetch() {
  const waiting: ((request: HeldRequest) => void)[] = [];
  const made: Promise<HeldRequest>[] = [];
  const fetch = vi.fn(
    (_url: string, init: RequestInit) =>
      new Promise<Response>((resolve, reject) => {
        init.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        const request = { signal: init.signal!, answer: (body: unknown) => resolve(new Response(JSON.stringify(body))) };
        const listener = waiting.shift();
        if (listener) listener(request);
        else made.push(Promise.resolve(request));
      }),
  );
  vi.stubGlobal('fetch', fetch);
  const next = () => made.shift() ?? new Promise<HeldRequest>((resolve) => waiting.push(resolve));
  return { fetch, next };
}

describe('nameDrawing', () => {
  afterEach(() => {
    closeName();
    vi.unstubAllGlobals();
  });

  it('shows "naming" at once, then the answer', async () => {
    const { next } = holdFetch();
    const { ketcher, give } = fakeKetcher();
    const done = nameDrawing(ketcher);
    expect(getNameState()).toEqual({ kind: 'naming' });
    give('s');
    (await next()).answer(ANSWER);
    await done;
    expect(getNameState()).toMatchObject({ kind: 'found', cid: 7 });
  });

  it('a reaction is not sent', async () => {
    const { fetch } = holdFetch();
    await nameDrawing(fakeKetcher(true).ketcher);
    expect(getNameState()).toEqual({ kind: 'reaction' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("a drawing Ketcher can't write as SMILES is not sent", async () => {
    const { fetch } = holdFetch();
    const { ketcher, fail } = fakeKetcher();
    const done = nameDrawing(ketcher);
    fail(new Error('SMILES: cannot write'));
    await done;
    expect(getNameState()).toEqual({ kind: 'invalid' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('a drawing with no SMILES is not sent', async () => {
    const { fetch } = holdFetch();
    const { ketcher, give } = fakeKetcher();
    const done = nameDrawing(ketcher);
    give('');
    await done;
    expect(getNameState()).toEqual({ kind: 'invalid' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('a change while the answer is on its way drops it and aborts the request', async () => {
    const { next } = holdFetch();
    const { ketcher, give } = fakeKetcher();
    const done = nameDrawing(ketcher);
    give('s');
    const request = await next();
    closeName(); // what the drawing's change event calls
    expect(getNameState()).toEqual({ kind: 'idle' });
    expect(request.signal.aborted).toBe(true);
    request.answer(ANSWER);
    await done;
    expect(getNameState()).toEqual({ kind: 'idle' });
  });

  it('a change before the SMILES is ready sends nothing', async () => {
    const { fetch } = holdFetch();
    const { ketcher, give } = fakeKetcher();
    const done = nameDrawing(ketcher);
    closeName();
    give('s');
    await done;
    expect(fetch).not.toHaveBeenCalled();
    expect(getNameState()).toEqual({ kind: 'idle' });
  });

  it('closing after an answer hides it', async () => {
    const { next } = holdFetch();
    const { ketcher, give } = fakeKetcher();
    const done = nameDrawing(ketcher);
    give('s');
    (await next()).answer({ ...ANSWER, found: false });
    await done;
    expect(getNameState()).toEqual({ kind: 'not-found' });
    closeName();
    expect(getNameState()).toEqual({ kind: 'idle' });
  });
});

it('the stereo note counts places', () => {
  expect(stereoNote(1)).toBe(
    'Stereochemistry is undefined at 1 place in this drawing, so the name may differ for a specific stereoisomer.',
  );
  expect(stereoNote(3)).toContain('at 3 places in this drawing');
});
