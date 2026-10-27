import { KETCHER_SAVED_OPTIONS_KEY, PRESETS, ShowHydrogenLabels } from 'ketcher-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ACS_APPLIED_KEY, acsSettings, applyOnce, HETERO_H_APPLIED_KEY, KETCHER_SETTINGS_KEY } from './acsStyle';

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

describe('applyOnce', () => {
  it('a new browser: writes the ACS settings and marks them applied', () => {
    const storage = new FakeStorage();
    applyOnce(storage.asStorage(), ACS_APPLIED_KEY, ACS);
    expect(storage.settings()).toEqual(ACS);
    expect(storage.getItem(ACS_APPLIED_KEY)).not.toBeNull();
  });

  it("a browser with Ketcher's settings saved: ACS goes over them, the student's others stay", () => {
    const storage = new FakeStorage();
    const saved = { bondLength: 2, bondLengthUnit: 'px', atomColoring: true, carbonExplicitly: true };
    storage.items.set(KETCHER_SETTINGS_KEY, JSON.stringify(saved));
    applyOnce(storage.asStorage(), ACS_APPLIED_KEY, ACS);
    expect(storage.settings()).toEqual({ ...ACS, carbonExplicitly: true });
  });

  it('applied already: a student\'s own settings are left alone', () => {
    const storage = new FakeStorage();
    applyOnce(storage.asStorage(), ACS_APPLIED_KEY, ACS);
    const own = JSON.stringify({ ...ACS, atomColoring: true });
    storage.items.set(KETCHER_SETTINGS_KEY, own);
    applyOnce(storage.asStorage(), ACS_APPLIED_KEY, ACS);
    expect(storage.getItem(KETCHER_SETTINGS_KEY)).toBe(own);
  });

  it('unreadable saved settings are replaced by ACS', () => {
    for (const text of ['{not json', 'null', '[1,2]', '"text"']) {
      const storage = new FakeStorage();
      storage.items.set(KETCHER_SETTINGS_KEY, text);
      applyOnce(storage.asStorage(), ACS_APPLIED_KEY, ACS);
      expect(storage.settings()).toEqual(ACS);
    }
  });

  it('storage blocked: nothing is thrown, and Ketcher keeps its own defaults', () => {
    const blocked = () => {
      throw new DOMException('blocked', 'SecurityError');
    };
    expect(() => applyOnce(blocked, ACS_APPLIED_KEY, ACS)).not.toThrow();
  });

  it('each record is its own: a browser with ACS applied still gets a later step, once', () => {
    const storage = new FakeStorage();
    applyOnce(storage.asStorage(), ACS_APPLIED_KEY, ACS);
    applyOnce(storage.asStorage(), HETERO_H_APPLIED_KEY, { showHydrogenLabels: 'Hetero' });
    expect(storage.settings()).toEqual({ ...ACS, showHydrogenLabels: 'Hetero' });
    const own = JSON.stringify({ ...ACS, showHydrogenLabels: 'Terminal' });
    storage.items.set(KETCHER_SETTINGS_KEY, own);
    applyOnce(storage.asStorage(), HETERO_H_APPLIED_KEY, { showHydrogenLabels: 'Hetero' });
    expect(storage.getItem(KETCHER_SETTINGS_KEY)).toBe(own);
  });

  it('storage full: nothing is thrown, nothing is marked, and the next start tries again', () => {
    const storage = new FakeStorage();
    storage.refuse = true;
    expect(() => applyOnce(storage.asStorage(), ACS_APPLIED_KEY, ACS)).not.toThrow();
    expect(storage.getItem(ACS_APPLIED_KEY)).toBeNull();
    storage.refuse = false;
    applyOnce(storage.asStorage(), ACS_APPLIED_KEY, ACS);
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

  async function start(storage: FakeStorage): Promise<void> {
    vi.stubGlobal('window', { localStorage: storage });
    vi.resetModules();
    await import('./acsStart');
  }

  it("a new browser: Ketcher's own ACS preset (minus image resolution) and hydrogens on heteroatoms only", async () => {
    const storage = new FakeStorage();
    await start(storage);
    expect(storage.settings()).toEqual({ ...acsSettings(PRESETS.acs), showHydrogenLabels: ShowHydrogenLabels.Hetero });
  });

  it('a browser that has ACS already: only the hydrogen labels change, once', async () => {
    const storage = new FakeStorage();
    const before = { ...acsSettings(PRESETS.acs), atomColoring: true, showHydrogenLabels: ShowHydrogenLabels.TerminalAndHetero };
    storage.items.set(KETCHER_SETTINGS_KEY, JSON.stringify(before));
    storage.items.set(ACS_APPLIED_KEY, '1');
    await start(storage);
    expect(storage.settings()).toEqual({ ...before, showHydrogenLabels: ShowHydrogenLabels.Hetero });
    expect(storage.getItem(HETERO_H_APPLIED_KEY)).not.toBeNull();
  });
});
