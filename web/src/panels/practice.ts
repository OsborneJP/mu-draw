// Practice mode (docs/plans/v2-practice-mode.md): the app gives a name, the student draws it,
// and Check compares the drawing's InChIKey, made by Indigo on the device, with the keys the
// list ships, made by RDKit (web/public/practice.json, from server/scripts/
// build_practice_lists.py). Nothing is kept: the lists and the place in them live in memory,
// and nothing is sent anywhere.
//
// A verdict is about the drawing as it was when Check was pressed, so any change to the
// drawing clears it, and an answer still on its way when the drawing changes (or the name
// does) is dropped when it arrives. Check stays greyed until then, so a test can hold Indigo's
// reply, change the drawing, release it and see that nothing is shown.
import type { Ketcher } from 'ketcher-core';
import { readDrawing } from '../editor/drawing';
import { PRACTICE_FILE, type PracticeList, type PracticeName } from './practiceFile';

export type { PracticeList, PracticeName };

export type Verdict =
  | { kind: 'correct'; stereoUnchecked: boolean }
  | { kind: 'stereo'; marked: boolean }
  | { kind: 'protonation' }
  | { kind: 'isomer'; formula: string }
  | { kind: 'formula'; formula: string }
  | { kind: 'fragments'; drawn: number; expected: number }
  | { kind: 'reaction' }
  | { kind: 'not-elements' }
  | { kind: 'query' }
  | { kind: 'valence' }
  | { kind: 'failed' };

export type Lists = { kind: 'loading' } | { kind: 'failed' } | { kind: 'ready'; lists: PracticeList[] };

export type Answer = { kind: 'none' } | { kind: 'drawing' } | { kind: 'shown'; src: string } | { kind: 'failed' };

export interface PracticeState {
  open: boolean;
  lists: Lists;
  list: number;
  position: number;
  checking: boolean;
  verdict: Verdict | null;
  /** A Check of this name wasn't right, so Show answer is offered. */
  missed: boolean;
  answer: Answer;
}

// An InChIKey's blocks: the skeleton (14 letters); the stereo (8 letters), then S for a
// standard InChI or N for one that isn't (Indigo writes one for stereocentres marked & or
// "or"), then the version letter; and the protonation letter.
const skeleton = (key: string) => key.slice(0, 14);
const standard = (key: string) => key.charAt(23) === 'S';
const protonation = (key: string) => key.slice(-1);

/** An InChI's formula layer: the part between its first two slashes. */
export function inchiFormula(inchi: string): string {
  return inchi.split('/')[1] ?? '';
}

/** How many parts an InChI formula has: parts are separated by dots, and a part may start
 * with how many of it there are. */
export function components(formula: string): number {
  return [...formula.matchAll(/(?:^|\.)(\d*)[A-Z]/g)].reduce((sum, m) => sum + Number(m[1] || 1), 0);
}

/** The verdict on a drawing whose InChIKey and InChI Indigo gave, for one name. */
export function judge(item: PracticeName, drawn: { inchikey: string; inchi: string }): Verdict {
  const formula = inchiFormula(drawn.inchi);
  const parts = components(formula);
  if (parts !== item.components) return { kind: 'fragments', drawn: parts, expected: item.components };
  const key = drawn.inchikey;
  const sameSkeleton = item.keys.filter((k) => skeleton(k) === skeleton(key));
  const right =
    item.stereo === 'checked'
      ? item.keys.includes(key)
      : sameSkeleton.some((k) => protonation(k) === protonation(key));
  if (right) return { kind: 'correct', stereoUnchecked: item.stereo === 'unchecked' };
  if (sameSkeleton.length > 0) {
    if (!sameSkeleton.some((k) => protonation(k) === protonation(key))) return { kind: 'protonation' };
    return { kind: 'stereo', marked: !standard(key) };
  }
  return formula === item.formula ? { kind: 'isomer', formula } : { kind: 'formula', formula };
}

/** What the panel says for each verdict. */
export function verdictText(verdict: Verdict): string {
  switch (verdict.kind) {
    case 'correct':
      return verdict.stereoUnchecked
        ? "Correct. The name doesn't give the stereochemistry, so any is accepted."
        : 'Correct.';
    case 'stereo':
      return verdict.marked
        ? 'Right structure, but the stereochemistry is different: some stereocentres are marked “&” or “or”. The name means one stereoisomer, so draw them as absolute (ABS).'
        : 'Right structure, but the stereochemistry is different. Check the wedges and hashes, and which way round each double bond is.';
    case 'protonation':
      return 'Right skeleton, but the hydrogens or charges are different, for example an acid drawn as its anion.';
    case 'isomer':
      return `Right formula (${verdict.formula}), but a different structure: an isomer of the answer.`;
    case 'formula':
      return `Not this compound: your drawing is ${verdict.formula}.`;
    case 'fragments':
      return `Your drawing has ${count(verdict.drawn)}; the answer has ${count(verdict.expected)}. Leave only your answer on the canvas.`;
    case 'reaction':
      return 'Practice checks one structure, not a reaction. Take the arrow out.';
    case 'not-elements':
      return 'Your drawing has a generic atom or an R-group. Draw the actual atoms.';
    case 'query':
      return "Practice can't check a crossed (either) double bond or another query feature. Draw a plain double bond.";
    case 'valence':
      return 'An atom has too many bonds (Ketcher marks it in red). Fix it, then check again.';
    case 'failed':
      return "The editor couldn't read this drawing.";
  }
}

