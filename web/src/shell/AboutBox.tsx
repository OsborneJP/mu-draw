import { useRef } from 'react';

// Our own About box; Ketcher's stays hidden because it links to outside sites. Plain text
// only: nothing here may link or load anything.
export default function AboutBox({ title }: { title: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
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
        <p className="about-credits">
          Built with Ketcher (EPAM Systems, Apache License 2.0) and RDKit (BSD 3-Clause License).
        </p>
        <button type="button" onClick={() => dialog.current?.close()}>
          Close
        </button>
      </dialog>
    </>
  );
}
