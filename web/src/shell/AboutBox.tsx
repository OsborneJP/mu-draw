import { useRef, useSyncExternalStore } from 'react';
import { GLASSWARE_CREDIT } from '../panels/glassware';
import { installOffer } from '../pwa/install';

// Our own About box; Ketcher's stays hidden because it links to outside sites. Plain text
// only: nothing here may link or load anything.
export default function AboutBox({ title }: { title: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  // While the browser offers to install the app, even after the strip's Not now.
  const { offered } = useSyncExternalStore(installOffer.subscribe, installOffer.getState);
  return (
    <>
      <button
        type="button"
        className="header-button"
        data-testid="app-about-button"
        onClick={() => dialog.current?.showModal()}
      >
        About
      </button>
      <dialog ref={dialog} className="about-box" aria-labelledby="about-title">
        <h2 id="about-title">{title}</h2>
        <p data-testid="app-version">Version {__APP_VERSION__}</p>
        <p>Draw chemical structures and reactions. Works offline.</p>
        <p>Your drawing is saved only in this browser, on this device.</p>
        {offered && (
          <p>
            <button
              type="button"
              data-testid="about-install-button"
              onClick={() => {
                installOffer.install();
                // The button goes; keep the keyboard's place in the dialog.
                close.current?.focus();
              }}
            >
              Install as an app
            </button>
          </p>
        )}
        <p data-testid="app-authors">Made by Jeff Osborne with Claude Code.</p>
        <p className="about-credits">
          Built with Ketcher (EPAM Systems, Apache License 2.0), RDKit (BSD 3-Clause License) and
          3Dmol.js (University of Pittsburgh and contributors, BSD 3-Clause License).
        </p>
        <p className="about-credits" data-testid="about-glassware-credit">
          Lab glassware: {GLASSWARE_CREDIT}
        </p>
        <button type="button" ref={close} onClick={() => dialog.current?.close()}>
          Close
        </button>
      </dialog>
    </>
  );
}
