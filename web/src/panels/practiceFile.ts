// Practice mode's lists in the build, under the base path: web/public/practice.json, built by
// server/scripts/build_practice_lists.py. Shared by the app, the precache guard and the tests,
// so nothing here may import Node or browser APIs.

export const PRACTICE_FILE = 'practice.json';

export interface PracticeName {
  name: string;
  /** The InChIKeys that count as right: the answer's, and its mirror image's when the name
   * states only relative stereo (cis/trans, E/Z). */
  keys: string[];
  /** 'checked': the whole key must match. 'unchecked' (the answer has stereo the name doesn't
   * state) and 'none': only the skeleton and the protonation letter count. */
  stereo: 'checked' | 'unchecked' | 'none';
  /** The InChI's formula layer, and how many parts it has. */
  formula: string;
  components: number;
  /** The answer, for Show answer. */
  molfile: string;
}

export interface PracticeList {
  id: string;
  title: string;
  names: PracticeName[];
}
