// The 3D view's orderings, forced: the test decides what the drawing is, when Ketcher writes
// its SMILES, when the server answers, and what happens in between.
import { describe, expect, it } from 'vitest';
import type { ConformerOutcome } from '../api';
import type { Drawing } from '../chem/tracker';
import { createThreeD, sourceLine, stereoNote, type ShownModel, type ThreeDState } from './threeD';

interface Held<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: Error): void;
}

function held<T>(): Held<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

interface Request {
  smiles: string;
  signal: AbortSignal;
  answer: Held<ConformerOutcome>;
}

const STRUCTURE: Drawing = { kind: 'structure', molfile: 'the drawing', atomIds: [0], badValence: 0 };
const MODEL: ConformerOutcome = {
  kind: 'model',
  molblock: 'a model',
  source: 'pubchem',
  cid: 7,
  pubchem: 'found',
  undefinedStereo: 1,
};
const READY: ThreeDState = {
  kind: 'ready',
  model: { molblock: 'a model', source: 'pubchem', cid: 7, pubchem: 'found', undefinedStereo: 1 },
};

function setup() {
  let drawing: Drawing = STRUCTURE;
  let online = true;
  const smiles: Held<string>[] = [];
  const requests: Request[] = [];
  const waiting: ((request: Request) => void)[] = [];
  const shown: ThreeDState[] = [];
  const threeD = createThreeD({
    read: () => drawing,
    smiles: () => {
      const text = held<string>();
      smiles.push(text);
      return text.promise;
    },
    online: () => online,
    request: (text, signal) => {
      const request = { smiles: text, signal, answer: held<ConformerOutcome>() };
      requests.push(request);
      waiting.shift()?.(request);
      return request.answer.promise;
    },
    show: (state) => shown.push(state),
  });
  return {
    threeD,
    smiles,
    requests,
    shown,
    last: () => shown.at(-1),
    draw(next: Drawing) {
      drawing = next;
    },
    goOffline() {
      online = false;
    },
    /** The next request, made once its SMILES arrives: ask before releasing the SMILES. */
    nextRequest: () => new Promise<Request>((resolve) => waiting.push(resolve)),
  };
}

