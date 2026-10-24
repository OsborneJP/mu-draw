// The offline guard: everything the app needs must be in the service worker's precache.
// Workbox leaves out, without failing, any file its globPatterns don't match, so a build
// can look fine online and break offline. This check fails the build instead.
import vm from 'node:vm';
import { RDKIT_WASM_FILE, RDKIT_WORKER_FILE } from '../../config/rdkitWasm.ts';

export interface DistFile {
  path: string;
  size: number;
}

// Files that are correctly not precached: the service worker itself, its Workbox runtime,
// and source maps (never deployed).
const NOT_PRECACHED = [/^sw\.js$/, /^workbox-[\w-]+\.js$/, /\.map$/];
// Indigo with rendering (Ketcher's PNG/SVG export needs it), not the norender build.
const INDIGO_WASM = /^assets\/indigo-ketcher-\d[\d.]*-[\w-]+\.wasm$/;
const MARKER = 'precacheAndRoute(';

/** The URLs in sw.js's precache manifest. Evaluates only the bracket-matched array literal
 * (the minified output has unquoted keys, so it isn't JSON). */
export function parseSwManifest(swSource: string): string[] {
  const at = swSource.indexOf(MARKER);
  if (at === -1 || swSource.indexOf(MARKER, at + 1) !== -1) {
    throw new Error(`sw.js must contain exactly one ${MARKER}`);
  }
  const start = swSource.indexOf('[', at + MARKER.length);
  if (start === -1 || swSource.slice(at + MARKER.length, start).trim() !== '') {
    throw new Error(`sw.js: ${MARKER} is not followed by an array literal`);
  }
  let depth = 0;
  let quote: string | null = null;
  for (let i = start; i < swSource.length; i += 1) {
    const ch = swSource[i];
    if (quote) {
      if (ch === '\\') i += 1;
      else if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
    } else if (ch === '[') {
      depth += 1;
    } else if (ch === ']') {
      depth -= 1;
      if (depth === 0) {
        const entries = vm.runInNewContext(`(${swSource.slice(start, i + 1)})`, {}, { timeout: 1000 });
        if (!Array.isArray(entries)) throw new Error('sw.js: precache manifest is not an array');
        return entries.map((entry: { url?: unknown }) => {
          if (typeof entry?.url !== 'string') throw new Error('sw.js: precache entry without a url');
          return entry.url;
        });
      }
    }
  }
  throw new Error('sw.js: unterminated precache manifest');
}

/** Problems with a build's precache, given its files and the manifest's URLs. */
export function checkPrecache(files: DistFile[], precached: string[]): string[] {
  const errors: string[] = [];
  const inManifest = new Set(precached);
  const paths = new Set(files.map((f) => f.path));
  for (const file of files) {
    if (NOT_PRECACHED.some((re) => re.test(file.path))) continue;
    if (!inManifest.has(file.path)) {
      const what = file.path.endsWith('.wasm') ? 'WebAssembly file' : 'file';
      errors.push(`${what} not precached (it would be missing offline): ${file.path} (${file.size} bytes)`);
    }
  }
  for (const url of precached) {
    if (!paths.has(url)) errors.push(`precache lists a file that isn't in the build: ${url}`);
  }
  const indigo = files.filter((f) => INDIGO_WASM.test(f.path));
  if (indigo.length !== 1) {
    errors.push(`expected one Indigo wasm (with rendering), found ${indigo.length}`);
  }
  for (const file of files) {
    if (/indigo-ketcher-norender/.test(file.path)) errors.push(`norender Indigo shipped: ${file.path}`);
  }
  if (!paths.has(RDKIT_WASM_FILE)) errors.push(`RDKit wasm missing: ${RDKIT_WASM_FILE}`);
  if (!paths.has(RDKIT_WORKER_FILE)) errors.push(`RDKit worker missing: ${RDKIT_WORKER_FILE}`);
  return errors;
}
