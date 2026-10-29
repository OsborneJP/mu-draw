// The shipped licence notices (docs/plans/licence-notices.md).
//   DIST_DIR=<dist> node scripts/build-notices.ts --accept     (from web/, after a build)
// takes that build's inventory as the reviewed one (third_party/notices/inventory.json):
// run it only once every change it reports has been looked at.
import { diskFor, INVENTORY_FILE, readBuildLog, readInventory, writeInventory } from './notices/disk.ts';
import { inventoryChanges, inventoryOf } from './notices/inventory.ts';

const dist = process.env.DIST_DIR ?? 'dist';
if (!process.argv.includes('--accept')) {
  console.error('usage: DIST_DIR=<dist> node scripts/build-notices.ts --accept');
  process.exit(2);
}
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
