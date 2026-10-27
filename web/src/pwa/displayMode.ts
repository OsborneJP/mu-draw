/** Whether the page runs as the installed app: in one of the display modes an app's window has.
 * A browser tab is 'browser', and a tab made fullscreen (F11, or Ketcher's own button) is
 * 'fullscreen', so fullscreen alone doesn't count (an installed app made fullscreen then reads
 * as a tab, which is harmless). */
export function runningInstalled(): boolean {
  return ['standalone', 'minimal-ui', 'window-controls-overlay', 'tabbed'].some(
    (mode) => window.matchMedia(`(display-mode: ${mode})`).matches,
  );
}
