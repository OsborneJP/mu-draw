import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { answerFor, createUsage, isoWeek, localDay, takeTurns, TOOLS, weeksBetween, type Answer, type Settled, type WeekSummary } from './usage';

// docs/plans/v2-usage-counts.md, bar A (the browser's rules).

describe('weeks', () => {
  // ISO weeks from Python's date.isocalendar(), for dates either side of year ends.
  it.each([
    ['2026-01-01', '2026-W01'],
    ['2027-01-01', '2026-W53'],
    ['2024-12-30', '2025-W01'],
    ['2020-12-31', '2020-W53'],
    ['2021-01-03', '2020-W53'],
    ['2026-03-08', '2026-W10'],
    ['2026-10-27', '2026-W44'],
    ['2026-11-01', '2026-W44'],
    ['2026-11-02', '2026-W45'],
  ])('%s is in %s, by the device calendar', (day, week) => {
    const [y, m, d] = day.split('-').map(Number);
    for (const hour of [0, 12, 23]) expect(isoWeek(new Date(y, m - 1, d, hour))).toBe(week);
    expect(localDay(new Date(y, m - 1, d, 23, 59))).toBe(day);
  });

  it('weeks between two weeks, across a year with 53 weeks', () => {
    expect(weeksBetween('2026-W43', '2026-W44')).toBe(1);
    expect(weeksBetween('2026-W52', '2027-W01')).toBe(2);
    expect(weeksBetween('2020-W53', '2021-W01')).toBe(1);
    expect(weeksBetween('2026-W44', '2026-W44')).toBe(0);
  });
});

/** A Map behind the Storage methods used; it can refuse. */
class FakeStorage {
  items = new Map<string, string>();
  blocked = false;
  getItem(key: string) {
    if (this.blocked) throw new DOMException('blocked', 'SecurityError');
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    if (this.blocked) throw new DOMException('blocked', 'SecurityError');
    this.items.set(key, value);
  }
  removeItem(key: string) {
    if (this.blocked) throw new DOMException('blocked', 'SecurityError');
    this.items.delete(key);
  }
}

const KEY = 'usage:test';
// Wednesdays of consecutive ISO weeks (2026-W43 to W47), at noon on the device.
const WEEK = [new Date(2026, 9, 21, 12), new Date(2026, 9, 28, 12), new Date(2026, 10, 4, 12), new Date(2026, 10, 11, 12), new Date(2026, 10, 18, 12)];

/** The browser's surroundings, every one set by the test. `answers` are given in turn; a
 * held answer waits until `release` is called. */
function browser() {
  const storage = new FakeStorage();
  const sent: WeekSummary[][] = [];
  const settled: Settled[] = [];
  const env = { now: WEEK[0], installed: false, gpc: false, online: true, answer: 'taken' as Answer, lockRefused: false };
  let release: (answer: Answer) => void = () => {};
  let hold = false;
  let heldSend: () => void = () => {};
  // One task at a time, in order, as the browser's lock API runs them.
  let queue = Promise.resolve();
  const usage = createUsage({
    storage: () => storage as unknown as Storage,
    key: KEY,
    now: () => env.now,
    installed: () => env.installed,
    gpc: () => env.gpc,
    online: () => env.online,
    send: (weeks) => {
      sent.push(structuredClone(weeks));
      if (!hold) return Promise.resolve(env.answer);
      heldSend();
      return new Promise((resolve) => (release = resolve));
    },
    lock: (task) => {
      if (env.lockRefused) return Promise.reject(new DOMException('site data blocked', 'SecurityError'));
      const run = queue.then(task);
      queue = run.catch(() => {});
      return run;
    },
    settled: (outcome) => settled.push(outcome),
  });
  const kept = () => {
    const text = storage.items.get(KEY);
    return text === undefined ? undefined : JSON.parse(text);
  };
  return {
    usage,
    storage,
    sent,
    settled,
    env,
    kept,
    /** Holds the next answers; resolves once a summary is on its way. */
    holdAnswers: () => {
      hold = true;
      return new Promise<void>((resolve) => (heldSend = resolve));
    },
    release: (answer: Answer) => release(answer),
  };
}

