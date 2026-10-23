// Ships RDKit.js's WebAssembly file with the app (and so into the offline precache) before
// any code uses it. The properties panel will load RDKit with
// locateFile: () => `${import.meta.env.BASE_URL}${RDKIT_WASM_FILE}`.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';

// Unhashed and outside assets/: the precache revision (a content hash) handles updates,
// and Apache serves it no-cache like index.html.
export const RDKIT_WASM_FILE = 'rdkit/RDKit_minimal.wasm';

// By file path: the package's exports map doesn't expose dist/ or package.json.
const SOURCE = fileURLToPath(
  new URL('../node_modules/@rdkit/rdkit/dist/RDKit_minimal.wasm', import.meta.url),
);

export function rdkitWasm(): Plugin {
  return {
    name: 'rdkit-wasm',
    apply: 'build',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: RDKIT_WASM_FILE, source: readFileSync(SOURCE) });
    },
  };
}
