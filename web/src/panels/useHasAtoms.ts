import { useCallback, useSyncExternalStore } from 'react';
import type { Ketcher } from 'ketcher-core';

/** Whether the canvas has any atoms, updated on Ketcher's change event. */
export function useHasAtoms(ketcher: Ketcher | null): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!ketcher) return () => {};
      ketcher.changeEvent.add(onChange);
      return () => ketcher.changeEvent.remove(onChange);
    },
    [ketcher],
  );
  return useSyncExternalStore(subscribe, () => (ketcher ? ketcher.editor.struct().atoms.size > 0 : false));
}
