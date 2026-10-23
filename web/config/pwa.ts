// The PWA plugin's options, built in one place from the base path so that Vite's base,
// the manifest's scope/start_url/id and the service worker's navigation rules can't drift.
import type { VitePWAOptions } from 'vite-plugin-pwa';

export const APP_TITLE = 'Structure Editor';
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
      name: APP_TITLE,
      short_name: APP_TITLE,
      description: 'Draw chemical structures and reactions. Works offline.',
      start_url: base,
      scope: base,
      display: 'standalone',
      background_color: '#ffffff',
      theme_color: '#1f4e79',
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
      globPatterns: ['**/*.{html,js,css,wasm,png,svg,ico,json,woff,woff2,ttf}'],
      maximumFileSizeToCacheInBytes: MAX_PRECACHE_BYTES,
      navigateFallback: 'index.html',
      // The naming API is never answered from the cache.
      navigateFallbackDenylist: [new RegExp(`^${escapeRegExp(base)}api/`)],
      cleanupOutdatedCaches: true,
    },
  };
}
