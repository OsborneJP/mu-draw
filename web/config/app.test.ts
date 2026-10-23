import { describe, expect, it } from 'vitest';
import raw from '../../app.config.json' with { type: 'json' };
import { basePath, resolveBase } from './app';

describe('base paths', () => {
  it('derive from app.config.json', () => {
    expect(basePath('production')).toBe(`/${raw.path}/`);
    expect(basePath('staging')).toBe(`/${raw.path}-staging/`);
  });

  it('default to staging and accept only known bases', () => {
    expect(resolveBase({})).toBe(basePath('staging'));
    expect(resolveBase({ BASE: basePath('production') })).toBe(basePath('production'));
    expect(() => resolveBase({ BASE: '/elsewhere/' })).toThrow(/not one of/);
  });
});
