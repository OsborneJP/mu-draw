import type { Ketcher } from 'ketcher-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { pubchemCompoundPage } from '../api';
import { closeName, drawingChanged, drawName, getNameState, isBusy, nameDrawing, sameName, stereoNote } from './naming';

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
  url: string;
  body: unknown;
  signal: AbortSignal;
  answer: (body: unknown) => void;
}

/** A fetch that answers only when the test says so. `next()` resolves when it is called. */
function holdFetch() {
  const waiting: ((request: HeldRequest) => void)[] = [];
  const made: Promise<HeldRequest>[] = [];
  const fetch = vi.fn(
    (url: string, init: RequestInit) =>
      new Promise<Response>((resolve, reject) => {
        init.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        const request = {
          url,
          body: JSON.parse(init.body as string) as unknown,
          signal: init.signal!,
          answer: (body: unknown) => resolve(new Response(JSON.stringify(body))),
        };
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

const DRAWN = {
  found: true,
  smiles: 'drawn smiles',
  molfile: 'drawn molfile',
  source: 'OPSIN',
  message: null,
  title: null,
  cid: null,
  matches: 0,
  stereo_from_pubchem: false,
};

/** A Ketcher with what Name to structure uses. Like Ketcher (measured), each insertion fires
 * its change event before it resolves. `started()` resolves once an insertion has begun;
 * the insertion itself resolves (`finish`) or fails (`fail`) when the test says so. */
function drawingKetcher() {
  const inserted: string[] = [];
  let finish: () => void = () => {};
  let fail: (error: Error) => void = () => {};
  let begun: () => void = () => {};
  const started = new Promise<void>((resolve) => (begun = resolve));
  const insert = (how: string) =>
    vi.fn(
      (molfile: string) =>
        new Promise<void>((resolve, reject) => {
          inserted.push(`${how} ${molfile}`);
          drawingChanged(); // Ketcher's change event for this insertion
          finish = resolve;
          fail = reject;
          begun();
        }),
    );
  const ketcher = { addFragment: insert('add'), setMolecule: insert('replace') };
  return {
    ketcher: ketcher as unknown as Ketcher,
    inserted,
    started: () => started,
    finish: () => finish(),
    fail: (error: Error) => fail(error),
  };
}

describe('drawName', () => {
  afterEach(() => {
    closeName();
    vi.unstubAllGlobals();
  });

  it.each([
    ['replace', 'replace drawn molfile'],
    ['add', 'add drawn molfile'],
  ] as const)('%s: draws, keeps the panel through its own change, then names what it drew', async (mode, how) => {
    const { next } = holdFetch();
    const { ketcher, inserted, started, finish } = drawingKetcher();
    const done = drawName(ketcher, 'typed name', mode);
    expect(getNameState()).toEqual({ kind: 'drawing', typed: 'typed name' });
    expect(isBusy()).toBe(true);
    const structure = await next();
    expect(structure.body).toEqual({ name: 'typed name' });
    structure.answer(DRAWN);
    const roundTrip = next();
    await started();
    expect(inserted).toEqual([how]);
    finish();
    const naming = await roundTrip;
    expect(naming.body).toEqual({ smiles: 'drawn smiles' });
    expect(getNameState()).toMatchObject({ kind: 'drawn', typed: 'typed name', roundTrip: { kind: 'naming' } });
    naming.answer(ANSWER);
    await done;
    expect(getNameState()).toMatchObject({ kind: 'drawn', roundTrip: { kind: 'found', iupac: 'i' } });
    expect(isBusy()).toBe(false);
  });

  it('a change after drawing closes the panel and drops the round trip', async () => {
    const { next } = holdFetch();
    const { ketcher, started, finish } = drawingKetcher();
    const done = drawName(ketcher, 'n', 'replace');
    (await next()).answer(DRAWN);
    const roundTrip = next();
    await started();
    finish();
    const naming = await roundTrip;
    drawingChanged(); // the student's own edit
    expect(getNameState()).toEqual({ kind: 'idle' });
    expect(naming.signal.aborted).toBe(true);
    naming.answer(ANSWER);
    await done;
    expect(getNameState()).toEqual({ kind: 'idle' });
  });

  it('a change while the name is looked up draws nothing', async () => {
    const { next } = holdFetch();
    const { ketcher, inserted } = drawingKetcher();
    const done = drawName(ketcher, 'n', 'add');
    const structure = await next();
    drawingChanged();
    expect(structure.signal.aborted).toBe(true);
    structure.answer(DRAWN);
    await done;
    expect(inserted).toEqual([]);
    expect(getNameState()).toEqual({ kind: 'idle' });
  });

  it('no compound by that name: nothing is drawn, and OPSIN’s words show', async () => {
    const { next } = holdFetch();
    const { ketcher, inserted } = drawingKetcher();
    const done = drawName(ketcher, 'n', 'replace');
    (await next()).answer({ ...DRAWN, found: false, smiles: null, molfile: null, source: null, message: 'opsin said' });
    await done;
    expect(inserted).toEqual([]);
    expect(getNameState()).toEqual({ kind: 'no-compound', typed: 'n', opsinMessage: 'opsin said' });
  });

  it('a structure the editor refuses is reported, and nothing is named', async () => {
    const { next, fetch } = holdFetch();
    const { ketcher, started, fail } = drawingKetcher();
    const done = drawName(ketcher, 'n', 'replace');
    (await next()).answer(DRAWN);
    await started();
    fail(new Error('cannot draw'));
    await done;
    expect(getNameState()).toEqual({ kind: 'draw-failed' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

it('the round trip matches names that differ only in case and spacing', () => {
  expect(sameName('  Ethyl   Propanoate ', 'ethyl propanoate')).toBe(true);
  expect(sameName('4-methyl-3-pentanol', '2-methylpentan-3-ol')).toBe(false);
});
