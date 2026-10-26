// The nine GHS hazard pictograms, shipped with the app as web/public/ghs/GHS01.svg to GHS09.svg
// (Wikimedia Commons' public-domain copies of UNECE's files; THIRD-PARTY-NOTICES.md). Shared by
// the Safety panel, the precache guard and the tests, so nothing here may import Node or
// browser APIs.

export const GHS_PICTOGRAMS = ['GHS01', 'GHS02', 'GHS03', 'GHS04', 'GHS05', 'GHS06', 'GHS07', 'GHS08', 'GHS09'] as const;

export type PictogramCode = (typeof GHS_PICTOGRAMS)[number];

export function isPictogramCode(value: unknown): value is PictogramCode {
  return (GHS_PICTOGRAMS as readonly unknown[]).includes(value);
}

/** The pictogram's file in the build, under the base path. */
export function pictogramFile(code: PictogramCode): string {
  return `ghs/${code}.svg`;
}
