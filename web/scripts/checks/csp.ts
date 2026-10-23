// Rules any CSP for this app must satisfy, whatever web/csp.json says, so loosening the
// policy to "fix" something fails the check instead of silently allowing other hosts.

const REQUIRED = ['default-src', 'script-src', 'worker-src', 'connect-src', 'object-src', 'base-uri', 'form-action'];
const NEVER = ['*', 'http:', 'https:', "'unsafe-eval'"];

export function parsePolicy(policy: string): Map<string, string[]> {
  const parsed = new Map<string, string[]>();
  for (const part of policy.split(';')) {
    const [name, ...values] = part.trim().split(/\s+/);
    if (name) parsed.set(name.toLowerCase(), values);
  }
  return parsed;
}

export function checkCspPolicy(policy: string): string[] {
  const errors: string[] = [];
  const parsed = parsePolicy(policy);
  for (const name of REQUIRED) {
    if (!parsed.has(name)) errors.push(`missing ${name}`);
  }
  for (const [name, values] of parsed) {
    for (const value of values) {
      if (NEVER.includes(value) || /^(https?:\/\/|\*\.)/.test(value)) {
        errors.push(`${name} allows ${value}`);
      }
    }
  }
  for (const name of ['script-src', 'worker-src']) {
    for (const value of parsed.get(name) ?? []) {
      if (value === 'blob:' || value === 'data:') errors.push(`${name} allows ${value}`);
    }
  }
  const connect = parsed.get('connect-src') ?? [];
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
