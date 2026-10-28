// Anonymous weekly usage counts (docs/plans/v2-usage-counts.md). The browser keeps a summary
// of the current week in its own storage: which days the app was open, whether as the
// installed app, whether this is the browser's first week, and which tools were used. Using a
// tool only updates that summary. At the first opening in a new week, the summary of the week
// before is sent, once, with no cookie and no referrer, and forgotten; the server only adds it
// to weekly totals. Global Privacy Control, or About's switch, turns all of it off and
// forgets what was kept. One tab at a time records or sends (the browser's lock API), and the
// record is kept where every tab reads the last write (IndexedDB, idbStore.ts), so a week is
// sent once however many tabs are open.
import events from './events.json';

/** The counted tools. Append-only: a name is never reused or removed (server/usage_events.json
 * is a copy, and the server ignores names it doesn't know). */
export const TOOLS: readonly string[] = events.tools;

export interface WeekSummary {
  week: string;
  days: number;
  installed: boolean;
  first: boolean;
  tools: string[];
}

/** The current week, and ended weeks not sent yet. Only a count of days and the last one is
 * kept, not the dates: other apps on this host can read this browser's storage for it. */
interface Kept {
  week: string;
  days: number;
  lastDay: string;
  installed: boolean;
  first: boolean;
  tools: string[];
  pending: WeekSummary[];
}

/** What one opening decided: a summary sent; kept to send later (offline, or no answer);
 * dropped (the server refused it); nothing to send; or counting is off. */
export type Settled = 'sent' | 'kept' | 'dropped' | 'nothing' | 'off';

/** The server's answer to a summary: taken, refused (a 4xx: never sent again), or none. */
export type Answer = 'taken' | 'refused' | 'failed';

/** Ended weeks older than this are dropped, sent or not. */
const KEEP_WEEKS = 2;

/** The server's answer to a summary, by its status: taken (2xx); kept for next time (a
 * redirect, such as a network's sign-in page, 404 while the API isn't restarted yet, 408, 429,
 * 5xx); or refused for good (any other 4xx). */
export function answerFor(status: number): Answer {
  if (status >= 200 && status < 300) return 'taken';
  if (status >= 400 && status < 500 && ![404, 408, 429].includes(status)) return 'refused';
  return 'failed';
}

/** Turn-taking within one tab, for a browser without the lock API. */
export function takeTurns(): (task: () => Promise<void>) => Promise<void> {
  let turns = Promise.resolve();
  return (task) => {
    const run = turns.then(task);
    turns = run.catch(() => {});
    return run;
  };
}

/** Where the record is kept: one value, read and written whole. A write resolves once it is
 * committed, so the next tab to take the lock reads it; localStorage can't promise that
 * (docs/plans/v2-usage-counts.md, revision of 2026-10-28). */
export interface Store {
  /** The value, or undefined if none. */
  get(): Promise<unknown>;
  set(value: unknown): Promise<void>;
  remove(): Promise<void>;
}

export interface UsageDeps {
  store: Store;
  /** The record as the build before kept it (localStorage, as JSON), or null. Its tabs read
   * only that, so an "off" is kept there for them (docs/plans/v2-usage-counts.md, bar R.2). */
  oldRecord: () => string | null;
  forgetOldRecord: () => void;
  /** Writes "off" where the build before's tabs read it. */
  oldRecordOff: () => void;
  now: () => Date;
  /** Running as the installed app. */
  installed: () => boolean;
  /** The browser sends Global Privacy Control. */
  gpc: () => boolean;
  online: () => boolean;
  send: (weeks: WeekSummary[]) => Promise<Answer>;
  /** Runs `task` while no other tab of this build runs one. */
  lock: (task: () => Promise<void>) => Promise<void>;
  settled: (outcome: Settled) => void;
}

export interface Usage {
  /** Called at each opening, and when the student comes back to the app or it comes back online. */
  open(): Promise<void>;
  /** Records that a counted tool was used (in this browser only). */
  use(tool: string): Promise<void>;
  /** Whether counting is on, read in turn: false with Global Privacy Control, after About's
   * switch, or if the record (or the lock) can't be had. */
  isOn(): Promise<boolean>;
  /** About's switch. Off forgets everything kept; on starts afresh. It waits its turn behind a
   * summary on its way, so the summary's answer can't undo it. */
  setOn(on: boolean): Promise<void>;
}