describe('the 3D view', () => {
  it("asks with the drawing's SMILES and shows the model", async () => {
    const t = setup();
    const done = t.threeD.open();
    expect(t.last()).toEqual({ kind: 'loading' });
    const request = t.nextRequest();
    t.smiles[0].resolve('the smiles');
    const made = await request;
    expect(made.smiles).toBe('the smiles');
    made.answer.resolve(MODEL);
    await done;
    expect(t.last()).toEqual(READY);
  });

  it.each(['empty', 'reaction', 'not-elements', 'unreadable'] as const)('a drawing that is %s is not sent', async (kind) => {
    const t = setup();
    t.draw({ kind });
    await t.threeD.open();
    expect(t.last()).toEqual({ kind: 'message', message: kind });
    expect(t.smiles).toHaveLength(0);
  });

  it('offline it says so, and asks nothing', async () => {
    const t = setup();
    t.goOffline();
    await t.threeD.open();
    expect(t.last()).toEqual({ kind: 'message', message: 'offline' });
    expect(t.smiles).toHaveLength(0);
  });

  it.each([
    ['two structures', (s: Held<string>) => s.resolve('one.two'), 'one-structure'],
    ['no SMILES', (s: Held<string>) => s.resolve(''), 'unreadable'],
    ["Ketcher can't write it", (s: Held<string>) => s.reject(new Error('cannot write')), 'unreadable'],
  ] as const)('%s: nothing is sent', async (_, give, message) => {
    const t = setup();
    const done = t.threeD.open();
    give(t.smiles[0]);
    await done;
    expect(t.last()).toEqual({ kind: 'message', message });
    expect(t.requests).toHaveLength(0);
  });

  it.each([
    [{ kind: 'no-model', reason: 'too_big' }, 'too-big'],
    [{ kind: 'no-model', reason: 'no_model' }, 'no-model'],
    [{ kind: 'invalid' }, 'unreadable'],
    [{ kind: 'one-structure' }, 'one-structure'],
    [{ kind: 'busy' }, 'busy'],
    [{ kind: 'not-responding' }, 'not-responding'],
  ] as const)('the answer %j says %s', async (outcome, message) => {
    const t = setup();
    const done = t.threeD.open();
    const request = t.nextRequest();
    t.smiles[0].resolve('s');
    (await request).answer.resolve(outcome);
    await done;
    expect(t.last()).toEqual({ kind: 'message', message });
  });

  it('a change while the SMILES is on its way: stale, and nothing is sent', async () => {
    const t = setup();
    const done = t.threeD.open();
    t.threeD.changed();
    expect(t.last()).toEqual({ kind: 'stale' });
    t.smiles[0].resolve('s');
    await done;
    expect(t.requests).toHaveLength(0);
    expect(t.last()).toEqual({ kind: 'stale' });
  });

  it("a change while the server answers: stale, the request is aborted, and its answer isn't shown", async () => {
    const t = setup();
    const done = t.threeD.open();
    const request = t.nextRequest();
    t.smiles[0].resolve('s');
    const made = await request;
    t.threeD.changed();
    expect(made.signal.aborted).toBe(true);
    made.answer.resolve(MODEL);
    await done;
    expect(t.shown).toEqual([{ kind: 'loading' }, { kind: 'stale' }]);
  });

  it('Show again while an answer is on its way: only the newer answer is shown', async () => {
    const t = setup();
    const first = t.threeD.open();
    const firstRequest = t.nextRequest();
    t.smiles[0].resolve('first');
    const older = await firstRequest;
    const second = t.threeD.open();
    expect(older.signal.aborted).toBe(true);
    const secondRequest = t.nextRequest();
    t.smiles[1].resolve('second');
    const newer = await secondRequest;
    newer.answer.resolve(MODEL);
    await second;
    older.answer.resolve({ kind: 'busy' });
    await first;
    expect(t.last()).toEqual(READY);
  });

  it('a change after a model or a message makes it stale; idle and stale stay as they are', async () => {
    const t = setup();
    t.threeD.changed();
    expect(t.shown).toEqual([]);
    t.goOffline();
    await t.threeD.open();
    t.threeD.changed();
    t.threeD.changed();
    expect(t.shown).toEqual([{ kind: 'message', message: 'offline' }, { kind: 'stale' }]);
  });

  it("closing drops the answer on its way, and doesn't show it later", async () => {
    const t = setup();
    const done = t.threeD.open();
    const request = t.nextRequest();
    t.smiles[0].resolve('s');
    const made = await request;
    t.threeD.close();
    expect(made.signal.aborted).toBe(true);
    made.answer.resolve(MODEL);
    await done;
    expect(t.shown).toEqual([{ kind: 'loading' }, { kind: 'idle' }]);
    t.threeD.close();
    expect(t.shown).toHaveLength(2);
  });
});

describe("the 3D view's words", () => {
  const shown = (change: Partial<ShownModel>): ShownModel => ({ ...(READY as { model: ShownModel }).model, ...change });

  it.each([
    [shown({}), '3D model from PubChem (CID 7).'],
    [shown({ source: 'rdkit', cid: null, pubchem: 'none' }), '3D model computed by RDKit: PubChem has none for this structure.'],
    [shown({ source: 'rdkit', cid: null, pubchem: 'unusable' }), "3D model computed by RDKit: PubChem's model didn't match the drawing."],
    [shown({ source: 'rdkit', cid: null, pubchem: 'no_answer' }), '3D model computed by RDKit: PubChem did not answer.'],
  ])('where the model came from: %j', (model, line) => {
    expect(sourceLine(model)).toBe(line);
  });

  it('the stereo note counts the places, and is absent when there are none', () => {
    expect(stereoNote(0)).toBeNull();
    expect(stereoNote(1)).toBe('Your drawing leaves the stereochemistry undefined at 1 place. This model shows one arrangement.');
    expect(stereoNote(4)).toBe('Your drawing leaves the stereochemistry undefined at 4 places. This model shows one arrangement.');
  });
});
