import { describe, expect, it } from 'vitest';
import type { BuildLog } from '../../config/noticesLog.ts';
import { inventoryChanges, inventoryOf, packageRoot, type Disk } from './inventory.ts';

// A small world: two packages (one nested, one with a vendored copy that has no package.json
// of its own), Vite and rolldown, one Workbox module, and a public file.
const FILES: Record<string, string> = {
  'node_modules/lib/package.json': '{"name":"lib","version":"1.0.0"}',
  'node_modules/lib/index.js': 'lib',
  'node_modules/lib/dist/node_modules/vendored/index.js': 'vendored',
  'node_modules/host/package.json': '{"name":"host","version":"2.0.0"}',
  'node_modules/host/node_modules/@scope/inner/package.json': '{"name":"@scope/inner","version":"3.0.0"}',
  'node_modules/host/node_modules/@scope/inner/inner.js': 'inner',
  'node_modules/vite/package.json': '{"name":"vite","version":"8.3.5"}',
  'node_modules/rolldown/package.json': '{"name":"rolldown","version":"1.2.15"}',
  'node_modules/workbox-build/package.json': '{"name":"workbox-build","version":"7.4.1"}',
  'node_modules/workbox-core/package.json': '{"name":"workbox-core","version":"7.4.1"}',
  'node_modules/workbox-core/_version.js': "self['workbox:core:7.4.0']&&_()",
  'public/data.json': '{}',
};

function disk(files = FILES, dist: Record<string, string> = DIST): Disk {
  return {
    read: (path) => (path in files ? Buffer.from(files[path]) : null),
    distFiles: Object.keys(dist).sort(),
    readDist: (path) => Buffer.from(dist[path]),
    publicFiles: Object.keys(files)
      .filter((p) => p.startsWith('public/'))
      .map((p) => p.slice('public/'.length)),
  };
}

const LOG: BuildLog = {
  chunks: [
    {
      file: 'assets/index.js',
      worker: false,
      modules: [
        'src/main.tsx',
        'node_modules/lib/index.js',
        'node_modules/lib/dist/node_modules/vendored/index.js',
        '\0vite/preload-helper.js',
        '\0rolldown/runtime.js',
      ],
    },
    {
      file: 'assets/worker.js',
      worker: true,
      modules: ['node_modules/host/node_modules/@scope/inner/inner.js'],
    },
  ],
  assets: [{ file: 'index.html', from: ['index.html'] }],
};
const DIST: Record<string, string> = {
  'assets/index.js': '',
  'assets/worker.js': '',
  'index.html': '',
  'data.json': '{}',
  'sw.js': '',
  'workbox-abc.js': "self['workbox:core:7.4.0']",
};

describe("a build's inventory", () => {
  const { inventory, problems } = inventoryOf(LOG, disk());

  it('names every package by its own package.json, nested ones too, and hashes their files', () => {
    expect(problems).toEqual([]);
    expect(Object.keys(inventory.packages).sort()).toEqual(['@scope/inner@3.0.0', 'lib@1.0.0']);
    // A vendored copy without a package.json belongs to the package that carries it.
    expect(Object.keys(inventory.packages['lib@1.0.0']).sort()).toEqual([
      'node_modules/lib/dist/node_modules/vendored/index.js',
      'node_modules/lib/index.js',
    ]);
    expect(inventory.packages['lib@1.0.0']['node_modules/lib/index.js']).toMatch(/^[0-9a-f]{64}$/);
  });

  it('names the build tools whose code ships, the Workbox modules and the public files', () => {
    expect(inventory.tools).toEqual(['rolldown@1.2.15', 'vite@8.3.5', 'workbox-build@7.4.1']);
    expect(inventory.workbox).toEqual({ 'workbox-core@7.4.1': '7.4.0' });
    expect(inventory.public).toEqual(['data.json']);
  });

  it('finds a package root above a scoped, nested package', () => {
    expect(packageRoot('node_modules/host/node_modules/@scope/inner/inner.js', disk())).toBe(
      'node_modules/host/node_modules/@scope/inner',
    );
  });
});

