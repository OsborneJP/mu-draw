// Invariant: the chemistry engines are pinned to exact versions. ketcher-core is included
// because ketcher-react and ketcher-standalone depend on it as "*".
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const PINNED = ['ketcher-react', 'ketcher-standalone', 'ketcher-core'] as const;
// The Ketcher packages must move together.
export const SAME_VERSION = ['ketcher-react', 'ketcher-standalone', 'ketcher-core'] as const;

const EXACT = /^\d+\.\d+\.\d+$/;

export interface PinInputs {
  packageJson: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  lock: { packages: Record<string, { version?: string }> };
  /** Version found in node_modules/<name>/package.json, or undefined if not installed. */
  installed: Record<string, string | undefined>;
}

export function checkPins(inputs: PinInputs, names: readonly string[] = PINNED): string[] {
  const errors: string[] = [];
  const deps = { ...inputs.packageJson.devDependencies, ...inputs.packageJson.dependencies };
  for (const name of names) {
    const spec = deps[name];
    if (spec === undefined) {
      errors.push(`${name}: missing from package.json`);
      continue;
    }
    if (!EXACT.test(spec)) errors.push(`${name}: "${spec}" is not an exact x.y.z version`);
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
  return errors;
}

/** The real inputs, read from web/. Installed versions are read by file path because some
 * packages (e.g. @rdkit/rdkit) don't export their package.json. */
export function readPinInputs(names: readonly string[] = PINNED): PinInputs {
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
  return { packageJson: json('package.json'), lock: json('package-lock.json'), installed };
}
