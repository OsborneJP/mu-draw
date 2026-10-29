import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  checkArchive,
  checkSourceMatchesWasm,
  INDIGO_SOURCE,
  INDIGO_SOURCE_README,
  recordedSource,
  wasmCommit,
} from './indigoSource.ts';

const WASM = readFileSync(new URL('../node_modules/indigo-ketcher/indigo-ketcher-1.46.0.wasm', import.meta.url));
const README = readFileSync(INDIGO_SOURCE_README, 'utf8');

describe('the shipped InChI and cairo source', () => {
  it("is the source of the shipped Indigo wasm, by the commit in the wasm's version string", () => {
    expect(wasmCommit(WASM)).toMatch(/^[0-9a-f]{9}$/);
    expect(checkSourceMatchesWasm(WASM, README)).toEqual([]);
  });

  it('fails when the wasm comes from another commit', () => {
    const other = Buffer.from('Indigo 1.47.0.0-g0123456789-wasm32-wasm-clang', 'latin1');
    expect(checkSourceMatchesWasm(other, README)).toEqual([
      `the Indigo wasm was built from 0123456789, but the shipped source is from ${/commit\s+([0-9a-f]{40})/.exec(README)![1]}`,
    ]);
  });

  it("fails when the wasm doesn't name a commit, or the README doesn't", () => {
    expect(checkSourceMatchesWasm(Buffer.from('no version here'), README)).toEqual([
      "the Indigo wasm doesn't say which commit it was built from",
    ]);
    expect(checkSourceMatchesWasm(WASM, 'a README without one')).toEqual([
      "the source archive's README doesn't name an Indigo commit",
    ]);
  });
});

describe('the shipped archive', () => {
  const archive = readFileSync(INDIGO_SOURCE);

  it('is the one the Indigo record reviewed, from the shipped wasm’s commit', () => {
    expect(checkArchive(archive, recordedSource(), WASM)).toEqual([]);
  });

  it('fails when its bytes are not the reviewed ones (cut short, say)', () => {
    const cut = archive.subarray(0, archive.length - 1);
    expect(checkArchive(cut, recordedSource(), WASM)).toHaveLength(1);
    expect(checkArchive(cut, recordedSource(), WASM)[0]).toMatch(
      /^the shipped archive \([0-9a-f]{64}\) is not the one the record reviewed$/,
    );
  });

  it("fails when the record's commit is not the wasm's", () => {
    const other = Buffer.from('Indigo 1.47.0.0-g0123456789-wasm32-wasm-clang', 'latin1');
    expect(checkArchive(archive, recordedSource(), other)).toEqual([
      `the record's archive is from ${recordedSource().indigoCommit}, but the Indigo wasm from 0123456789`,
    ]);
  });
});
