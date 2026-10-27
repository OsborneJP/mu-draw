// main.tsx imports this first, before App brings in Ketcher: ketcher-react reads its saved
// settings as soon as its code loads, so the defaults must be in storage by then
// (acsStyle.ts). The browser test 'a new browser starts in ACS' fails if a build ever runs
// this later.
import { PRESETS, ShowHydrogenLabels } from 'ketcher-core';
import { ACS_APPLIED_KEY, acsSettings, applyOnce, HETERO_H_APPLIED_KEY } from './acsStyle';

const storage = () => window.localStorage;
applyOnce(storage, ACS_APPLIED_KEY, acsSettings(PRESETS.acs));
// Hydrogens on heteroatoms only (OH, NH); terminal carbons are plain line ends. Ketcher's
// default also labels them (CH3), and its ACS preset leaves this setting alone.
applyOnce(storage, HETERO_H_APPLIED_KEY, { showHydrogenLabels: ShowHydrogenLabels.Hetero });
