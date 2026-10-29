// Writes the shipped licence notices, web/public/third-party/NOTICES.txt
// (docs/plans/licence-notices.md, "The notices file"), from the reviewed inventory, the reviewed
// records in third_party/notices/ and the packages in node_modules. It refuses to write a file
// that would be incomplete; each refusal is one of the guards of the plan's bar B.3.
import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import { packageRoot, type Inventory } from './inventory.ts';

export interface TextRef {
  file: string;
  url: string;
  sha256: string;
}
export interface Component {
  name: string;
  version: string;
  licence: string;
  /** Verbatim copyright lines; when there are none, noCopyright says why. */
  copyright?: string[];
  /** Why a component has no copyright line: "public domain", "none named upstream", … */
  noCopyright?: string;
  /** MPL 1.1's Initial Developers, which it asks to be named (cairo). */
  initialDevelopers?: string[];
  /** How the copy shipped differs from its upstream, and who changed it. */
  modifications?: string[];
  texts?: TextRef[];
  statement?: string;
  /** For the next reviewer; not shown. */
  evidence?: string;
}
export type Key = { file: string; sha256: string } | { package: string } | { module: string } | { public: string };
export interface NoticeRecord {
  slug: string;
  title: string;
  part: 2 | 3 | 4;
  keys: Key[];
  inlinesNothing?: boolean;
  components: Component[];
}

/** What the notices read; a test passes fixtures. */
export interface Sources {
  /** A file under web/ (node_modules/…, src/…), or null. */
  read(path: string): Buffer | null;
  /** A folder's file names (top level only). */
  list(dir: string): string[];
  /** A file in third_party/notices/ (the records' texts), or null. */
  readText(file: string): Buffer | null;
  /** The canonical licence texts, by SPDX id. */
  canonical: Record<string, string>;
}

