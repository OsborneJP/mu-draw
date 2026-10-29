// The PWA plugin's options, built in one place from the base path so that Vite's base,
// the manifest's scope/start_url/id and the service worker's navigation rules can't drift.
import type { Plugin } from 'vite';
import type { VitePWAOptions } from 'vite-plugin-pwa';
import { basePath } from './app.ts';

export const APP_TITLE = 'MU Draw';

/** The app's name for a base: staging says so, so an installed staging app can't be
 * mistaken for the production one. */
export function appTitle(base: string): string {
  return base === basePath('staging') ? `${APP_TITLE} (staging)` : APP_TITLE;
}

/** Puts the app's name in index.html's <title> (the installed window's title). */
export function htmlTitle(title: string): Plugin {
  const escaped = title.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  return {
    name: 'html-title',
    transformIndexHtml: (html) => html.replace(/<title>[^<]*<\/title>/, `<title>${escaped}</title>`),
  };
}
// Workbox skips files over 2 MB by default; Indigo's wasm alone is 11.8 MB.
export const MAX_PRECACHE_BYTES = 30 * 1024 * 1024;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function pwaOptions(base: string): Partial<VitePWAOptions> {
  return {
    // A new build waits until the student chooses to reload (the "update ready" banner);
    // it never takes over or reloads by itself mid-drawing.
    registerType: 'prompt',
    // src/pwa/register.ts registers the worker itself.
    injectRegister: false,
    // The icons (and the manifest, which the plugin always adds) come from globPatterns, so
    // each file is listed in the precache once.
    includeManifestIcons: false,
    strategies: 'generateSW',
    manifest: {
      id: base,
      name: appTitle(base),
      short_name: appTitle(base),
      description: 'Draw chemical structures and reactions. Works offline.',
      start_url: base,
      scope: base,
      display: 'standalone',
      background_color: '#ffffff',
      theme_color: '#000000',
      // Relative to the manifest, which is served from the base.
      icons: [
        { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
        { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    },
    workbox: {
      // Setting globPatterns replaces Workbox's default; anything not matched here is left
      // out of the precache silently (scripts/verify-dist.ts fails the build instead).
      // bin: the ¹³C and ¹H shift tables; txt: their licence (under nmr/) and the third-party
      // notices; xz: the InChI and cairo source (both under third-party/).
      globPatterns: ['**/*.{html,js,css,wasm,png,svg,ico,json,bin,txt,xz,woff,woff2,ttf}'],
      maximumFileSizeToCacheInBytes: MAX_PRECACHE_BYTES,
      navigateFallback: 'index.html',
      // The naming API is never answered from the cache.
      navigateFallbackDenylist: [new RegExp(`^${escapeRegExp(base)}api/`)],
      cleanupOutdatedCaches: true,
    },
  };
}
