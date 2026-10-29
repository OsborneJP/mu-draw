import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { checkSourceMatchesWasm, INDIGO_SOURCE_README, wasmCommit } from './indigoSource.ts';

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
