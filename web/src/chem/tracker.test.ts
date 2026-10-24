// Every ordering of drawing changes and worker replies, forced: the test decides what the
// drawing is at each moment and when (and whether) each reply arrives.
import { describe, expect, it } from 'vitest';
import type { Computed } from './compute';
import type { GroupsResult } from './functionalGroups';
import { createTracker, type Drawing, type PanelState, type WorkerRequest } from './tracker';

/** A made-up result whose average MW tells the drawings apart (not a real compound). */
function result(
  amw: number,
  centres: number[] = [],
  groups: GroupsResult = { kind: 'found', groups: [], problems: [] },
): Computed {
  return {
    descriptors: { amw, exactmw: amw, lipinskiHBD: 0, lipinskiHBA: 0, NumRotatableBonds: 0, tpsa: 0, CrippenClogP: 0 },
    elements: { C: 1 },
    charge: 0,
    radicals: 0,
    fragments: 1,
    centres: centres.map((i) => ({ atoms: [i], defined: true })),
    doubleBonds: [],
    groups,
  };
}

function structure(name: string, atomIds: number[] = [0], badValence = 0): Drawing {
  return { kind: 'structure', molfile: name, atomIds, badValence };
}

function setup() {
  let drawing: Drawing = { kind: 'empty' };
  const sent: WorkerRequest[] = [];
  const shown: PanelState[] = [];
  const tracker = createTracker(
    () => drawing,
    (request) => sent.push(request),
    (state) => shown.push(state),
  );
  return {
    tracker,
    sent,
    shown,
    draw(next: Drawing) {
      drawing = next;
      tracker.changed();
    },
    last: () => shown[shown.length - 1],
    shownMw: () => shown.flatMap((s) => (s.kind === 'ready' ? [s.values.averageMw] : [])),
  };
}

