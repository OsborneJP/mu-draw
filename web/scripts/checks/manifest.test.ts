import { describe, expect, it } from 'vitest';
import { checkManifest, checkPromptMode } from './manifest';

const BASE = '/app-x/';
const GOOD = {
  name: 'Editor',
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
    expect(checkManifest(GOOD, BASE)).toEqual([]);
  });

  it.each(['scope', 'start_url', 'id'])('fails when %s drifts from the base', (key) => {
    expect(checkManifest({ ...GOOD, [key]: '/' }, BASE)).toEqual([`${key} is "/", not "${BASE}"`]);
  });

  it('fails without a 512 px icon', () => {
    expect(checkManifest({ ...GOOD, icons: GOOD.icons.slice(0, 1) }, BASE)).toEqual(['no 512x512 PNG icon']);
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
