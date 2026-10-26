import { registerSW } from 'virtual:pwa-register';

// Registers the service worker that precaches the whole app (including both WebAssembly
// engines) so it works offline. Prompt mode: when a new build is ready, the update banner
// appears and nothing else happens. Only the student's click on its Reload button
// (applyUpdate) lets the new build take over and reloads the page. The drawing is
// autosaved on every change, so that reload loses nothing.
//
// The browser looks for a new build (a changed sw.js) by itself only when the app is opened
// or refreshed. So that an app kept open through a lab finds one too, it asks again when the
// student comes back to it and when the device comes back online. No timer: Jeff chose
// events only (docs/plans/update-check.md).

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

function showUpdateBanner(): void {
  if (updateReady) return;
  updateReady = true;
  listeners.forEach((listener) => listener());
}

export function registerServiceWorker(): void {
  updateSW = registerSW({
    immediate: true,
    onNeedRefresh: showUpdateBanner,
    onNeedReload() {
      // Called when a new build takes over this page, e.g. after the student clicked
      // Reload in another tab. Without this handler the plugin reloads the page here;
      // this tab keeps its banner and reloads when its own Reload is clicked.
    },
    onOfflineReady() {
      document.documentElement.dataset.offlineReady = 'true';
    },
    onRegisteredSW(_swUrl: string, registration: ServiceWorkerRegistration | undefined) {
      if (registration) checkWhenBack(registration);
      window.dispatchEvent(new Event('sw-registered'));
    },
    onRegisterError(error: unknown) {
      window.dispatchEvent(new CustomEvent('sw-error', { detail: String(error) }));
    },
  });
}

/** Check for a new build when the student comes back to the app (another tab or window, a
 * minimised window, a closed lid) and when the device comes back online. Each check is one
 * request for sw.js. */
function checkWhenBack(registration: ServiceWorkerRegistration): void {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void checkForUpdate(registration);
  });
  window.addEventListener('online', () => void checkForUpdate(registration));
}

/** Fetch sw.js; if it changed, let the new build install; then show the banner if a build
 * is waiting. onNeedRefresh can't be trusted for this: workbox-window stops listening for
 * good after its second new build, or its first one more than a minute after the page
 * opened, so one failed install (a download cut off) would hide every later build
 * (update.spec.ts shows it). A check that can't reach the server shows nothing, and the
 * next one tries again. Tests wait for sw-update-checked. */
async function checkForUpdate(registration: ServiceWorkerRegistration): Promise<void> {
  try {
    await registration.update();
    await installSettled(registration.installing);
  } catch {
    // Offline, or the server unreachable.
  }
  // Waiting behind the running build. The first install also passes through waiting, with
  // nothing running yet, on its way to activating by itself; that is not an update.
  if (registration.waiting && registration.active) showUpdateBanner();
  window.dispatchEvent(new Event('sw-update-checked'));
}

/** Resolves once a new build has installed, or failed to. */
function installSettled(worker: ServiceWorker | null): Promise<void> {
  return new Promise((resolve) => {
    const check = () => {
      if (worker?.state !== 'parsed' && worker?.state !== 'installing') resolve();
    };
    worker?.addEventListener('statechange', check);
    check();
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
