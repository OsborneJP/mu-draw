// tests/fixtures/biochem_indigo_expected.json must be what Indigo answers now (bar A.2): an
// Indigo or monomer-library upgrade that changes a value fails here first.
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { generate, OUTPUT } from './gen-biochem-indigo.ts';

it('the committed Indigo fixture is what the generator makes now', async () => {
  expect(await generate()).toBe(readFileSync(OUTPUT, 'utf8'));
}, 120_000);
