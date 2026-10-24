// The ¹³C shift table the NMR preview looks shifts up in: for each carbon environment seen
// in NMRShiftDB2's assigned spectra (a HOSE-style code, src/chem/hose.ts), the median
// measured shift. web/scripts/build-carbon-table.ts writes it; the NMR worker reads it.
//
// About 350,000 codes, so they are stored as two hashes each, not as text: a 32-bit one
// (sorted, delta-encoded as varints) and an 8-bit check. A code that isn't in the table
// matches by accident with odds of about 1 in 2^40 / 350,000 per lookup.
//
// Layout: MAGIC, uint32 header length, the header (UTF-8 JSON, TableInfo), uint32 entry
// count n, n varints (hash deltas), n check bytes, n int16 shifts (tenths of a ppm). All
// little-endian.

export const MAGIC = 'MUDRAW-C13';

/** What the table says about itself (and what its licence requires it to carry). */
export interface TableInfo {
  version: 1;
  /** Codes describe a carbon out to this many bonds (spheres). */
  spheres: number;
  source: { file: string; sha256: string; records: number; spectra: number; carbons: number };
  /** Compounds left out (InChIKey first blocks), so the tests are held out. */
  excluded: { name: string; inchikey: string }[];
  generator: string;
  rdkit: string;
  licence: string;
  /** Distinct codes per sphere; two codes with one key were both dropped. */
  codes: number[];
  dropped: number;
}

export interface CarbonTable {
  info: TableInfo;
  hashes: Uint32Array;
  checks: Uint8Array;
  shifts: Int16Array;
}

/** The 32-bit key and the 8-bit check of a code (FNV-1a over UTF-16 code units, with two
 * offset bases). */
export function keyOf(code: string): [number, number] {
  let h = 0x811c9dc5;
  let c = 0x9747b28c;
  for (let i = 0; i < code.length; i += 1) {
    const unit = code.charCodeAt(i);
    h = Math.imul(h ^ unit, 0x01000193) >>> 0;
    c = Math.imul(c ^ unit, 0x01000193) >>> 0;
  }
  return [h, c >>> 24];
}

/** Write a table. `entries` maps each code to its median shift in ppm. (`key` is for
 * tests, which force two codes onto one key.) */
export function encodeTable(info: TableInfo, entries: Map<string, number>, key = keyOf): Uint8Array {
  const keyed = new Map<string, { hash: number; check: number; tenths: number; code: string }>();
  let dropped = 0;
  for (const [code, shift] of entries) {
    const [hash, check] = key(code);
    const id = `${hash}:${check}`;
    if (keyed.has(id)) {
      // Two codes, one key: neither can be told apart, so neither is kept.
      dropped += keyed.get(id)!.code !== '' ? 2 : 1;
      keyed.set(id, { hash, check, tenths: 0, code: '' });
    } else keyed.set(id, { hash, check, tenths: Math.round(shift * 10), code });
  }
  const rows = [...keyed.values()].filter((r) => r.code !== '').sort((a, b) => a.hash - b.hash || a.check - b.check);
  const header = new TextEncoder().encode(JSON.stringify({ ...info, dropped }));
  const varints: number[] = [];
  let previous = 0;
  for (const row of rows) {
    let delta = row.hash - previous;
    previous = row.hash;
    do {
      const byte = delta & 0x7f;
      delta = Math.floor(delta / 128);
      varints.push(delta > 0 ? byte | 0x80 : byte);
    } while (delta > 0);
  }
  const magic = new TextEncoder().encode(MAGIC);
  const size = magic.length + 4 + header.length + 4 + varints.length + rows.length + 2 * rows.length;
  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  let at = 0;
  out.set(magic, at);
  at += magic.length;
  view.setUint32(at, header.length, true);
  at += 4;
  out.set(header, at);
  at += header.length;
  view.setUint32(at, rows.length, true);
  at += 4;
  out.set(varints, at);
  at += varints.length;
  rows.forEach((r, i) => (out[at + i] = r.check));
  at += rows.length;
  rows.forEach((r, i) => view.setInt16(at + 2 * i, r.tenths, true));
  return out;
}

/** Read a table; throws if the bytes are not one. */
export function decodeTable(bytes: ArrayBuffer): CarbonTable {
  const data = new Uint8Array(bytes);
  const view = new DataView(bytes);
  const magic = new TextEncoder().encode(MAGIC);
  if (data.length < magic.length + 8 || magic.some((b, i) => data[i] !== b)) throw new Error('not a ¹³C shift table');
  let at = magic.length;
  const headerLength = view.getUint32(at, true);
  at += 4;
  const info = JSON.parse(new TextDecoder().decode(data.subarray(at, at + headerLength))) as TableInfo;
  at += headerLength;
  if (info.version !== 1) throw new Error(`unknown table version ${String(info.version)}`);
  const n = view.getUint32(at, true);
  at += 4;
  const hashes = new Uint32Array(n);
  let previous = 0;
  for (let i = 0; i < n; i += 1) {
    let delta = 0;
    let scale = 1;
    for (;;) {
      if (at >= data.length) throw new Error('the table is cut short');
      const byte = data[at++];
      delta += (byte & 0x7f) * scale;
      scale *= 128;
      if (byte < 0x80) break;
    }
    previous += delta;
    hashes[i] = previous;
  }
  if (at + 3 * n !== data.length) throw new Error('the table is cut short');
  const checks = data.slice(at, at + n);
  at += n;
  const shifts = new Int16Array(n);
  for (let i = 0; i < n; i += 1) shifts[i] = view.getInt16(at + 2 * i, true);
  return { info, hashes, checks, shifts };
}

/** The median shift (ppm) recorded for a code, or null. */
export function lookup(table: CarbonTable, code: string, key = keyOf): number | null {
  const [hash, check] = key(code);
  let lo = 0;
  let hi = table.hashes.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (table.hashes[mid] < hash) lo = mid + 1;
    else hi = mid;
  }
  for (let i = lo; i < table.hashes.length && table.hashes[i] === hash; i += 1) {
    if (table.checks[i] === check) return table.shifts[i] / 10;
  }
  return null;
}
