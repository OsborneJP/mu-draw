import { afterEach, describe, expect, it, vi } from 'vitest';
import { runningInstalled } from './displayMode';

/** A window whose display mode is `mode` (as its media queries report it). */
function displayMode(mode: string) {
  vi.stubGlobal('window', {
    matchMedia: (query: string) => ({ matches: query === `(display-mode: ${mode})` }),
  });
}

describe('running as the installed app', () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each(['standalone', 'minimal-ui', 'window-controls-overlay', 'tabbed'])("an app window (%s): yes", (mode) => {
    displayMode(mode);
    expect(runningInstalled()).toBe(true);
  });

  it.each(['browser', 'fullscreen'])('a browser tab, even made fullscreen (%s): no', (mode) => {
    displayMode(mode);
    expect(runningInstalled()).toBe(false);
  });
});
