// Ships the source of InChI and cairo as built into Indigo (docs/plans/licence-notices.md,
// decision 1), from third_party/indigo-source/, made by scripts/build_indigo_source.py.
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';
import { INDIGO_SOURCE_FILE } from '../src/shell/thirdParty.ts';

export const INDIGO_SOURCE = fileURLToPath(
  new URL(`../../third_party/indigo-source/${basename(INDIGO_SOURCE_FILE)}`, import.meta.url),
);
export const INDIGO_SOURCE_README = fileURLToPath(new URL('../../third_party/indigo-source/README.md', import.meta.url));

export function indigoSource(): Plugin {
  return {
    name: 'indigo-source',
    apply: 'build',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: INDIGO_SOURCE_FILE,
        originalFileName: INDIGO_SOURCE,
        source: readFileSync(INDIGO_SOURCE),
      });
    },
  };
}

/** The Indigo commit an Indigo wasm says it was built from ("…-g<commit>-wasm32…"). */
export function wasmCommit(wasm: Buffer): string | null {
  return /\d+\.\d+\.\d+\.\d+-g([0-9a-f]{7,40})-wasm/.exec(wasm.toString('latin1'))?.[1] ?? null;
}

/** Problems if the shipped source isn't the source of the shipped Indigo wasm. */
export function checkSourceMatchesWasm(wasm: Buffer, readme: string): string[] {
  const commit = wasmCommit(wasm);
  if (!commit) return ["the Indigo wasm doesn't say which commit it was built from"];
  const named = /built from Indigo's commit\s+([0-9a-f]{40})/.exec(readme)?.[1];
  if (!named) return ["the source archive's README doesn't name an Indigo commit"];
  return named.startsWith(commit)
    ? []
    : [`the Indigo wasm was built from ${commit}, but the shipped source is from ${named}`];
}
