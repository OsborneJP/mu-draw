import { NAMING_DEADLINE_MS } from '../api';
import { runningInstalled } from '../pwa/displayMode';
import { idbStore } from './idbStore';
import { answerFor, createUsage, takeTurns, type Answer, type WeekSummary } from './usage';

// The app's anonymous usage counts (usage.ts; docs/plans/v2-usage-counts.md), started from
// main.tsx. Each decision is announced, as a usage-settled event and on the page's root element
// as data-usage="<n> <outcome>", so a test waits for the decision instead of waiting for time.
const BASE = import.meta.env.BASE_URL;
let decisions = 0;

/** One POST of the waiting summaries: no cookie (other apps on this host may set one), no
 * referrer, nothing in the URL, and no redirect followed (a network's sign-in page isn't the
 * server). Gives up after the naming deadline, so a server that never answers can't hold the
 * other tabs' lock. The answer is read by answerFor (usage.ts). */
async function send(weeks: WeekSummary[]): Promise<Answer> {
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), NAMING_DEADLINE_MS);
  try {
    const response = await fetch(`${BASE}api/count`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ weeks }),
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      cache: 'no-store',
      redirect: 'error',
      signal: deadline.signal,
    });
    return answerFor(response.status);
  } catch {
    return 'failed';
  } finally {
    clearTimeout(timer);
  }
}

// One tab at a time records or sends: the browser's lock, or where it has none, this tab's
// own turn-taking (so a send can't overlap another in the same tab).
const thisTabInTurn = takeTurns();

// The build before kept the record in localStorage under this key: its "off" still holds, and
// stays there for that build's tabs (usage.ts offInOldBuild).
const OLD_KEY = `usage:${BASE}`;

export const usage = createUsage({
  store: idbStore(`usage:${BASE}`),
  oldRecord: () => window.localStorage.getItem(OLD_KEY),
  forgetOldRecord: () => window.localStorage.removeItem(OLD_KEY),
  oldRecordOff: () => window.localStorage.setItem(OLD_KEY, JSON.stringify({ off: true })),
  now: () => new Date(),
  installed: runningInstalled,
  gpc: () => (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl === true,
  online: () => navigator.onLine,
  send,
  lock: (task) => ('locks' in navigator ? navigator.locks.request(`usage:${BASE}`, task) : thisTabInTurn(task)),
  settled: (outcome) => {
    decisions += 1;
    document.documentElement.dataset.usage = `${decisions} ${outcome}`;
    window.dispatchEvent(new CustomEvent('usage-settled', { detail: outcome }));
  },
});

/** Counts at this opening, and again when the student comes back to the app or it comes back
 * online: a new week may have begun, or a waiting summary can go now. */
export function startUsage(): void {
  void usage.open();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void usage.open();
  });
  window.addEventListener('online', () => void usage.open());
}

/** Records, in this browser only, that a counted tool (events.json) was used this week. */
export function countUse(tool: string): void {
  void usage.use(tool);
}
