import { describe, expect, it } from 'vitest';
import { cspFor, cspMetaTag, cspPlugin, cspPolicy, WORKER_EXTRAS, workerCspPolicy } from '../../config/csp';
import { checkBuiltHtml, checkCspPolicy, checkWorkerExtras } from './csp';

const POLICY = cspPolicy();

describe('checkCspPolicy', () => {
  it("passes the app's policy", () => {
    expect(checkCspPolicy(POLICY)).toEqual([]);
  });

  // Each case loosens one existing directive in place.
  const loosen = (directive: string, extra: string) => {
    const at = POLICY.indexOf(`${directive} `);
    expect(at).toBeGreaterThanOrEqual(0);
    const end = POLICY.indexOf(';', at);
    return `${POLICY.slice(0, end)} ${extra}${POLICY.slice(end)}`;
  };

  it.each([
    ['another host with a scheme', 'img-src', 'https://cdn.example.com'],
    ['a bare host', 'font-src', 'fonts.gstatic.com'],
    ['a host with a port', 'img-src', 'cdn.example.com:443'],
    ['a bare host for scripts', 'script-src', 'cdn.example.com'],
    ['https: anywhere', 'default-src', 'https:'],
    ['https: in upper case', 'img-src', 'HTTPS:'],
    ['websockets', 'img-src', 'wss:'],
    ['a wildcard', 'font-src', '*'],
    ['unsafe-eval', 'script-src', "'unsafe-eval'"],
    ['inline scripts', 'script-src', "'unsafe-inline'"],
    ['blob: workers', 'worker-src', 'blob:'],
    ['blob: images', 'img-src', 'blob:'],
    ['data: scripts', 'script-src', 'data:'],
  ])('fails on %s', (_name, directive, extra) => {
    expect(checkCspPolicy(loosen(directive, extra))).toContain(`${directive} allows ${extra}`);
  });

  it('fails on a missing directive', () => {
    expect(checkCspPolicy(POLICY.replace("object-src 'none'; ", ''))).toContain('missing object-src');
  });

  it('fails on a repeated directive', () => {
    expect(checkCspPolicy(`${POLICY}; img-src 'self'`)).toContain(
      'img-src appears twice (browsers ignore all but the first)',
    );
  });

  it('fails when connect-src is not exactly self', () => {
    expect(checkCspPolicy(POLICY.replace("connect-src 'self'", "connect-src 'none'"))).toContain(
      "connect-src must be exactly 'self', not 'none'",
    );
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

describe('worker policies', () => {
  it("passes the app's worker extras", () => {
    expect(checkWorkerExtras(WORKER_EXTRAS)).toEqual([]);
  });

  it("gives the RDKit worker the page's policy plus 'unsafe-eval', and nothing else", () => {
    const rdkit = cspFor('rdkit/worker.js');
    expect(rdkit).toBe(POLICY.replace("script-src 'self' 'wasm-unsafe-eval'", "script-src 'self' 'wasm-unsafe-eval' 'unsafe-eval'"));
    expect(rdkit).not.toBe(POLICY);
  });

  it("gives every other file the page's policy", () => {
    for (const path of ['', 'index.html', 'sw.js', 'assets/indigoWorker-abc.js', 'rdkit/RDKit_minimal.wasm']) {
      expect(cspFor(path)).toBe(POLICY);
    }
  });

  it('merges extras into their own directive only', () => {
    expect(workerCspPolicy({ 'script-src': ['x'] }, { 'default-src': ['a'], 'script-src': ['b'] })).toBe(
      'default-src a; script-src b x',
    );
  });

  it.each([
    ['another host for a worker', { 'rdkit/worker.js': { 'connect-src': ['https://cdn.example.com'] } }, 'rdkit/worker.js: connect-src allows https://cdn.example.com'],
    ['inline scripts for a worker', { 'rdkit/worker.js': { 'script-src': ["'unsafe-inline'"] } }, "rdkit/worker.js: script-src allows 'unsafe-inline'"],
    ['unsafe-eval for the page', { 'index.html': { 'script-src': ["'unsafe-eval'"] } }, "index.html: only a worker script may get more than the page's policy"],
    ['unsafe-eval for the root', { '': { 'script-src': ["'unsafe-eval'"] } }, "index.html: only a worker script may get more than the page's policy"],
    ['unsafe-eval for the service worker', { 'sw.js': { 'script-src': ["'unsafe-eval'"] } }, "sw.js: only a worker script may get more than the page's policy"],
    ['a file that is not a script', { 'rdkit/RDKit_minimal.wasm': { 'script-src': ["'unsafe-eval'"] } }, "rdkit/RDKit_minimal.wasm: only a worker script may get more than the page's policy"],
  ])('fails on %s', (_name, extras, problem) => {
    expect(checkWorkerExtras(extras)).toContain(problem);
  });
});
