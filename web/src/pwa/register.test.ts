import { beforeEach, expect, it, vi } from 'vitest';

const updateSW = vi.fn();
const registerSW = vi.fn<(options: unknown) => typeof updateSW>(() => updateSW);
vi.mock('virtual:pwa-register', () => ({ registerSW }));

beforeEach(() => {
  updateSW.mockClear();
  registerSW.mockClear();
  vi.stubGlobal('document', { documentElement: { dataset: {} } });
  vi.stubGlobal('window', { dispatchEvent: vi.fn() });
});

it('never reloads or activates a new build by itself', async () => {
  const { registerServiceWorker } = await import('./register');
  registerServiceWorker();
  expect(registerSW).toHaveBeenCalledTimes(1);
  const options = registerSW.mock.calls[0][0] as Record<string, () => void>;
  // Without onNeedReload the plugin reloads the page when a new worker takes control.
  expect(typeof options.onNeedReload).toBe('function');
  options.onNeedRefresh();
  options.onNeedReload();
  options.onOfflineReady();
  expect(updateSW).not.toHaveBeenCalled();
});
