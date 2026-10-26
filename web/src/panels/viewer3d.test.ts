// The 3D viewer's orderings, forced with a stand-in for 3Dmol: the test decides when its
// module arrives (or fails to), and what the student does meanwhile.
import type { GLViewer } from '3dmol';
import { describe, expect, it } from 'vitest';
import { FIRST_LOOK, showModel, STYLES, type ThreeDmol, type ViewerProblem } from './viewer3d';

function standIn() {
  const calls: unknown[][] = [];
  let view = [0];
  const gl = {
    addModel: (...args: unknown[]) => calls.push(['addModel', ...args]),
    setStyle: (...args: unknown[]) => calls.push(['setStyle', ...args]),
    zoomTo: () => {
      calls.push(['zoomTo']);
      view = [1];
    },
    getView: () => view,
    setView: (next: number[]) => {
      calls.push(['setView', next]);
      view = next;
    },
    render: () => calls.push(['render']),
    clear: () => calls.push(['clear']),
  };
  const created: unknown[][] = [];
  const module: ThreeDmol = {
    createViewer: (element, config) => {
      created.push([element, config]);
      return gl as unknown as GLViewer;
    },
  };
  return { calls, created, module, gl, turn: (next: number[]) => (view = next) };
}

function setup({ webgl = true } = {}) {
  const t = standIn();
  let arrive: (module: ThreeDmol) => void = () => {};
  let fail: (error: Error) => void = () => {};
  let loads = 0;
  const events: ('shown' | ViewerProblem)[] = [];
  const element = {} as HTMLElement;
  const viewer = showModel(element, 'a model', FIRST_LOOK, {
    load: () => {
      loads += 1;
      return new Promise((resolve, reject) => {
        arrive = resolve;
        fail = reject;
      });
    },
    hasWebgl: () => webgl,
    onShown: () => events.push('shown'),
    onProblem: (problem) => events.push(problem),
  });
  return {
    ...t,
    element,
    viewer,
    events,
    loads: () => loads,
    async arrive() {
      arrive(t.module);
      await Promise.resolve();
    },
    async fail() {
      fail(new Error('the chunk did not load'));
      await Promise.resolve().then(() => undefined);
    },
  };
}

describe('the 3D viewer', () => {
  it('without WebGL it says so and never loads 3Dmol', () => {
    const t = setup({ webgl: false });
    expect(t.events).toEqual(['no-webgl']);
    expect(t.loads()).toBe(0);
  });

  it('shows the model once 3Dmol arrives: white, Jmol colours, ball and stick, every H', async () => {
    const t = setup();
    expect(t.created).toEqual([]);
    await t.arrive();
    expect(t.created).toEqual([[t.element, { backgroundColor: 'white', antialias: true }]]);
    expect(t.calls).toEqual([['addModel', 'a model', 'sdf'], ['setStyle', {}, STYLES['ball-and-stick']], ['zoomTo'], ['render']]);
    expect(t.events).toEqual(['shown']);
    expect((t.element as { viewer3d?: unknown }).viewer3d).toBe(t.gl);
  });

  it('closed before 3Dmol arrives: no viewer is made', async () => {
    const t = setup();
    t.viewer.close();
    await t.arrive();
    expect(t.created).toEqual([]);
    expect(t.events).toEqual([]);
  });

  it('a style chosen before 3Dmol arrives is the one shown', async () => {
    const t = setup();
    t.viewer.setLook({ style: 'space-filling', hydrogens: false });
    await t.arrive();
    expect(t.calls.slice(1, 3)).toEqual([
      ['setStyle', {}, STYLES['space-filling']],
      ['setStyle', { elem: 'H' }, {}],
    ]);
  });

  it('each style, with and without H', async () => {
    const t = setup();
    await t.arrive();
    t.calls.length = 0;
    t.viewer.setLook({ style: 'sticks', hydrogens: false });
    t.viewer.setLook({ style: 'sticks', hydrogens: true });
    expect(t.calls).toEqual([
      ['setStyle', {}, STYLES.sticks],
      ['setStyle', { elem: 'H' }, {}],
      ['render'],
      ['setStyle', {}, STYLES.sticks],
      ['render'],
    ]);
  });

  it('Reset view goes back to the first view', async () => {
    const t = setup();
    await t.arrive();
    t.turn([2]);
    t.viewer.reset();
    expect(t.calls.slice(-2)).toEqual([['setView', [1]], ['render']]);
  });

  it("3Dmol's chunk failing to load is said, unless the viewer was closed", async () => {
    const t = setup();
    await t.fail();
    expect(t.events).toEqual(['unavailable']);
    const closed = setup();
    closed.viewer.close();
    await closed.fail();
    expect(closed.events).toEqual([]);
  });

  it('closing clears the model and forgets the viewer', async () => {
    const t = setup();
    await t.arrive();
    t.viewer.close();
    expect(t.calls.at(-1)).toEqual(['clear']);
    expect((t.element as { viewer3d?: unknown }).viewer3d).toBeUndefined();
    t.viewer.setLook({ style: 'sticks', hydrogens: true });
    t.viewer.reset();
    expect(t.calls.at(-1)).toEqual(['clear']);
  });
});
