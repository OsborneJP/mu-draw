// Ketcher 3.18 ships a debug shortcut, Alt+Shift+R ("qs-serialize"), that writes the whole
// drawing into the page URL (?mol=<Molfile>) and reloads. That navigation reaches the
// server, so the structure would land in its access log, and the drawing is lost. Its
// `hidden` option is misplaced in ketcher-react, so the buttons config can't switch it off.
// Swallow the key on window, in the capture phase, before Ketcher's element listener.

type KeyFields = Pick<KeyboardEvent, 'altKey' | 'shiftKey' | 'ctrlKey' | 'metaKey' | 'code'>;

export function isDebugSerializeShortcut(event: KeyFields): boolean {
  return event.altKey && event.shiftKey && !event.ctrlKey && !event.metaKey && event.code === 'KeyR';
}

export function blockDebugHotkeys(target: Pick<Window, 'addEventListener'> = window): void {
  target.addEventListener(
    'keydown',
    (event) => {
      if (isDebugSerializeShortcut(event)) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    },
    { capture: true },
  );
}
