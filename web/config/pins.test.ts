import { describe, expect, it } from 'vitest';
import { checkPins, PINNED, readPinInputs, type PinInputs } from './pins';

const KETCHER = { 'ketcher-react': '3.18.0', 'ketcher-standalone': '3.18.0', 'ketcher-core': '3.18.0' };

function inputs(version = '3.18.0'): PinInputs {
  const names = Object.keys(KETCHER);
  return {
    packageJson: { dependencies: Object.fromEntries(names.map((n) => [n, version])) },
    lock: { packages: Object.fromEntries(names.map((n) => [`node_modules/${n}`, { version }])) },
    installed: Object.fromEntries(names.map((n) => [n, version])),
  };
}

describe('pin check', () => {
  it('passes for the real web/ install', () => {
    expect(checkPins(readPinInputs())).toEqual([]);
  });

  it('passes for exact, consistent pins', () => {
    expect(checkPins(inputs(), KETCHER)).toEqual([]);
  });

  it('rejects a caret range', () => {
    const bad = inputs();
    bad.packageJson.dependencies!['ketcher-core'] = '^3.18.0';
    expect(checkPins(bad, KETCHER).join('\n')).toMatch(/ketcher-core: "\^3.18.0" is not an exact/);
  });

  it('rejects a lockfile that resolved a different version', () => {
    const bad = inputs();
    bad.lock.packages['node_modules/ketcher-react'] = { version: '3.18.1' };
    expect(checkPins(bad, KETCHER).join('\n')).toMatch(/ketcher-react: lockfile .* is 3.18.1/);
  });

  it('rejects a nested duplicate', () => {
    const bad = inputs();
    bad.lock.packages['node_modules/ketcher-react/node_modules/ketcher-core'] = { version: '3.20.0' };
    expect(checkPins(bad, KETCHER).join('\n')).toMatch(/ketcher-core: expected one lockfile entry, found 2/);
  });

  it('rejects a missing pinned package', () => {
    const bad = inputs();
    delete bad.packageJson.dependencies!['ketcher-standalone'];
    expect(checkPins(bad, KETCHER)).toContain('ketcher-standalone: missing from package.json');
  });

  it('rejects an upgrade that was not made in config/pins.ts', () => {
    expect(checkPins(inputs('3.19.0'), KETCHER).join('\n')).toMatch(
      /ketcher-react: package.json has 3.19.0, but config\/pins.ts pins 3.18.0/,
    );
  });

  it('rejects Ketcher packages that differ', () => {
    const bad = inputs();
    bad.packageJson.dependencies!['ketcher-standalone'] = '3.17.2';
    bad.lock.packages['node_modules/ketcher-standalone'] = { version: '3.17.2' };
    bad.installed['ketcher-standalone'] = '3.17.2';
    expect(checkPins(bad, KETCHER).join('\n')).toMatch(/Ketcher packages differ/);
  });

  it('covers every pinned engine', () => {
    expect(Object.keys(PINNED)).toEqual(
      expect.arrayContaining(['ketcher-react', 'ketcher-standalone', 'ketcher-core', '@rdkit/rdkit', 'lexical']),
    );
  });

  it('rejects a second copy of lexical, or another version of it', () => {
    const lexical = { lexical: PINNED.lexical };
    const real = readPinInputs(['lexical']);
    expect(checkPins(real, lexical)).toEqual([]);
    const nested = structuredClone(real);
    nested.lock.packages['node_modules/ketcher-react/node_modules/lexical'] = { version: '0.41.0' };
    expect(checkPins(nested, lexical).join('\n')).toMatch(/lexical: expected one lockfile entry, found 2/);
    const upgraded = structuredClone(real);
    upgraded.installed.lexical = '0.41.0';
    expect(checkPins(upgraded, lexical).join('\n')).toMatch(/lexical: node_modules has 0.41.0, not 0.40.0/);
  });
});
