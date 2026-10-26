// main.tsx imports this first, before App brings in Ketcher: ketcher-react reads its saved
// settings as soon as its code loads, so the ACS style must be in storage by then
// (acsStyle.ts). The browser test 'a new browser starts in ACS' fails if a build ever runs
// this later.
import { PRESETS } from 'ketcher-core';
import { acsSettings, applyAcsOnce } from './acsStyle';

applyAcsOnce(() => window.localStorage, acsSettings(PRESETS.acs));