describe('the weekly summary', () => {
  it("a new browser's first week: recorded here, nothing sent", async () => {
    const b = browser();
    await b.usage.open();
    await b.usage.open();
    expect(b.settled).toEqual(['nothing', 'nothing']);
    expect(b.sent).toEqual([]);
    expect(b.kept()).toEqual({ week: '2026-W43', days: 1, lastDay: '2026-10-21', installed: false, first: true, tools: [], pending: [] });
  });

  it("the next week's first opening sends last week's summary once, and forgets it", async () => {
    const b = browser();
    await b.usage.open();
    b.env.now = new Date(2026, 9, 22, 9); // the next day, same week
    await b.usage.open();
    b.env.now = WEEK[1];
    await b.usage.open();
    await b.usage.open();
    expect(b.sent).toEqual([[{ week: '2026-W43', days: 2, installed: false, first: true, tools: [] }]]);
    expect(b.settled).toEqual(['nothing', 'nothing', 'sent', 'nothing']);
    expect(b.kept()).toEqual({ week: '2026-W44', days: 1, lastDay: '2026-10-28', installed: false, first: false, tools: [], pending: [] });
  });

  it('a tool used many times is one tool in the week; using tools sends nothing', async () => {
    const b = browser();
    await b.usage.open();
    for (const tool of ['export', 'get-name', 'export', 'export']) await b.usage.use(tool);
    expect(b.sent).toEqual([]);
    b.env.now = WEEK[1];
    await b.usage.open();
    expect(b.sent[0][0].tools).toEqual(['export', 'get-name']);
  });

  it('opened as the installed app on any day of the week: installed', async () => {
    const b = browser();
    await b.usage.open();
    b.env.installed = true;
    b.env.now = new Date(2026, 9, 23, 12);
    await b.usage.open();
    b.env.installed = false;
    b.env.now = WEEK[1];
    await b.usage.open();
    expect(b.sent[0][0]).toMatchObject({ days: 2, installed: true });
  });

  it('a tool used on a later day of the week counts that day too', async () => {
    const b = browser();
    await b.usage.open();
    b.env.now = new Date(2026, 9, 24, 12);
    await b.usage.use('export');
    b.env.now = WEEK[1];
    await b.usage.open();
    expect(b.sent[0][0]).toMatchObject({ days: 2, tools: ['export'] });
  });

  it('offline at the new week: kept, then sent at the next opening online', async () => {
    const b = browser();
    await b.usage.open();
    b.env.now = WEEK[1];
    b.env.online = false;
    await b.usage.open();
    expect(b.settled).toEqual(['nothing', 'kept']);
    expect(b.sent).toEqual([]);
    b.env.online = true;
    await b.usage.open();
    expect(b.settled.at(-1)).toBe('sent');
    expect(b.sent).toEqual([[{ week: '2026-W43', days: 1, installed: false, first: true, tools: [] }]]);
  });

  it('no answer keeps the summary; a refusal drops it for good', async () => {
    const b = browser();
    await b.usage.open();
    b.env.now = WEEK[1];
    b.env.answer = 'failed';
    await b.usage.open();
    expect(b.kept().pending).toHaveLength(1);
    b.env.answer = 'refused';
    await b.usage.open();
    expect(b.settled).toEqual(['nothing', 'kept', 'dropped']);
    expect(b.kept().pending).toEqual([]);
    await b.usage.open();
    expect(b.sent).toHaveLength(2);
  });

  it('two weeks waiting go together; a summary more than two weeks old is dropped unsent', async () => {
    const b = browser();
    b.env.online = false;
    await b.usage.open(); // W43
    b.env.now = WEEK[1];
    await b.usage.open(); // W44: W43 waits
    b.env.now = WEEK[2];
    await b.usage.open(); // W45: W43 and W44 wait
    expect(b.kept().pending.map((s: WeekSummary) => s.week)).toEqual(['2026-W43', '2026-W44']);
    b.env.now = WEEK[3];
    await b.usage.open(); // W46: W43 is now three weeks old
    expect(b.kept().pending.map((s: WeekSummary) => s.week)).toEqual(['2026-W44', '2026-W45']);
    b.env.online = true;
    await b.usage.open();
    expect(b.sent.map((weeks) => weeks.map((s) => s.week))).toEqual([['2026-W44', '2026-W45']]);
  });

  it('a week with no opening sends no summary for it', async () => {
    const b = browser();
    await b.usage.open(); // W43
    b.env.now = WEEK[2]; // W44 skipped
    await b.usage.open();
    expect(b.sent.map((weeks) => weeks.map((s) => s.week))).toEqual([['2026-W43']]);
  });
});

