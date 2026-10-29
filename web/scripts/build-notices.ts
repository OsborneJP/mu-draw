// The shipped licence notices (docs/plans/licence-notices.md), from web/:
//   node scripts/build-notices.ts
// writes web/public/third-party/NOTICES.txt from the reviewed inventory and records in
// third_party/notices/, or lists why it can't;
//   DIST_DIR=<dist> node scripts/build-notices.ts --accept
// first takes that build's inventory as the reviewed one: run it only once every change it
// reports has been looked at, and its records written.
import { writeFileSync } from 'node:fs';
import {
  currentNotices,
  diskFor,
  INVENTORY_FILE,
  NOTICES_OUT,
  readBuildLog,
  readInventory,
  writeInventory,
} from './notices/disk.ts';
import { inventoryChanges, inventoryOf } from './notices/inventory.ts';

if (process.argv.includes('--accept')) {
  const dist = process.env.DIST_DIR ?? 'dist';
  const log = readBuildLog(dist);
  if (!log) {
    console.error(`build-notices: no build log beside ${dist}; build first`);
    process.exit(1);
  }
  const { inventory, problems } = inventoryOf(log, diskFor(dist));
  if (problems.length > 0) {
    console.error('build-notices: the build has problems an inventory cannot record:');
    for (const problem of problems) console.error(`  ${problem}`);
    process.exit(1);
  }
  const reviewed = readInventory();
  const changes = reviewed ? inventoryChanges(reviewed, inventory) : ['(the first reviewed inventory)'];
  writeInventory(inventory);
  console.log(`build-notices: ${INVENTORY_FILE} now holds ${dist}'s inventory`);
  for (const change of changes) console.log(`  ${change}`);
}

const { text, problems } = currentNotices();
if (problems.length > 0) {
  console.error('build-notices: the notices would be incomplete:');
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}
writeFileSync(NOTICES_OUT, text);
console.log(`build-notices: wrote ${NOTICES_OUT} (${Buffer.byteLength(text)} bytes)`);
