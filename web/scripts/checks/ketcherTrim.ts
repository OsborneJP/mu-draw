// The built app leaves out Ketcher's Miew viewer (config/ketcherTrim.ts). Minifying strips
// Miew's banner, so these are strings of its own code that survive it.
export const MIEW_MARKERS = ['Miew FBX Exporter', 'Miew.rebuild(): already building!'];

/** Problems with a build's scripts, given each one's path and text. */
export function checkNoMiew(scripts: { path: string; text: string }[]): string[] {
  return scripts.flatMap(({ path, text }) =>
    MIEW_MARKERS.filter((marker) => text.includes(marker)).map(
      (marker) => `${path}: Ketcher's Miew viewer is in the build (found "${marker}")`,
    ),
  );
}