describe('two tabs', () => {
  it("while one tab's summary is on its way, another tab sends nothing; the week goes once", async () => {
    const b = browser();
    await b.usage.open();
    b.env.now = WEEK[1];
    const onItsWay = b.holdAnswers();
    const first = b.usage.open(); // tab 1: holds the lock while its summary is out
    const second = b.usage.open(); // tab 2: waits for the lock
    const used = b.usage.use('export'); // a tool used meanwhile waits too
    await onItsWay;
    expect(b.sent).toHaveLength(1);
    expect(b.settled).toEqual(['nothing']);
    b.release('taken');
    await Promise.all([first, second, used]);
    expect(b.settled).toEqual(['nothing', 'sent', 'nothing']);
    expect(b.sent).toHaveLength(1);
    expect(b.kept()).toMatchObject({ week: '2026-W44', tools: ['export'], pending: [] });
  });
});

describe('what the review found', () => {
  it("turning counting off while a summary is on its way: the summary's answer doesn't undo it", async () => {
    const b = browser();
    await b.usage.open();
    b.env.now = WEEK[1];
    const onItsWay = b.holdAnswers();
    const opening = b.usage.open();
    await onItsWay;
    const switchedOff = b.usage.setOn(false); // waits its turn
    b.release('taken');
    await Promise.all([opening, switchedOff]);
    expect(b.kept()).toEqual({ off: true });
    b.env.now = WEEK[2];
    await b.usage.open();
    expect(b.settled.at(-1)).toBe('off');
    expect(b.sent).toHaveLength(1);
  });

  it('a clock moved back to an earlier week changes nothing: no week is ended early', async () => {
    const b = browser();
    b.env.now = WEEK[1];
    await b.usage.open();
    b.env.now = WEEK[0];
    await b.usage.open();
    expect(b.sent).toEqual([]);
    expect(b.kept()).toMatchObject({ week: '2026-W44', pending: [] });
  });

  it("storage that won't keep this week (full): nothing is sent, so nothing is sent twice", async () => {
    const b = browser();
    await b.usage.open();
    b.env.now = WEEK[1];
    const store = b.storage as unknown as { setItem: (key: string, value: string) => void };
    store.setItem = () => {
      throw new DOMException('full', 'QuotaExceededError');
    };
    await b.usage.open();
    await b.usage.open();
    expect(b.sent).toEqual([]);
    expect(b.settled).toEqual(['nothing', 'nothing', 'nothing']);
  });

  it('a browser that refuses the lock (site data blocked): the opening still decides, and nothing throws', async () => {
    const b = browser();
    b.env.lockRefused = true;
    await b.usage.open();
    await expect(b.usage.use('export')).resolves.toBeUndefined();
    await expect(b.usage.setOn(false)).resolves.toBeUndefined();
    expect(b.settled).toEqual(['off']);
    expect(b.sent).toEqual([]);
  });

  it('days are counted, not kept as dates, and never more than seven', async () => {
    const b = browser();
    for (let day = 0; day < 7; day++) {
      b.env.now = new Date(2026, 9, 19 + day, 12); // Monday to Sunday of 2026-W43
      await b.usage.open();
      await b.usage.open();
    }
    expect(b.kept()).toMatchObject({ days: 7, lastDay: '2026-10-25' });
    expect(JSON.stringify(b.kept())).not.toContain('2026-10-19');
    // A clock flipping between two days can't push it past seven (the server takes 1 to 7).
    for (let flip = 0; flip < 8; flip++) {
      b.env.now = new Date(2026, 9, flip % 2 === 0 ? 20 : 21, 12);
      await b.usage.open();
    }
    expect(b.kept()).toMatchObject({ days: 7 });
  });
});