/** Licences the notices take from a package's own files, with no reviewed record. */
export const PLAIN_LICENCES = ['MIT', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause', 'Apache-2.0', '0BSD', 'Zlib'];
const LICENCE_FILE = /^(licen[cs]e|copying)(\.(md|txt|markdown))?$/i;
const NOTICE_FILE = /^notice(\.(md|txt))?$/i;
const COPYRIGHT_LINE = /^[\s/*#>-]*(copyright\b|\(c\)\s|©)/i;
const MENTIONS_COPYRIGHT = /copyright|\(c\)|©/i;
// A licence file's own title or underline, which says nothing about who holds the copyright.
const TITLE = /^[\s#=*_-]*((the )?[\w.\- ]*licen[cs]e( agreement)?( \([\w.\- ]+\))?)?[\s#=*_-]*$/i;
const BUNDLER_MARKERS = ['__webpack_require__', 'define.amd', 'wasmBinary'];

export const sha256 = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const words = (text: string) => text.replace(/\s+/g, ' ').trim();
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Prebuilt (the plan's rule): a wasm file, one holding a bundler's runtime or wrapper, or one
 * whose source map names sources outside its package, so it may carry other authors' code that
 * its package's own notice doesn't cover. */
export function isPrebuilt(path: string, bytes: Buffer, read: Sources['read']): boolean {
  if (path.endsWith('.wasm')) return true;
  const text = bytes.toString('latin1');
  if (BUNDLER_MARKERS.some((marker) => text.includes(marker))) return true;
  const map = read(`${path}.map`);
  if (!map) return false;
  const root = packageRoot(path, { read });
  let sources: unknown;
  try {
    sources = (JSON.parse(map.toString('utf8')) as { sources?: unknown }).sources;
  } catch {
    return false;
  }
  return (Array.isArray(sources) ? sources : []).some((source: unknown) => {
    if (typeof source !== 'string') return false;
    if (source.includes('node_modules/')) return true;
    if (/^[a-z][\w+.-]*:/i.test(source)) return false; // webpack://… names no file
    return !posix.normalize(posix.join(posix.dirname(path), source)).startsWith(`${root}/`);
  });
}

/** A copy vendored inside another package without a package.json of its own. */
export function isVendored(path: string, read: Sources['read']): boolean {
  const parts = path.split('/');
  const i = parts.lastIndexOf('node_modules');
  const innermost = parts.slice(0, i + (parts[i + 1]?.startsWith('@') ? 3 : 2)).join('/');
  return packageRoot(path, { read }) !== innermost;
}

/** Where the body of a canonical licence starts: its first four words, after its title and
 * copyright lines (SPDX's MIT text opens "MIT License", then "Copyright (c) <year> …"). */
export function bodyOpening(canonical: string): string[] {
  const lines = canonical.split('\n').filter((l) => l.trim() && !COPYRIGHT_LINE.test(l));
  const titled = /^\S+ License$/.test(lines[0]?.trim() ?? '') && lines[0].trim() !== 'Apache License';
  return words(lines.slice(titled ? 1 : 0).join(' '))
    .split(' ')
    .slice(0, 4);
}

/** A licence file split by subtraction into its notice and its body: the body starts where the
 * canonical text's body does (from the start of that line), and every line above it but a bare
 * title or rule is the notice, kept whole, so a holder named mid-line isn't lost. Lines in the
 * body, Apache's appendix included, never count. Null if the canonical opening isn't there. */
export function splitLicence(text: string, canonical: string): { copyright: string[]; body: string } | null {
  const found = new RegExp(bodyOpening(canonical).map(escapeRe).join('\\s+')).exec(text);
  if (!found) return null;
  const lineStart = text.lastIndexOf('\n', found.index) + 1;
  const header = text.slice(0, lineStart).replace(/\r\n?/g, '\n').split('\n');
  return {
    copyright: header.filter((line) => line.trim() && !TITLE.test(line)).map((line) => line.trim()),
    body: text.slice(lineStart).replace(/\r\n?/g, '\n').trimEnd(),
  };
}

/** The licence a package.json declares ("MIT", "(MIT AND Zlib)", or the old {type} forms). */
export function declaredLicence(pkg: { license?: unknown; licenses?: unknown }): string | null {
  const one = (l: unknown) =>
    typeof l === 'string' ? l : typeof l === 'object' && l !== null && 'type' in l ? String(l.type) : null;
  if (pkg.license !== undefined) return one(pkg.license);
  if (Array.isArray(pkg.licenses) && pkg.licenses.length === 1) return one(pkg.licenses[0]);
  return null;
}

/** The SPDX ids an expression is made of: "(MIT AND Zlib)" -> MIT, Zlib. */
export function licenceIds(expression: string): string[] {
  return expression
    .replace(/[()]/g, ' ')
    .split(/\s+/)
    .filter((t) => t && t !== 'AND' && t !== 'OR');
}

/** Every package whose code ships: bundled, a build tool's runtime, or in the service worker. */
export function shippedPackages(inventory: Inventory): string[] {
  return [...Object.keys(inventory.packages), ...inventory.tools, ...Object.keys(inventory.workbox)];
}

export function keyHolds(key: Key, inventory: Inventory, read: Sources['read']): boolean {
  if ('file' in key) return Object.values(inventory.packages).some((files) => files[key.file] === key.sha256);
  if ('package' in key) return shippedPackages(inventory).includes(key.package);
  if ('module' in key) return read(key.module) !== null;
  return inventory.public.includes(key.public);
}

/** Licence bodies, each printed once under a label; entries whose bodies are the same text,
 * line breaks and spacing aside, share it. */
class Bodies {
  private byText = new Map<string, { label: string; text: string; from: string }>();
  private counts = new Map<string, number>();
  /** The label of a text: its own name if given (a record's text file), else the licence
   * and a number. */
  label(licence: string, text: string, from: string, named?: string): string {
    const key = words(text);
    const known = this.byText.get(key);
    if (known) return known.label;
    const name = bare(licence);
    const n = (this.counts.get(name) ?? 0) + 1;
    this.counts.set(name, n);
    const label = named ?? `${name} #${n}`;
    this.byText.set(key, { label, text, from });
    return label;
  }
  all() {
    return [...this.byText.values()];
  }
}

const heading = (title: string) => [title, '='.repeat(title.length), ''];
/** "(MIT AND Zlib)" as "MIT AND Zlib", for printing. */
const bare = (licence: string) => licence.replace(/^\((.*)\)$/, '$1');
/** A text as the file shows it: Unix line ends, no byte-order mark, no trailing blank lines. */
const plain = (text: string) =>
  text
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .trimEnd();
const indent = (text: string, by: string) =>
  text
    .split('\n')
    .map((line) => (line.trim() ? by + line : ''))
    .join('\n');

/** The notices file's text, and the reasons it can't be written. `about` is part 1. */
export function buildNotices(
  inventory: Inventory,
  records: NoticeRecord[],
  sources: Sources,
  about: string,
): { text: string; problems: string[] } {
  const problems: string[] = [];
  const bodies = new Bodies();

  for (const record of records) {
    for (const c of record.components) {
      if ((c.copyright ?? []).length === 0 && !c.noCopyright) {
        problems.push(`${record.slug}: ${c.name} has no copyright line and no noCopyright saying why`);
      }
    }
    for (const key of record.keys) {
      if (!keyHolds(key, inventory, sources.read)) {
        problems.push(`${record.slug}: ${JSON.stringify(key)} no longer describes the build`);
      }
    }
    for (const component of record.components) {
      for (const ref of component.texts ?? []) {
        const bytes = sources.readText(ref.file);
        if (!bytes) problems.push(`${record.slug}: ${ref.file} is missing`);
        else if (sha256(bytes) !== ref.sha256) problems.push(`${record.slug}: ${ref.file} is not the reviewed text`);
      }
    }
  }
  const keyed = (test: (k: Key) => boolean) => records.filter((r) => r.keys.some(test));

  const component = (c: Component) => {
    const lines = [`  ${c.name} ${c.version} (${bare(c.licence)})`];
    for (const line of c.copyright ?? []) lines.push(indent(line, '    '));
    for (const line of c.initialDevelopers ?? []) lines.push(indent(`Initial Developer: ${line}`, '    '));
    for (const line of c.modifications ?? []) lines.push(indent(`Changed: ${line}`, '    '));
    for (const ref of c.texts ?? []) {
      const text = plain(sources.readText(ref.file)?.toString('utf8') ?? '');
      const named = ref.file.replace(/^texts\//, '').replace(/\.txt$/, '');
      lines.push(`    See [${bodies.label(c.licence, text, ref.url, named)}]`);
    }
    return lines.join('\n');
  };

  const printed = new Set<NoticeRecord>();
  /** One package's entry: its notice, its licence text, and what was bundled into its files. */
  const entry = (id: string, root: string, files: Record<string, string>): string[] => {
    const out: string[] = [];
    // A package's own records describe the package; records keyed to its files describe what
    // was bundled into them.
    const own = keyed((k) => 'package' in k && k.package === id).filter((r) => !r.keys.some((k) => 'file' in k));
    const inlined: NoticeRecord[] = [];
    for (const [path, hash] of Object.entries(files).sort(([a], [b]) => a.localeCompare(b))) {
      const describing = keyed((k) => 'file' in k && k.file === path && k.sha256 === hash);
      const bytes = sources.read(path);
      if (
        ((bytes && isPrebuilt(path, bytes, sources.read)) || isVendored(path, sources.read)) &&
        describing.length === 0
      ) {
        problems.push(`${id}: ${path} is prebuilt or vendored, and no record describes this version of it`);
      }
      for (const r of describing) if (!inlined.includes(r) && !own.includes(r)) inlined.push(r);
    }
    const pkg = JSON.parse(sources.read(`${root}/package.json`)?.toString('utf8') ?? '{}') as Record<string, unknown>;
    const licence = declaredLicence(pkg) ?? '';
    const names = sources.list(root);
    const noticeName = names.find((n) => NOTICE_FILE.test(n));
    const notice = noticeName ? plain(sources.read(`${root}/${noticeName}`)!.toString('utf8')).trim() : null;

    out.push(`${id} (${bare(licence) || 'see below'})`);
    if (own.length === 0) {
      const ids = licenceIds(licence);
      const licenceName = names.find((n) => LICENCE_FILE.test(n));
      if (ids.length === 0 || !ids.every((l) => PLAIN_LICENCES.includes(l) && sources.canonical[l])) {
        problems.push(`${id}: its licence ${JSON.stringify(licence)} needs a reviewed record`);
      } else if (!licenceName) {
        problems.push(`${id}: its package has no licence file; it needs a reviewed record`);
      } else {
        const text = plain(sources.read(`${root}/${licenceName}`)!.toString('utf8'));
        const split = splitLicence(text, sources.canonical[ids[0]]);
        if (!split) {
          problems.push(`${id}: ${licenceName} isn't the ${ids[0]} licence it declares; it needs a reviewed record`);
        } else {
          const fromNotice = (notice ?? '')
            .split('\n')
            .filter((l) => COPYRIGHT_LINE.test(l))
            .map((l) => l.trim());
          if (![...split.copyright, ...fromNotice].some((l) => MENTIONS_COPYRIGHT.test(l))) {
            problems.push(`${id}: no copyright line in its licence or NOTICE; it needs a reviewed record`);
          }
          for (const line of split.copyright) out.push(`  ${line}`);
          out.push(`  See [${bodies.label(licence, split.body, `${id}'s ${licenceName}`)}]`);
        }
      }
      if (notice) out.push('  Its NOTICE file:', indent(notice, '    '));
    }
    for (const r of [...own, ...inlined]) {
      printed.add(r);
      if (r.inlinesNothing) continue;
      if (r.part !== 2) {
        out.push(`  Its ${r.title}: see part ${r.part}.`);
        continue;
      }
      if (!own.includes(r)) out.push(`  ${r.title}:`);
      for (const c of r.components) out.push(component(c));
    }
    out.push('');
    return out;
  };
  const toolRoot = (id: string) => `node_modules/${id.slice(0, id.lastIndexOf('@'))}`;
  const part2 = [
    ...Object.keys(inventory.packages)
      .sort()
      .flatMap((id) => {
        const files = inventory.packages[id];
        return entry(id, packageRoot(Object.keys(files)[0], sources)!, files);
      }),
    "The service worker's Workbox modules, and the build tools whose runtime code ships:",
    '',
    ...[...inventory.tools, ...Object.keys(inventory.workbox)].sort().flatMap((id) => entry(id, toolRoot(id), {})),
  ];
  for (const r of records) {
    if (r.part === 2 && !printed.has(r)) problems.push(`${r.slug}: a part-2 record that no package's entry prints`);
  }

  const partOf = (n: 3 | 4) =>
    records
      .filter((r) => r.part === n)
      .sort((a, b) => a.slug.localeCompare(b.slug))
      .flatMap((r) => [r.title, ...r.components.map(component), '']);
  const part3 = partOf(3);
  const part4 = partOf(4);
  const statements = records
    .flatMap((r) => r.components.filter((c) => c.statement).map((c) => `- ${c.name}: ${c.statement}`))
    .sort();

  const out = [
    '﻿' + about.trimEnd(),
    '',
    ...(statements.length ? ['Choices and statements this file makes:', '', ...statements, ''] : []),
    ...heading("2. The app's code"),
    ...part2,
    ...heading('3. Inside the WebAssembly files'),
    ...part3,
    ...heading("4. The app's own derived material and data"),
    ...part4,
    ...heading('Licence texts'),
    ...bodies.all().flatMap((b) => [`[${b.label}], as in ${b.from}:`, '', b.text.trimEnd(), '', '']),
  ];
  return { text: `${out.join('\n').trimEnd()}\n`, problems };
}
