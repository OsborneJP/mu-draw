import { describe, expect, it } from 'vitest';
import { checkManifest, checkPromptMode } from './manifest';

const BASE = '/app-x/';
const TITLE = 'Editor (staging)';
const GOOD = {
  name: TITLE,
  short_name: TITLE,
  scope: BASE,
  start_url: BASE,
  id: BASE,
  display: 'standalone',
  icons: [
    { src: 'icons/a.png', sizes: '192x192', type: 'image/png' },
    { src: 'icons/b.png', sizes: '512x512', type: 'image/png' },
  ],
};

describe('checkManifest', () => {
  it('passes a manifest tied to the base', () => {
    expect(checkManifest(GOOD, BASE, TITLE)).toEqual([]);
  });

  it.each(['scope', 'start_url', 'id'])('fails when %s drifts from the base', (key) => {
    expect(checkManifest({ ...GOOD, [key]: '/' }, BASE, TITLE)).toEqual([`${key} is "/", not "${BASE}"`]);
  });

  it("fails when the name is not the target's", () => {
    expect(checkManifest({ ...GOOD, name: 'Editor' }, BASE, TITLE)).toEqual(['name is "Editor", not "Editor (staging)"']);
  });

  it('fails without a 512 px icon', () => {
    expect(checkManifest({ ...GOOD, icons: GOOD.icons.slice(0, 1) }, BASE, TITLE)).toEqual(['no 512x512 PNG icon']);
  });
});

describe('checkPromptMode', () => {
  const prompt =
    'self.addEventListener("message",e=>{e.data&&"SKIP_WAITING"===e.data.type&&self.skipWaiting()}),e.precacheAndRoute([])';

  it('passes a prompt-mode worker', () => {
    expect(checkPromptMode(prompt)).toEqual([]);
  });

  it('fails an auto-update worker', () => {
    const auto = 'self.skipWaiting(),e.clientsClaim(),e.precacheAndRoute([])';
    expect(checkPromptMode(auto)).toEqual([
      'calls clientsClaim (would take over open pages)',
      'has no SKIP_WAITING message handler',
    ]);
  });

  it('fails a second unconditional skipWaiting', () => {
    expect(checkPromptMode(`self.skipWaiting();${prompt}`)).toHaveLength(1);
  });
});

describe('checkPromptMode on a real build', () => {
  it('passes the committed sw.js', async () => {
    const { readFileSync } = await import('node:fs');
    const sw = readFileSync(new URL('./fixtures/sw.js', import.meta.url), 'utf8');
    expect(checkPromptMode(sw)).toEqual([]);
  });
});
