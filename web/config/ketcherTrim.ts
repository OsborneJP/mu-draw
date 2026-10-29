// Parts of Ketcher the build leaves out, for their licences (docs/plans/licence-notices.md):
// - Miew, Ketcher's own 3D viewer (decision 4): `miew-react` resolves to a stand-in.
// - The Save dialog's InChI formats (decision 5): Indigo's InChI is a modified InChI 1.06,
//   whose licence (§15) forbids calling its output "InChI" or any similar name.
import { fileURLToPath } from 'node:url';
import type { Alias, Plugin } from 'vite';

export const MIEW_STAND_IN: Alias = {
  find: /^miew-react$/,
  replacement: fileURLToPath(new URL('../src/editor/noMiew.ts', import.meta.url)),
};

// Ketcher 3.18.0's SaveDialog lists its formats in one array literal; this is the line with
// the three InChI formats and the divider after them (ketcher-react/dist/index.js).
export const INCHI_FORMATS =
  "SupportedFormat.inChI, SupportedFormat.inChIAuxInfo, SupportedFormat.inChIKey, '<----secondDivider--->',";
const SAVE_DIALOG_MODULE = '/node_modules/ketcher-react/dist/index.js';

/** Ketcher's code without the InChI formats in Save. Throws unless the line is there exactly
 * once, so a Ketcher upgrade that moves it fails the build instead of shipping them. */
export function withoutInchiFormats(code: string): string {
  const found = code.split(INCHI_FORMATS).length - 1;
  if (found !== 1) throw new Error(`Ketcher's Save dialog: expected its InChI formats line once, found ${found}`);
  return code.replace(INCHI_FORMATS, '');
}

/** Removes the InChI formats from the built app. Build only: the dev server's pre-bundled
 * Ketcher still lists them. */
export function ketcherSaveFormats(): Plugin {
  let trimmed = false;
  return {
    name: 'ketcher-save-formats',
    apply: 'build',
    transform(code, id) {
      if (!id.split('?')[0].endsWith(SAVE_DIALOG_MODULE)) return null;
      trimmed = true;
      return { code: withoutInchiFormats(code), map: null };
    },
    buildEnd() {
      if (!trimmed) this.error(`${SAVE_DIALOG_MODULE} was never built, so its InChI formats weren't removed`);
    },
  };
}
