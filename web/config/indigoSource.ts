// Ships the source of InChI and cairo as built into Indigo (docs/plans/licence-notices.md,
// decision 1), from third_party/indigo-source/, made by scripts/build_indigo_source.py.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';
import { INDIGO_SOURCE_FILE } from '../src/shell/thirdParty.ts';

export const INDIGO_SOURCE = fileURLToPath(
  new URL(`../../third_party/indigo-source/${basename(INDIGO_SOURCE_FILE)}`, import.meta.url),
);
export const INDIGO_SOURCE_README = fileURLToPath(
  new URL('../../third_party/indigo-source/README.md', import.meta.url),
);

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

/** The source archive as reviewed: recorded in the Indigo wasm's record (bar B.4). */
export interface SourceArchive {
  file: string;
  sha256: string;
  indigoCommit: string;
}
export function recordedSource(): SourceArchive {
  const record = fileURLToPath(new URL('../../third_party/notices/records/indigo-wasm.json', import.meta.url));
  return (JSON.parse(readFileSync(record, 'utf8')) as { sourceArchive: SourceArchive }).sourceArchive;
}

/** Problems if the shipped archive isn't the reviewed one, or isn't from the commit the shipped
 * Indigo wasm was built from. */
export function checkArchive(archive: Buffer, recorded: SourceArchive, wasm: Buffer): string[] {
  const problems: string[] = [];
  const hash = createHash('sha256').update(archive).digest('hex');
  if (hash !== recorded.sha256) problems.push(`the shipped archive (${hash}) is not the one the record reviewed`);
  const commit = wasmCommit(wasm);
  if (commit && !recorded.indigoCommit.startsWith(commit)) {
    problems.push(`the record's archive is from ${recorded.indigoCommit}, but the Indigo wasm from ${commit}`);
  }
  return problems;
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
