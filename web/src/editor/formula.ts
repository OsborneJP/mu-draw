// Formula text's typing rules (docs/plans/v2-formula-text.md, "The rules"): which characters
// of a text are subscripts and which are superscripts. Counts and multipliers follow
// ChemDraw's Formula style; charges go further, as Jeff asked (2026-10-26). Only the
// formatting is decided here: the characters stay as the student typed them.

/** A character's place: a subscript, a superscript, or on the line (null). */
export type Script = 'sub' | 'sup' | null;

const DIGIT = /[0-9]/;
const SIGNS = '+-−–'; // plus, hyphen-minus, minus sign, en dash
const TRAILING = '.,;:!?';
const STATE_SYMBOL = /\((?:s|l|g|aq)\)$/;
const COUNTED = /[\p{L})\]]/u; // a count follows a letter or a closing bracket
const ELEMENT_LIKE = /^[0-9]*[A-Z][a-z]?$/; // after any multiplier
const PARTIAL_OR_ELECTRON = /^[0-9]*[eδ]$/u;

/** One entry per UTF-16 code unit of `text` (Lexical's offsets). Words are split at
 * whitespace, so each line of a text box can be passed whole. */
export function formulaScripts(text: string): Script[] {
  const scripts: Script[] = new Array<Script>(text.length).fill(null);
  for (const word of text.matchAll(/\S+/g)) {
    wordScripts(word[0]).forEach((script, i) => (scripts[word.index + i] = script));
  }
  return scripts;
}

function wordScripts(word: string): Script[] {
  const scripts: Script[] = new Array<Script>(word.length).fill(null);
  const end = chargeEnd(word);
  const charge = chargeStart(word, end);
  for (let i = charge; i < end; i++) scripts[i] = 'sup';
  // Rules 1 and 2: a run of digits is a count after a letter or closing bracket, and a
  // multiplier (on the line) anywhere else.
  for (let i = 1; i < charge; i++) {
    if (DIGIT.test(word[i]) && (COUNTED.test(word[i - 1]) || scripts[i - 1] === 'sub')) scripts[i] = 'sub';
  }
  return scripts;
}

/** Where a charge would end: the word's end, before any trailing punctuation or state
 * symbol, as in "Cu2+(aq)" and "Cl-." (rule 3). */
function chargeEnd(word: string): number {
  let end = word.length;
  for (;;) {
    const state = STATE_SYMBOL.exec(word.slice(0, end));
    if (state) end -= state[0].length;
    else if (end > 0 && TRAILING.includes(word[end - 1])) end--;
    else return end;
  }
}

/** Where the word's charge starts (rules 3 and 4), or `end` when it has none. */
function chargeStart(word: string, end: number): number {
  let sign = end;
  while (sign > 0 && SIGNS.includes(word[sign - 1])) sign--;
  if (sign === end || sign === 0) return end; // no sign, or a sign standing alone
  const body = word.slice(0, sign);
  if (!/[A-Z]/.test(body) && !PARTIAL_OR_ELECTRON.test(body)) return end; // "cis-", "2-"
  let digits = sign;
  while (digits > 0 && DIGIT.test(word[digits - 1])) digits--;
  const count = sign - digits;
  if (count === 0) return sign;
  if (word[digits - 1] === ']') return digits; // 4a: [Fe(CN)6]3-
  if (count === 1 && ELEMENT_LIKE.test(word.slice(0, digits))) return digits; // 4b: Cu2+
  if (count >= 2 && word[sign - 1] !== '0') return sign - 1; // 4c: SO42-, but C60-
  return sign; // 4d: NH4+
}