describe('the inventory check fails on', () => {
  const reviewed = inventoryOf(LOG, disk()).inventory;
  const changesWith = (files: Record<string, string>, log = LOG, dist = DIST) =>
    inventoryChanges(reviewed, inventoryOf(log, disk(files, dist)).inventory);

  it('a new package', () => {
    const log: BuildLog = {
      ...LOG,
      chunks: [
        ...LOG.chunks,
        {
          file: 'assets/x.js',
          worker: false,
          modules: ['node_modules/host/index.js'],
        },
      ],
    };
    const files = { ...FILES, 'node_modules/host/index.js': 'host' };
    expect(changesWith(files, log, { ...DIST, 'assets/x.js': '' })).toEqual(['new package host@2.0.0']);
  });

  it('a changed version', () => {
    const files = {
      ...FILES,
      'node_modules/lib/package.json': '{"name":"lib","version":"1.0.1"}',
    };
    expect(changesWith(files)).toEqual(['package lib@1.0.0 no longer ships', 'new package lib@1.0.1']);
  });

  it('a changed file', () => {
    expect(changesWith({ ...FILES, 'node_modules/lib/index.js': 'lib, changed' })).toEqual([
      'lib@1.0.0: node_modules/lib/index.js changed',
    ]);
  });

  it('a new public file', () => {
    expect(
      changesWith({ ...FILES, 'public/new.bin': 'x' }, LOG, {
        ...DIST,
        'new.bin': 'x',
      }),
    ).toEqual(['new public file new.bin']);
  });

  it('a new build tool', () => {
    const log: BuildLog = {
      ...LOG,
      chunks: [
        {
          ...LOG.chunks[0],
          modules: [...LOG.chunks[0].modules, '/@vite-plugin-pwa/virtual:pwa-register'],
        },
        LOG.chunks[1],
      ],
    };
    const files = {
      ...FILES,
      'node_modules/vite-plugin-pwa/package.json': '{"name":"vite-plugin-pwa","version":"2.0.0"}',
    };
    expect(changesWith(files, log)).toEqual(['new build tool vite-plugin-pwa@2.0.0']);
  });
});

describe('the inventory cannot be made from a build with', () => {
  it('a module that belongs to no package and is not the app', () => {
    const log: BuildLog = {
      ...LOG,
      chunks: [{ ...LOG.chunks[0], modules: ['\0unknown/helper.js'] }, LOG.chunks[1]],
    };
    expect(inventoryOf(log, disk()).problems).toEqual([
      'assets/index.js: module "\\u0000unknown/helper.js" belongs to no package and isn\'t the app\'s own',
    ]);
  });

  it('a file no module, public file, tool or Workbox marker accounts for', () => {
    expect(inventoryOf(LOG, disk(FILES, { ...DIST, 'stray.js': '' })).problems).toEqual([
      'stray.js: no module, public file, tool or Workbox marker accounts for it',
    ]);
  });

  it("a Workbox marker that differs from its installed package's own (7.4.1 packages say 7.4.0)", () => {
    expect(
      inventoryOf(
        LOG,
        disk(FILES, {
          ...DIST,
          'workbox-abc.js': "self['workbox:core:7.4.1']",
        }),
      ).problems,
    ).toEqual(["workbox-abc.js: workbox-core's marker is 7.4.1, its installed _version.js says 7.4.0"]);
  });

  it('a Workbox module that is not installed', () => {
    expect(
      inventoryOf(
        LOG,
        disk(FILES, {
          ...DIST,
          'workbox-abc.js': "self['workbox:routing:7.4.0']",
        }),
      ).problems,
    ).toEqual(['workbox-abc.js: workbox-routing is in the service worker but not installed']);
  });
});
