import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { checkPrecache, parseSwManifest, type DistFile } from './precache';

// A real build's sw.js and file list (base path replaced with /app-x/), recaptured with
// scripts/capture-sw-fixture.ts from the merged build.
const SW = readFileSync(new URL('./fixtures/sw.js', import.meta.url), 'utf8');
const FILES: DistFile[] = JSON.parse(readFileSync(new URL('./fixtures/dist-files.json', import.meta.url), 'utf8'));
const INDIGO = FILES.find((f) => f.path.endsWith('.wasm') && f.path.includes('indigo'))!.path;

describe('parseSwManifest', () => {
  it('reads every URL from a real sw.js', () => {
    const urls = parseSwManifest(SW);
    expect(urls).toContain('index.html');
    expect(urls).toContain(INDIGO);
    expect(urls).toHaveLength(FILES.length - 2); // all but sw.js and workbox-*.js
    expect(new Set(urls).size).toBe(urls.length);
  });

  it('rejects a second precacheAndRoute call', () => {
    expect(() => parseSwManifest(`${SW};e.precacheAndRoute([])`)).toThrow(/exactly one/);
  });

  it('rejects an unterminated manifest', () => {
    expect(() => parseSwManifest('e.precacheAndRoute([{url:"a"}')).toThrow(/unterminated/);
  });

  it('ignores brackets inside strings', () => {
    expect(parseSwManifest('e.precacheAndRoute([{url:"a]b[c",revision:null}],{})')).toEqual(['a]b[c']);
  });
});

describe('checkPrecache', () => {
  it('passes a real build', () => {
    expect(checkPrecache(FILES, parseSwManifest(SW))).toEqual([]);
  });

  it('names a wasm file left out of the precache', () => {
    const urls = parseSwManifest(SW).filter((url) => url !== INDIGO);
    const errors = checkPrecache(FILES, urls);
    expect(errors).toContainEqual(expect.stringContaining(`WebAssembly file not precached`));
    expect(errors.join('\n')).toContain(INDIGO);
  });

  it('fails on any other unprecached file, such as a font', () => {
    const files = [...FILES, { path: 'assets/font-x.woff2', size: 1000 }];
    expect(checkPrecache(files, parseSwManifest(SW))).toEqual([
      'file not precached (it would be missing offline): assets/font-x.woff2 (1000 bytes)',
    ]);
  });

  it('fails when the norender Indigo build is shipped', () => {
    const norender = { path: 'assets/indigo-ketcher-norender-1.46.0-x.wasm', size: 1 };
    const errors = checkPrecache([...FILES, norender], [...parseSwManifest(SW), norender.path]);
    expect(errors).toEqual([`norender Indigo shipped: ${norender.path}`]);
  });

  it.each([
    ['wasm', 'rdkit/RDKit_minimal.wasm'],
    ['worker', 'rdkit/worker.js'],
  ])('fails when the RDKit %s is missing from the build', (what, path) => {
    const files = FILES.filter((f) => f.path !== path);
    const urls = parseSwManifest(SW).filter((url) => url !== path);
    expect(checkPrecache(files, urls)).toEqual([`RDKit ${what} missing: ${path}`]);
  });

  it('fails when the functional-group patterns are missing from the build', () => {
    const files = FILES.filter((f) => f.path !== 'functional-groups.json');
    expect(files.length).toBe(FILES.length - 1);
    const urls = parseSwManifest(SW).filter((url) => url !== 'functional-groups.json');
    expect(checkPrecache(files, urls)).toEqual(['functional-group patterns missing: functional-groups.json']);
  });

  it.each([
    ['¹³C shift table', 'nmr/carbon-shifts.bin'],
    ["¹³C shift table's licence", 'nmr/LICENSE-nmrshiftdb2.txt'],
    ['¹H shift table', 'nmr/proton-shifts.bin'],
    ['IR hint table', 'ir-bands.json'],
    ['practice list file', 'practice.json'],
  ])('fails when the %s is missing from the build', (what, path) => {
    const files = FILES.filter((f) => f.path !== path);
    expect(files.length).toBe(FILES.length - 1);
    const urls = parseSwManifest(SW).filter((url) => url !== path);
    expect(checkPrecache(files, urls)).toEqual([`${what} missing: ${path}`]);
  });

  it('fails when a glassware piece is missing from the build, and when it is left out of the precache', () => {
    const path = 'glassware/round-bottom-flask.svg';
    const files = FILES.filter((f) => f.path !== path);
    expect(files.length).toBe(FILES.length - 1);
    const urls = parseSwManifest(SW).filter((url) => url !== path);
    expect(checkPrecache(files, urls)).toEqual([`glassware piece missing: ${path}`]);
    expect(checkPrecache(FILES, urls)).toEqual([
      `file not precached (it would be missing offline): ${path} (${FILES.find((f) => f.path === path)!.size} bytes)`,
    ]);
  });

  it('fails when Indigo is missing (e.g. the base64 build was used)', () => {
    const files = FILES.filter((f) => f.path !== INDIGO);
    const urls = parseSwManifest(SW).filter((url) => url !== INDIGO);
    expect(checkPrecache(files, urls)).toEqual(['expected one Indigo wasm (with rendering), found 0']);
  });

  it('fails on a stale manifest entry', () => {
    expect(checkPrecache(FILES, [...parseSwManifest(SW), 'assets/gone.js'])).toEqual([
      "precache lists a file that isn't in the build: assets/gone.js",
    ]);
  });
});
