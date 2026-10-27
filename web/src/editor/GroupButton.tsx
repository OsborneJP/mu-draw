import { useSyncExternalStore } from 'react';
import { getGroupState, groupSelection, subscribeGroups, ungroupSelection } from './groupStore';
import './groupButton.css';
import { countUse } from '../usage/start';

// The Group / Ungroup button (docs/plans/v2-grouping.md): beside Ketcher's floating tools over
// the selection, or in the canvas's corner when they don't show. data-* let tests read it.
export default function GroupButton() {
  const { offer, anchored } = useSyncExternalStore(subscribeGroups, getGroupState);
  if (offer === null) return null;
  const label = offer === 'group' ? 'Group' : 'Ungroup';
  return (
    <button
      type="button"
      className={anchored ? 'group-button group-button-anchored' : 'group-button'}
      data-testid="group-button"
      data-offer={offer}
      data-anchored={anchored}
      title={offer === 'group' ? 'Group these, to move them together' : 'Ungroup: move each on its own again'}
      // Focus stays on the canvas, so Ketcher's keys (Delete, Ctrl+Z) work straight after.
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => {
        countUse('group');
        if (offer === 'group') groupSelection();
        else ungroupSelection();
      }}
    >
      {label}
    </button>
  );
}
