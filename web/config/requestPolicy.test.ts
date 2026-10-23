import { expect, it } from 'vitest';
import { requestProblem } from './requestPolicy';

const APP = 'https://lab.example.edu/app-x/';

it.each([
  ['https://lab.example.edu/app-x/assets/a.wasm', null],
  ['https://lab.example.edu/app-x/api/name', null],
  ['blob:https://lab.example.edu/0b6c3a5e', null],
  ['https://lab.example.edu/favicon.ico', 'outside /app-x/'],
  ['https://lab.example.edu/other-app/', 'outside /app-x/'],
  ['https://cdn.example.com/lib.js', 'other origin'],
  ['http://lab.example.edu/app-x/', 'other origin'],
  ['blob:https://evil.example.com/0b6c', 'foreign blob'],
  ['ws://lab.example.edu/app-x/', 'scheme ws:'],
])('%s -> %s', (url, problem) => {
  expect(requestProblem(url, APP)).toBe(problem);
});
