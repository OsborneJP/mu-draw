import { beforeEach, expect, it, vi } from 'vitest';

const updateSW = vi.fn(async () => {});
const registerSW = vi.fn<(options: unknown) => typeof updateSW>(() => updateSW);
vi.mock('virtual:pwa-register', () => ({ registerSW }));

const reload = vi.fn();
let registration: { waiting: FakeWorker | null } | undefined;

/** A service worker whose state changes only when the test says so. */
class FakeWorker extends EventTarget {
  state: ServiceWorkerState;
  constructor(state: ServiceWorkerState = 'installed') {
    super();
    this.state = state;
  }
  become(state: ServiceWorkerState) {
    this.state = state;
    this.dispatchEvent(new Event('statechange'));
  }
}

/** A registration whose update() answers only when the test says so: the browser's check
 * for a changed sw.js. A build is already running. */
class FakeRegistration extends EventTarget {
  installing: FakeWorker | null = null;
  waiting: FakeWorker | null = null;
  active: FakeWorker | null = new FakeWorker('activated');
  private answers: { resolve: () => void; reject: (error: Error) => void }[] = [];
  update = vi.fn(() => new Promise<void>((resolve, reject) => this.answers.push({ resolve, reject })));
  /** sw.js has not changed. */
  unchanged() {
    this.answers.shift()!.resolve();
  }
  /** sw.js has changed: the new build starts installing. */
  changed(): FakeWorker {
    const worker = new FakeWorker('installing');
    this.installing = worker;
    this.answers.shift()!.resolve();
    return worker;
  }
  /** The check can't reach the server (offline). */
  unreachable() {
    this.answers.shift()!.reject(new TypeError('Failed to update a ServiceWorker'));
  }
  /** The new build has installed and waits (or, with nothing running, is about to activate). */
  installed(worker: FakeWorker) {
    this.installing = null;
    this.waiting = worker;
    worker.become('installed');
  }
  /** The new build's install failed, e.g. its download was cut off. */
  failed(worker: FakeWorker) {
    this.installing = null;
    worker.become('redundant');
  }
}

/** The page, which the student can leave and come back to. */
class FakeDocument extends EventTarget {
  documentElement = { dataset: {} };
  visibilityState: DocumentVisibilityState = 'visible';
}
let page: FakeDocument;
let win: EventTarget;
const checked = vi.fn();

/** The student switches away from the app, or back to it. */
function show(state: DocumentVisibilityState) {
  page.visibilityState = state;
  page.dispatchEvent(new Event('visibilitychange'));
}

/** Let the code under test run as far as it can: every pending promise callback runs
 * before Node's next setImmediate callback. Nothing else (no timer, no event) is pending in
 * these tests, so this is not a wait. (Node's setImmediate: this file is typed for the
 * browser.) */
const settle = () =>
  new Promise<void>((resolve) =>
    (globalThis as unknown as { setImmediate(run: () => void): void }).setImmediate(resolve),
  );

beforeEach(() => {
  vi.resetModules(); // fresh banner state for each test
  updateSW.mockClear();
  registerSW.mockClear();
  reload.mockClear();
  checked.mockClear();
  registration = undefined;
  page = new FakeDocument();
  win = Object.assign(new EventTarget(), { location: { reload } });
  win.addEventListener('sw-update-checked', checked);
  vi.stubGlobal('document', page);
  vi.stubGlobal('window', win);
  vi.stubGlobal('navigator', { serviceWorker: { getRegistration: async () => registration } });
});

type Options = Record<string, (...args: unknown[]) => void>;

async function start() {
  const register = await import('./register');
  register.registerServiceWorker();
  expect(registerSW).toHaveBeenCalledTimes(1);
  return { register, options: registerSW.mock.calls[0][0] as Options };
}

/** Start, and let the plugin hand over the registration, as it does once registered. */
async function startWatching() {
  const started = await start();
  const watched = new FakeRegistration();
  started.options.onRegisteredSW('sw.js', watched);
  return { ...started, watched };
}

it('never reloads or activates a new build by itself', async () => {
  const { options } = await start();
  // Without onNeedReload the plugin reloads the page when a new worker takes control.
  expect(typeof options.onNeedReload).toBe('function');
  options.onNeedRefresh();
  options.onNeedReload();
  options.onOfflineReady();
  expect(updateSW).not.toHaveBeenCalled();
  expect(reload).not.toHaveBeenCalled();
});

it('a waiting build shows the banner', async () => {
  const { register, options } = await start();
  const listener = vi.fn();
  register.subscribeUpdateReady(listener);
  expect(register.isUpdateReady()).toBe(false);
  options.onNeedRefresh();
  expect(register.isUpdateReady()).toBe(true);
  expect(listener).toHaveBeenCalledTimes(1);
});

