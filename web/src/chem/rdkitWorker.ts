// The RDKit worker: RDKit.js computes the properties panel's values here, off the page.
//
// It runs in a worker because RDKit.js 2026.9.1 builds its JavaScript bindings with
// `new Function` (Emscripten's embind), which the page's CSP forbids. This one file is
// served with its own policy, the page's plus 'unsafe-eval' (web/csp-workers.json); the
// page itself never gets it. Measured: under the page's policy RDKit fails to start with
// an EvalError, on the page and in a worker alike.
//
// Messages: the properties panel sends {id, molfile}; the worker answers {id, computed}
// (null when RDKit can't read the drawing). The NMR preview's copy (rdkitWorkers.ts) is sent
// {kind: 'nmr', id, molfile} and answers with the predicted peaks (src/chem/nmr.ts). Either
// copy sends {failed} once if RDKit can't start. Nothing leaves the device: the worker's
// only requests are for RDKit's own wasm, the functional-group patterns (on the first
// properties request) and the ¹³C table (on the first prediction), all from the precache.
import initRDKitModule from '@rdkit/rdkit';
import { decodeTable, type CarbonTable } from './carbonTable';
import { computeProperties, configureRdkit, type PatternsOrReason } from './compute';
import { readPatterns } from './functionalGroups';
import { predictCarbon, type NmrReply, type NmrRequest } from './nmr';
import { CARBON_TABLE_FILE, PATTERNS_FILE, RDKIT_WASM_FILE } from './rdkitFiles';
import type { WorkerReply, WorkerRequest } from './tracker';

const scope = self as unknown as {
  postMessage(message: WorkerReply | NmrReply): void;
  onmessage: ((event: MessageEvent<WorkerRequest | NmrRequest>) => void) | null;
};

const ready = initRDKitModule({ locateFile: () => `${import.meta.env.BASE_URL}${RDKIT_WASM_FILE}` }).then(
  (rdkit) => {
    configureRdkit(rdkit);
    return rdkit;
  },
);

ready.catch((error: unknown) => scope.postMessage({ failed: String(error) }));

/** A file from the app's base, or why it couldn't be had. Settled at once (never left
 * rejected while RDKit starts, which would be an unhandled rejection). */
function load<T>(file: string, read: (response: Response) => Promise<T>): Promise<{ file: T } | { unavailable: string }> {
  return fetch(`${import.meta.env.BASE_URL}${file}`)
    .then((response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return read(response);
    })
    .then(
      (contents) => ({ file: contents }),
      (error: unknown) => ({ unavailable: `${file} could not be loaded (${String(error)})` }),
    );
}

// Fetched on the first request that needs them. If a file can't be had or read, the panel
// says why; an entry of the patterns RDKit can't use is skipped and named.
let patterns: Promise<PatternsOrReason> | null = null;
let table: Promise<CarbonTable | { unavailable: string }> | null = null;

function loadPatterns(): Promise<PatternsOrReason> {
  const file = load(PATTERNS_FILE, (r) => r.json() as Promise<unknown>);
  const result = ready.then(async (rdkit) => {
    const loaded = await file;
    return 'file' in loaded ? readPatterns(rdkit, loaded.file) : loaded;
  });
  result.catch(() => {}); // fails only if RDKit does, which is reported as {failed}
  return result;
}

function loadTable(): Promise<CarbonTable | { unavailable: string }> {
  return load(CARBON_TABLE_FILE, (r) => r.arrayBuffer().then(decodeTable)).then((loaded) =>
    'file' in loaded ? loaded.file : loaded,
  );
}

function predict({ id, molfile }: NmrRequest): void {
  Promise.all([ready, (table ??= loadTable())]).then(
    ([rdkit, shifts]) => {
      if ('unavailable' in shifts) {
        scope.postMessage({ kind: 'nmr', id, unavailable: shifts.unavailable });
        return;
      }
      let peaks = null;
      try {
        peaks = predictCarbon(rdkit, molfile, shifts);
      } catch (error) {
        console.error('RDKit could not predict the ¹³C NMR:', error);
      }
      scope.postMessage({ kind: 'nmr', id, peaks });
    },
    () => {}, // already reported as {failed}
  );
}

scope.onmessage = (event) => {
  if ('kind' in event.data) {
    predict(event.data);
    return;
  }
  const { id, molfile } = event.data;
  Promise.all([ready, (patterns ??= loadPatterns())]).then(
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
