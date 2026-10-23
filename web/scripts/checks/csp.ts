// Rules any CSP for this app must satisfy, whatever web/csp.json says, so loosening the
// policy to "fix" something fails the check instead of silently allowing other hosts.
// An allowlist: every source must be one listed here for its directive. Browsers compare
// keywords and schemes case-insensitively, so this does too.

const REQUIRED = ['default-src', 'script-src', 'worker-src', 'connect-src', 'object-src', 'base-uri', 'form-action'];
const ALLOWED_EVERYWHERE = ["'self'", "'none'"];
const ALLOWED_IN: Record<string, string[]> = {
  'script-src': ["'wasm-unsafe-eval'"], // compiling Indigo's and RDKit's WebAssembly
  'style-src': ["'unsafe-inline'"], // Ketcher's emotion/MUI <style> elements
  'img-src': ['data:'], // Ketcher's CSS images and placed images are data: URLs
};

export function parsePolicy(policy: string): [string, string[]][] {
  const parsed: [string, string[]][] = [];
  for (const part of policy.split(';')) {
    const [name, ...values] = part.trim().split(/\s+/);
    if (name) parsed.push([name.toLowerCase(), values]);
  }
  return parsed;
}

export function checkCspPolicy(policy: string): string[] {
  const errors: string[] = [];
  const parsed = parsePolicy(policy);
  const seen = new Set<string>();
  for (const [name, values] of parsed) {
    if (seen.has(name)) errors.push(`${name} appears twice (browsers ignore all but the first)`);
    seen.add(name);
    const allowed = [...ALLOWED_EVERYWHERE, ...(ALLOWED_IN[name] ?? [])];
    for (const value of values) {
      if (!allowed.includes(value.toLowerCase())) errors.push(`${name} allows ${value}`);
    }
  }
  for (const name of REQUIRED) {
    if (!seen.has(name)) errors.push(`missing ${name}`);
  }
  const connect = parsed.find(([name]) => name === 'connect-src')?.[1] ?? [];
  if (connect.join(' ') !== "'self'") errors.push(`connect-src must be exactly 'self', not ${connect.join(' ')}`);
  return errors;
}

/** The built index.html carries exactly one CSP meta tag, equal to the expected policy. */
export function checkBuiltHtml(html: string, expected: string): string[] {
  const metas = [...html.matchAll(/<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]*)"/gi)];
  if (metas.length !== 1) return [`expected one CSP meta tag, found ${metas.length}`];
  const content = metas[0][1].replaceAll('&#39;', "'").replaceAll('&apos;', "'");
  return content === expected ? [] : [`CSP meta is "${content}", expected "${expected}"`];
}
