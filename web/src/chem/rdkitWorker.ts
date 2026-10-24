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
// the worker's only request is for RDKit's own wasm, from the app's precache.
import initRDKitModule from '@rdkit/rdkit';
import { computeProperties, configureRdkit } from './compute';
import { RDKIT_WASM_FILE } from './rdkitFiles';
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

scope.onmessage = (event) => {
  const { id, molfile } = event.data;
  ready.then(
    (rdkit) => {
      let computed = null;
      try {
        computed = computeProperties(rdkit, molfile);
      } catch (error) {
        console.error('RDKit could not compute properties:', error);
      }
      scope.postMessage({ id, computed });
    },
    () => {}, // already reported as {failed}
  );
};
