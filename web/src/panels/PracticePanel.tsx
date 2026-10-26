import { useEffect, useSyncExternalStore, type KeyboardEvent } from 'react';
import type { Ketcher } from 'ketcher-core';
import { getKetcher, subscribeKetcher } from '../editor/instance';
import {
  check,
  closePractice,
  currentName,
  drawingChanged,
  getPracticeState,
  goTo,
  showAnswer,
  subscribePractice,
  verdictText,
  type PracticeState,
} from './practice';
import './practice.css';
import Docked from './Docked';
import { useHasAtoms } from './useHasAtoms';

// Practice mode's panel (docs/plans/v2-practice-mode.md), docked below the canvas like the
// NMR preview and the stereoisomers (Docked.tsx: the canvas gets shorter and the drawing
// stays in the middle of it, so the panel never covers it), one at a time: the name to
// draw, Check, Show answer after a Check that wasn't right, and Previous and Next. Esc inside
// the panel closes it. data-verdict lets tests read the verdict exactly.
export default function PracticePanel() {
  const ketcher = useSyncExternalStore(subscribeKetcher, getKetcher);
  const state = useSyncExternalStore(subscribePractice, getPracticeState);
  const hasAtoms = useHasAtoms(ketcher);

  useEffect(() => {
    if (!ketcher) return;
    ketcher.changeEvent.add(drawingChanged);
    return () => ketcher.changeEvent.remove(drawingChanged);
  }, [ketcher]);

  if (!state.open || !ketcher) return null;
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') closePractice();
  };
  return (
    <Docked ketcher={ketcher} className="practice-panel" label="Practice" testId="practice-panel" state={state.lists.kind} onKeyDown={onKeyDown}>
      <div className="practice-head">
        <h2>Practice</h2>
        <button
          type="button"
          className="practice-close"
          data-testid="practice-close"
          aria-label="Close practice"
          onClick={closePractice}
        >
          ×
        </button>
      </div>
      <Body ketcher={ketcher} state={state} hasAtoms={hasAtoms} />
    </Docked>
  );
}

function Body({ ketcher, state, hasAtoms }: { ketcher: Ketcher; state: PracticeState; hasAtoms: boolean }) {
  if (state.lists.kind === 'loading') {
    return <p data-testid="practice-message">Loading the practice lists…</p>;
  }
  if (state.lists.kind === 'failed') {
    return <p data-testid="practice-message">The practice lists didn&apos;t load. Close Practice and open it again.</p>;
  }
  const { lists } = state.lists;
  const list = lists[state.list];
  const item = currentName(state);
  if (!list || !item) return null;
  const last = list.names.length - 1;
  return (
    <>
      <div className="practice-row">
        {lists.length > 1 ? (
          <select
            data-testid="practice-list"
            aria-label="Practice list"
            value={state.list}
            onChange={(event) => void goTo(ketcher, Number(event.target.value), 0)}
          >
            {lists.map((l, i) => (
              <option key={l.id} value={i}>
                {l.title}
              </option>
            ))}
          </select>
        ) : (
          <span className="practice-list-title" data-testid="practice-list-title">
            {list.title}
          </span>
        )}
        <span data-testid="practice-position">
          {state.position + 1} of {list.names.length}
        </span>
      </div>
      <p className="practice-question">
        Draw: <strong data-testid="practice-name">{item.name}</strong>
      </p>
      <div className="practice-row">
        <button
          type="button"
          data-testid="practice-check"
          disabled={!hasAtoms || state.checking}
          title={hasAtoms ? 'Compare your drawing with the answer' : 'Draw a structure first'}
          onClick={() => void check(ketcher)}
        >
          {state.checking ? 'Checking…' : 'Check'}
        </button>
        {state.missed && state.answer.kind === 'none' && (
          <button type="button" data-testid="practice-show-answer" onClick={() => void showAnswer(ketcher)}>
            Show answer
          </button>
        )}
        <button
          type="button"
          data-testid="practice-previous"
          disabled={state.position === 0}
          onClick={() => void goTo(ketcher, state.list, state.position - 1)}
        >
          Previous
        </button>
        <button
          type="button"
          data-testid="practice-next"
          disabled={state.position === last}
          onClick={() => void goTo(ketcher, state.list, state.position + 1)}
        >
          Next
        </button>
      </div>
      <p role="status" className="practice-status">
        {state.verdict && (
          <span
            className={`practice-verdict practice-verdict-${state.verdict.kind === 'correct' ? 'right' : 'wrong'}`}
            data-testid="practice-verdict"
            data-verdict={state.verdict.kind}
          >
            {state.verdict.kind === 'correct' ? '✓ ' : ''}
            {verdictText(state.verdict)}
          </span>
        )}
      </p>
      <Answer state={state} name={item.name} />
    </>
  );
}

function Answer({ state, name }: { state: PracticeState; name: string }) {
  switch (state.answer.kind) {
    case 'none':
      return null;
    case 'drawing':
      return <p data-testid="practice-answer-message">Drawing the answer…</p>;
    case 'failed':
      return <p data-testid="practice-answer-message">The answer couldn&apos;t be drawn.</p>;
    case 'shown':
      return (
        <figure className="practice-answer" data-testid="practice-answer">
          <img src={state.answer.src} alt={`The answer: ${name}`} />
          <figcaption>The answer</figcaption>
        </figure>
      );
  }
}
