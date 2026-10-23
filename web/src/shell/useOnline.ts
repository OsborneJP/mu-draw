import { useSyncExternalStore } from 'react';

function subscribe(onChange: () => void): () => void {
  window.addEventListener('online', onChange);
  window.addEventListener('offline', onChange);
  return () => {
    window.removeEventListener('online', onChange);
    window.removeEventListener('offline', onChange);
  };
}

// navigator.onLine is false only when the device has no network at all; on Wi-Fi without
// internet it stays true. Requests that fail are each feature's own business.
export function useOnline(): boolean {
  return useSyncExternalStore(subscribe, () => navigator.onLine);
}
