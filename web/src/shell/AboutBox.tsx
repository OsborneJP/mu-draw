import { useRef, useState, useSyncExternalStore } from 'react';
import { download } from '../download';
import { GLASSWARE_CREDIT } from '../panels/glassware';
import { installOffer } from '../pwa/install';
import { usage } from '../usage/start';
import { FREETYPE_CREDIT, INCHI_CREDIT, SOURCE_CREDIT } from './credits';
import { INDIGO_SOURCE_FILE, NOTICES_FILE } from './thirdParty';
import { isOpen, licencesPanel, sourceSaver, type PanelState } from './thirdPartyActions';

// Our own About box; Ketcher's stays hidden because it links to outside sites. No links: it
// loads only the app's own precached files, the third-party notices and the InChI and cairo
// source (docs/plans/licence-notices.md), so both work offline and in the installed app.
const own = (file: string) => `${import.meta.env.BASE_URL}${file}`;
const SOURCE_NAME = INDIGO_SOURCE_FILE.split('/').pop()!;
const fetched = (file: string) =>
  fetch(own(file)).then((response) => (response.ok ? response : Promise.reject(new Error(`HTTP ${response.status}`))));
export default function AboutBox({ title }: { title: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  // While the browser offers to install the app, even after the strip's Not now.
  const { offered } = useSyncExternalStore(installOffer.subscribe, installOffer.getState);
  // Anonymous usage counts (docs/plans/v2-usage-counts.md): what is counted, and the switch.
  // It is read from storage each time About opens (another tab may have changed it); null
  // until that read comes back, and only the latest read is shown.
  const [counting, setCounting] = useState<boolean | null>(null);
  const reads = useRef(0);
  const show = (read: Promise<boolean>) => {
    const n = ++reads.current;
    void read.then((on) => {
      if (reads.current === n) setCounting(on);
    });
  };
  const gpc = (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl === true;
  // The third-party notices (read when first asked for) and the source's Save, in
  // thirdPartyActions.ts so their orderings can be tested.
  const [licences, setLicences] = useState<PanelState>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [panel] = useState(() => licencesPanel(() => fetched(NOTICES_FILE).then((r) => r.text()), setLicences));
  const [saver] = useState(() =>
    sourceSaver(
      () => fetched(INDIGO_SOURCE_FILE).then((r) => r.blob()),
      (blob) => download(blob, SOURCE_NAME),
      setProblem,
    ),
  );
  return (
    <>
      <button
        type="button"
        className="header-button"
        data-testid="app-about-button"
        onClick={() => {
          setCounting(null);
          show(usage.isOn());
          saver.reset();
          dialog.current?.showModal();
          // Focus starts on the title: not on an action (Save would start a download), and not
          // on Close, which would scroll a dialog taller than the window to its end.
          heading.current?.focus();
        }}
      >
        About
      </button>
      <dialog ref={dialog} className="about-box" aria-labelledby="about-title">
        <h2 id="about-title" ref={heading} tabIndex={-1}>
          {title}
        </h2>
        <p data-testid="app-version">Version {__APP_VERSION__}</p>
        <p>Draw chemical structures and reactions. Works offline.</p>
        <p>Your drawing is saved only in this browser, on this device.</p>
        <p data-testid="about-usage-note">
          This app counts, each week, how many browsers open it and which tools are used. The counts are kept without
          names, IDs or IP addresses. The web server, like any, logs each visit's address for about two weeks. Your
          drawings stay on this device: only Get name, Safety and the 3D view send a structure, and Name to structure
          the name you type, to this server, which asks PubChem. The switch below is kept in this browser.
        </p>
        <p>
          <label>
            <input
              type="checkbox"
              data-testid="about-usage-switch"
              checked={counting === true}
              disabled={gpc || counting === null}
              aria-busy={counting === null}
              onChange={(event) => {
                const on = event.target.checked;
                setCounting(on);
                // In turn behind a summary on its way, which can't then undo it.
                show(usage.setOn(on).then(() => usage.isOn()));
              }}
            />{' '}
            Include this browser in the anonymous weekly counts
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
          Built with Ketcher (EPAM Systems, Apache License 2.0), RDKit (BSD 3-Clause License) and 3Dmol.js (University
          of Pittsburgh and contributors, BSD 3-Clause License).
        </p>
        <p className="about-credits" data-testid="about-glassware-credit">
          Lab glassware: {GLASSWARE_CREDIT}
        </p>
        <p className="about-credits" data-testid="about-inchi-credit">
          {INCHI_CREDIT}
        </p>
        <p className="about-credits" data-testid="about-freetype-credit">
          {FREETYPE_CREDIT}
        </p>
        <p className="about-credits" data-testid="about-source">
          {SOURCE_CREDIT}{' '}
          <button type="button" data-testid="about-save-source" onClick={() => saver.save()}>
            Save InChI and cairo source
          </button>
          {problem && <span role="alert"> {problem}</span>}
        </p>
        <p>
          <button
            type="button"
            data-testid="about-licences-button"
            aria-expanded={isOpen(licences)}
            aria-controls="about-licences"
            onClick={() => (isOpen(licences) ? panel.close() : panel.open())}
          >
            Third-party licences
          </button>
          {licences !== null && 'loading' in licences && <span role="status"> Loading…</span>}
          {licences !== null && 'error' in licences && <span role="alert"> {licences.error}</span>}
        </p>
        {licences !== null && 'text' in licences && (
          <pre
            id="about-licences"
            className="about-licences"
            data-testid="about-licences"
            role="region"
            aria-label="Third-party licences"
            tabIndex={0}
          >
            {licences.text}
          </pre>
        )}
        <button type="button" ref={close} onClick={() => dialog.current?.close()}>
          Close
        </button>
      </dialog>
    </>
  );
}
