// Content Security Policy, from web/csp.json: the browser itself enforces invariant 1 (no
// requests except our own origin). The same policy goes into index.html at build time,
// into the preview server's headers in tests, and into Apache's config
// (scripts/render_server_config.py), which also covers sw.js and the Indigo worker.
//
// Why each loosening exists:
// - script-src 'wasm-unsafe-eval': compiling WebAssembly (Indigo, RDKit) needs it.
// - img-src data:  Ketcher's CSS uses data: SVG cursors and icons; placed images are data: URLs.
// - style-src 'unsafe-inline': Ketcher's UI (emotion/MUI) injects <style> elements.
import type { Plugin } from 'vite';
import directives from '../csp.json' with { type: 'json' };

export function cspPolicy(source: Record<string, string[]> = directives): string {
  return Object.entries(source)
    .map(([name, values]) => `${name} ${values.join(' ')}`)
    .join('; ');
}

export function cspMetaTag(policy: string = cspPolicy()) {
  return {
    tag: 'meta',
    attrs: { 'http-equiv': 'Content-Security-Policy', content: policy },
    injectTo: 'head-prepend' as const,
  };
}

/** Build only: Vite's dev server needs inline scripts for hot reload. */
export function cspPlugin(): Plugin {
  return {
    name: 'csp-meta',
    apply: 'build',
    transformIndexHtml: () => [cspMetaTag()],
  };
}
