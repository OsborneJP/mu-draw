import { describe, expect, it, vi } from 'vitest';
import { basePath } from '../../config/app';
import { createInstallOffer, notNowKey, type InstallOffer } from './installOffer';

const KEY = notNowKey(basePath('production'));

/** A Map behind the Storage methods used; it can be made to refuse. */
class FakeStorage {
  items = new Map<string, string>();
  blocked = false;
  getItem(key: string): string | null {
    if (this.blocked) throw new DOMException('blocked', 'SecurityError');
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    if (this.blocked) throw new DOMException('blocked', 'SecurityError');
    this.items.set(key, value);
  }
}

/** The browser's offer, as Chrome sends it; `prompt` counts its calls. */
function offerEvent(prompt: () => unknown = () => Promise.resolve()) {
  const event = new Event('beforeinstallprompt', { cancelable: true });
  const calls = vi.fn(prompt);
  Object.assign(event, { prompt: calls });
  return { event, prompt: calls };
}

function start(options: { storage?: FakeStorage; standalone?: boolean } = {}) {
  const events = new EventTarget();
  const storage = options.storage ?? new FakeStorage();
  const offer = createInstallOffer(events, () => storage as unknown as Storage, KEY, options.standalone ?? false);
  const changes = vi.fn();
  offer.subscribe(changes);
  return { events, storage, offer, changes };
}

function offerFrom(events: EventTarget, prompt?: () => unknown) {
  const sent = offerEvent(prompt);
  events.dispatchEvent(sent.event);
  return sent;
}

const state = (offer: InstallOffer) => offer.getState();

describe('the install offer', () => {
  it('nothing is offered until the browser offers; then the strip shows and the offer is kept', () => {
    const { events, offer, changes } = start();
    expect(state(offer)).toEqual({ offered: false, strip: false });
    const { event } = offerFrom(events);
    expect(event.defaultPrevented).toBe(true);
    expect(state(offer)).toEqual({ offered: true, strip: true });
    expect(changes).toHaveBeenCalledTimes(1);
  });

  it('the state is the same object until something changes', () => {
    const { events, offer } = start();
    const before = state(offer);
    expect(state(offer)).toBe(before);
    offerFrom(events);
    const after = state(offer);
    expect(after).not.toBe(before);
    offerFrom(events); // a second offer changes nothing that shows
    expect(state(offer)).toBe(after);
  });

  it('running as the installed app: no offer is taken, and nothing shows', () => {
    const { events, offer } = start({ standalone: true });
    const { event } = offerFrom(events);
    expect(event.defaultPrevented).toBe(false);
    expect(state(offer)).toEqual({ offered: false, strip: false });
  });

  it("Install calls the browser's prompt once, in the call, and lets the offer go", () => {
    const { events, offer } = start();
    const { prompt } = offerFrom(events);
    offer.install();
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(state(offer)).toEqual({ offered: false, strip: false });
    offer.install();
    expect(prompt).toHaveBeenCalledTimes(1);
  });

  it("a cancelled dialog: Chrome's next offer goes to About, the strip stays away this visit, and nothing is remembered", () => {
    const { events, offer, storage } = start();
    offerFrom(events);
    offer.install();
    expect(storage.items.size).toBe(0);
    offerFrom(events); // Chrome offers again as soon as the dialog is cancelled
    expect(state(offer)).toEqual({ offered: true, strip: false });
    const next = start({ storage }); // the next visit
    offerFrom(next.events);
    expect(state(next.offer)).toEqual({ offered: true, strip: true });
  });

  it("Not now in another tab of this build hides this tab's strip; other keys change nothing", () => {
    const storage = new FakeStorage();
    const here = start({ storage });
    const there = start({ storage });
    offerFrom(here.events);
    offerFrom(there.events);
    const storageEvent = (key: string) => Object.assign(new Event('storage'), { key });
    here.events.dispatchEvent(storageEvent(KEY)); // nothing stored yet: a stale event
    here.events.dispatchEvent(storageEvent(notNowKey(basePath('staging'))));
    expect(state(here.offer)).toEqual({ offered: true, strip: true });
    there.offer.notNow();
    here.events.dispatchEvent(storageEvent(KEY));
    expect(state(here.offer)).toEqual({ offered: true, strip: false });
  });

  it('a browser that refuses the dialog leaves no error, whether it rejects or throws', async () => {
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      for (const prompt of [() => Promise.reject(new Error('refused')), () => {
        throw new Error('refused');
      }]) {
        const { events, offer } = start();
        offerFrom(events, prompt);
        expect(() => offer.install()).not.toThrow();
        expect(state(offer).offered).toBe(false);
      }
      await new Promise((resolve) => setImmediate(resolve));
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });

  it("Not now hides the strip for good in this browser; the offer stays for About's Install", () => {
    const { events, offer, storage } = start();
    const { prompt } = offerFrom(events);
    offer.notNow();
    expect(state(offer)).toEqual({ offered: true, strip: false });
    expect(storage.items.get(KEY)).toBeDefined();
    offer.install();
    expect(prompt).toHaveBeenCalledTimes(1);

    // The next visit: a new offer shows no strip.
    const next = start({ storage });
    offerFrom(next.events);
    expect(state(next.offer)).toEqual({ offered: true, strip: false });
    // Another build's Not now is its own.
    const other = createInstallOffer(next.events, () => storage as unknown as Storage, notNowKey(basePath('staging')), false);
    offerFrom(next.events);
    expect(other.getState()).toEqual({ offered: true, strip: true });
  });

  it('storage blocked: Not now hides the strip for this visit, and nothing throws', () => {
    const storage = new FakeStorage();
    storage.blocked = true;
    const { events, offer } = start({ storage });
    offerFrom(events);
    expect(() => offer.notNow()).not.toThrow();
    expect(state(offer)).toEqual({ offered: true, strip: false });
  });

  it('once the app is installed, the offer goes', () => {
    const { events, offer } = start();
    offerFrom(events);
    events.dispatchEvent(new Event('appinstalled'));
    expect(state(offer)).toEqual({ offered: false, strip: false });
  });

  it('an unsubscribed listener hears nothing more', () => {
    const { events, offer } = start();
    const listener = vi.fn();
    const unsubscribe = offer.subscribe(listener);
    unsubscribe();
    offerFrom(events);
    expect(listener).not.toHaveBeenCalled();
  });
});
