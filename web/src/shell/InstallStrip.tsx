import { useSyncExternalStore } from 'react';
import { installOffer } from '../pwa/install';

// "Install the app": shown under the header while Chrome or Edge offers to install it, until
// the student installs it or says Not now (docs/plans/v2-install-prompt.md).
const TITLE = document.title;

export default function InstallStrip() {
  const { strip } = useSyncExternalStore(installOffer.subscribe, installOffer.getState);
  return (
    // Always in the page, so screen readers announce the strip when it appears.
    <div role="status">
      {strip && (
        <div className="install-strip" data-testid="install-strip">
          <span>
            <strong>Install {TITLE} as an app:</strong> it opens in its own window, like your other apps, and works
            offline.
          </span>
          <button type="button" data-testid="install-button" onClick={installOffer.install}>
            Install
          </button>
          <button type="button" className="secondary" data-testid="install-not-now-button" onClick={installOffer.notNow}>
            Not now
          </button>
        </div>
      )}
    </div>
  );
}
