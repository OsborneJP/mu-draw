import { describe, expect, it } from 'vitest';
import { linkProblem, requestProblem } from './requestPolicy';

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

describe('linkProblem', () => {
  it.each([
    ['https://lab.example.edu/app-x/', null],
    ['https://lab.example.edu/app-x/#section', null],
    ['blob:https://lab.example.edu/0b6c3a5e', null],
    ['https://pubchem.ncbi.nlm.nih.gov/compound/12345', null],
    ['https://pubchem.ncbi.nlm.nih.gov/compound/1', null],
    // The same page, as the browser resolves it.
    ['https://PubChem.ncbi.nlm.nih.gov:443/compound/12345', null],
  ])('allows %s', (url, problem) => {
    expect(linkProblem(url, APP)).toBe(problem);
  });

  it.each([
    'https://example.com/',
    'https://lab.example.edu/other-app/',
    'http://pubchem.ncbi.nlm.nih.gov/compound/12345',
    'https://pubchem.ncbi.nlm.nih.gov/',
    'https://pubchem.ncbi.nlm.nih.gov/compound/',
    'https://pubchem.ncbi.nlm.nih.gov/compound/0',
    'https://pubchem.ncbi.nlm.nih.gov/compound/012345',
    'https://pubchem.ncbi.nlm.nih.gov/compound/aspirin',
    'https://pubchem.ncbi.nlm.nih.gov/compound/12345/',
    'https://pubchem.ncbi.nlm.nih.gov/compound/12345?x=1',
    'https://pubchem.ncbi.nlm.nih.gov/compound/12345#section',
    'https://pubchem.ncbi.nlm.nih.gov:8443/compound/12345',
    'https://user@pubchem.ncbi.nlm.nih.gov/compound/12345',
    'https://pubchem.ncbi.nlm.nih.gov.example.com/compound/12345',
    'https://evil.pubchem.ncbi.nlm.nih.gov/compound/12345',
    'https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/2244/JSON',
    'https://www.ncbi.nlm.nih.gov/compound/12345',
    'javascript:alert(1)',
    'mailto:someone@example.edu',
    'data:text/html,hello',
  ])('reports %s', (url) => {
    expect(linkProblem(url, APP)).not.toBeNull();
  });
});
