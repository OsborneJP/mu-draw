import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { checkNoMiew, MIEW_MARKERS } from '../scripts/checks/ketcherTrim.ts';
import { INCHI_FORMATS, withoutInchiFormats } from './ketcherTrim.ts';

// The file Vite resolves for ketcher-react (its ESM entry), as installed.
const KETCHER = readFileSync(new URL('../node_modules/ketcher-react/dist/index.js', import.meta.url), 'utf8');

describe("Ketcher's Save formats", () => {
  it('lose exactly the three InChI formats, and nothing else', () => {
    const trimmed = withoutInchiFormats(KETCHER);
    expect(trimmed).not.toContain(INCHI_FORMATS);
    expect(trimmed.length).toBe(KETCHER.length - INCHI_FORMATS.length);
    // The array they sat in keeps its other formats and its first divider.
    expect(trimmed).toMatch(/SupportedFormat\.cml, '<----firstDivider--->',\s*'svg', 'png', SupportedFormat\.cdxml/);
  });

  it('fail the build if the line moves or appears twice', () => {
    expect(() => withoutInchiFormats(KETCHER.replace(INCHI_FORMATS, ''))).toThrow('found 0');
    expect(() => withoutInchiFormats(`${INCHI_FORMATS}\n${INCHI_FORMATS}`)).toThrow('found 2');
  });

  it('are offered only by the Save dialog', () => {
    // Nowhere else in Ketcher's UI lists InChI output: each format is named once, in that line.
    for (const format of ['inChI', 'inChIAuxInfo', 'inChIKey']) {
      expect(KETCHER.match(new RegExp(`SupportedFormat\\.${format}\\b`, 'g')), format).toHaveLength(1);
    }
  });
});

describe("Ketcher's Miew viewer", () => {
  it('is loaded from exactly one place: the 3D dialog, lazily', () => {
    const at = [...KETCHER.matchAll(/import\('miew-react'\)/g)].map((m) => m.index);
    expect(at).toHaveLength(1);
    expect(KETCHER.slice(at[0] - 60, at[0])).toMatch(/var Viewer = lazy\(function \(\) \{\s*return $/);
  });

  it("is recognised by the build check in Miew's own code", () => {
    const miew = readFileSync(new URL('../node_modules/miew/dist/Miew.module.js', import.meta.url), 'utf8');
    expect(checkNoMiew([{ path: 'miew.js', text: miew }])).toHaveLength(MIEW_MARKERS.length);
  });

  it('fails the build check when its code is in a script', () => {
    const scripts = MIEW_MARKERS.map((marker, i) => ({ path: `assets/chunk${i}.js`, text: `x("${marker}")` }));
    expect(checkNoMiew([...scripts, { path: 'assets/other.js', text: 'Ketcher' }])).toEqual([
      `assets/chunk0.js: Ketcher's Miew viewer is in the build (found "${MIEW_MARKERS[0]}")`,
      `assets/chunk1.js: Ketcher's Miew viewer is in the build (found "${MIEW_MARKERS[1]}")`,
    ]);
  });
});
