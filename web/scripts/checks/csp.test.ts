import { describe, expect, it } from 'vitest';
import { cspMetaTag, cspPlugin, cspPolicy } from '../../config/csp';
import { checkBuiltHtml, checkCspPolicy } from './csp';

const POLICY = cspPolicy();

describe('checkCspPolicy', () => {
  it("passes the app's policy", () => {
    expect(checkCspPolicy(POLICY)).toEqual([]);
  });

  it.each([
    ['another host', `${POLICY}; img-src 'self' https://cdn.example.com`, "img-src allows https://cdn.example.com"],
    ['https: anywhere', POLICY.replace("connect-src 'self'", "connect-src 'self' https:"), 'connect-src allows https:'],
    ['a wildcard', POLICY.replace("font-src 'self'", 'font-src *'), 'font-src allows *'],
    ['unsafe-eval', POLICY.replace("'wasm-unsafe-eval'", "'unsafe-eval'"), "script-src allows 'unsafe-eval'"],
    ['blob: workers', POLICY.replace("worker-src 'self'", "worker-src 'self' blob:"), 'worker-src allows blob:'],
    ['a missing directive', POLICY.replace("object-src 'none'; ", ''), 'missing object-src'],
  ])('fails on %s', (_name, policy, error) => {
    expect(checkCspPolicy(policy)).toContain(error);
  });
});

describe('checkBuiltHtml', () => {
  const meta = `<meta http-equiv="Content-Security-Policy" content="${POLICY.replaceAll("'", '&#39;')}">`;

  it('passes one matching meta tag', () => {
    expect(checkBuiltHtml(`<head>${meta}</head>`, POLICY)).toEqual([]);
  });

  it('fails without the tag, with two, or with a different policy', () => {
    expect(checkBuiltHtml('<head></head>', POLICY)).toEqual(['expected one CSP meta tag, found 0']);
    expect(checkBuiltHtml(`<head>${meta}${meta}</head>`, POLICY)).toEqual(['expected one CSP meta tag, found 2']);
    expect(checkBuiltHtml(`<head>${meta}</head>`, `${POLICY}; img-src *`)[0]).toMatch(/^CSP meta is/);
  });
});

describe('cspPlugin', () => {
  it('adds the policy to the head of the built page only', () => {
    const plugin = cspPlugin();
    expect(plugin.apply).toBe('build');
    const transform = plugin.transformIndexHtml as () => unknown;
    expect(transform()).toEqual([cspMetaTag(POLICY)]);
  });
});
