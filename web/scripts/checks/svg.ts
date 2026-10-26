// The GHS pictograms (web/public/ghs/) are third-party SVGs shipped as the app's own files. An
// SVG can carry scripts and references to other sites. The panel shows them with <img>, where
// neither runs, but a student can open the file itself, and invariant 1 allows no reference
// out of the app. So this check allows only what plain drawn shapes need: an allowlist of
// elements and attributes, each attribute's value in a fixed form, and no other markup
// (CDATA, DOCTYPE, entities, processing instructions, namespace prefixes, text). Anything it
// can't read is a problem, so a trick it doesn't know fails rather than passes.

const SVG_NS = 'http://www.w3.org/2000/svg';
const ELEMENTS = new Set(['svg', 'g', 'path', 'circle', 'ellipse', 'rect', 'line', 'polyline', 'polygon']);
const NUMBERS = /^[-+\d.eE,\s%]*$/;
const COLOUR = /^(#[0-9a-fA-F]{3,8}|[a-zA-Z]+)$/;
const TRANSFORM = /^(\s*(matrix|translate|scale|rotate|skewX|skewY)\(\s*[-+\d.eE,\s]*\)\s*,?)*\s*$/;
const PATH_DATA = /^[MmLlHhVvCcSsQqTtAaZz\d\s.,eE+-]*$/;
const STYLE_PROPERTIES = new Set(['fill', 'stroke', 'stroke-width', 'opacity', 'fill-opacity', 'stroke-opacity', 'fill-rule']);

function styleProblem(value: string): boolean {
  return !value
    .split(';')
    .filter((d) => d.trim() !== '')
    .every((declaration) => {
      const [property, text, ...more] = declaration.split(':').map((s) => s.trim());
      if (more.length > 0 || !STYLE_PROPERTIES.has(property)) return false;
      return property.startsWith('fill') || property.startsWith('stroke') ? COLOUR.test(text) || NUMBERS.test(text) || text === 'evenodd' || text === 'nonzero' : NUMBERS.test(text);
    });
}

/** Each allowed attribute and the form its value must have. */
const ATTRIBUTES: Record<string, (value: string) => boolean> = {
  xmlns: (v) => v === SVG_NS,
  'xmlns:svg': (v) => v === SVG_NS,
  version: (v) => /^\d+(\.\d+)?$/.test(v),
  viewBox: (v) => NUMBERS.test(v),
  width: (v) => /^[\d.]+(px|pt|%)?$/.test(v),
  height: (v) => /^[\d.]+(px|pt|%)?$/.test(v),
  d: (v) => PATH_DATA.test(v),
  points: (v) => NUMBERS.test(v),
  transform: (v) => TRANSFORM.test(v),
  fill: (v) => COLOUR.test(v),
  stroke: (v) => COLOUR.test(v),
  'fill-rule': (v) => v === 'evenodd' || v === 'nonzero',
  style: (v) => !styleProblem(v),
  ...Object.fromEntries(
    ['stroke-width', 'opacity', 'cx', 'cy', 'r', 'rx', 'ry', 'x', 'y', 'x1', 'y1', 'x2', 'y2'].map((a) => [a, (v: string) => NUMBERS.test(v)]),
  ),
};

const PROLOG = /^\uFEFF?\s*<\?xml(\s+(version|encoding|standalone)\s*=\s*("[\w.-]*"|'[\w.-]*'))*\s*\?>/;
const ATTRIBUTE = /^\s+([^\s=/>"']+)\s*=\s*(?:"([^"]*)"|'([^']*)')/;

/** Problems with an SVG file, or [] if it is only shapes drawn with allowed attributes. */
export function checkSvg(source: string): string[] {
  const errors = new Set<string>();
  let rest = source.replace(PROLOG, '');
  let root: string | null = null;
  while (rest.length > 0) {
    const comment = /^<!--([\s\S]*?)-->/.exec(rest);
    if (comment) {
      if (comment[1].includes('--')) errors.add('has a malformed comment');
      rest = rest.slice(comment[0].length);
      continue;
    }
    const text = /^[^<]+/.exec(rest);
    if (text) {
      if (text[0].trim() !== '') errors.add('has text');
      rest = rest.slice(text[0].length);
      continue;
    }
    const end = /^<\/([^\s>]+)\s*>/.exec(rest);
    if (end) {
      if (!ELEMENTS.has(end[1])) errors.add(`has an element outside the allowlist: ${end[1]}`);
      rest = rest.slice(end[0].length);
      continue;
    }
    const open = /^<([^\s/>!?]+)/.exec(rest);
    if (!open) {
      errors.add('has markup other than elements and comments (CDATA, DOCTYPE, an entity or a processing instruction)');
      break;
    }
    const name = open[1];
    root ??= name;
    if (!ELEMENTS.has(name)) errors.add(`has an element outside the allowlist: ${name}`);
    rest = rest.slice(open[0].length);
    for (let attribute = ATTRIBUTE.exec(rest); attribute; attribute = ATTRIBUTE.exec(rest)) {
      const [whole, key, double, single] = attribute;
      const value = double ?? single;
      const allowed = ATTRIBUTES[key];
      if (!allowed) errors.add(`has an attribute outside the allowlist: ${key}`);
      else if (!allowed(value)) errors.add(`has an attribute value not allowed: ${key}="${value}"`);
      rest = rest.slice(whole.length);
    }
    const close = /^\s*\/?>/.exec(rest);
    if (!close) {
      errors.add(`has a tag it can't read: <${name}`);
      break;
    }
    rest = rest.slice(close[0].length);
  }
  if (root !== 'svg') errors.add('not an SVG document');
  return [...errors];
}
