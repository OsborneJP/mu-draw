import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { currentNotices, NOTICES_OUT, noticesSources } from './disk.ts';
import type { Inventory } from './inventory.ts';
import { buildNotices, isPrebuilt, sha256, splitLicence, type NoticeRecord, type Sources } from './notices.ts';

const CANONICAL = noticesSources().canonical;

describe('the shipped notices', () => {
  it('are what the reviewed inventory and records make, with nothing missing (bar B.2)', () => {
    const { text, problems } = currentNotices();
    expect(problems).toEqual([]);
    expect(text).toBe(readFileSync(NOTICES_OUT, 'utf8'));
  });

  it('start with a byte-order mark, so browsers that guess no encoding read them as UTF-8', () => {
    expect(readFileSync(NOTICES_OUT).subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
  });
});

describe('copyright lines are found by subtraction', () => {
  const apache = readFileSync(new URL('../../node_modules/indigo-ketcher/LICENSE', import.meta.url), 'utf8');

  it("finds none in a bare Apache licence, whose own words and appendix don't count", () => {
    expect(splitLicence(apache, CANONICAL['Apache-2.0'])?.copyright).toEqual([]);
  });

  it('keeps every line above the body but its title, and none of the body', () => {
    // A body line that starts "COPYRIGHT HOLDERS", and a holder named mid-line above it, as in
    // react-transition-group's licence.
    const body = CANONICAL.MIT.split('\n')
      .slice(4)
      .join('\n')
      .replace('AUTHORS OR COPYRIGHT HOLDERS', 'AUTHORS OR\nCOPYRIGHT HOLDERS');
    expect(body).toMatch(/^COPYRIGHT HOLDERS/m);
    const mit = `The MIT License (MIT)\n=====\n\nCopyright (c) 2020 Ada Lovelace\nForked from Analytical (x) Copyright 2019 Charles Babbage\nAll rights reserved.\n\n${body}`;
    expect(splitLicence(mit, CANONICAL.MIT)?.copyright).toEqual([
      'Copyright (c) 2020 Ada Lovelace',
      'Forked from Analytical (x) Copyright 2019 Charles Babbage',
      'All rights reserved.',
    ]);
  });

  it('refuses a text whose opening is not the licence it declares', () => {
    expect(
      splitLicence('Software License Agreement\n\nRedistribution and use of this software', CANONICAL['BSD-3-Clause']),
    ).toBeNull();
  });
});

// A small world for the refusals: one package, its files, and whatever records a test adds.
function world(
  files: Record<string, string>,
  records: NoticeRecord[] = [],
  texts: Record<string, string> = {},
  tools: string[] = [],
) {
  const sources: Sources = {
    read: (path) => (path in files ? Buffer.from(files[path]) : null),
    list: (dir) =>
      Object.keys(files)
        .filter((p) => p.startsWith(`${dir}/`) && !p.slice(dir.length + 1).includes('/'))
        .map((p) => p.slice(dir.length + 1)),
    readText: (file) => (file in texts ? Buffer.from(texts[file]) : null),
    canonical: CANONICAL,
  };
  const packages: Inventory['packages'] = {};
  for (const [path, text] of Object.entries(files)) {
    if (path.endsWith('.js') || path.endsWith('.wasm')) {
      const id = JSON.parse(files[`${path.split('/').slice(0, 2).join('/')}/package.json`]) as {
        name: string;
        version: string;
      };
      (packages[`${id.name}@${id.version}`] ??= {})[path] = sha256(text);
    }
  }
  return buildNotices({ packages, tools, workbox: {}, public: ['data.json'] }, records, sources, 'About').problems;
}

const MIT_PACKAGE = {
  'node_modules/lib/package.json': '{"name":"lib","version":"1.0.0","license":"MIT"}',
  'node_modules/lib/LICENSE': `Copyright (c) 2020 Ada Lovelace\n\n${CANONICAL.MIT.split('\n').slice(4).join('\n')}`,
  'node_modules/lib/index.js': 'export const x = 1;',
};

describe('the notices refuse to be written', () => {
  it('for nothing when a plain package has its licence and holder', () => {
    expect(world(MIT_PACKAGE)).toEqual([]);
  });

  it('when a licence is outside the plain ones and no record covers it', () => {
    expect(
      world({
        ...MIT_PACKAGE,
        'node_modules/lib/package.json': '{"name":"lib","version":"1.0.0","license":"MPL-2.0"}',
      }),
    ).toEqual(['lib@1.0.0: its licence "MPL-2.0" needs a reviewed record']);
  });

  it('when a package has no licence file', () => {
    const files = Object.fromEntries(Object.entries(MIT_PACKAGE).filter(([path]) => !path.endsWith('LICENSE')));
    expect(world(files)).toEqual(['lib@1.0.0: its package has no licence file; it needs a reviewed record']);
  });

  it('when no copyright line is found (a bare Apache licence)', () => {
    const apache = readFileSync(new URL('../../node_modules/indigo-ketcher/LICENSE', import.meta.url), 'utf8');
    const files = {
      ...MIT_PACKAGE,
      'node_modules/lib/package.json': '{"name":"lib","version":"1.0.0","license":"Apache-2.0"}',
      'node_modules/lib/LICENSE': apache,
    };
    expect(world(files)).toEqual(['lib@1.0.0: no copyright line in its licence or NOTICE; it needs a reviewed record']);
  });

  it('when a prebuilt file (a bundler runtime) has no record for its bytes', () => {
    const files = { ...MIT_PACKAGE, 'node_modules/lib/index.js': 'function __webpack_require__(id) {}' };
    expect(world(files)).toEqual([
      'lib@1.0.0: node_modules/lib/index.js is prebuilt or vendored, and no record describes this version of it',
    ]);
  });

  it("when a file's source map names sources outside its package, and no record describes it", () => {
    const files = {
      ...MIT_PACKAGE,
      'node_modules/lib/index.js.map': JSON.stringify({ sources: ['../../node_modules/other/index.js'] }),
    };
    expect(world(files)).toEqual([
      'lib@1.0.0: node_modules/lib/index.js is prebuilt or vendored, and no record describes this version of it',
    ]);
    expect(
      isPrebuilt('node_modules/lib/index.js', Buffer.from(''), (p) =>
        p.endsWith('.map') ? Buffer.from(JSON.stringify({ sources: ['./own.ts'] })) : Buffer.from('{}'),
      ),
    ).toBe(false);
  });

  it('when a vendored copy (no package.json of its own) has no record', () => {
    const files = { ...MIT_PACKAGE, 'node_modules/lib/dist/node_modules/copy/index.js': 'copied' };
    expect(world(files)).toEqual([
      'lib@1.0.0: node_modules/lib/dist/node_modules/copy/index.js is prebuilt or vendored, and no record describes this version of it',
    ]);
  });

  const record = (over: Partial<NoticeRecord> = {}): NoticeRecord => ({
    slug: 'r',
    title: 'Inlined',
    part: 2,
    keys: [{ file: 'node_modules/lib/index.js', sha256: sha256('function __webpack_require__(id) {}') }],
    components: [
      {
        name: 'other',
        version: '2.0',
        licence: 'MIT',
        copyright: ['Copyright 2021 Someone'],
        texts: [{ file: 'texts/mit.txt', url: 'https://example.org/MIT@abc', sha256: sha256('MIT text') }],
      },
    ],
    ...over,
  });
  const PREBUILT = { ...MIT_PACKAGE, 'node_modules/lib/index.js': 'function __webpack_require__(id) {}' };

  it('for nothing when a record describes the prebuilt file', () => {
    expect(world(PREBUILT, [record()], { 'texts/mit.txt': 'MIT text' })).toEqual([]);
  });

  it("when a record's text is not the reviewed one", () => {
    expect(world(PREBUILT, [record()], { 'texts/mit.txt': 'MIT text, edited' })).toEqual([
      'r: texts/mit.txt is not the reviewed text',
    ]);
  });

  it('when a record is keyed to bytes that no longer ship', () => {
    const files = { ...PREBUILT, 'node_modules/lib/index.js': 'function __webpack_require__(id) { /* v2 */ }' };
    expect(world(files, [record()], { 'texts/mit.txt': 'MIT text' })).toEqual([
      `r: {"file":"node_modules/lib/index.js","sha256":"${sha256('function __webpack_require__(id) {}')}"} no longer describes the build`,
      'lib@1.0.0: node_modules/lib/index.js is prebuilt or vendored, and no record describes this version of it',
      "r: a part-2 record that no package's entry prints",
    ]);
  });

  it('when a component has no copyright line and no reason why', () => {
    const bare = record({ components: [{ ...record().components[0], copyright: [], statement: 'A statement.' }] });
    expect(world(PREBUILT, [bare], { 'texts/mit.txt': 'MIT text' })).toEqual([
      'r: other has no copyright line and no noCopyright saying why',
    ]);
    const said = record({ components: [{ ...record().components[0], copyright: [], noCopyright: 'public domain' }] });
    expect(world(PREBUILT, [said], { 'texts/mit.txt': 'MIT text' })).toEqual([]);
  });

  it('for a build tool whose runtime ships, as for any package: here, one with no licence file', () => {
    const tool = { 'node_modules/tool/package.json': '{"name":"tool","version":"3.0.0","license":"MIT"}' };
    expect(world({ ...MIT_PACKAGE, ...tool }, [], {}, ['tool@3.0.0'])).toEqual([
      'tool@3.0.0: its package has no licence file; it needs a reviewed record',
    ]);
    expect(
      world({ ...MIT_PACKAGE, ...tool, 'node_modules/tool/LICENSE': MIT_PACKAGE['node_modules/lib/LICENSE'] }, [], {}, [
        'tool@3.0.0',
      ]),
    ).toEqual([]);
  });

  it('when a part-2 record would print nowhere (keyed to no package or file of the build)', () => {
    const stray = record({ keys: [{ public: 'data.json' }] });
    expect(world(PREBUILT, [record(), stray], { 'texts/mit.txt': 'MIT text' })).toEqual([
      "r: a part-2 record that no package's entry prints",
    ]);
  });
});