/** The ISO week (`YYYY-Www`) that `date` falls in, by the device's own calendar. */
export function isoWeek(date: Date): string {
  const thursday = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  thursday.setUTCDate(thursday.getUTCDate() + 3 - ((thursday.getUTCDay() + 6) % 7));
  const year = thursday.getUTCFullYear();
  const week = 1 + Math.floor((thursday.getTime() - Date.UTC(year, 0, 1)) / (7 * 86_400_000));
  return `${year}-W${String(week).padStart(2, '0')}`;
}

/** Weeks from `earlier` to `later`, both `YYYY-Www`. */
export function weeksBetween(earlier: string, later: string): number {
  return Math.round((monday(later) - monday(earlier)) / (7 * 86_400_000));
}

function monday(week: string): number {
  const [year, number] = week.split('-W').map(Number);
  const jan4 = Date.UTC(year, 0, 4);
  const jan4Weekday = (new Date(jan4).getUTCDay() + 6) % 7;
  return jan4 - jan4Weekday * 86_400_000 + (number - 1) * 7 * 86_400_000;
}

/** The device's own date, `YYYY-MM-DD`. */
export function localDay(date: Date): string {
  const two = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`;
}

export function createUsage(deps: UsageDeps): Usage {
  /** The kept summaries, 'off' if the student turned counting off, null if none (or not a
   * record), or 'unreadable' if the store failed: then nothing may be written over it. */
  async function read(): Promise<Kept | 'off' | null | 'unreadable'> {
    let value: unknown;
    try {
      value = await deps.store.get();
    } catch {
      return 'unreadable';
    }
    if (isOff(value)) return 'off';
    return isKept(value) ? value : null;
  }

  /** Whether it was stored and committed (storage can be blocked or full). */
  async function write(value: Kept | 'off'): Promise<boolean> {
    try {
      await deps.store.set(value === 'off' ? { off: true } : value);
      return true;
    } catch {
      return false;
    }
  }

  async function forget(): Promise<void> {
    try {
      await deps.store.remove();
    } catch {
      // Storage blocked: nothing was kept.
    }
  }

  /** The build before's record: undefined if there is none (or its storage is blocked), null
   * if it isn't JSON, otherwise its value. */
  function oldRecord(): unknown {
    let text: string | null;
    try {
      text = deps.oldRecord();
    } catch {
      return undefined;
    }
    if (text === null) return undefined;
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return null;
    }
  }

  function forgetOldRecord(): void {
    try {
      deps.forgetOldRecord();
    } catch {
      // Storage blocked: nothing kept there.
    }
  }

  /** The build before's record (`old`), in the lock's turn; true if counting is off there. Its
   * week isn't carried over: that build counted only from its first week, which this record
   * holds the same (newHere() keeps whether it was new). Its "off" counts here too, and forgets
   * what is kept here, as its own switch forgot; only the switch removes it (that build's tabs
   * read only that key). Its record goes once its week has passed: a tab of that build may be
   * counting with it until then, and removing it sooner could erase an "off" that tab had just
   * written but this tab's localStorage doesn't show yet. */
  async function offInOldBuild(old: unknown): Promise<boolean> {
    if (old === undefined) return false;
    if (isOff(old)) {
      const here = await read();
      if (here !== null && here !== 'off' && here !== 'unreadable') await forget();
      return true;
    }
    if (!isKept(old) || weeksBetween(old.week, isoWeek(deps.now())) > 0) forgetOldRecord();
    return false;
  }

  /** Whether a record started here is a new browser's: not if the build before's record (`old`)
   * shows it counted this browser in an earlier week. */
  function newHere(old: unknown): boolean {
    return !isKept(old) || (old.first && old.week === isoWeek(deps.now()));
  }

  /** This week's summary, the week before moved to the waiting ones, today recorded. A clock
   * moved back into last week changes nothing: the week only moves on. A record from more than
   * a week ahead came from a clock set wrong: it starts again from this week. `first` is for a
   * record started from nothing. */
  function today(kept: Kept | null, first = true): Kept {
    const now = deps.now();
    const week = isoWeek(now);
    const day = localDay(now);
    let current = kept ?? { week, days: 0, lastDay: '', installed: false, first, tools: [], pending: [] };
    if (weeksBetween(week, current.week) > 1) {
      current = { week, days: 0, lastDay: '', installed: false, first: false, tools: [], pending: [] };
    } else if (weeksBetween(current.week, week) > 0) {
      const ended = current.days > 0 ? [summary(current)] : [];
      current = { week, days: 0, lastDay: '', installed: false, first: false, tools: [], pending: [...current.pending, ...ended] };
    }
    return {
      ...current,
      days: current.lastDay === day ? current.days : Math.min(current.days + 1, 7),
      lastDay: day,
      installed: current.installed || deps.installed(),
      pending: current.pending.filter((ended) => weeksBetween(ended.week, current.week) <= KEEP_WEEKS),
    };
  }

  /** Runs `task` in turn; if the browser refuses its lock (site data blocked), nothing is
   * counted and `refused` runs instead. */
  async function inTurn(task: () => Promise<void>, refused: () => void): Promise<void> {
    try {
      await deps.lock(task);
    } catch {
      refused();
    }
  }

  return {
    async open() {
      await inTurn(
        async () => {
          if (deps.gpc()) {
            // Forget what was counted, but not the student's own "off", which must outlast it.
            const old = oldRecord();
            if (old !== undefined && !isOff(old)) forgetOldRecord();
            const here = await read();
            if (here !== 'off' && here !== 'unreadable') await forget();
            return deps.settled('off');
          }
          const old = oldRecord();
          if (await offInOldBuild(old)) return deps.settled('off');
          const kept = await read();
          if (kept === 'unreadable') return deps.settled('nothing');
          if (kept === 'off') return deps.settled('off');
          const current = today(kept, newHere(old));
          // Unless the browser holds this week, nothing can be sent: it couldn't remember that
          // it was, and would send it again at every opening.
          if (!(await write(current))) return deps.settled('nothing');
          if (current.pending.length === 0) return deps.settled('nothing');
          if (!deps.online()) return deps.settled('kept');
          const answer = await deps.send(current.pending);
          if (answer === 'failed') return deps.settled('kept');
          // Tool uses and the switch wait their turn, so nothing changed meanwhile; without the
          // lock API another tab may have turned counting off, which this mustn't undo.
          const now = await read();
          if (now !== 'off' && now !== 'unreadable') await write({ ...current, pending: [] });
          deps.settled(answer === 'taken' ? 'sent' : 'dropped');
        },
        () => deps.settled('off'),
      );
    },
    async use(tool) {
      if (deps.gpc()) return;
      await inTurn(
        async () => {
          const old = oldRecord();
          if (await offInOldBuild(old)) return;
          const kept = await read();
          if (kept === 'off' || kept === 'unreadable') return;
          const current = today(kept, newHere(old));
          await write(current.tools.includes(tool) ? current : { ...current, tools: [...current.tools, tool] });
        },
        () => {},
      );
    },
    async isOn() {
      if (deps.gpc()) return false;
      // In turn, so it reads what a summary on its way, or the switch, leaves.
      let on = false;
      await inTurn(
        async () => {
          if (isOff(oldRecord())) return;
          const kept = await read();
          on = kept !== 'off' && kept !== 'unreadable';
        },
        () => {},
      );
      return on;
    },
    async setOn(on) {
      await inTurn(
        async () => {
          if (on) {
            await forget();
            forgetOldRecord();
            return;
          }
          // Off in both places, so the build before's tabs stop too; either one holds it.
          await write('off');
          try {
            deps.oldRecordOff();
          } catch {
            // Storage blocked: the build before's tabs can't count either.
          }
        },
        () => {},
      );
    },
  };
}

function summary(kept: Kept): WeekSummary {
  return { week: kept.week, days: kept.days, installed: kept.installed, first: kept.first, tools: kept.tools };
}

function isOff(value: unknown): boolean {
  return typeof value === 'object' && value !== null && (value as { off?: unknown }).off === true;
}

function isKept(value: unknown): value is Kept {
  if (typeof value !== 'object' || value === null) return false;
  const kept = value as Record<string, unknown>;
  return (
    typeof kept.week === 'string' &&
    typeof kept.days === 'number' &&
    typeof kept.lastDay === 'string' &&
    typeof kept.installed === 'boolean' &&
    typeof kept.first === 'boolean' &&
    isStrings(kept.tools) &&
    Array.isArray(kept.pending) &&
    kept.pending.every(isSummary)
  );
}

function isSummary(value: unknown): value is WeekSummary {
  if (typeof value !== 'object' || value === null) return false;
  const ended = value as Record<string, unknown>;
  return (
    typeof ended.week === 'string' &&
    typeof ended.days === 'number' &&
    typeof ended.installed === 'boolean' &&
    typeof ended.first === 'boolean' &&
    isStrings(ended.tools)
  );
}

function isStrings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}
