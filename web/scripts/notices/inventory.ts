// What a build ships that isn't the app's own code, for the shipped licence notices
// (docs/plans/licence-notices.md, "A reviewed inventory"). Built from the build's log
// (config/noticesLog.ts), the files in its output folder and node_modules; compared after
// every build with third_party/notices/inventory.json, the inventory the notices were last
// reviewed against.
import { createHash } from 'node:crypto';
import type { BuildLog } from '../../config/noticesLog.ts';

export interface Inventory {
  /** Every package whose code ships ("name@version"), with each of its shipped files' SHA-256
   * (paths relative to web/). */
  packages: Record<string, Record<string, string>>;
  /** Build tools whose own runtime code ships ("name@version"). */
  tools: string[];
  /** Workbox modules in the service worker ("workbox-core@7.4.1"), with the version marker
   * their own _version.js carries (which lags the package's version). */
  workbox: Record<string, string>;
  /** Files copied from web/public, by path in the build. By path only: the app's own data
   * changes often without changing any licence, but a new file may bring one. */
  public: string[];
}

/** What the inventory needs to read from disk; a test passes fixtures. */
export interface Disk {
  /** A file under web/ (node_modules/…, public/…), or null if there is none. */
  read(path: string): Buffer | null;
  /** The build's output files, relative to its folder. */
  distFiles: string[];
  /** A file of the build's output. */
  readDist(path: string): Buffer;
  /** web/public's files, relative to it. */
  publicFiles: string[];
}

// The build tools' helpers, which arrive as virtual modules.
const TOOL_MODULES: [RegExp, string][] = [
  [/^\0rolldown\//, 'rolldown'],
  [/^\0vite\//, 'vite'],
  [/^__vite-browser-external$/, 'vite'],
  [/^\/@vite-plugin-pwa\//, 'vite-plugin-pwa'],
];
// Written into the build by tools, not bundled from modules.
const TOOL_FILES: [RegExp, string][] = [[/^sw\.js$/, 'workbox-build']];
// The service worker's runtime, which carries "workbox:<module>:<version>" markers.
const WORKBOX_RUNTIME = /^workbox-[\w-]+\.js$/;
// The app's own sources.
const OWN = /^(src\/|index\.html$)/;
// The notices themselves, which the inventory can't contain (they would change with it).
export const NOTICES_OUTPUTS = /^third-party\//;

const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

/** The package a node_modules file belongs to: the folder of the innermost
 * node_modules/<name> (or @scope/<name>) above it that has a package.json. */
export function packageRoot(path: string, disk: Pick<Disk, 'read'>): string | null {
  const parts = path.split('/');
  for (let i = parts.lastIndexOf('node_modules'); i >= 0; i = parts.lastIndexOf('node_modules', i - 1)) {
    const length = parts[i + 1]?.startsWith('@') ? 3 : 2;
    const root = parts.slice(0, i + length).join('/');
    if (disk.read(`${root}/package.json`)) return root;
    if (i === 0) break;
  }
  return null;
}

function packageId(root: string, disk: Pick<Disk, 'read'>): string {
  const { name, version } = JSON.parse(disk.read(`${root}/package.json`)!.toString('utf8')) as {
    name: string;
    version: string;
  };
  return `${name}@${version}`;
}

/** The inventory of one build, and the problems found making it. */
export function inventoryOf(log: BuildLog, disk: Disk): { inventory: Inventory; problems: string[] } {
  const problems: string[] = [];
  const packages: Inventory['packages'] = {};
  const tools = new Set<string>();
  const addFile = (path: string) => {
    const root = packageRoot(path, disk);
    const bytes = disk.read(path);
    if (!root || !bytes) {
      problems.push(`${path}: not a file in a package`);
      return;
    }
    const id = packageId(root, disk);
    (packages[id] ??= {})[path] = sha256(bytes);
  };
  const addTool = (name: string) => tools.add(packageId(`node_modules/${name}`, disk));

  for (const chunk of log.chunks) {
    for (const id of chunk.modules) {
      if (id.startsWith('node_modules/')) addFile(id);
      else if (OWN.test(id)) continue;
      else {
        const tool = TOOL_MODULES.find(([re]) => re.test(id));
        if (tool) addTool(tool[1]);
        else problems.push(`${chunk.file}: module ${JSON.stringify(id)} belongs to no package and isn't the app's own`);
      }
    }
  }
  for (const asset of log.assets) for (const from of asset.from) if (from.startsWith('node_modules/')) addFile(from);

  const publicFiles = disk.publicFiles.filter((path) => !NOTICES_OUTPUTS.test(path)).sort();

  const workbox: Inventory['workbox'] = {};
  const fromBundle = new Set([...log.chunks.map((c) => c.file), ...log.assets.map((a) => a.file)]);
  for (const file of disk.distFiles) {
    if (fromBundle.has(file) || publicFiles.includes(file) || NOTICES_OUTPUTS.test(file)) continue;
    const tool = TOOL_FILES.find(([re]) => re.test(file));
    if (tool) {
      addTool(tool[1]);
    } else if (WORKBOX_RUNTIME.test(file)) {
      const text = disk.readDist(file).toString('utf8');
      for (const [, module, built] of text.matchAll(/workbox:([a-z-]+):(\d+\.\d+\.\d+)/g)) {
        const root = `node_modules/workbox-${module}`;
        const own = disk
          .read(`${root}/_version.js`)
          ?.toString('utf8')
          .match(/workbox:[a-z-]+:(\d+\.\d+\.\d+)/)?.[1];
        if (!own) problems.push(`${file}: workbox-${module} is in the service worker but not installed`);
        else if (own !== built)
          problems.push(`${file}: workbox-${module}'s marker is ${built}, its installed _version.js says ${own}`);
        else workbox[packageId(root, disk)] = own;
      }
    } else {
      problems.push(`${file}: no module, public file, tool or Workbox marker accounts for it`);
    }
  }
  return {
    inventory: {
      packages,
      tools: [...tools].sort(),
      workbox,
      public: publicFiles,
    },
    problems,
  };
}

/** How a build's inventory differs from the reviewed one, in words. */
export function inventoryChanges(reviewed: Inventory, built: Inventory): string[] {
  const changes: string[] = [];
  const keys = (a: object, b: object) => [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
  for (const id of keys(reviewed.packages, built.packages)) {
    const [was, now] = [reviewed.packages[id], built.packages[id]];
    if (!was) changes.push(`new package ${id}`);
    else if (!now) changes.push(`package ${id} no longer ships`);
    else {
      for (const path of keys(was, now)) {
        if (!(path in was)) changes.push(`${id}: new file ${path}`);
        else if (!(path in now)) changes.push(`${id}: ${path} no longer ships`);
        else if (was[path] !== now[path]) changes.push(`${id}: ${path} changed`);
      }
    }
  }
  for (const tool of built.tools) if (!reviewed.tools.includes(tool)) changes.push(`new build tool ${tool}`);
  for (const tool of reviewed.tools)
    if (!built.tools.includes(tool)) changes.push(`build tool ${tool} no longer ships`);
  for (const id of keys(reviewed.workbox, built.workbox)) {
    if (reviewed.workbox[id] !== built.workbox[id])
      changes.push(`Workbox ${id}: ${reviewed.workbox[id] ?? 'none'} -> ${built.workbox[id] ?? 'none'}`);
  }
  for (const path of built.public) if (!reviewed.public.includes(path)) changes.push(`new public file ${path}`);
  for (const path of reviewed.public)
    if (!built.public.includes(path)) changes.push(`public file ${path} no longer ships`);
  return changes;
}
