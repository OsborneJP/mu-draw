import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GHS_PICTOGRAMS, pictogramFile } from '../../src/panels/ghsPictograms';
import { checkSvg } from './svg';

const shipped = (code: string) => readFileSync(new URL(`../../public/ghs/${code}.svg`, import.meta.url), 'utf8');
// A shipped file with something planted just inside its root element.
const planted = (extra: string) => shipped('GHS07').replace(/(<svg[^>]*>)/, `$1${extra}`);

describe('checkSvg', () => {
  it.each(GHS_PICTOGRAMS)('passes the shipped %s', (code) => {
    expect(pictogramFile(code)).toBe(`ghs/${code}.svg`);
    expect(checkSvg(shipped(code))).toEqual([]);
  });

  it.each([
    ['a script', '<script>alert(1)</script>', 'has a script'],
    ['an event handler', '<g onload="alert(1)"/>', 'has an event handler'],
    ['an entity', '<!ENTITY x "y">', 'has a DOCTYPE or an entity'],
    ['an outside image', '<image href="https://example.org/x.png"/>', 'embeds or links to other content'],
    ['a link', '<a href="#x"><path d="M0 0"/></a>', 'embeds or links to other content'],
    ['foreign content', '<foreignObject><div/></foreignObject>', 'embeds or links to other content'],
    ['an imported stylesheet', '<style>@import "https://example.org/x.css";</style>', 'imports a stylesheet'],
  ])('fails on %s', (_, extra, problem) => {
    expect(checkSvg(planted(extra))).toContain(problem);
  });

  it('fails on a reference outside the file, by href or by url()', () => {
    expect(checkSvg(planted('<use xlink:href="other.svg#x"/>'))).toEqual(['refers outside itself: other.svg#x']);
    expect(checkSvg(planted('<use href="https://example.org/a.svg#x"/>'))).toEqual([
      'refers outside itself: https://example.org/a.svg#x',
    ]);
    expect(checkSvg(planted('<path fill="url(https://example.org/p)" d="M0 0"/>'))).toEqual([
      'refers outside itself: https://example.org/p',
    ]);
  });

  it('allows references inside the file', () => {
    expect(checkSvg(planted('<use href="#a"/><path fill="url(#g)" d="M0 0"/>'))).toEqual([]);
  });

  it('fails on a file that is not an SVG', () => {
    expect(checkSvg('<html><body/></html>')).toEqual(['not an SVG document']);
  });
});
