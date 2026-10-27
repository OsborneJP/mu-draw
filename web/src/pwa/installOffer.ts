// The offer to install the app (docs/plans/v2-install-prompt.md). Chrome and Edge tell a page
// it can be installed with a beforeinstallprompt event, and only when it can be installed in
// that browser, isn't installed there already and isn't running as the installed app. The
// app keeps the event; the student's click calls its prompt(), which opens the browser's own
// install dialog. So nothing here names a browser or describes a menu, and the offer keeps
// working however browsers redesign theirs. Safari and Firefox send no event: nothing shows.

/** Chrome's event, which TypeScript's DOM types don't have. */
export interface InstallPromptEvent extends Event {
  prompt(): Promise<unknown>;
}

export interface InstallState {
  /** The browser's offer is held, so Install can be pressed (About shows its button). */
  offered: boolean;
  /** The strip under the header shows: an offer is held, the student hasn't said Not now, and
   * hasn't already pressed Install on this visit. */
  strip: boolean;
}

export interface InstallOffer {
  subscribe(listener: () => void): () => void;
  /** The same object until something changes (React's useSyncExternalStore needs that). */
  getState(): InstallState;
  /** Opens the browser's install dialog: call it straight from the click, which the browser
   * requires. The offer is used up whatever the student answers. If they cancel, Chrome offers
   * again at once: About takes that offer, but the strip stays away until the next visit.
   * Nothing is remembered. */
  install(): void;
  /** Hides the strip in this browser for good, in every open tab of this build. About still
   * offers Install. */
  notNow(): void;
}

/** Where Not now is remembered: per build, as staging and production share the site's storage. */
export function notNowKey(base: string): string {
  return `install-not-now:${base}`;
}

/** Listens on `events` (the window) for the browser's offer, its installed event and other
 * tabs' Not now. When `standalone` (running as the installed app) it never offers. */
export function createInstallOffer(
  events: EventTarget,
  storage: () => Storage,
  key: string,
  standalone: boolean,
): InstallOffer {
  let held: InstallPromptEvent | null = null;
  let saidNotNow = readNotNow();
  let askedThisVisit = false;
  let state: InstallState = { offered: false, strip: false };
  const listeners = new Set<() => void>();

  function readNotNow(): boolean {
    try {
      return storage().getItem(key) !== null;
    } catch {
      return false;
    }
  }

  function update(): void {
    const offered = held !== null;
    const strip = offered && !saidNotNow && !askedThisVisit;
    if (offered === state.offered && strip === state.strip) return;
    state = { offered, strip };
    listeners.forEach((listener) => listener());
  }

  if (!standalone) {
    events.addEventListener('beforeinstallprompt', (event) => {
      // Keeps the offer for the student's click. (On a phone it also stops the browser's own
      // bar, which goes away by itself after a few seconds.)
      event.preventDefault();
      held = event as InstallPromptEvent;
      update();
    });
    events.addEventListener('appinstalled', () => {
      held = null;
      update();
    });
    // Not now in another tab of this build.
    events.addEventListener('storage', (event) => {
      if ((event as StorageEvent).key !== key || !readNotNow()) return;
      saidNotNow = true;
      update();
    });
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getState: () => state,
    install() {
      const offer = held;
      if (!offer) return;
      held = null;
      askedThisVisit = true;
      update();
      // Called here, inside the click, as the browser requires. A browser that refuses the
      // dialog (rejecting, or throwing) must not leave an unhandled error.
      try {
        Promise.resolve(offer.prompt()).catch(() => {});
      } catch {
        // Refused: the offer is gone either way.
      }
    },
    notNow() {
      saidNotNow = true;
      try {
        storage().setItem(key, '1');
      } catch {
        // Storage blocked: hidden for this visit only.
      }
      update();
    },
  };
}
