import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { KetSerializer } from 'ketcher-core';
import { StructRender } from 'ketcher-react';
import { getKetcher, subscribeKetcher } from '../editor/instance';
import { placeInHand } from '../editor/placeInHand';
import { GROUPS, heldTemplate, pickTemplate, subscribeTemplates, TEMPLATES, type Template } from './templates';
import './templates.css';

const PLACING = 'Click on the canvas to place it. Esc cancels.';
const serializer = new KetSerializer();
// Drawn in the page by Ketcher's own renderer, as its Structure Library draws its thumbnails.
// Not from Ketcher's render cache: it is keyed by structure name, and these have none.
const PICTURE_OPTIONS = { autoScaleMargin: 6, downScale: true, needCache: false };

/** The template's picture. Hidden from screen readers: the SVG's text (its atom labels and
 * Raphaël's credit) would otherwise become part of the button's name. */
function Picture({ template }: { template: Template }) {
  const struct = useMemo(() => serializer.deserialize(JSON.stringify(template.ket)), [template]);
  return (
    <span aria-hidden="true" className="template-picture">
      <StructRender struct={struct} options={PICTURE_OPTIONS} fullsize testId={`template-picture-${template.id}`} />
    </span>
  );
}

// Templates (header): a menu of conformation and projection templates, each with its
// picture. A click puts one in the student's hand, as Name to structure's Add does: it
// follows the mouse over the canvas until a click places it, and Esc puts it away
// (src/panels/templates.ts). Works offline: the templates are in the app itself.
export default function TemplatesMenu() {
  const ketcher = useSyncExternalStore(subscribeKetcher, getKetcher);
  const holding = useSyncExternalStore(subscribeTemplates, heldTemplate);
  const [open, setOpen] = useState(false);
  const wrapper = useRef<HTMLSpanElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  // Open: focus on the first template; Esc or a press anywhere else closes it.
  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector('button')?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      setOpen(false);
      button.current?.focus();
    }
    function onPointerDown(event: PointerEvent) {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, [open]);

  function pick(template: Template) {
    setOpen(false);
    if (ketcher) void pickTemplate(ketcher, template, placeInHand);
  }

  return (
    <span className="templates" ref={wrapper}>
      {holding && (
        <span role="status" className="info-badge" data-testid="templates-placing">
          {PLACING}
        </span>
      )}
      <button
        ref={button}
        type="button"
        className="header-button"
        data-testid="templates-button"
        aria-expanded={open}
        aria-controls="templates-menu"
        disabled={!ketcher}
        title="Chair, Newman, Fischer and Haworth templates"
        onClick={() => setOpen(!open)}
      >
        Templates
      </button>
      {open && (
        <div id="templates-menu" ref={menu} className="templates-menu" role="dialog" aria-label="Templates">
          {GROUPS.map((group) => (
            <section key={group} aria-label={group}>
              <h2>{group}</h2>
              <div className="templates-grid">
                {TEMPLATES.filter((t) => t.group === group).map((template) => (
                  <button
                    key={template.id}
                    type="button"
                    className="template-item"
                    data-testid={`template-item-${template.id}`}
                    onClick={() => pick(template)}
                  >
                    <Picture template={template} />
                    <span>{template.name}</span>
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </span>
  );
}
