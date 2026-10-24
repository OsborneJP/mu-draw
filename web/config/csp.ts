// Content Security Policy, from web/csp.json: the browser itself enforces invariant 1 (no
// requests except our own origin). The same policy goes into index.html at build time,
// into the preview server's headers in tests, and into Apache's config
// (scripts/render_server_config.py), which also covers sw.js and the Indigo worker.
//
// Why each loosening exists:
// - script-src 'wasm-unsafe-eval': compiling WebAssembly (Indigo, RDKit) needs it.
// - img-src data:  Ketcher's CSS uses data: SVG cursors and icons; placed images are data: URLs.
// - style-src 'unsafe-inline': Ketcher's UI (emotion/MUI) injects <style> elements.
//
// Workers take their CSP from their own response header, never from the page. One worker
// gets more than the page (web/csp-workers.json, keyed by its path under the base):
// - rdkit/worker.js, script-src 'unsafe-eval': RDKit.js builds its JavaScript bindings
//   with `new Function` (Emscripten's embind) and can't start without it. The page's own
//   policy never allows it; scripts/checks/csp.ts allows nothing else for workers.
import type { Plugin } from 'vite';
import directives from '../csp.json' with { type: 'json' };
import workers from '../csp-workers.json' with { type: 'json' };

type Directives = Record<string, string[]>;

export function cspPolicy(source: Directives = directives): string {
  return Object.entries(source)
    .map(([name, values]) => `${name} ${values.join(' ')}`)
    .join('; ');
}

/** The extra sources each worker gets on top of the page's policy, by path under the base. */
export const WORKER_EXTRAS: Record<string, Directives> = workers;

/** A worker's policy: the page's, with its extra sources appended to their directives. */
export function workerCspPolicy(extras: Directives, page: Directives = directives): string {
  const merged: Directives = Object.fromEntries(
    Object.entries(page).map(([name, values]) => [name, [...values, ...(extras[name] ?? [])]]),
  );
  return cspPolicy(merged);
}

/** The policy the server sends for a path under the base ('' is index.html). */
export function cspFor(path: string): string {
  const extras = WORKER_EXTRAS[path];
  return extras ? workerCspPolicy(extras) : cspPolicy();
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

/** The preview server (tests) sends the CSP header like Apache: on every file, with each
 * worker's own policy for its file. Runs before the static files are served. */
export function cspHeaders(base: string): Plugin {
  return {
    name: 'csp-headers',
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = new URL(req.url ?? '/', 'http://preview').pathname;
        const underBase = path.startsWith(base) ? path.slice(base.length) : path;
        res.setHeader('Content-Security-Policy', cspFor(underBase));
        next();
      });
    },
  };
}
