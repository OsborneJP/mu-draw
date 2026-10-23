import { describe, expect, it } from 'vitest';
import { checkHtmlLinks } from './html';

const BASE = '/app-x/';
const FILES = ['index.html', 'icons/icon-192.png', 'manifest.webmanifest', 'assets/index-a.js', 'assets/index-b.css'];
const page = (head: string) => `<!doctype html><html><head>${head}</head><body></body></html>`;
const GOOD = [
  '<link rel="icon" type="image/png" href="icons/icon-192.png" />',
  '<script type="module" crossorigin src="/app-x/assets/index-a.js"></script>',
  '<link rel="stylesheet" crossorigin href="/app-x/assets/index-b.css">',
  '<link rel="manifest" href="/app-x/manifest.webmanifest">',
].join('');

describe('checkHtmlLinks', () => {
  it('passes a page whose links stay under the base and exist', () => {
    expect(checkHtmlLinks(page(GOOD), BASE, FILES)).toEqual([]);
  });

  it('fails without an icon link', () => {
    const html = page(GOOD.replace('<link rel="icon" type="image/png" href="icons/icon-192.png" />', ''));
    expect(checkHtmlLinks(html, BASE, FILES)).toEqual([
      'no <link rel="icon">, so browsers request /favicon.ico at the site root',
    ]);
  });

  it('fails on an icon at the site root', () => {
    const html = page(GOOD.replace('href="icons/icon-192.png"', 'href="/favicon.ico"'));
    expect(checkHtmlLinks(html, BASE, FILES)).toEqual(['href="/favicon.ico" (outside /app-x/)']);
  });

  it.each([
    ['single quotes', "<link rel='icon' href='/favicon.ico'>"],
    ['no quotes', '<link rel=icon href=/favicon.ico>'],
  ])('reads %s', (_name, extra) => {
    expect(checkHtmlLinks(page(GOOD + extra), BASE, FILES)).toEqual(['href="/favicon.ico" (outside /app-x/)']);
  });

  it('fails on another origin', () => {
    const html = page(`${GOOD}<script src="https://cdn.example.com/x.js"></script>`);
    expect(checkHtmlLinks(html, BASE, FILES)).toEqual(['src="https://cdn.example.com/x.js" (other origin)']);
  });

  it('fails on a file missing from the build', () => {
    const html = page(GOOD.replace('icons/icon-192.png', 'icons/missing.png'));
    expect(checkHtmlLinks(html, BASE, FILES)).toEqual([`href="icons/missing.png" names a file that isn't in the build`]);
  });
});
