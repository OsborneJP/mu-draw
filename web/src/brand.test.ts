import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { APP_TITLE } from '../config/pwa';

// The app is MU Draw, in black and gold (Jeff, 2026-10-25). The colours are tokens in
// src/index.css; the old blue must not come back anywhere in the web source. The canvas's
// highlight colours stay as they were (light blue for defined stereocentres, gold for
// undefined ones), so the two never look alike.
const WEB = fileURLToPath(new URL('..', import.meta.url));
const OLD_BLUE = ['#1f', '4e79'].join(''); // split, so this file doesn't match itself
const OLD_NAME = ['Structure', 'Editor'].join(' ');

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(css|html|tsx?|json|mjs)$/.test(name) ? [path] : [];
  });
}

describe('the brand', () => {
  const files = [...sources(join(WEB, 'src')), ...sources(join(WEB, 'config')), join(WEB, 'index.html')];

  it('reads every web source file (positive control)', () => {
    expect(files.map((f) => relative(WEB, f))).toEqual(expect.arrayContaining(['index.html', 'src/index.css', 'src/shell/shell.css']));
  });

  it.each([OLD_BLUE, OLD_NAME])('nothing in web source says %s', (old) => {
    const found = files.filter((f) => readFileSync(f, 'utf8').toLowerCase().includes(old.toLowerCase()));
    expect(found.map((f) => relative(WEB, f))).toEqual([]);
  });

  it('the app is MU Draw', () => {
    expect(APP_TITLE).toBe('MU Draw');
  });

  it('the icons and the theme colour are the CSS tokens', () => {
    const css = readFileSync(join(WEB, 'src/index.css'), 'utf8');
    const token = (name: string) => {
      const hex = new RegExp(`--${name}: #([0-9a-f]+);`).exec(css)![1];
      return hex.length === 3 ? [...hex].map((d) => d + d).join('') : hex; // 000 -> 000000
    };
    const rgb = (hex: string) => [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ');
    const [black, gold] = [token('mu-black'), token('mu-gold')];
    expect(gold).toBe('eeb111'); // Manchester's brand gold (Jeff, 2026-10-25)
    const icons = readFileSync(join(WEB, '../scripts/make_icons.py'), 'utf8');
    expect(icons).toContain(`BACKGROUND = (${rgb(black)}, 255)`);
    expect(icons).toContain(`FOREGROUND = (${rgb(gold)}, 255)`);
    expect(readFileSync(join(WEB, 'config/pwa.ts'), 'utf8')).toContain(`theme_color: '#${black}'`);
    expect(readFileSync(join(WEB, 'index.html'), 'utf8')).toContain(`<meta name="theme-color" content="#${black}" />`);
  });

  it("the stereocentre button, pressed, is the colour of the atoms it lights up", () => {
    // Read as text: stereoHighlight.ts loads Ketcher.
    const highlight = readFileSync(join(WEB, 'src/editor/stereoHighlight.ts'), 'utf8');
    const defined = /export const DEFINED_COLOR = '(#[0-9a-f]{6})'/.exec(highlight)?.[1];
    const css = readFileSync(join(WEB, 'src/panels/properties.css'), 'utf8');
    const pressed = /\.count-button\[aria-pressed='true'\] \{[^}]*background: (#[0-9a-f]{6});/.exec(css)?.[1];
    expect(defined).toBeDefined();
    expect(pressed).toBe(defined);
  });
});
