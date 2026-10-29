// Export and copy (spec section 4), entirely on the device: nothing here makes a request.
//
// Every image starts as Indigo's SVG rendering of the whole drawing (ketcher.generateImage,
// which applies the student's Ketcher display settings), at CSS pixels (AT_CSS_PIXELS), so
// ACS's sizes in points come out at print size. The SVG file is that text. A PNG is
// that SVG drawn on a canvas at 1x, 2x or 4x, so every scale is the same picture at exactly
// scale × the SVG's size. Each PNG says it is 96 × scale dpi, so Word places all three at
// the same size: a higher scale is sharper, not bigger.
//
// Not used (measured on Ketcher 3.18, see BUILD-LEARNINGS.md): exportImage('svg') copies the
// canvas at the screen's zoom and offsets it by Ketcher's own toolbar sizes, so the app's
// header would clip it; Indigo's own PNG keeps fixed margins when the bond length grows, so
// its sizes are never an exact multiple.
//
// The SVG reaches the canvas as a data: image, which img-src allows (web/csp.json); blob:
// images are not allowed. Downloads use a blob: link, which the CSP doesn't govern.
import type { Ketcher } from 'ketcher-core';
import { download } from '../download';

export type Scale = 1 | 2 | 4;
export const SCALES: readonly Scale[] = [1, 2, 4];
/** Copy image always uses this scale and a white background (see copyDrawing). */
export const COPY_SCALE: Scale = 2;

/** CSS pixels per inch: Indigo draws 1x in CSS pixels. */
const CSS_DPI = 96;

/** Every picture the app makes asks Indigo for CSS pixels, over the student's display
 * settings. Sizes set in points, as ACS's are, then come out at print size (ACS's 14.4 pt
 * bond is 0.2 in), and sizes set in pixels are unchanged. At Ketcher's own image resolution
 * (600 dpi in its ACS preset) an ACS drawing would come out 6.25 times too big. */
export const AT_CSS_PIXELS = { 'image-resolution': CSS_DPI } as const;

/** 'empty': the drawing is empty, so nothing was saved or copied. */
export type Outcome = 'done' | 'empty';

export const SVG_FILE_NAME = 'structure.svg';

export function pngFileName(scale: Scale): string {
  return scale === 1 ? 'structure.png' : `structure-${scale}x.png`;
}

/** Download the drawing as a PNG at `scale`, on white unless `transparent`. */
export async function savePng(ketcher: Ketcher, scale: Scale, transparent: boolean): Promise<Outcome> {
  if (isEmpty(ketcher)) return 'empty';
  download(await drawingPng(ketcher, scale, transparent), pngFileName(scale));
  return 'done';
}

/** Download the drawing as an SVG (transparent background). */
export async function saveSvg(ketcher: Ketcher): Promise<Outcome> {
  if (isEmpty(ketcher)) return 'empty';
  download(new Blob([await drawingSvg(ketcher)], { type: 'image/svg+xml' }), SVG_FILE_NAME);
  return 'done';
}

/** Copy image: the drawing as a PNG at COPY_SCALE on white, like Ketcher's own Copy Image,
 * for pasting into Word or Google Docs. The clipboard write starts inside the student's
 * click, with the PNG still being made, so the browser counts it as their action however
 * long the drawing takes. Call it straight from the click handler. */
export function copyDrawing(ketcher: Ketcher): Promise<Outcome> {
  if (isEmpty(ketcher)) return Promise.resolve('empty');
  const png = drawingPng(ketcher, COPY_SCALE, false);
  // A browser that refuses the write never reads the PNG, so its failure would go unhandled;
  // otherwise the failure arrives through the write.
  png.catch(() => {});
  return navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]).then(() => 'done');
}

function isEmpty(ketcher: Ketcher): boolean {
  return ketcher.editor.struct().isBlank();
}

async function drawingSvg(ketcher: Ketcher): Promise<string> {
  const ket = await ketcher.getKet();
  return (await ketcher.generateImage(ket, { outputFormat: 'svg', ...AT_CSS_PIXELS })).text();
}

async function drawingPng(ketcher: Ketcher, scale: Scale, transparent: boolean): Promise<Blob> {
  const svg = await drawingSvg(ketcher);
  const root = new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement;
  const width = Math.ceil(Number(root.getAttribute('width')) * scale);
  const height = Math.ceil(Number(root.getAttribute('height')) * scale);
  if (!(width > 0 && height > 0)) throw new Error('the SVG has no size');
  const image = new Image();
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await image.decode();
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('no 2D canvas');
  if (!transparent) {
    context.fillStyle = '#fff';
    context.fillRect(0, 0, width, height);
  }
  context.drawImage(image, 0, 0, width, height);
  // null when the browser can't encode a canvas this large (a big drawing at 4x).
  const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!png) throw new Error('the canvas could not be encoded as PNG');
  return new Blob([withDpi(new Uint8Array(await png.arrayBuffer()), scale)], { type: 'image/png' });
}


const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

/** The PNG with a pHYs chunk saying 96 × scale dpi, placed right after IHDR (any pHYs it
 * had is dropped). PNG measures density in pixels per metre. */
export function withDpi(png: Uint8Array, scale: Scale): Uint8Array<ArrayBuffer> {
  const chunks = pngChunks(png);
  if (chunks[0]?.type !== 'IHDR') throw new Error('not a PNG: IHDR is not the first chunk');
  const perMetre = Math.round((CSS_DPI * scale) / 0.0254);
  const phys = new Uint8Array(4 + 4 + 9 + 4);
  const view = new DataView(phys.buffer);
  view.setUint32(0, 9);
  phys.set(ascii('pHYs'), 4);
  view.setUint32(8, perMetre);
  view.setUint32(12, perMetre);
  phys[16] = 1; // the unit is the metre
  view.setUint32(17, crc32(phys.subarray(4, 17)));
  const kept = chunks.filter((chunk) => chunk.type !== 'pHYs').map((chunk) => chunk.bytes);
  return concat([png.subarray(0, PNG_SIGNATURE.length), kept[0], phys, ...kept.slice(1)]);
}

/** A PNG's chunks in order, each with its whole bytes (length, type, data, CRC). */
export function pngChunks(png: Uint8Array): { type: string; bytes: Uint8Array }[] {
  if (!PNG_SIGNATURE.every((byte, i) => png[i] === byte)) throw new Error('not a PNG: bad signature');
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const chunks = [];
  for (let at = PNG_SIGNATURE.length; at < png.length; ) {
    if (at + 12 > png.length) throw new Error('not a PNG: truncated chunk');
    const end = at + 12 + view.getUint32(at);
    if (end > png.length) throw new Error('not a PNG: truncated chunk');
    chunks.push({ type: String.fromCharCode(...png.subarray(at + 4, at + 8)), bytes: png.subarray(at, end) });
    at = end;
  }
  return chunks;
}

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

/** CRC-32 as PNG uses it (over a chunk's type and data). */
export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function ascii(text: string): Uint8Array {
  return Uint8Array.from(text, (char) => char.charCodeAt(0));
}

function concat(parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}