function count(structures: number): string {
  return structures === 1 ? '1 separate structure' : `${structures} separate structures`;
}

let state: PracticeState = {
  open: false,
  lists: { kind: 'loading' },
  list: 0,
  position: 0,
  checking: false,
  verdict: null,
  missed: false,
  answer: { kind: 'none' },
};
// Bumped when a verdict on its way no longer applies: the drawing changed, or the question did.
let drawingGeneration = 0;
// Bumped when the question changes (another name or list, or the panel closed): a picture of
// the old answer on its way is dropped.
let questionGeneration = 0;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

function update(changes: Partial<PracticeState>): void {
  state = { ...state, ...changes };
  listeners.forEach((listener) => listener());
}

export function getPracticeState(): PracticeState {
  return state;
}

export function subscribePractice(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The name being practised, once the lists are in. */
export function currentName(s: PracticeState = state): PracticeName | null {
  return s.lists.kind === 'ready' ? (s.lists.lists[s.list]?.names[s.position] ?? null) : null;
}

/** The lists, fetched once (from the precache when offline). After a failure, the next open
 * tries again. */
function loadLists(): void {
  loading ??= (async () => {
    try {
      const response = await fetch(`${import.meta.env.BASE_URL}${PRACTICE_FILE}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = (await response.json()) as { lists: PracticeList[] };
      update({ lists: { kind: 'ready', lists: data.lists } });
    } catch (error) {
      console.error('The practice lists did not load:', error);
      loading = null;
      update({ lists: { kind: 'failed' } });
    }
  })();
}

function newQuestion(): void {
  questionGeneration += 1;
  drawingGeneration += 1;
}

export function openPractice(): void {
  if (state.open) return;
  update({ open: true, ...(state.lists.kind === 'failed' ? { lists: { kind: 'loading' } } : {}) });
  loadLists();
}

/** Close the panel. Opening it again comes back to the same name. */
export function closePractice(): void {
  if (!state.open) return;
  newQuestion();
  update({ open: false, verdict: null, missed: false, answer: { kind: 'none' } });
}

export function togglePractice(): void {
  if (state.open) closePractice();
  else openPractice();
}

/** Ketcher's change event: the verdict no longer applies, and one on its way is dropped. */
export function drawingChanged(): void {
  drawingGeneration += 1;
  if (state.verdict) update({ verdict: null });
}

/** Go to another name or list. The canvas is cleared, in one step that Undo reverses. */
export async function goTo(ketcher: Ketcher, list: number, position: number): Promise<void> {
  newQuestion();
  update({ list, position, verdict: null, missed: false, answer: { kind: 'none' } });
  if (!ketcher.editor.struct().isBlank()) await ketcher.setMolecule('');
}

/** Check the drawing against the current name. */
export async function check(ketcher: Ketcher): Promise<void> {
  const item = currentName();
  if (!item || state.checking) return;
  const drawing = readDrawing(ketcher);
  if (drawing.kind === 'empty') return;
  if (drawing.kind !== 'structure' || drawing.badValence > 0) {
    const kind = drawing.kind === 'structure' ? 'valence' : drawing.kind === 'unreadable' ? 'failed' : drawing.kind;
    update({ verdict: { kind }, missed: true });
    return;
  }
  const asked = drawingGeneration;
  update({ checking: true, verdict: null });
  let verdict: Verdict;
  try {
    // One after the other, each through the Indigo queue (src/editor/imageQueue.ts).
    const inchikey = await ketcher.getInChIKey();
    const inchi = await ketcher.getInchi();
    verdict = judge(item, { inchikey, inchi });
  } catch (error) {
    // Indigo refuses a crossed double bond and other query features with "<query molecule>
    // is not a molecule" (measured).
    verdict = { kind: /query molecule/.test(String(error)) ? 'query' : 'failed' };
  }
  if (drawingGeneration !== asked) {
    update({ checking: false });
    return;
  }
  update({ checking: false, verdict, missed: state.missed || verdict.kind !== 'correct' });
}

/** Show answer: a picture of the answer in the panel. The canvas is left alone. */
export async function showAnswer(ketcher: Ketcher): Promise<void> {
  const item = currentName();
  if (!item || state.answer.kind !== 'none') return;
  const asked = questionGeneration;
  update({ answer: { kind: 'drawing' } });
  let answer: Answer;
  try {
    // What ketcher.generateImage asks Indigo for (the student's display settings), kept as
    // base64: a data: image, which img-src allows (web/csp.json; blob: images are not). With
    // no Blob to read, the answer is handled as soon as Indigo's reply arrives, so a test
    // knows it was dropped once a later request through the queue has settled.
    const settings = (ketcher.editor as unknown as { serverSettings: Record<string, unknown> }).serverSettings;
    const svg = await ketcher.structService.generateImageAsBase64(item.molfile, { ...settings, outputFormat: 'svg' });
    answer = { kind: 'shown', src: `data:image/svg+xml;base64,${svg}` };
  } catch (error) {
    console.error('Show answer could not draw the answer:', error);
    answer = { kind: 'failed' };
  }
  if (questionGeneration === asked) update({ answer });
}
