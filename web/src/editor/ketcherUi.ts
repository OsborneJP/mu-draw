import type { ButtonsConfig } from 'ketcher-react';

// Stock Ketcher parts that stay hidden (decided 2026-10-23):
// - help, about: open github.com / epam.com, breaking "no requests except our own files".
// - miew: the 3D viewer ("3D view" is After v1).
// - recognize: structure from image ("Later version"; standalone Ketcher can't run it).
// - create-monomer: macromolecule tooling ("Biochem tools" are After v1).
export const HIDDEN_BUTTONS = {
  help: { hidden: true },
  about: { hidden: true },
  miew: { hidden: true },
  recognize: { hidden: true },
  'create-monomer': { hidden: true },
} as const satisfies ButtonsConfig;

// The peptide/RNA (macromolecules) editor is After v1 as well.
export const DISABLE_MACROMOLECULES_EDITOR = true;
