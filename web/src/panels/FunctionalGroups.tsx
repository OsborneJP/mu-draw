import type { GroupsView } from '../chem/tracker';
import { PATTERNS_FILE } from '../chem/rdkitFiles';

// The properties panel's functional-group section (spec section 3): a "Show functional
// groups" checkbox and, while it is ticked, the groups found with their colours and counts.
// PropertiesPanel colours them on the canvas. data-name and data-count let tests read the
// list exactly.

interface Props {
  groups: GroupsView;
  shown: boolean;
  onShow: (shown: boolean) => void;
}

export default function FunctionalGroups({ groups, shown, onShow }: Props) {
  return (
    <section className="groups" aria-label="Functional groups">
      <h3>Functional groups</h3>
      <label className="groups-toggle">
        <input type="checkbox" data-testid="groups-toggle" checked={shown} onChange={(e) => onShow(e.target.checked)} />
        Show functional groups
      </label>
      {shown && groups.kind === 'unavailable' && (
        <p className="properties-note" data-testid="groups-message">
          Functional groups are unavailable: {groups.reason}.
        </p>
      )}
      {shown && groups.kind === 'found' && (
        <>
          {groups.groups.length === 0 ? (
            <p className="properties-note" data-testid="groups-message">
              None of the groups this app looks for is in the drawing.
            </p>
          ) : (
            <ul className="groups-list" data-testid="groups-list">
              {groups.groups.map((g) => (
                <li key={g.name} data-testid="group" data-name={g.name} data-count={g.instances.length} data-color={g.color}>
                  <span className="group-swatch" style={{ background: g.color }} aria-hidden="true" />
                  <span className="group-name">{g.name}</span>
                  <span className="group-count">×{g.instances.length}</span>
                </li>
              ))}
            </ul>
          )}
          {groups.problems.length > 0 && (
            <div className="properties-note" data-testid="groups-problems">
              Skipped in {PATTERNS_FILE}:
              <ul>
                {groups.problems.map((problem, i) => (
                  <li key={i}>{problem}</li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </section>
  );
}
