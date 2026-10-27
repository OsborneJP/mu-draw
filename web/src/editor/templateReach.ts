import { CoordinateTransformation, FunctionalGroup, type Atom, type Ketcher, type Render, type Vec2 } from 'ketcher-core';

// Ketcher's template tool (the rings under the canvas and its Structure Library) joins a
// template to an atom or a bond only when the cursor is within 0.4 bond lengths of the
// atom, or on the bond's drawn line: at ACS size and 100% zoom, about 7 px either way
// (measured), so students had to be right on top of it. ChemDraw is looser (Jeff,
// 2026-10-27; docs/plans/template-reach.md). So while the template tool is in use, where
// Ketcher finds nothing the app looks further: the nearest atom or bond within REACH_PX.
// Ketcher's hover highlight, its preview of the joined template and the drop all ask the
// editor's findItem, so all three agree. Every other tool keeps Ketcher's own reach.

/** How far from an atom, or from a bond's line, the cursor may be, in screen pixels: a 24 px
 * target, WCAG 2.2's minimum target size. Zoomed in far enough that a bond is over 30 px on
 * screen, Ketcher's own reach is the larger, and it decides. */
export const REACH_PX = 12;

export interface Point {
  x: number;
  y: number;
}

export interface Target {
  map: 'atoms' | 'bonds';
  id: number;
  /** As Ketcher ranks it: to the atom, or to the bond's middle. */
  dist: number;
}

/** The atom or bond nearest `cursor` within `reach`, all in screen pixels. Nearest as
 * Ketcher ranks them: an atom by its distance, a bond by the distance to its middle, so a
 * bond's middle half is the bond's and its ends are its atoms'. A bond is in reach only
 * beside it, not beyond its ends. */
export function nearestInReach(
  cursor: Point,
  atoms: Iterable<readonly [number, Point]>,
  bonds: Iterable<readonly [number, Point, Point]>,
  reach: number,
): Target | null {
  let best: Target | null = null;
  for (const [id, at] of atoms) {
    const dist = Math.hypot(cursor.x - at.x, cursor.y - at.y);
    if (dist <= reach && (best === null || dist < best.dist)) best = { map: 'atoms', id, dist };
  }
  for (const [id, begin, end] of bonds) {
    const dx = end.x - begin.x;
    const dy = end.y - begin.y;
    const length = Math.hypot(dx, dy);
    if (length === 0) continue;
    const along = ((cursor.x - begin.x) * dx + (cursor.y - begin.y) * dy) / length;
    const across = Math.abs((cursor.x - begin.x) * dy - (cursor.y - begin.y) * dx) / length;
    if (along < 0 || along > length || across > reach) continue;
    const dist = Math.hypot(cursor.x - (begin.x + end.x) / 2, cursor.y - (begin.y + end.y) / 2);
    if (best === null || dist < best.dist) best = { map: 'bonds', id, dist };
  }
  return best;
}

/** Ketcher's editor (ketcher-react), as far as this file uses it. */
interface FindingEditor {
  render: Render;
  tool(): unknown;
  findItem(event: MouseEvent, maps: string[] | null, skip?: unknown): unknown;
}

/** What Ketcher's template tool joins a template to (its findItems: atoms and bonds, or atoms
 * alone for a functional group or a salt), or null for any other tool. The template tool is
 * the one with a template preview (ketcher-react's TemplateTool; class names don't survive
 * the build). */
function templateTargets(tool: unknown): readonly unknown[] | null {
  if (typeof tool !== 'object' || tool === null || !('templatePreview' in tool) || !('findItems' in tool)) return null;
  return Array.isArray(tool.findItems) ? tool.findItems : null;
}

/** Widens the template tool's reach (above). Call once per Ketcher. */
export function widenTemplateReach(ketcher: Ketcher): void {
  const editor = ketcher.editor as unknown as FindingEditor;
  const find = editor.findItem.bind(editor);
  editor.findItem = (event, maps, skip = null) => {
    const found = find(event, maps, skip);
    const targets = templateTargets(editor.tool());
    if (found || skip !== null || maps === null || targets === null) return found;
    // Only what the tool joins a template to: its preview asks for bonds even with a
    // functional group in hand, which never joins one.
    return inReach(editor.render, event, maps.filter((map) => targets.includes(map)));
  };
}

/** What nearestInReach finds among the drawing's atoms and bonds, skipping what Ketcher's own
 * search skips: the template's own preview, and atoms inside a contracted abbreviation
 * ("Ph", "CO2Et"). Bonds into one are skipped too: its label sits on its hidden attachment
 * atom, so such a bond, measured to that atom, would reach over the label, where Ketcher
 * finds nothing. Its distance comes back in bond lengths, Ketcher's unit. */
function inReach(render: Render, event: MouseEvent, maps: string[]): Target | null {
  const restruct = render.ctab;
  const view = (point: Vec2) => CoordinateTransformation.modelToView(point, render);
  const hidden = (atom: Atom) =>
    FunctionalGroup.isAtomInContractedFunctionalGroup(atom, restruct.sgroups, restruct.molecule.functionalGroups);
  const atoms: [number, Point][] = [];
  if (maps.includes('atoms')) {
    restruct.visibleAtoms.forEach(({ a }, id) => {
      if (!a.isPreview && !hidden(a)) atoms.push([id, view(a.pp)]);
    });
  }
  const bonds: [number, Point, Point][] = [];
  if (maps.includes('bonds')) {
    restruct.visibleBonds.forEach(({ b }, id) => {
      const begin = restruct.molecule.atoms.get(b.begin);
      const end = restruct.molecule.atoms.get(b.end);
      if (b.isPreview || !begin || !end || hidden(begin) || hidden(end)) return;
      bonds.push([id, view(begin.pp), view(end.pp)]);
    });
  }
  const cursor = CoordinateTransformation.canvasToView(CoordinateTransformation.pageToCanvas(event, render), render);
  const target = nearestInReach(cursor, atoms, bonds, REACH_PX);
  return target && { ...target, dist: target.dist / (render.options.microModeScale * render.options.zoom) };
}
