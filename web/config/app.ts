// Build-time view of app.config.json (Node side: vite, vitest, playwright).
// The name and URL path are written only in app.config.json; derive, never retype.
import raw from '../../app.config.json' with { type: 'json' };

export type Target = 'staging' | 'production';

export const appName: string = raw.name;
export const ports: { production: number; staging: number; dev: number } = raw.ports;

/** URL base for a deploy target, with leading and trailing slash. */
export function basePath(target: Target): string {
  return target === 'production' ? `/${raw.path}/` : `/${raw.path}-staging/`;
}

/** The base to build or test with: $BASE if set (must be a known base), else staging. */
export function resolveBase(env: Record<string, string | undefined> = process.env): string {
  const wanted = env.BASE;
  if (wanted === undefined || wanted === '') return basePath('staging');
  const known = [basePath('staging'), basePath('production')];
  if (!known.includes(wanted)) {
    throw new Error(`BASE=${wanted} is not one of ${known.join(', ')}`);
  }
  return wanted;
}
