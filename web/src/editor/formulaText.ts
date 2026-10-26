// Formula text (docs/plans/v2-formula-text.md): a Formula button in Ketcher's Text Editor.
// While it is on, each line of the text is formatted by the typing rules (formula.ts) as the
// student types: H2SO4 comes out H₂SO₄, and Cu2+ Cu²⁺ once the + arrives.
//
// Ketcher's Text Editor is a Lexical editor, and ketcher-react imports the one copy of
// `lexical` that the app imports too (config/pins.ts pins it). So the formatting is set by
// Lexical node transforms, which run synchronously inside each of the editor's own updates:
// the student's key and its formatting are one change, with no timer, and Apply saves the
// runs as Ketcher's own subscripts and superscripts. Ketcher is not patched.
import {
  $getRoot,
  $isElementNode,
  $isTextNode,
  getNearestEditorFromDOMNode,
  HISTORIC_TAG,
  HISTORY_MERGE_TAG,
  IS_SUBSCRIPT,
  IS_SUPERSCRIPT,
  TextNode,
  type ElementNode,
  type LexicalEditor,
} from 'lexical';
import { formulaScripts, type Script } from './formula';

const SCRIPT_BITS = IS_SUBSCRIPT | IS_SUPERSCRIPT;

function scriptBits(script: Script): number {
  return script === 'sub' ? IS_SUBSCRIPT : script === 'sup' ? IS_SUPERSCRIPT : 0;
}

/** The rules' answer for one line, aligned with its children's text. */
function blockScripts(block: ElementNode): Script[] {
  return formulaScripts(
    block
      .getChildren()
      .map((child) => child.getTextContent())
      .join(''),
  );
}

/** Formats one line by the rules: only the subscript and superscript bits change, so bold,
 * italic and size stay. Formatting a line twice changes nothing, so transforms settle. */
export function $formatBlock(block: ElementNode): void {
  const scripts = blockScripts(block);
  let at = 0;
  for (const child of block.getChildren()) {
    const size = child.getTextContentSize();
    // An input method's text is left alone until it is committed.
    if ($isTextNode(child) && !child.isComposing()) $formatText(child, scripts.slice(at, at + size));
    at += size;
  }
}

function $formatText(node: TextNode, scripts: Script[]): void {
  const cuts: number[] = [];
  for (let i = 1; i < scripts.length; i++) if (scripts[i] !== scripts[i - 1]) cuts.push(i);
  let at = 0;
  for (const part of cuts.length ? node.splitText(...cuts) : [node]) {
    const format = (part.getFormat() & ~SCRIPT_BITS) | scriptBits(scripts[at]);
    if (part.getFormat() !== format) part.setFormat(format);
    at += part.getTextContentSize();
  }
}

function $lines(): ElementNode[] {
  return $getRoot().getChildren().filter($isElementNode);
}

/** True when the text is exactly what Formula would make of it, with at least one
 * subscript or superscript: such a text reopens with Formula on (decision 5). */
export function $isFormulaText(): boolean {
  let scripted = false;
  for (const line of $lines()) {
    const scripts = blockScripts(line);
    let at = 0;
    for (const child of line.getChildren()) {
      const size = child.getTextContentSize();
      if ($isTextNode(child)) {
        const bits = child.getFormat() & SCRIPT_BITS;
        for (let i = at; i < at + size; i++) if (bits !== scriptBits(scripts[i])) return false;
        if (bits && size > 0) scripted = true;
      }
      at += size;
    }
  }
  return scripted;
}

/** Turns Formula on for an editor: formats the text there now and as it changes. Returns
 * the function that turns it off again, leaving the text as it is (decision 4). */
export function startFormula(editor: LexicalEditor): () => void {
  // Merged into the current history step, so Undo goes back past the student's own change.
  const formatAll = () => editor.update(() => $lines().forEach($formatBlock), { tag: HISTORY_MERGE_TAG });
  const stops = [
    // A change to a line marks a text node in it dirty: the one changed, or the neighbours
    // of one added or removed (Lexical relinks them), so this one transform covers it all.
    editor.registerNodeTransform(TextNode, (node) => {
      const line = node.getParent();
      if (line) $formatBlock(line);
    }),
    // Undo and Redo put an earlier state back without running transforms.
    editor.registerUpdateListener(({ tags }) => {
      if (tags.has(HISTORIC_TAG)) formatAll();
    }),
  ];
  formatAll();
  return () => stops.forEach((stop) => stop());
}

const INPUT = '[data-testid="text-editor"]';
const TOOLBAR = '[role="toolbar"][aria-label="Text formatting toolbar"]';
/** Ketcher's buttons that Formula decides for while it is on (greyed, decision 4). */
const SCRIPT_BUTTONS = ['text-superscript', 'text-subscript'];

/** Puts the Formula button in each Text Editor Ketcher opens. Call once, at start-up. */
export function addFormulaButton(doc: Document = document): void {
  const done = new WeakSet<Element>();
  // Ketcher mounts its dialog with the editor already attached (Lexical sets it on the
  // editable element as React commits), so the dialog is complete when this sees it.
  new MutationObserver(() => {
    const input = doc.querySelector(INPUT);
    if (!input || done.has(input)) return;
    done.add(input);
    const editor = getNearestEditorFromDOMNode(input);
    const toolbar = doc.querySelector(TOOLBAR);
    if (editor && toolbar) formulaButton(doc, editor, toolbar);
  }).observe(doc.body, { childList: true, subtree: true });
}

function formulaButton(doc: Document, editor: LexicalEditor, toolbar: Element): void {
  const button = doc.createElement('button');
  button.type = 'button';
  button.textContent = 'Formula';
  button.dataset.testid = 'formula-button';
  button.title = 'Formula: numbers become subscripts and charges superscripts as you type';
  let stop: (() => void) | null = null;
  const set = (on: boolean) => {
    stop?.();
    stop = on ? startFormula(editor) : null;
    button.setAttribute('aria-pressed', String(on));
    for (const id of SCRIPT_BUTTONS) {
      const scriptButton = toolbar.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`);
      if (scriptButton) scriptButton.disabled = on;
    }
  };
  // Like Ketcher's own buttons: a press keeps the student's place in the text, and the
  // toolbar's click handler then puts the focus back there.
  button.addEventListener('mousedown', (event) => event.preventDefault());
  button.addEventListener('click', () => set(!stop));
  // Ketcher's toolbar turns Enter and Space into "focus the text"; on this button they press it.
  button.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') event.stopPropagation();
  });
  // A row of its own in the toolbar: Ketcher's row has no room left (editor.css).
  const row = doc.createElement('div');
  row.dataset.testid = 'formula-row';
  row.append(button);
  toolbar.append(row);
  set(editor.getEditorState().read($isFormulaText));
}
