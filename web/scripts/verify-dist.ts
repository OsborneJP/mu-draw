// Post-build guards, run on every build before any smoke test or deploy:
//   DIST_DIR=dist BASE=<base> node scripts/verify-dist.ts      (from web/)
// Exits 1 and lists every problem if the build is not safe to ship.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveBase } from '../config/app.ts';
import { checkManifest, checkPromptMode } from './checks/manifest.ts';

const dist = process.env.DIST_DIR ?? 'dist';
const base = resolveBase();
const read = (rel: string) => readFileSync(join(dist, rel), 'utf8');

const errors = [
  ...checkManifest(JSON.parse(read('manifest.webmanifest')), base).map((e) => `manifest.webmanifest: ${e}`),
  ...checkPromptMode(read('sw.js')).map((e) => `sw.js: ${e}`),
];

if (errors.length > 0) {
  console.error(`verify-dist: ${dist} (base ${base}) is not safe to ship:`);
  for (const error of errors) console.error(`  ${error}`);
  process.exit(1);
}
console.log(`verify-dist: ${dist} ok (base ${base})`);
