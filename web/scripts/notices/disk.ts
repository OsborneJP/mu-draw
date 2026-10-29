// The licence notices' inputs on disk: a build's log and output folder, node_modules, web/public,
// and the reviewed inventory in third_party/notices/.
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildLogPath, type BuildLog } from '../../config/noticesLog.ts';
import { inventoryChanges, inventoryOf, type Disk, type Inventory } from './inventory.ts';

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
