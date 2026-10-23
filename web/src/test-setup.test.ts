import { expect, it } from 'vitest';

it('blocks network access in unit tests', () => {
  expect(() => fetch('http://192.0.2.1/')).toThrow(/not allowed/);
});
