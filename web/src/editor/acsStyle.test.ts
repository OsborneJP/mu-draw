import { KETCHER_SAVED_OPTIONS_KEY, PRESETS } from 'ketcher-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ACS_APPLIED_KEY, acsSettings, applyAcsOnce, KETCHER_SETTINGS_KEY } from './acsStyle';

/** A Map behind the Storage methods acsStyle uses; setItem can be made to fail. */
class FakeStorage {
  items = new Map<string, string>();
  refuse = false;
  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    if (this.refuse) throw new DOMException('quota', 'QuotaExceededError');
    this.items.set(key, value);
  }
  asStorage(): () => Storage {
    return () => this as unknown as Storage;
  }
  settings(): unknown {
    return JSON.parse(this.items.get(KETCHER_SETTINGS_KEY)!);
  }
}

// Stand-ins for Ketcher's settings: what the app writes comes from the caller, so any
// values will do here; 'the start-up module writes Ketcher's own preset' checks the real ones.
const ACS = { bondLength: 1, bondLengthUnit: 'pt', atomColoring: false };

describe('applyAcsOnce', () => {
  it('a new browser: writes the ACS settings and marks them applied', () => {
    const storage = new FakeStorage();
    applyAcsOnce(storage.asStorage(), ACS);
    expect(storage.settings()).toEqual(ACS);
    expect(storage.getItem(ACS_APPLIED_KEY)).not.toBeNull();
  });

  it("a browser with Ketcher's settings saved: ACS goes over them, the student's others stay", () => {
    const storage = new FakeStorage();
    const saved = { bondLength: 2, bondLengthUnit: 'px', atomColoring: true, carbonExplicitly: true };
    storage.items.set(KETCHER_SETTINGS_KEY, JSON.stringify(saved));
    applyAcsOnce(storage.asStorage(), ACS);
    expect(storage.settings()).toEqual({ ...ACS, carbonExplicitly: true });
  });

  it('applied already: a student\'s own settings are left alone', () => {
    const storage = new FakeStorage();
    applyAcsOnce(storage.asStorage(), ACS);
    const own = JSON.stringify({ ...ACS, atomColoring: true });
    storage.items.set(KETCHER_SETTINGS_KEY, own);
    applyAcsOnce(storage.asStorage(), ACS);
    expect(storage.getItem(KETCHER_SETTINGS_KEY)).toBe(own);
  });

  it('unreadable saved settings are replaced by ACS', () => {
    for (const text of ['{not json', 'null', '[1,2]', '"text"']) {
      const storage = new FakeStorage();
      storage.items.set(KETCHER_SETTINGS_KEY, text);
      applyAcsOnce(storage.asStorage(), ACS);
      expect(storage.settings()).toEqual(ACS);
    }
  });

  it('storage blocked: nothing is thrown, and Ketcher keeps its own defaults', () => {
    const blocked = () => {
      throw new DOMException('blocked', 'SecurityError');
    };
    expect(() => applyAcsOnce(blocked, ACS)).not.toThrow();
  });

  it('storage full: nothing is thrown, nothing is marked, and the next start tries again', () => {
    const storage = new FakeStorage();
    storage.refuse = true;
    expect(() => applyAcsOnce(storage.asStorage(), ACS)).not.toThrow();
    expect(storage.getItem(ACS_APPLIED_KEY)).toBeNull();
    storage.refuse = false;
    applyAcsOnce(storage.asStorage(), ACS);
    expect(storage.settings()).toEqual(ACS);
  });
});

describe('the ACS values', () => {
  it("are Ketcher's own ACS preset, without its image resolution", () => {
    const { imageResolution, ...rest } = PRESETS.acs;
    expect(imageResolution).toBeDefined();
    expect(acsSettings(PRESETS.acs)).toEqual(rest);
  });

  it("are stored where Ketcher reads its settings", () => {
    expect(KETCHER_SETTINGS_KEY).toBe(KETCHER_SAVED_OPTIONS_KEY);
  });
});

describe('the start-up module', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("writes Ketcher's own preset (minus image resolution) into the page's storage when imported", async () => {
    const storage = new FakeStorage();
    vi.stubGlobal('window', { localStorage: storage });
    vi.resetModules();
    await import('./acsStart');
    expect(storage.settings()).toEqual(acsSettings(PRESETS.acs));
  });
});
