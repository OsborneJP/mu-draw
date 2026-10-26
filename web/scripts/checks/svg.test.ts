import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GHS_PICTOGRAMS, pictogramFile } from '../../src/panels/ghsPictograms';
import { checkSvg } from './svg';

const shipped = (code: string) => readFileSync(new URL(`../../public/ghs/${code}.svg`, import.meta.url), 'utf8');
// A shipped file with something planted just inside its root element.
const planted = (extra: string) => shipped('GHS07').replace(/(<svg[^>]*>)/, `$1${extra}`);

// Each file is Wikimedia Commons' copy of the UNECE pictogram it is named for, unedited
// (THIRD-PARTY-NOTICES.md); pinned so a swapped or edited file fails here.
const COMMONS: Record<string, [string, string]> = {
  GHS01: ['GHS-pictogram-explos.svg', '7daedecc22828389b734a0735a0e207f483184b1e4e3446e8b009df9ebff1c43'],
  GHS02: ['GHS-pictogram-flamme.svg', 'e812ae23f6139af28167cab0a6ad131c116677121b785098a57213c281e03752'],
  GHS03: ['GHS-pictogram-rondflam.svg', 'aab8cd9f2f842a499768ef1ac58a7ae2947e0a0b9ce9835167d4da1b45320904'],
  GHS04: ['GHS-pictogram-bottle.svg', '5792f474c746302f73d075a91cf5eb5872fa4de1e2068b02f44537177746aeae'],
  GHS05: ['GHS-pictogram-acid.svg', 'e70b57e57cb7a53ef97b8b0f9d7d143674293b6bb1338991dfebdfd5848097c0'],
  GHS06: ['GHS-pictogram-skull.svg', '8f84bcbb0e09d83011afda408e001cb9fc15603dba4a47a673b55db867ba4394'],
  GHS07: ['GHS-pictogram-exclam.svg', '0774fa5f0b69944b5732df42195310513745f1835222b7c6fe51dfb8cffa7372'],
  GHS08: ['GHS-pictogram-silhouette.svg', 'a9d7063bf811a5a8462b6aef95b9e1cfff7cf4799242104a9ecae365c0483029'],
  GHS09: ['GHS-pictogram-pollu.svg', 'ac03bb8aa044e841ffb84c1d1e7a2453c2553475750a2b97bd2bdac891071d19'],
};

describe('the shipped pictograms', () => {
  it.each(GHS_PICTOGRAMS)('%s passes and is the Commons file it is named for', (code) => {
    expect(pictogramFile(code)).toBe(`ghs/${code}.svg`);
    expect(checkSvg(shipped(code))).toEqual([]);
    expect(createHash('sha256').update(shipped(code)).digest('hex'), COMMONS[code][0]).toBe(COMMONS[code][1]);
  });
});

describe('checkSvg', () => {
  it.each([
    ['a script', '<script>alert(1)</script>', 'has an element outside the allowlist: script'],
    ['a prefixed script', '<s:script xmlns:s="http://www.w3.org/2000/svg">alert(1)</s:script>', 'has an element outside the allowlist: s:script'],
    ['an XHTML script', '<h:script xmlns:h="http://www.w3.org/1999/xhtml">alert(1)</h:script>', 'has an element outside the allowlist: h:script'],
    ['an event handler', '<g onload="alert(1)"/>', 'has an attribute outside the allowlist: onload'],
    ['an outside image', '<image href="https://example.org/x.png"/>', 'has an element outside the allowlist: image'],
    ['a link', '<a href="#x"><path d="M0 0"/></a>', 'has an element outside the allowlist: a'],
    ['foreign content', '<foreignObject><div/></foreignObject>', 'has an element outside the allowlist: foreignObject'],
    ['an iframe in foreign content', '<s:foreignObject xmlns:s="http://www.w3.org/2000/svg"><h:iframe src="https://example.org"/></s:foreignObject>', 'has an element outside the allowlist: s:foreignObject'],
    ['a stylesheet', '<style>@import "https://example.org/x.css";</style>', 'has an element outside the allowlist: style'],
    ['an animation setting a link', '<set attributeName="href" to="https://example.org"/>', 'has an element outside the allowlist: set'],
    ['a use of another file', '<use href="other.svg#x"/>', 'has an element outside the allowlist: use'],
    ['an outside fill by url()', '<path fill="url(https://example.org/p)" d="M0 0"/>', 'has an attribute value not allowed: fill="url(https://example.org/p)"'],
    ['a CSS escape in a style', '<path style="fill:u\\72l(https://example.org/p)" d="M0 0"/>', 'has an attribute value not allowed: style="fill:u\\72l(https://example.org/p)"'],
    ['an entity in a value', '<path fill="u&#114;l(https://example.org/p)" d="M0 0"/>', 'has an attribute value not allowed: fill="u&#114;l(https://example.org/p)"'],
    ['image-set in a style', '<path style="fill:image-set(&quot;https://example.org&quot; 1x)" d="M0 0"/>', 'has an attribute value not allowed: style="fill:image-set(&quot;https://example.org&quot; 1x)"'],
    ['a src attribute', '<path src="https://example.org" d="M0 0"/>', 'has an attribute outside the allowlist: src'],
    ['an xlink:href', '<path xlink:href="https://example.org" d="M0 0"/>', 'has an attribute outside the allowlist: xlink:href'],
    ['text', '<g>hello</g>', 'has text'],
  ])('fails on %s', (_, extra, problem) => {
    expect(checkSvg(planted(extra))).toContain(problem);
  });

  it.each([
    ['CDATA hiding a script from a comment-stripper', '<g><![CDATA[ <!-- ]]></g><script>alert(1)</script><g><![CDATA[ --> ]]></g>'],
    ['processing instructions doing the same', '<?x <!-- ?><script>alert(1)</script><?x --> ?>'],
    ['an entity declaration', '<!ENTITY x "y">'],
    ['a DOCTYPE', '<!DOCTYPE svg>'],
  ])('fails on %s', (_, extra) => {
    expect(checkSvg(planted(extra))).toContainEqual(expect.stringMatching(/^has markup other than elements and comments/));
  });

  it('fails on a file that is not an SVG', () => {
    expect(checkSvg('<html><body/></html>')).toContain('not an SVG document');
  });

  it('allows comments and an XML prolog', () => {
    expect(checkSvg(`<?xml version="1.0" encoding="UTF-8"?><!-- made by hand -->${planted('<!-- a note -->')}`)).toEqual([]);
  });
});
