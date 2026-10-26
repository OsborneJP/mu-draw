// Students start in the ACS Document 1996 drawing style, the one ChemDraw users pick for
// journals and reports (Jeff, 2026-10-26; docs/plans/acs-style-default.md). It is
// Ketcher's own "Set ACS Settings" preset, written into Ketcher's saved settings before
// Ketcher's code loads (acsStart.ts), once per browser: a student's own changes in Ketcher's
// Settings stay after that.
//
// Ketcher reads its saved settings twice: ketcher-react as soon as its code loads, and
// ketcher-core's settings service when the editor starts. Written before both, ACS is what
// the first canvas is drawn with, and the canvas is drawn once.

/** Where Ketcher keeps its settings: one entry for the whole site, so production and
 * staging share it (ketcher-core's KETCHER_SAVED_OPTIONS_KEY; acsStyle.test.ts). */
export const KETCHER_SETTINGS_KEY = 'ketcher-opts';
/** Set once ACS has been written in this browser. Per site, like Ketcher's own entry. */
export const ACS_APPLIED_KEY = 'ketcher-opts:acs-applied';

/** Ketcher's ACS preset without its image resolution. The two readers store resolution
 * differently (text against a number), so a stored 600 makes Ketcher redraw the canvas once
 * at start, and that redraw leaves an Undo step on a fresh, empty canvas (measured). The
 * app's own pictures don't use it: they ask Indigo for CSS pixels (panels/exportImage.ts). */
export function acsSettings(preset: Record<string, unknown>): Record<string, unknown> {
  const rest = { ...preset };
  delete rest.imageResolution;
  return rest;
}

/** Merge `acs` over Ketcher's saved settings, unless this browser already had it. The
 * student's other settings stay. Never throws: with storage blocked, Ketcher starts with
 * its own defaults (and autosave can't work either). */
export function applyAcsOnce(storage: () => Storage, acs: Record<string, unknown>): void {
  try {
    const store = storage();
    if (store.getItem(ACS_APPLIED_KEY) !== null) return;
    const saved = { ...savedSettings(store.getItem(KETCHER_SETTINGS_KEY)), ...acs };
    store.setItem(KETCHER_SETTINGS_KEY, JSON.stringify(saved));
    // Only once the settings are written: if that failed (storage full), the next start tries again.
    store.setItem(ACS_APPLIED_KEY, '1');
  } catch {
    // Storage blocked or full: Ketcher's own defaults this time.
  }
}

/** The saved settings object, or none if there is nothing readable there. */
function savedSettings(text: string | null): Record<string, unknown> {
  if (text === null) return {};
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
