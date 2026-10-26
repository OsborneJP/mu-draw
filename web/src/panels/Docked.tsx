import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';
import type { Ketcher } from 'ketcher-core';

/** A panel docked at the bottom of the canvas area (Practice, the ¹³C NMR preview, the
 * stereoisomers), so the canvas gets shorter instead of being covered. Ketcher keeps its
 * view's top-left corner when the canvas resizes, which would leave the drawing low, behind
 * its bottom toolbar; so the view moves down by half of whatever height the panel takes (and
 * back when it closes): the middle of the canvas stays in the middle. Ketcher's own resize
 * sets only the view's size, so the order of the two doesn't matter. data-docked says how
 * much height has been made up for (tests wait on it). */
export default function Docked({
  ketcher,
  className,
  label,
  testId,
  state,
  onKeyDown,
  children,
}: {
  ketcher: Ketcher;
  className: string;
  label: string;
  testId: string;
  state: string;
  onKeyDown?: (event: KeyboardEvent) => void;
  children: ReactNode;
}) {
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    const element = panel.current;
    if (!element) return;
    const render = ketcher.editor.render;
    let made = 0;
    const makeUp = (height: number) => {
      const dy = (height - made) / 2 / render.options.zoom;
      made = height;
      render.setViewBox((view) => ({ ...view, minY: view.minY + dy }));
      element.dataset.docked = String(height);
    };
    const observer = new ResizeObserver(() => makeUp(element.offsetHeight));
    observer.observe(element);
    return () => {
      observer.disconnect();
      makeUp(0);
    };
  }, [ketcher]);
  return (
    <section ref={panel} className={className} aria-label={label} data-testid={testId} data-state={state} onKeyDown={onKeyDown}>
      {children}
    </section>
  );
}
