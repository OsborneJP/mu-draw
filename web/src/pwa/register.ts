import { registerSW } from 'virtual:pwa-register';

// Registers the service worker that precaches the whole app (including both WebAssembly
// engines) so it works offline. Prompt mode: when a new build is ready, nothing happens
// until the student clicks the update banner (a v1 feature still to come). Never call the
// returned updateSW() without that click; it would reload the page mid-drawing.
export function registerServiceWorker(): void {
  registerSW({
    immediate: true,
    onNeedRefresh() {
      // The "An update is ready. Reload to use it." banner will hook in here.
    },
    onNeedReload() {
      // Without this handler the plugin reloads the page when a new worker takes control.
    },
    onOfflineReady() {
      document.documentElement.dataset.offlineReady = 'true';
    },
    onRegisteredSW() {
      window.dispatchEvent(new Event('sw-registered'));
    },
    onRegisterError(error: unknown) {
      window.dispatchEvent(new CustomEvent('sw-error', { detail: String(error) }));
    },
  });
}
