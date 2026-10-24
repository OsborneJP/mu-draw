// Starts a copy of the RDKit worker (rdkitWorker.ts). The URL is written in this one place,
// so Vite bundles one worker file, rdkit/worker.js, which the server gives its own CSP
// (web/csp-workers.json). The properties panel runs one copy; the NMR preview starts
// another on its first prediction, so the properties never wait for it.
export type RdkitWorkerName = 'rdkit' | 'rdkit-nmr';

export function startRdkitWorker(name: RdkitWorkerName): Worker {
  return new Worker(new URL('./rdkitWorker.ts', import.meta.url), { name });
}
