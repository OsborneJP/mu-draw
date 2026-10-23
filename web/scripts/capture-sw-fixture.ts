// Refresh scripts/checks/fixtures/ from a fresh build, for the precache guard's tests:
//   npm run build && node scripts/capture-sw-fixture.ts      (from web/)
// The base path is a placeholder (app.config.json), so it is replaced with /app-x/.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveBase } from '../config/app.ts';

const dist = process.env.DIST_DIR ?? 'dist';
const base = resolveBase();
const out = new URL('./checks/fixtures/', import.meta.url);

const sw = readFileSync(join(dist, 'sw.js'), 'utf8')
  .split(base.replaceAll('/', '\\/'))
  .join('\\/app-x\\/')
  .split(base)
  .join('/app-x/');
writeFileSync(new URL('sw.js', out), sw);

const files = readdirSync(dist, { recursive: true, encoding: 'utf8' })
  .map((rel) => rel.split('\\').join('/'))
  .filter((rel) => statSync(join(dist, rel)).isFile())
  .sort()
  .map((rel) => ({ path: rel, size: statSync(join(dist, rel)).size }));
writeFileSync(new URL('dist-files.json', out), `${JSON.stringify(files, null, 2)}\n`);
console.log(`captured sw.js and ${files.length} file entries from ${dist}`);
