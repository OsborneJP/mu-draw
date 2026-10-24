// The RDKit worker: RDKit.js computes the properties panel's values here, off the page.
//
// It runs in a worker because RDKit.js 2026.9.1 builds its JavaScript bindings with
// `new Function` (Emscripten's embind), which the page's CSP forbids. This one file is
// served with its own policy, the page's plus 'unsafe-eval' (web/csp-workers.json); the
// page itself never gets it. Measured: under the page's policy RDKit fails to start with
// an EvalError, on the page and in a worker alike.
//
// Messages: the page sends {id, molfile}; the worker answers {id, computed} (null when RDKit
// can't read the drawing), or {failed} once if RDKit can't start. Nothing leaves the device:
// the worker's only requests are for RDKit's own wasm and the functional-group patterns,
// both from the app's precache.
import initRDKitModule from '@rdkit/rdkit';
import { computeProperties, configureRdkit, type PatternsOrReason } from './compute';
import { readPatterns } from './functionalGroups';
import { PATTERNS_FILE, RDKIT_WASM_FILE } from './rdkitFiles';
import type { WorkerReply, WorkerRequest } from './tracker';

const scope = self as unknown as {
  postMessage(message: WorkerReply): void;
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
};

const ready = initRDKitModule({ locateFile: () => `${import.meta.env.BASE_URL}${RDKIT_WASM_FILE}` }).then(
  (rdkit) => {
    configureRdkit(rdkit);
    return rdkit;
  },
);

ready.catch((error: unknown) => scope.postMessage({ failed: String(error) }));

// Fetched once, while RDKit starts. If the file can't be had or read, the properties still
// work and the panel says why there are no functional groups; an entry RDKit can't use is
// skipped and named.
// Settled at once (never left rejected while RDKit starts, which would be an unhandled
// rejection).
const patternFile = fetch(`${import.meta.env.BASE_URL}${PATTERNS_FILE}`)
  .then((response) => {
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json() as Promise<unknown>;
  })
  .then(
    (file) => ({ file }),
    (error: unknown) => ({ unavailable: `${PATTERNS_FILE} could not be loaded (${String(error)})` }),
  );
const patterns: Promise<PatternsOrReason> = ready.then(async (rdkit) => {
  const loaded = await patternFile;
  return 'file' in loaded ? readPatterns(rdkit, loaded.file) : loaded;
});
patterns.catch(() => {}); // fails only if RDKit does, which is reported as {failed}

scope.onmessage = (event) => {
  const { id, molfile } = event.data;
  Promise.all([ready, patterns]).then(
    ([rdkit, groups]) => {
      let computed = null;
      try {
        computed = computeProperties(rdkit, molfile, groups);
      } catch (error) {
        console.error('RDKit could not compute properties:', error);
      }
      scope.postMessage({ id, computed });
    },
    () => {}, // already reported as {failed}
  );
};
