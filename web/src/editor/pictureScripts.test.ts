import { describe, expect, it } from 'vitest';
import { DEFAULT_TEXT_SIZE, smallerScripts, withSmallerScripts } from './pictureScripts';

/** A KET drawing with one text, as Ketcher 3.18 writes it. */
function drawing(parts: object[]) {
  const text = { type: 'text', boundingBox: { x: 1, y: -1, width: 2, height: 0.4 }, paragraphs: [{ parts }] };
  return JSON.stringify({ root: { nodes: [text], connections: [], templates: [] }, ket_version: '2.0.0' });
}

function parts(data: string): object[] {
  return JSON.parse(data).root.nodes[0].paragraphs[0].parts;
}

describe('smallerScripts', () => {
  it('draws subscripts and superscripts at 75% of the default size, in whole pixels', () => {
    expect(DEFAULT_TEXT_SIZE).toBe(13);
    const data = drawing([{ text: 'H' }, { text: '2', subscript: true }, { text: 'O Cu' }, { text: '2+', superscript: true }]);
    expect(parts(smallerScripts(data))).toEqual([
      { text: 'H' },
      { text: '2', subscript: true, font: { size: 10 } },
      { text: 'O Cu' },
      { text: '2+', superscript: true, font: { size: 10 } },
    ]);
  });

  it("takes 75% of a run's own size, keeping the rest of its font", () => {
    const own = drawing([{ text: '2', subscript: true, bold: true, font: { size: 20, family: 'Arial' } }]);
    expect(parts(smallerScripts(own))).toEqual([{ text: '2', subscript: true, bold: true, font: { size: 15, family: 'Arial' } }]);
    const small = drawing([{ text: '+', superscript: true, font: { size: 4 } }]);
    expect(parts(smallerScripts(small))).toEqual([{ text: '+', superscript: true, font: { size: 3 } }]);
  });

  it('gives back anything else exactly as it came', () => {
    const plain = drawing([{ text: 'H2O' }]);
    expect(smallerScripts(plain)).toBe(plain);
    const structure = JSON.stringify({ root: { nodes: [{ $ref: 'mol0' }] }, mol0: { type: 'molecule', atoms: [] } });
    expect(smallerScripts(structure)).toBe(structure);
    expect(smallerScripts('not a KET drawing')).toBe('not a KET drawing');
    expect(smallerScripts('null')).toBe('null');
  });
});

describe('withSmallerScripts', () => {
  it('hands the picture request the smaller copy, with its options', async () => {
    const seen: [string, unknown][] = [];
    const service = withSmallerScripts({
      generateImageAsBase64(data: string, options?: unknown) {
        seen.push([data, options]);
        return Promise.resolve('picture');
      },
    });
    const data = drawing([{ text: '2', subscript: true }]);
    const options = { outputFormat: 'svg' as const };
    expect(await service.generateImageAsBase64(data, options)).toBe('picture');
    expect(seen).toEqual([[smallerScripts(data), options]]);
    expect(seen[0][0]).not.toBe(data);
  });
});
