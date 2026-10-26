// The shift tables' format: what is written is read back, a code is found or not, a
// damaged file is refused, two codes on one key are both left out, and a ¹³C table is never
// read as a ¹H one or the other way round.
import { describe, expect, it } from 'vitest';
import { CARBON, decodeTable, encodeTable, keyOf, lookup, MAGIC, PROTON, type TableInfo } from './carbonTable';

const INFO: TableInfo = {
  version: 1,
  spheres: 4,
  source: { file: 'test.sd', sha256: '0'.repeat(64), records: 2, spectra: 2, carbons: 3 },
  excluded: [],
  generator: 'carbonTable.test.ts',
  rdkit: 'test',
  licence: 'test',
  codes: [3],
  dropped: 0,
};

// Made-up codes and shifts: the format doesn't care what they mean.
const ENTRIES = new Map([
  ['6H3(6)', 21.3],
  ['6H0(=8,6,6)', 206.7],
  ['a6H1(*a6*a6)', -12.4],
]);

const buffer = (bytes: Uint8Array) => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

describe('the shift table', () => {
  it('reads back what was written, to a tenth of a ppm', () => {
    const table = decodeTable(buffer(encodeTable(INFO, ENTRIES)));
    expect(table.info).toEqual(INFO);
    for (const [code, shift] of ENTRIES) expect(lookup(table, code)).toBe(shift);
    expect(lookup(table, '6H2(6,6)')).toBeNull();
    expect([...table.hashes]).toEqual([...table.hashes].sort((a, b) => a - b));
  });

  it('keeps 32-bit keys in order through the varint deltas, the largest included', () => {
    const codes = Array.from({ length: 2000 }, (_, i) => `code ${i}`);
    const table = decodeTable(buffer(encodeTable(INFO, new Map(codes.map((c, i) => [c, i / 10])))));
    codes.forEach((c, i) => expect(lookup(table, c)).toBe(i / 10));
    const top = new Map([['top', 1]]);
    const atTop = decodeTable(buffer(encodeTable(INFO, top, () => [0xffffffff, 7])));
    expect(atTop.hashes[0]).toBe(0xffffffff);
    expect(lookup(atTop, 'top', () => [0xffffffff, 7])).toBe(1);
    expect(lookup(atTop, 'top', () => [0xffffffff, 8])).toBeNull(); // the check byte counts
  });

  it('leaves out codes that share a key, and says how many', () => {
    const key = (code: string): [number, number] => (code.startsWith('6H0') || code.startsWith('a6') ? [42, 1] : keyOf(code));
    const table = decodeTable(buffer(encodeTable(INFO, ENTRIES, key)));
    expect(table.info.dropped).toBe(2);
    expect(table.hashes.length).toBe(1);
    expect(lookup(table, '6H3(6)')).toBe(21.3);
    expect(lookup(table, '6H0(=8,6,6)', key)).toBeNull();
  });

  it('refuses bytes that are not a table, or are cut short', () => {
    const bytes = encodeTable(INFO, ENTRIES);
    // An error page served in its place, long enough to be read as a header.
    const page = '<!doctype html><title>Not Found</title><p>The file was not found.</p>';
    expect(() => decodeTable(buffer(new TextEncoder().encode(page)))).toThrow('not a ¹³C shift table');
    expect(() => decodeTable(buffer(bytes.slice(0, bytes.length - 1)))).toThrow('cut short');
    expect(() => decodeTable(buffer(new Uint8Array([...bytes, 0])))).toThrow('cut short');
    const wrongVersion = new TextEncoder().encode(MAGIC + '\0\0\0\0');
    expect(() => decodeTable(buffer(wrongVersion))).toThrow();
  });
});

describe('the ¹H table', () => {
  const PRECISE = new Map([
    ['6H3(6)', 1.234],
    ['8H1(6)', -0.567],
    ['6H2(6,6)|hi', 12.345],
  ]);

  it('reads back what was written, to a hundredth of a ppm', () => {
    const table = decodeTable(buffer(encodeTable(INFO, PRECISE, keyOf, PROTON)), PROTON);
    expect(table.info).toEqual(INFO);
    expect([...PRECISE.keys()].map((code) => lookup(table, code))).toEqual([1.23, -0.57, 12.35]);
    // The ¹³C table keeps tenths.
    const carbon = decodeTable(buffer(encodeTable(INFO, PRECISE)));
    expect([...PRECISE.keys()].map((code) => lookup(carbon, code))).toEqual([1.2, -0.6, 12.3]);
  });

  it('is never read as the ¹³C table, nor the other way round', () => {
    const proton = buffer(encodeTable(INFO, PRECISE, keyOf, PROTON));
    const carbon = buffer(encodeTable(INFO, PRECISE, keyOf, CARBON));
    expect(() => decodeTable(proton)).toThrow('not a ¹³C shift table');
    expect(() => decodeTable(carbon, PROTON)).toThrow('not a ¹H shift table');
  });
});
