import { describe, expect, it } from 'vitest';
import { checkPins, PINNED, readPinInputs, type PinInputs } from './pins';

const KETCHER = ['ketcher-react', 'ketcher-standalone', 'ketcher-core'];

function inputs(version = '3.18.0'): PinInputs {
  const names = KETCHER;
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

  it('rejects Ketcher packages that differ', () => {
    const bad = inputs();
    bad.packageJson.dependencies!['ketcher-standalone'] = '3.17.2';
    bad.lock.packages['node_modules/ketcher-standalone'] = { version: '3.17.2' };
    bad.installed['ketcher-standalone'] = '3.17.2';
    expect(checkPins(bad, KETCHER).join('\n')).toMatch(/Ketcher packages differ/);
  });

  it('covers every pinned engine', () => {
    expect(PINNED).toEqual(
      expect.arrayContaining(['ketcher-react', 'ketcher-standalone', 'ketcher-core', '@rdkit/rdkit']),
    );
  });
});