describe('what the second review found', () => {
  it("Global Privacy Control doesn't erase the student's own off: with it gone, counting stays off", async () => {
    const b = browser();
    await b.usage.open();
    await b.usage.setOn(false);
    b.env.gpc = true;
    await b.usage.open();
    expect(b.kept()).toEqual({ off: true });
    b.env.gpc = false;
    expect(b.usage.isOn()).toBe(false);
  });

  it('a record from a clock once set more than a week ahead starts again from this week', async () => {
    const b = browser();
    b.env.now = new Date(2027, 9, 20, 12); // a year ahead
    await b.usage.open();
    await b.usage.use('export');
    b.env.now = WEEK[1]; // put right
    await b.usage.open();
    expect(b.kept()).toEqual({ week: '2026-W44', days: 1, lastDay: '2026-10-28', installed: false, first: false, tools: [], pending: [] });
    b.env.now = WEEK[2];
    await b.usage.open();
    expect(b.sent.map((weeks) => weeks.map((w) => w.week))).toEqual([['2026-W44']]);
  });

  it.each([
    [200, 'taken'],
    [204, 'taken'],
    [302, 'failed'],
    [400, 'refused'],
    [403, 'refused'],
    [404, 'failed'],
    [408, 'failed'],
    [413, 'refused'],
    [429, 'failed'],
    [500, 'failed'],
    [503, 'failed'],
  ] as const)('an answer of %i: %s', (status, answer) => {
    expect(answerFor(status)).toBe(answer);
  });

  it("without the lock API, one tab's tasks take turns, and a failed one doesn't stop the next", async () => {
    const inTurn = takeTurns();
    const order: string[] = [];
    let release: () => void = () => {};
    const first = inTurn(() => new Promise<void>((resolve) => (release = resolve)).then(() => void order.push('first')));
    const failing = inTurn(async () => {
      order.push('failing');
      throw new Error('no');
    });
    const last = inTurn(async () => void order.push('last'));
    await Promise.resolve();
    expect(order).toEqual([]);
    release();
    await first;
    await expect(failing).rejects.toThrow('no');
    await last;
    expect(order).toEqual(['first', 'failing', 'last']);
  });
});

describe('turning counting off', () => {
  it('Global Privacy Control: nothing recorded, nothing sent, and what was kept is forgotten', async () => {
    const b = browser();
    await b.usage.open();
    b.env.gpc = true;
    b.env.now = WEEK[1];
    await b.usage.open();
    await b.usage.use('export');
    expect(b.settled).toEqual(['nothing', 'off']);
    expect(b.sent).toEqual([]);
    expect(b.storage.items.size).toBe(0);
    expect(b.usage.isOn()).toBe(false);
  });

  it("About's switch off: what was kept is forgotten, and nothing is counted or sent; on again, it starts afresh", async () => {
    const b = browser();
    await b.usage.open();
    await b.usage.setOn(false);
    expect(b.kept()).toEqual({ off: true });
    expect(b.usage.isOn()).toBe(false);
    b.env.now = WEEK[1];
    await b.usage.open();
    await b.usage.use('export');
    expect(b.kept()).toEqual({ off: true });
    expect(b.settled).toEqual(['nothing', 'off']);
    await b.usage.setOn(true);
    expect(b.usage.isOn()).toBe(true);
    await b.usage.open();
    expect(b.kept()).toMatchObject({ week: '2026-W44', first: true, pending: [] });
    expect(b.sent).toEqual([]);
  });

  it('storage blocked or unreadable: nothing is thrown, and an unreadable record starts afresh', async () => {
    const b = browser();
    b.storage.blocked = true;
    await expect(b.usage.open()).resolves.toBeUndefined();
    await expect(b.usage.use('export')).resolves.toBeUndefined();
    await expect(b.usage.setOn(false)).resolves.toBeUndefined();
    b.storage.blocked = false;
    b.storage.items.set(KEY, '{"week": 3}');
    await b.usage.open();
    expect(b.kept()).toMatchObject({ week: '2026-W43', first: true });
  });
});

describe('the counted tools', () => {
  const SRC = fileURLToPath(new URL('..', import.meta.url));
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return files(path);
      return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
    });
  const calls = files(SRC).flatMap((path) =>
    [...readFileSync(path, 'utf8').matchAll(/countUse\(([^)]*)\)/g)].map((match) => ({ file: relative(SRC, path), arg: match[1] })),
  );

  it('every counted tool is counted somewhere, by its name written out; nothing else is', () => {
    const named = calls.filter((call) => call.file !== 'usage/start.ts');
    expect(named.every((call) => /^'[a-z0-9-]+'$/.test(call.arg))).toBe(true);
    expect(new Set(named.map((call) => call.arg.slice(1, -1)))).toEqual(new Set(TOOLS));
  });

  it("Practice isn't counted (its plan: it stores nothing and sends nothing)", () => {
    expect(TOOLS.some((tool) => tool.includes('practice'))).toBe(false);
    expect(calls.filter((call) => /practice/i.test(call.file))).toEqual([]);
  });

  it('names are unique and fit what the server takes', () => {
    expect(new Set(TOOLS).size).toBe(TOOLS.length);
    expect(TOOLS.every((tool) => /^[a-z0-9-]{1,40}$/.test(tool))).toBe(true);
  });
});
