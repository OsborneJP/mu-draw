import { describe, expect, it } from 'vitest';
import { basePath, type Target } from './app';
import { APP_TITLE, appTitle, htmlTitle, MAX_PRECACHE_BYTES, pwaOptions } from './pwa';

describe.each<Target>(['staging', 'production'])('pwaOptions for %s', (target) => {
  const base = basePath(target);
  const options = pwaOptions(base);
  const manifest = options.manifest || {};

  it('ties scope, start_url and id to the base', () => {
    expect(manifest.scope).toBe(base);
    expect(manifest.start_url).toBe(base);
    expect(manifest.id).toBe(base);
  });

  it('never activates a new build by itself', () => {
    expect(options.registerType).toBe('prompt');
    expect(options.workbox?.clientsClaim).toBeUndefined();
    expect(options.workbox?.skipWaiting).toBeUndefined();
  });

  it('precaches the WebAssembly engines', () => {
    expect(options.workbox?.globPatterns?.join()).toContain('wasm');
    expect(options.workbox?.maximumFileSizeToCacheInBytes).toBeGreaterThanOrEqual(MAX_PRECACHE_BYTES);
  });

  it('names the app and has the icons Chrome needs to install it', () => {
    expect(manifest.name).toBeTruthy();
    expect(manifest.theme_color).toBeTruthy();
    const sizes = (manifest.icons || []).map((icon) => icon.sizes);
    expect(sizes).toEqual(expect.arrayContaining(['192x192', '512x512']));
  });

  it('keeps API navigations away from the offline fallback', () => {
    const denied = options.workbox?.navigateFallbackDenylist || [];
    expect(denied.some((re) => re.test(`${base}api/health`))).toBe(true);
    expect(denied.some((re) => re.test(base))).toBe(false);
  });
});

describe('app name', () => {
  it('labels staging so it cannot be mistaken for production', () => {
    const nameFor = (target: Target) => (pwaOptions(basePath(target)).manifest || {}).name;
    expect(nameFor('staging')).toBe(`${APP_TITLE} (staging)`);
    expect(nameFor('production')).toBe(APP_TITLE);
    expect(appTitle(basePath('production'))).not.toMatch(/staging/i);
  });

  it('sets the page title', () => {
    const plugin = htmlTitle('A & B <test>');
    const transform = plugin.transformIndexHtml as (html: string) => string;
    expect(transform('<head><title>Old</title></head>')).toBe('<head><title>A &amp; B &lt;test></title></head>');
  });
});
