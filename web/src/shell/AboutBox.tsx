import { useRef, useState, useSyncExternalStore } from 'react';
import { GLASSWARE_CREDIT } from '../panels/glassware';
import { installOffer } from '../pwa/install';
import { usage } from '../usage/start';

// Our own About box; Ketcher's stays hidden because it links to outside sites. Plain text
// only: nothing here may link or load anything.
export default function AboutBox({ title }: { title: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  // While the browser offers to install the app, even after the strip's Not now.
  const { offered } = useSyncExternalStore(installOffer.subscribe, installOffer.getState);
  // Anonymous usage counts (docs/plans/v2-usage-counts.md): what is counted, and the switch.
  const [counting, setCounting] = useState(() => usage.isOn());
  const gpc = (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl === true;
  return (
    <>
      <button
        type="button"
        className="header-button"
        data-testid="app-about-button"
        onClick={() => {
          setCounting(usage.isOn()); // another tab may have changed it
          dialog.current?.showModal();
        }}
      >
        About
      </button>
      <dialog ref={dialog} className="about-box" aria-labelledby="about-title">
        <h2 id="about-title">{title}</h2>
        <p data-testid="app-version">Version {__APP_VERSION__}</p>
        <p>Draw chemical structures and reactions. Works offline.</p>
        <p>Your drawing is saved only in this browser, on this device.</p>
        <p data-testid="about-usage-note">
          This app counts, each week, how many browsers open it and which tools are used. The counts are kept
          without names, IDs or IP addresses. The web server, like any, logs each visit's address for about two
          weeks. Your drawings stay on this device: only Get name, Safety and the 3D view send a structure, and Name
          to structure the name you type, to this server, which asks PubChem. The switch below is kept in this
          browser.
        </p>
        <p>
          <label>
            <input
              type="checkbox"
              data-testid="about-usage-switch"
              checked={counting}
              disabled={gpc}
              onChange={(event) => {
                setCounting(event.target.checked);
                // In turn behind a summary on its way, which can't then undo it.
                void usage.setOn(event.target.checked).then(() => setCounting(usage.isOn()));
              }}
            />{' '}
            Count my use anonymously
          </label>
          {gpc && (
            <span data-testid="about-usage-gpc">
              {' '}
              (off: this browser asks sites not to track it, with Global Privacy Control)
            </span>
          )}
        </p>
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
