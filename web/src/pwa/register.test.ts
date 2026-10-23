import { beforeEach, expect, it, vi } from 'vitest';

const updateSW = vi.fn(async () => {});
const registerSW = vi.fn<(options: unknown) => typeof updateSW>(() => updateSW);
vi.mock('virtual:pwa-register', () => ({ registerSW }));

const reload = vi.fn();
let registration: { waiting: FakeWorker | null } | undefined;

/** A service worker whose state changes only when the test says so. */
class FakeWorker extends EventTarget {
  state: ServiceWorkerState = 'installed';
  become(state: ServiceWorkerState) {
    this.state = state;
    this.dispatchEvent(new Event('statechange'));
  }
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
  registration = undefined;
  vi.stubGlobal('document', { documentElement: { dataset: {} } });
  vi.stubGlobal('window', { dispatchEvent: vi.fn(), location: { reload } });
  vi.stubGlobal('navigator', { serviceWorker: { getRegistration: async () => registration } });
});

async function start() {
  const register = await import('./register');
  register.registerServiceWorker();
  expect(registerSW).toHaveBeenCalledTimes(1);
  return { register, options: registerSW.mock.calls[0][0] as Record<string, () => void> };
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
