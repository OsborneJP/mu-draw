// Pictures of the drawing (Export, Copy image, Ketcher's Save as SVG or PNG) are drawn by
// Indigo, which draws a text's subscripts and superscripts at full size, only moved half
// their height down or up (Indigo 1.46, render_context.cpp). Ketcher's canvas and ChemDraw
// draw them smaller. So each picture is drawn from a copy of the drawing in which they are
// 75% of their size, ChemDraw's "about 25 percent" smaller (docs/plans/v2-formula-text.md,
// decision 6). The drawing itself, and so every saved file, is unchanged.
import type { StructService } from 'ketcher-core';

/** A text run's size when it sets none: Ketcher's Text Editor default, and Indigo's. */
export const DEFAULT_TEXT_SIZE = 13;
export const SCRIPT_SCALE = 0.75;

interface TextPart {
  subscript?: boolean;
  superscript?: boolean;
  font?: { size?: number };
}
interface KetNode {
  type?: string;
  paragraphs?: { parts?: TextPart[] }[];
}

/** `data` with each subscript and superscript text run at 75% of its size, in whole pixels:
 * Indigo ignores a fractional size (measured: 9.75 px drew at full size). A run's size is its
 * own or the default: Ketcher writes sizes only on runs, and Indigo applies a line's or a
 * text's size only up to the first run with a size of its own. Anything that is not a KET
 * drawing with text (Practice's Molfiles) comes back as it is. */
export function smallerScripts(data: string): string {
  let drawing: { root?: { nodes?: KetNode[] } };
  try {
    drawing = JSON.parse(data);
  } catch {
    return data;
  }
  const nodes = drawing?.root?.nodes;
  if (!Array.isArray(nodes)) return data;
  let changed = false;
  for (const node of nodes) {
    if (node?.type !== 'text' || !Array.isArray(node.paragraphs)) continue;
    for (const paragraph of node.paragraphs) {
      for (const part of paragraph.parts ?? []) {
        if (!part.subscript && !part.superscript) continue;
        const size = part.font?.size ?? DEFAULT_TEXT_SIZE;
        part.font = { ...part.font, size: Math.max(1, Math.round(size * SCRIPT_SCALE)) };
        changed = true;
      }
    }
  }
  return changed ? JSON.stringify(drawing) : data;
}

/** Makes a service draw every picture with smaller subscripts and superscripts. Applied
 * before Ketcher binds the service's methods, as imageQueue is. */
export function withSmallerScripts<S extends Pick<StructService, 'generateImageAsBase64'>>(service: S): S {
  const target: Pick<StructService, 'generateImageAsBase64'> = service;
  const generate = target.generateImageAsBase64.bind(service);
  target.generateImageAsBase64 = (data, options) => generate(smallerScripts(data), options);
  return service;
}
