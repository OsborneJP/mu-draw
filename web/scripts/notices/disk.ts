// The licence notices' inputs on disk: a build's log and output folder, node_modules, web/public,
// and the reviewed inventory in third_party/notices/.
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildLogPath, type BuildLog } from '../../config/noticesLog.ts';
import { NOTICES_FILE } from '../../src/shell/thirdParty.ts';
import { ABOUT } from './about.ts';
import { inventoryChanges, inventoryOf, type Disk, type Inventory } from './inventory.ts';
import { buildNotices, sha256, type NoticeRecord, type Sources } from './notices.ts';

const WEB = fileURLToPath(new URL('../../', import.meta.url));
export const INVENTORY_FILE = fileURLToPath(new URL('../../../third_party/notices/inventory.json', import.meta.url));
const ACCEPT = 'DIST_DIR=<dist> node scripts/build-notices.ts --accept (from web/)';

function filesUnder(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .map((rel) => rel.split('\\').join('/'))
    .filter((rel) => statSync(join(dir, rel)).isFile())
    .sort();
}

export function diskFor(dist: string): Disk {
  const out = resolve(WEB, dist);
  return {
    read: (path) => {
      const file = join(WEB, path);
      return existsSync(file) && statSync(file).isFile() ? readFileSync(file) : null;
    },
    distFiles: filesUnder(out),
    readDist: (path) => readFileSync(join(out, path)),
    publicFiles: filesUnder(join(WEB, 'public')),
  };
}

export function readBuildLog(dist: string): BuildLog | null {
  const file = buildLogPath(resolve(WEB, dist));
  return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as BuildLog) : null;
}

/** The reviewed inventory, or null before the first one is accepted. */
export function readInventory(): Inventory | null {
  return existsSync(INVENTORY_FILE) ? (JSON.parse(readFileSync(INVENTORY_FILE, 'utf8')) as Inventory) : null;
}

/** Sorted at every level, so a change shows as a small diff. */
export function inventoryJson(inventory: Inventory): string {
  const packages = Object.fromEntries(
    Object.keys(inventory.packages)
      .sort()
      .map((id) => [
        id,
        Object.fromEntries(Object.entries(inventory.packages[id]).sort(([a], [b]) => a.localeCompare(b))),
      ]),
  );
  const workbox = Object.fromEntries(Object.entries(inventory.workbox).sort(([a], [b]) => a.localeCompare(b)));
  return `${JSON.stringify({ packages, tools: [...inventory.tools].sort(), workbox, public: [...inventory.public].sort() }, null, 1)}\n`;
}

export function writeInventory(inventory: Inventory): void {
  writeFileSync(INVENTORY_FILE, inventoryJson(inventory));
}

/** verify-dist's check: the build's inventory against the reviewed one. */
export function checkInventory(dist: string): string[] {
  const log = readBuildLog(dist);
  if (!log) return [`no build log beside ${dist} (config/noticesLog.ts writes it during the build)`];
  const { inventory, problems } = inventoryOf(log, diskFor(dist));
  const reviewed = readInventory();
  if (!reviewed) return [...problems, `there is no reviewed inventory yet: ${ACCEPT}`];
  const changes = inventoryChanges(reviewed, inventory);
  return [
    ...problems,
    ...changes,
    ...(changes.length > 0
      ? [`the licence notices were reviewed against a different build: review the changes, then ${ACCEPT}`]
      : []),
  ];
}

const NOTICES_DIR = fileURLToPath(new URL('../../../third_party/notices/', import.meta.url));
/** The shipped notices, which web/public copies into every build. */
export const NOTICES_OUT = join(WEB, 'public', NOTICES_FILE);

/** The reviewed records, by file name. */
export function readRecords(): NoticeRecord[] {
  const dir = join(NOTICES_DIR, 'records');
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => ({ ...(JSON.parse(readFileSync(join(dir, f), 'utf8')) as NoticeRecord), slug: f.slice(0, -5) }));
}

/** The canonical licence texts (SPDX's, at a pinned commit), each checked against its hash. */
function canonicalLicences(): Record<string, string> {
  const index = JSON.parse(readFileSync(join(NOTICES_DIR, 'licences', 'index.json'), 'utf8')) as Record<
    string,
    { file: string; sha256: string }
  >;
  return Object.fromEntries(
    Object.entries(index).map(([id, { file, sha256: expected }]) => {
      const bytes = readFileSync(join(NOTICES_DIR, file));
      if (sha256(bytes) !== expected) throw new Error(`third_party/notices/${file} is not the reviewed text`);
      return [id, bytes.toString('utf8')];
    }),
  );
}

export function noticesSources(): Sources {
  const read = (path: string) => {
    const file = join(WEB, path);
    return existsSync(file) && statSync(file).isFile() ? readFileSync(file) : null;
  };
  return {
    read,
    list: (dir) => readdirSync(join(WEB, dir)),
    readText: (file) => {
      const path = join(NOTICES_DIR, file);
      return existsSync(path) ? readFileSync(path) : null;
    },
    canonical: canonicalLicences(),
  };
}

/** The notices as the reviewed inputs make them now. */
export function currentNotices(): { text: string; problems: string[] } {
  const inventory = readInventory();
  if (!inventory) return { text: '', problems: ['there is no reviewed inventory yet'] };
  return buildNotices(inventory, readRecords(), noticesSources(), ABOUT);
}
