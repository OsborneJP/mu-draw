// Ships RDKit.js's WebAssembly file with the app (and so into the offline precache), and
// names the RDKit worker's bundle. The worker loads RDKit with
// locateFile: () => `${import.meta.env.BASE_URL}${RDKIT_WASM_FILE}`.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';
import { RDKIT_WASM_FILE, RDKIT_WORKER_CHUNK, RDKIT_WORKER_FILE } from '../src/chem/rdkitFiles.ts';

export { RDKIT_WASM_FILE, RDKIT_WORKER_FILE };

// By file path: the package's exports map doesn't expose dist/ or package.json.
const SOURCE = fileURLToPath(
  new URL('../node_modules/@rdkit/rdkit/dist/RDKit_minimal.wasm', import.meta.url),
);

export function rdkitWasm(): Plugin {
  return {
    name: 'rdkit-wasm',
    apply: 'build',
    generateBundle() {
      // Named after its source, so the licence notices' inventory can place it.
      this.emitFile({ type: 'asset', fileName: RDKIT_WASM_FILE, originalFileName: SOURCE, source: readFileSync(SOURCE) });
    },
  };
}

/** Worker bundles' file names: the RDKit worker at its fixed path, every other worker
 * (Indigo's) hashed in assets/ as before. */
export function workerFileName(chunk: { name: string }): string {
  return chunk.name === RDKIT_WORKER_CHUNK ? RDKIT_WORKER_FILE : 'assets/[name]-[hash].js';
}
