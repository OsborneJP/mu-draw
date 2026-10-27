import { createInstallOffer, notNowKey } from './installOffer';

// The app's one install offer, listening from the moment this module loads (main.tsx imports
// it before the app is drawn), so an early offer from the browser isn't missed.
export const installOffer = createInstallOffer(
  window,
  () => window.localStorage,
  notNowKey(import.meta.env.BASE_URL),
  // A browser tab's display mode is 'browser'; the installed app's is any other.
  !window.matchMedia('(display-mode: browser)').matches,
);