describe('tracker', () => {
  it('shows a message drawing at once and asks RDKit about a structure', () => {
    const t = setup();
    t.draw({ kind: 'empty' });
    expect(t.last()).toEqual({ kind: 'empty', drawing: 1 });
    t.draw(structure('A'));
    expect(t.sent).toEqual([{ id: 2, molfile: 'A' }]);
    expect(t.last()).toEqual({ kind: 'working', drawing: 2 });
    t.tracker.reply({ id: 2, computed: result(1) });
    expect(t.last()).toMatchObject({ kind: 'ready', drawing: 2, revision: 2 });
    expect(t.shownMw()).toEqual(['1.00']);
  });

  it('never shows the reply for a drawing that changed meanwhile', () => {
    const t = setup();
    t.draw(structure('A'));
    t.draw(structure('B'));
    expect(t.sent).toEqual([{ id: 1, molfile: 'A' }]); // one at a time
    t.tracker.reply({ id: 1, computed: result(1) });
    expect(t.shownMw()).toEqual([]);
    expect(t.sent).toEqual([
      { id: 1, molfile: 'A' },
      { id: 2, molfile: 'B' },
    ]);
    t.tracker.reply({ id: 2, computed: result(2) });
    expect(t.shownMw()).toEqual(['2.00']);
    expect(t.last()).toMatchObject({ kind: 'ready', drawing: 2, revision: 2 });
  });

  it('collapses the changes made while RDKit is busy into one request for the newest drawing', () => {
    const t = setup();
    t.draw(structure('A'));
    t.draw(structure('B'));
    t.draw(structure('C'));
    t.draw(structure('D'));
    t.tracker.reply({ id: 1, computed: result(1) });
    expect(t.sent.map((r) => r.molfile)).toEqual(['A', 'D']);
    expect(t.sent[1].id).toBe(4);
  });

  it('keeps the last values on screen, marked as out of date, while a newer drawing is worked out', () => {
    const t = setup();
    t.draw(structure('A'));
    t.tracker.reply({ id: 1, computed: result(1) });
    t.draw(structure('B'));
    expect(t.last()).toMatchObject({ kind: 'ready', drawing: 2, revision: 1 });
    t.tracker.reply({ id: 2, computed: result(2) });
    expect(t.last()).toMatchObject({ kind: 'ready', drawing: 2, revision: 2 });
  });

  it('shows a message drawing at once, even while RDKit is busy, and drops the late reply', () => {
    const t = setup();
    t.draw(structure('A'));
    t.draw({ kind: 'reaction' });
    expect(t.last()).toEqual({ kind: 'reaction', drawing: 2 });
    t.tracker.reply({ id: 1, computed: result(1) });
    expect(t.last()).toEqual({ kind: 'reaction', drawing: 2 });
    expect(t.shownMw()).toEqual([]);
    expect(t.sent).toHaveLength(1);
  });

  it('after a message, shows "working" rather than older values for the next structure', () => {
    const t = setup();
    t.draw(structure('A'));
    t.tracker.reply({ id: 1, computed: result(1) });
    t.draw({ kind: 'empty' });
    t.draw(structure('B'));
    expect(t.last()).toEqual({ kind: 'working', drawing: 3 });
  });

  it('works out the newest drawing when the busy one changed to a message and back', () => {
    const t = setup();
    t.draw(structure('A'));
    t.draw({ kind: 'empty' });
    t.draw(structure('C'));
    t.tracker.reply({ id: 1, computed: result(1) });
    expect(t.sent.map((r) => r.molfile)).toEqual(['A', 'C']);
    t.tracker.reply({ id: 3, computed: result(3) });
    expect(t.shownMw()).toEqual(['3.00']);
  });

  it('says so when RDKit cannot read the drawing', () => {
    const t = setup();
    t.draw(structure('A'));
    t.tracker.reply({ id: 1, computed: null });
    expect(t.last()).toEqual({ kind: 'unreadable', drawing: 1 });
  });

  it("gives Ketcher's valence warning as the reason when RDKit can't read the drawing", () => {
    const t = setup();
    t.draw(structure('A', [0, 1], 1));
    t.tracker.reply({ id: 1, computed: null });
    expect(t.last()).toEqual({ kind: 'invalid', atoms: 1, drawing: 1 });
  });

  it("shows RDKit's values when it reads a drawing Ketcher underlines", () => {
    const t = setup();
    t.draw(structure('A', [0, 1], 1));
    t.tracker.reply({ id: 1, computed: result(1) });
    expect(t.last()).toMatchObject({ kind: 'ready', drawing: 1 });
  });

  it('reports RDKit not starting, and then stops asking', () => {
    const t = setup();
    t.draw(structure('A'));
    t.tracker.reply({ failed: 'EvalError' });
    expect(t.last()).toEqual({ kind: 'unavailable', drawing: 1 });
    t.draw(structure('B'));
    t.tracker.reply({ id: 1, computed: result(1) });
    expect(t.sent).toHaveLength(1);
    expect(t.last()).toEqual({ kind: 'unavailable', drawing: 1 });
  });

  it("maps stereo elements to Ketcher's atom ids as they were when the drawing was read", () => {
    const t = setup();
    // Ketcher's ids out of Molfile order (an atom deleted and restored by Undo goes last).
    t.draw(structure('A', [0, 1, 3, 2]));
    t.tracker.reply({ id: 1, computed: result(1, [2, 3]) });
    const last = t.last();
    expect(last.kind === 'ready' && last.stereo).toEqual([
      { atoms: [3], defined: true },
      { atoms: [2], defined: true },
    ]);
  });

  it("maps functional groups to Ketcher's atom ids, bonds as their two atoms", () => {
    const t = setup();
    t.draw(structure('A', [0, 1, 3, 2]));
    const found: GroupsResult = {
      kind: 'found',
      groups: [{ name: 'G', color: '#123456', instances: [{ atoms: [2, 3], bonds: [[2, 3]] }, { atoms: [0], bonds: [] }] }],
      problems: ['"H": it has no SMARTS'],
    };
    t.tracker.reply({ id: 1, computed: result(1, [], found) });
    const last = t.last();
    expect(last.kind === 'ready' && last.groups).toEqual({
      kind: 'found',
      groups: [{ name: 'G', color: '#123456', instances: [{ atoms: [3, 2], bonds: [[3, 2]] }, { atoms: [0], bonds: [] }] }],
      problems: ['"H": it has no SMARTS'],
    });
    t.draw(structure('B', [5]));
    t.tracker.reply({ id: 2, computed: result(2, [], { kind: 'unavailable', reason: 'HTTP 404' }) });
    const next = t.last();
    expect(next.kind === 'ready' && next.groups).toEqual({ kind: 'unavailable', reason: 'HTTP 404' });
  });

  it('ignores a reply it did not ask for', () => {
    const t = setup();
    t.draw(structure('A'));
    t.tracker.reply({ id: 7, computed: result(7) });
    expect(t.shownMw()).toEqual([]);
    t.tracker.reply({ id: 1, computed: result(1) });
    expect(t.shownMw()).toEqual(['1.00']);
  });
});
