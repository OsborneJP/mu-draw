import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { KetSerializer } from 'ketcher-core';
import { StructRender } from 'ketcher-react';
import { getKetcher, subscribeKetcher } from '../editor/instance';
import { placeInHand } from '../editor/placeInHand';
import { GLASSWARE, GLASSWARE_CREDIT, GLASSWARE_GROUPS, pickGlassware, pieceUrl, type Piece } from './glassware';
import { GROUPS, heldTemplate, pickTemplate, subscribeTemplates, TEMPLATES, type Template } from './templates';
import './templates.css';

const PLACING = 'Click on the canvas to place it. Esc cancels.';
// Decision 5: what Ketcher's other formats do with glassware, said where students pick it.
const FORMATS_NOTE =
  'Glassware is kept by autosave, Ket Format files, Copy image and Export. Molfile, SMILES and ' +
  'other chemistry formats leave it out, and CDXML shows a placeholder.';
const TABS = [
  { id: 'structures', label: 'Structures' },
  { id: 'glassware', label: 'Glassware' },
] as const;
type Tab = (typeof TABS)[number]['id'];
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

/** The piece's picture: its own SVG file, which the name beside it describes. */
function PiecePicture({ piece }: { piece: Piece }) {
  return (
    <span aria-hidden="true" className="template-picture glassware-picture">
      <img src={pieceUrl(piece)} alt="" decoding="async" data-testid={`glassware-picture-${piece.id}`} />
    </span>
  );
}

// Templates (header): a menu with two tabs. Structures holds conformation and projection
// templates, Glassware the lab glassware (src/panels/glassware.ts), each with its picture.
// A click puts one in the student's hand, as Name to structure's Add does: it follows the
// mouse over the canvas until a click places it, and Esc puts it away
// (src/panels/templates.ts). Works offline: templates are in the app itself, and the
// glassware files are precached.
export default function TemplatesMenu() {
  const ketcher = useSyncExternalStore(subscribeKetcher, getKetcher);
  const holding = useSyncExternalStore(subscribeTemplates, heldTemplate);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>('structures');
  const wrapper = useRef<HTMLSpanElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  // Open: focus on the first item; Esc or a press anywhere else closes it.
  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLElement>('.template-item')?.focus();
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

  function pickPiece(piece: Piece) {
    setOpen(false);
    if (ketcher) void pickGlassware(ketcher, piece, placeInHand);
  }

  // The tabs' keys (WAI-ARIA tabs): Left and Right move to the other tab and show it.
  function onTabKey(event: ReactKeyboardEvent) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const next = TABS[(TABS.findIndex((t) => t.id === tab) + 1) % TABS.length].id;
    setTab(next);
    menu.current?.querySelector<HTMLElement>(`#templates-tab-${next}`)?.focus();
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
        title="Chair, Newman, Fischer and Haworth templates, and lab glassware"
        onClick={() => setOpen(!open)}
      >
        Templates
      </button>
      {open && (
        <div id="templates-menu" ref={menu} className="templates-menu" role="dialog" aria-label="Templates">
          <div role="tablist" aria-label="Kind" className="templates-tabs" onKeyDown={onTabKey}>
            {TABS.map((t) => (
              <button
                key={t.id}
                id={`templates-tab-${t.id}`}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                // Only the shown panel is in the page.
                aria-controls={tab === t.id ? `templates-panel-${t.id}` : undefined}
                tabIndex={tab === t.id ? 0 : -1}
                data-testid={`templates-tab-${t.id}`}
                onClick={() => setTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>
          {tab === 'structures' ? (
            <div role="tabpanel" id="templates-panel-structures" aria-labelledby="templates-tab-structures">
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
          ) : (
            <div role="tabpanel" id="templates-panel-glassware" aria-labelledby="templates-tab-glassware">
              {GLASSWARE_GROUPS.map((group) => (
                <section key={group} aria-label={group}>
                  <h2>{group}</h2>
                  <div className="templates-grid">
                    {GLASSWARE.filter((p) => p.group === group).map((piece) => (
                      <button
                        key={piece.id}
                        type="button"
                        className="template-item"
                        data-testid={`glassware-item-${piece.id}`}
                        onClick={() => pickPiece(piece)}
                      >
                        <PiecePicture piece={piece} />
                        <span>{piece.name}</span>
                      </button>
                    ))}
                  </div>
                </section>
              ))}
              <p className="glassware-note" data-testid="glassware-note">
                {FORMATS_NOTE}
              </p>
              <p className="glassware-credit" data-testid="glassware-credit">
                {GLASSWARE_CREDIT} Details: About.
              </p>
            </div>
          )}
        </div>
      )}
    </span>
  );
}
