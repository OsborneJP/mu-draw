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
