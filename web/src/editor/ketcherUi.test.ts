import { expect, it } from 'vitest';
import { DISABLE_MACROMOLECULES_EDITOR, HIDDEN_BUTTONS } from './ketcherUi';

it('keeps out-of-scope and external-link Ketcher UI hidden', () => {
  for (const name of ['help', 'about', 'miew', 'recognize', 'create-monomer'] as const) {
    expect(HIDDEN_BUTTONS[name].hidden, name).toBe(true);
  }
  expect(DISABLE_MACROMOLECULES_EDITOR).toBe(true);
});
