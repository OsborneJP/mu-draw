// Post-build guards, run on every build before any smoke test or deploy:
//   DIST_DIR=dist BASE=<base> node scripts/verify-dist.ts      (from web/)
// Exits 1 and lists every problem if the build is not safe to ship.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { resolveBase } from '../config/app.ts';
import { cspPolicy } from '../config/csp.ts';
import { checkBuiltHtml, checkCspPolicy } from './checks/csp.ts';
import { checkManifest, checkPromptMode } from './checks/manifest.ts';
import { checkPrecache, parseSwManifest, type DistFile } from './checks/precache.ts';

const dist = process.env.DIST_DIR ?? 'dist';
const base = resolveBase();
const read = (rel: string) => readFileSync(join(dist, rel), 'utf8');
const files: DistFile[] = readdirSync(dist, { recursive: true, encoding: 'utf8' })
  .map((rel) => rel.split('\\').join('/'))
  .filter((rel) => statSync(join(dist, rel)).isFile())
  .map((rel) => ({ path: rel, size: statSync(join(dist, rel)).size }));

const sw = read('sw.js');
const errors = [
  ...checkManifest(JSON.parse(read('manifest.webmanifest')), base).map((e) => `manifest.webmanifest: ${e}`),
  ...checkPromptMode(sw).map((e) => `sw.js: ${e}`),
  ...checkPrecache(files, parseSwManifest(sw)).map((e) => `precache: ${e}`),
  ...checkCspPolicy(cspPolicy()).map((e) => `csp.json: ${e}`),
  ...checkBuiltHtml(read('index.html'), cspPolicy()).map((e) => `index.html: ${e}`),
];

if (errors.length > 0) {
  console.error(`verify-dist: ${dist} (base ${base}) is not safe to ship:`);
  for (const error of errors) console.error(`  ${error}`);
  process.exit(1);
}
console.log(`verify-dist: ${dist} ok (base ${base}, ${files.length} files)`);
