import { describe, expect, it } from 'vitest';
import { crc32, pngChunks, pngFileName, withDpi } from './exportImage';

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(Uint8Array.from(type, (char) => char.charCodeAt(0)), 4);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** A 1×1 RGBA PNG's chunk layout, plus any extra chunks before IDAT. withDpi never reads
 * the pixels, so IDAT holds placeholder bytes; e2e/export.spec.ts checks real PNGs. */
function tinyPng(extra: Uint8Array[] = []): Uint8Array {
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, 1);
  view.setUint32(4, 1);
  ihdr.set([8, 6, 0, 0, 0], 8); // 8-bit RGBA, no interlace
  const pixels = Uint8Array.from([1, 2, 3, 4, 5]);
  const parts = [
    Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    ...extra,
    chunk('IDAT', pixels),
    chunk('IEND', new Uint8Array()),
  ];
  return Uint8Array.from(parts.flatMap((part) => [...part]));
}

function physOf(png: Uint8Array) {
  const found = pngChunks(png).filter((c) => c.type === 'pHYs');
  expect(found).toHaveLength(1);
  const bytes = found[0].bytes;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    x: view.getUint32(8),
    y: view.getUint32(12),
    unit: bytes[16],
    crcOk: view.getUint32(17) === crc32(bytes.subarray(4, 17)),
  };
}

describe('withDpi', () => {
  it.each([
    // 96, 192 and 384 dpi in pixels per metre, rounded
    [1, 3780],
    [2, 7559],
    [4, 15118],
  ] as const)('marks a %sx PNG as %s pixels per metre, right after IHDR', (scale, perMetre) => {
    const png = withDpi(tinyPng(), scale);
    expect(pngChunks(png).map((c) => c.type)).toEqual(['IHDR', 'pHYs', 'IDAT', 'IEND']);
    expect(physOf(png)).toEqual({ x: perMetre, y: perMetre, unit: 1, crcOk: true });
  });

  it('replaces a pHYs the PNG already had, keeping every other chunk byte for byte', () => {
    const old = new Uint8Array(9);
    old[8] = 1;
    const original = tinyPng([chunk('pHYs', old)]);
    const png = withDpi(original, 2);
    expect(physOf(png).x).toBe(7559);
    const kept = (p: Uint8Array) => pngChunks(p).filter((c) => c.type !== 'pHYs').map((c) => [...c.bytes]);
    expect(kept(png)).toEqual(kept(original));
  });

  it('refuses bytes that are not a PNG', () => {
    expect(() => withDpi(Uint8Array.from([1, 2, 3]), 1)).toThrow('bad signature');
    const truncated = tinyPng().subarray(0, 30);
    expect(() => withDpi(truncated, 1)).toThrow('truncated');
  });
});

describe('crc32', () => {
  it('gives the standard CRC-32 check value', () => {
    // The published check value: CRC-32 of the ASCII digits "123456789".
    expect(crc32(Uint8Array.from('123456789', (char) => char.charCodeAt(0)))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array())).toBe(0);
  });
});

describe('pngFileName', () => {
  it('names each scale', () => {
    expect([1, 2, 4].map((s) => pngFileName(s as 1 | 2 | 4))).toEqual([
      'structure.png',
      'structure-2x.png',
      'structure-4x.png',
    ]);
  });
});
