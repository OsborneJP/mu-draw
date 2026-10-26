// Invariant: the chemistry engines are pinned to exact versions. ketcher-core is included
// because ketcher-react and ketcher-standalone depend on it as "*". @rdkit/rdkit must also
// match the server's rdkit release (tests/test_versions.py). lexical is the Text Editor's
// engine inside ketcher-react; Formula text imports it too, and both must get the one copy
// (one lockfile entry), or the app's transforms would not be the dialog's. indigo-ketcher
// (the biochem worker's Indigo) must be the very release ketcher-standalone pins, so one
// Indigo ships.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Changing a version here is a deliberate upgrade: first re-read the Ketcher 3.18 and
// RDKit notes in BUILD-LEARNINGS.md (hidden UI, debug shortcut, CDXML, chiral flag), since
// those workarounds were checked against these exact versions.
export const PINNED: Record<string, string> = {
  'ketcher-react': '3.18.0',
  'ketcher-standalone': '3.18.0',
  'ketcher-core': '3.18.0',
  '@rdkit/rdkit': '2026.9.1',
  lexical: '0.40.0',
  'indigo-ketcher': '1.46.0',
};
// The Ketcher packages must move together.
export const SAME_VERSION = ['ketcher-react', 'ketcher-standalone', 'ketcher-core'] as const;

const EXACT = /^\d+\.\d+\.\d+$/;

export interface PinInputs {
  packageJson: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  lock: { packages: Record<string, { version?: string }> };
  /** Version found in node_modules/<name>/package.json, or undefined if not installed. */
  installed: Record<string, string | undefined>;
  /** The indigo-ketcher version ketcher-standalone's own package.json depends on. */
  ketcherIndigo?: string;
}

export function checkPins(inputs: PinInputs, pinned: Record<string, string> = PINNED): string[] {
  const errors: string[] = [];
  const names = Object.keys(pinned);
  const deps = { ...inputs.packageJson.devDependencies, ...inputs.packageJson.dependencies };
  for (const name of names) {
    const spec = deps[name];
    if (spec === undefined) {
      errors.push(`${name}: missing from package.json`);
      continue;
    }
    if (!EXACT.test(spec)) errors.push(`${name}: "${spec}" is not an exact x.y.z version`);
    else if (spec !== pinned[name]) {
      errors.push(`${name}: package.json has ${spec}, but config/pins.ts pins ${pinned[name]}`);
    }
    const entries = Object.entries(inputs.lock.packages).filter(
      ([path]) => path === `node_modules/${name}` || path.endsWith(`/node_modules/${name}`),
    );
    if (entries.length !== 1) {
      const where = entries.map(([path, e]) => `${path}@${e.version}`).join(', ');
      errors.push(`${name}: expected one lockfile entry, found ${entries.length} (${where})`);
    }
    for (const [path, entry] of entries) {
      if (entry.version !== spec) errors.push(`${name}: lockfile ${path} is ${entry.version}, not ${spec}`);
    }
    if (inputs.installed[name] !== spec) {
      errors.push(`${name}: node_modules has ${inputs.installed[name]}, not ${spec}`);
    }
  }
  const versions = new Set(SAME_VERSION.filter((n) => names.includes(n)).map((n) => deps[n]));
  if (versions.size > 1) errors.push(`Ketcher packages differ: ${[...versions].join(', ')}`);
  if ('indigo-ketcher' in pinned && inputs.ketcherIndigo !== deps['indigo-ketcher']) {
    errors.push(
      `indigo-ketcher: package.json has ${deps['indigo-ketcher']}, but ketcher-standalone uses ${inputs.ketcherIndigo}`,
    );
  }
  return errors;
}

/** The real inputs, read from web/. Installed versions are read by file path because some
 * packages (e.g. @rdkit/rdkit) don't export their package.json. */
export function readPinInputs(names: readonly string[] = Object.keys(PINNED)): PinInputs {
  const web = (rel: string) => fileURLToPath(new URL(`../${rel}`, import.meta.url));
  const json = (rel: string) => JSON.parse(readFileSync(web(rel), 'utf8'));
  const installed: Record<string, string | undefined> = {};
  for (const name of names) {
    try {
      installed[name] = json(`node_modules/${name}/package.json`).version;
    } catch {
      installed[name] = undefined;
    }
  }
  return {
    packageJson: json('package.json'),
    lock: json('package-lock.json'),
    installed,
    ketcherIndigo: json('node_modules/ketcher-standalone/package.json').dependencies?.['indigo-ketcher'],
  };
}
