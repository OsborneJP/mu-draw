import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { Ketcher } from 'ketcher-core';
import { getKetcher, subscribeKetcher } from '../editor/instance';
import { copyDrawing, type Outcome } from './exportImage';
import { countUse } from '../usage/start';

type CopyState = 'idle' | 'copying' | Outcome | 'failed';

const BADGES: Partial<Record<CopyState, { text: string; className: string; title?: string }>> = {
  done: {
    text: 'Image copied',
    className: 'info-badge',
    title: 'A picture of the drawing is on the clipboard: paste it into Word or Google Docs.',
  },
  empty: { text: 'Nothing to copy: the drawing is empty', className: 'warning-badge' },
  failed: {
    text: "Couldn't copy the image",
    className: 'warning-badge',
    title: 'The browser did not allow it. Use Export to save a PNG instead.',
  },
};

// Copy image: one click puts a PNG of the drawing on the clipboard. The message that
// follows is about the drawing as it was at the click, so it goes when the drawing changes,
// and a copy that finishes after a change shows none. data-state lets tests see each step.
export default function CopyImageButton() {
  const ketcher = useSyncExternalStore(subscribeKetcher, getKetcher);
  const [state, setState] = useState<CopyState>('idle');
  const latest = useRef(0); // the newest copy; an older one's result is dropped
  const changed = useRef(false); // the drawing changed since the newest copy started

  useEffect(() => {
    if (!ketcher) return;
    const onChange = () => {
      changed.current = true;
      setState((current) => (current === 'copying' ? current : 'idle'));
    };
    ketcher.changeEvent.add(onChange);
    return () => ketcher.changeEvent.remove(onChange);
  }, [ketcher]);

  async function copy(from: Ketcher) {
    const id = ++latest.current;
    changed.current = false;
    setState('copying');
    let result: CopyState;
    try {
      // Called straight from the click: the clipboard write must start inside it.
      result = await copyDrawing(from);
    } catch (error) {
      console.error('Copy image failed:', error);
      result = 'failed';
    }
    if (id !== latest.current) return;
    setState(changed.current ? 'idle' : result);
  }

  const badge = BADGES[state];
  return (
    <>
      {/* Always in the page, so screen readers announce the message when it appears. */}
      <span role="status" className="app-header-items" data-testid="copy-status" data-state={state}>
        {badge && (
          <span className={badge.className} title={badge.title}>
            {badge.text}
          </span>
        )}
      </span>
      <button
        type="button"
        className="header-button"
        data-testid="app-copy-image-button"
        disabled={!ketcher}
        onClick={() => {
          if (!ketcher) return;
          countUse('copy-image');
          void copy(ketcher);
        }}
      >
        Copy image
      </button>
    </>
  );
}
