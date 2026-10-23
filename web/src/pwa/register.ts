import { registerSW } from 'virtual:pwa-register';

// Registers the service worker that precaches the whole app (including both WebAssembly
// engines) so it works offline. Prompt mode: when a new build is ready, the update banner
// appears and nothing else happens. Only the student's click on its Reload button
// (applyUpdate) lets the new build take over and reloads the page. The drawing is
// autosaved on every change, so that reload loses nothing.

let updateSW: (() => Promise<void>) | undefined;

// Whether the banner shows.
let updateReady = false;
const listeners = new Set<() => void>();

export function isUpdateReady(): boolean {
  return updateReady;
}

export function subscribeUpdateReady(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function registerServiceWorker(): void {
  updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      updateReady = true;
      listeners.forEach((listener) => listener());
    },
    onNeedReload() {
      // Called when a new build takes over this page, e.g. after the student clicked
      // Reload in another tab. Without this handler the plugin reloads the page here;
      // this tab keeps its banner and reloads when its own Reload is clicked.
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

/** The banner's Reload button, and nothing else, calls this. In vite-plugin-pwa 2.0,
 * updateSW() only tells the waiting build to take over (the reload would come from
 * onNeedReload), so the reload happens here, once the new build is active and will serve
 * the page. If another tab already made it active, there is nothing to wait for. */
export async function applyUpdate(): Promise<void> {
  const registration = await navigator.serviceWorker.getRegistration();
  const waiting = registration?.waiting;
  if (waiting) {
    const settled = new Promise<void>((resolve) => {
      const check = () => {
        if (waiting.state === 'activated' || waiting.state === 'redundant') resolve();
      };
      waiting.addEventListener('statechange', check);
      check();
    });
    await updateSW?.();
    await settled;
  }
  window.location.reload();
}
