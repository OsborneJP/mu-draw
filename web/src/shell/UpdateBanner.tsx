import { useSyncExternalStore } from 'react';
import { applyUpdate, isUpdateReady, subscribeUpdateReady } from '../pwa/register';

// "An update is ready." The page reloads only when the student clicks Reload; the app
// never reloads by itself mid-drawing.
export default function UpdateBanner() {
  const ready = useSyncExternalStore(subscribeUpdateReady, isUpdateReady);
  return (
    // Always in the page, so screen readers announce the banner when it appears.
    <div role="status">
      {ready && (
        <div className="update-banner" data-testid="update-banner">
          <span data-testid="update-message">An update is ready. Reload to use it.</span>
          <button type="button" data-testid="update-reload-button" onClick={() => void applyUpdate()}>
            Reload
          </button>
        </div>
      )}
    </div>
  );
}
