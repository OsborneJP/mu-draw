// Records what the build bundles, for the shipped licence notices (docs/plans/licence-notices.md):
// every module of the main build and of each worker build, and every asset a plugin copies
// from node_modules. It writes them beside the output folder, never inside it, so the log is
// neither deployed nor precached: <outDir>.notices-build.json, read by scripts/verify-dist.ts.
import { writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin, Rollup } from 'vite';

type OutputItem = Rollup.OutputChunk | Rollup.OutputAsset;

/** web/, which every recorded path is relative to (absolute paths would name the repo). */
const WEB = fileURLToPath(new URL('..', import.meta.url));

export interface BuildLog {
  /** Module ids by chunk, relative to web/ where they are files. */
  chunks: { file: string; worker: boolean; modules: string[] }[];
  /** Assets the bundle emitted from a file, with that file relative to web/. */
  assets: { file: string; from: string[] }[];
}

/** The log's file for a build's output folder. */
export function buildLogPath(outDir: string): string {
  return `${resolve(outDir)}.notices-build.json`;
}

export function moduleId(id: string): string {
  const path = id.split('?')[0];
  return path.startsWith('/') && path.startsWith(WEB) ? relative(WEB, path) : path;
}

/** One recorder for the main build and its workers: `main` goes in `plugins`, `worker()` in
 * `worker.plugins` (Vite runs only those on worker builds). Workers are bundled while the main
 * build runs, so their chunks are in the log before the main build closes and writes it. */
export function noticesLog(): { main: Plugin; worker: () => Plugin } {
  const log: BuildLog = { chunks: [], assets: [] };
  const record = (worker: boolean) =>
    function (_options: unknown, bundle: Record<string, OutputItem>) {
      for (const item of Object.values(bundle)) {
        if (item.type === 'chunk') {
          log.chunks.push({
            file: item.fileName,
            worker,
            modules: item.moduleIds.map(moduleId),
          });
        } else {
          log.assets.push({
            file: item.fileName,
            from: (item.originalFileNames ?? []).map(moduleId),
          });
        }
      }
    };
  let outDir = 'dist';
  return {
    main: {
      name: 'notices-log',
      apply: 'build',
      configResolved(config) {
        outDir = resolve(config.root, config.build.outDir);
      },
      // The main build's final bundle, after every plugin has added to it (index.html, the
      // manifest); worker bundles are never written, so workers record theirs as generated.
      writeBundle: record(false),
      closeBundle() {
        const sorted: BuildLog = {
          chunks: [...log.chunks].sort((a, b) => a.file.localeCompare(b.file)),
          assets: [...log.assets].sort((a, b) => a.file.localeCompare(b.file)),
        };
        writeFileSync(buildLogPath(outDir), `${JSON.stringify(sorted, null, 1)}\n`);
      },
    },
    worker: () => ({
      name: 'notices-log-worker',
      generateBundle: record(true),
    }),
  };
}
