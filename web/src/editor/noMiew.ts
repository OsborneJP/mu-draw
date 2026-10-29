import { useEffect } from 'react';

// Stands in for `miew-react`, Ketcher's own 3D viewer, which the app doesn't ship
// (docs/plans/licence-notices.md, decision 4; vite.config.ts points the import here). Ketcher
// loads it only from its 3D button's dialog, which the app hides (ketcherUi.ts). Should
// anything reach it, it reports an editor error, which fails every smoke test.
export default function NoMiew(): null {
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('editor-error', { detail: "Ketcher's 3D viewer is not part of this app" }));
  }, []);
  return null;
}