it('Reload: the waiting build takes over, and the page reloads once it is active', async () => {
  const { register } = await start();
  const waiting = new FakeWorker();
  registration = { waiting };
  const clicked = register.applyUpdate();
  await settle();
  expect(updateSW).toHaveBeenCalledTimes(1);
  expect(reload).not.toHaveBeenCalled();
  waiting.become('activating');
  await settle();
  expect(reload).not.toHaveBeenCalled();
  waiting.become('activated');
  await clicked;
  expect(reload).toHaveBeenCalledTimes(1);
});

it('Reload after another tab already switched to the new build: reloads at once', async () => {
  const { register } = await start();
  registration = { waiting: null };
  await register.applyUpdate();
  expect(updateSW).not.toHaveBeenCalled();
  expect(reload).toHaveBeenCalledTimes(1);
});

it('Reload when the waiting build is replaced by a newer one: still reloads', async () => {
  const { register } = await start();
  const waiting = new FakeWorker();
  registration = { waiting };
  const clicked = register.applyUpdate();
  await settle();
  waiting.become('redundant');
  await clicked;
  expect(reload).toHaveBeenCalledTimes(1);
});

it('coming back to the app checks for a new build; leaving it does not', async () => {
  const { watched } = await startWatching();
  show('hidden');
  expect(watched.update).not.toHaveBeenCalled();
  show('visible');
  expect(watched.update).toHaveBeenCalledTimes(1);
});

it('coming back online checks for a new build', async () => {
  const { watched } = await startWatching();
  win.dispatchEvent(new Event('online'));
  expect(watched.update).toHaveBeenCalledTimes(1);
});

it('with no registration, nothing is checked', async () => {
  const { options } = await start();
  options.onRegisteredSW('sw.js', undefined);
  show('visible');
  win.dispatchEvent(new Event('online'));
  await settle();
  expect(checked).not.toHaveBeenCalled();
});

it('a new build found on coming back shows the banner once it has installed, and nothing reloads', async () => {
  const { register, watched } = await startWatching();
  const listener = vi.fn();
  register.subscribeUpdateReady(listener);
  show('visible');
  const worker = watched.changed();
  await settle();
  // Still downloading: no banner yet, and the check isn't over.
  expect(register.isUpdateReady()).toBe(false);
  expect(checked).not.toHaveBeenCalled();
  watched.installed(worker);
  await settle();
  expect(register.isUpdateReady()).toBe(true);
  expect(listener).toHaveBeenCalledTimes(1);
  expect(checked).toHaveBeenCalledTimes(1);
  expect(updateSW).not.toHaveBeenCalled();
  expect(reload).not.toHaveBeenCalled();
});

it('a new build that fails to install shows nothing', async () => {
  const { register, watched } = await startWatching();
  show('visible');
  watched.failed(watched.changed());
  await settle();
  expect(register.isUpdateReady()).toBe(false);
  expect(checked).toHaveBeenCalledTimes(1);
});

it('an unchanged sw.js shows nothing', async () => {
  const { register, watched } = await startWatching();
  show('visible');
  watched.unchanged();
  await settle();
  expect(register.isUpdateReady()).toBe(false);
  expect(checked).toHaveBeenCalledTimes(1);
});

it('a build already waiting shows the banner, whoever found it', async () => {
  // e.g. another tab's check, which workbox-window in this tab may no longer report.
  const { register, watched } = await startWatching();
  watched.waiting = new FakeWorker('installed');
  show('visible');
  watched.unchanged();
  await settle();
  expect(register.isUpdateReady()).toBe(true);
});

it('the first install, with no build running yet, is not an update', async () => {
  const { register, watched } = await startWatching();
  watched.active = null;
  const first = new FakeWorker('installing');
  watched.installing = first;
  show('visible');
  watched.unchanged();
  await settle();
  expect(checked).not.toHaveBeenCalled();
  watched.installed(first);
  await settle();
  expect(register.isUpdateReady()).toBe(false);
  expect(checked).toHaveBeenCalledTimes(1);
});

it("a check that can't reach the server shows nothing, and the next one still runs", async () => {
  // Vitest fails the run on an unhandled rejection, so the failure must be caught.
  const { register, watched } = await startWatching();
  show('visible');
  watched.unreachable();
  await settle();
  expect(register.isUpdateReady()).toBe(false);
  expect(checked).toHaveBeenCalledTimes(1);
  win.dispatchEvent(new Event('online'));
  expect(watched.update).toHaveBeenCalledTimes(2);
});
