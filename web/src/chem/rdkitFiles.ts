// Where RDKit.js lives in the build, under the base path. Unhashed and outside assets/: the
// precache revision (a content hash) handles updates, and Apache serves both no-cache.
// Shared by the app, the build (config/rdkitWasm.ts) and the tests, so nothing here may
// import Node or browser APIs.

/** RDKit.js's WebAssembly, copied from the package by config/rdkitWasm.ts. */
export const RDKIT_WASM_FILE = 'rdkit/RDKit_minimal.wasm';

/** The worker that runs RDKit (src/chem/rdkitWorker.ts). Its path is fixed because the
 * server gives this one file its own CSP (web/csp-workers.json). */
export const RDKIT_WORKER_FILE = 'rdkit/worker.js';

/** The worker's chunk name: its source file's name, which Vite uses as the chunk name. */
export const RDKIT_WORKER_CHUNK = 'rdkitWorker';

/** The functional-group patterns (web/public/), which the RDKit worker fetches once. Not
 * hashed, so anyone can edit it; the precache revision picks up a change. */
export const PATTERNS_FILE = 'functional-groups.json';

/** The ¹³C shift table (web/scripts/build-carbon-table.ts), which the panels' RDKit worker
 * fetches on its first ¹³C prediction, and the licence it is shared under. */
export const CARBON_TABLE_FILE = 'nmr/carbon-shifts.bin';
export const CARBON_TABLE_LICENCE_FILE = 'nmr/LICENSE-nmrshiftdb2.txt';

/** The ¹H shift table (web/scripts/build-proton-table.ts), fetched on the first ¹H
 * prediction; under the same licence as the ¹³C one. */
export const PROTON_TABLE_FILE = 'nmr/proton-shifts.bin';
