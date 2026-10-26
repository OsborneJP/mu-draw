// Formula's Lexical side, on a headless editor: what a Text Editor's state becomes while
// Formula is on. editor.read() flushes pending updates first, so every check sees the
// state after all transforms and listeners have run.
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  $isTextNode,
  createEditor,
  HISTORIC_TAG,
  IS_BOLD,
  IS_ITALIC,
  IS_SUBSCRIPT,
  IS_SUPERSCRIPT,
  type LexicalEditor,
} from 'lexical';
import { describe, expect, it } from 'vitest';
import { $isFormulaText, startFormula } from './formulaText';

const SUB = IS_SUBSCRIPT;
const SUP = IS_SUPERSCRIPT;

function newEditor(): LexicalEditor {
  return createEditor({
    namespace: 'formula-test',
    onError: (error) => {
      throw error;
    },
  });
}

/** Each line's text runs, as [text, format bits]. */
function runs(editor: LexicalEditor): [string, number][][] {
  return editor.read(() =>
    $getRoot()
      .getChildren()
      .filter($isElementNode)
      .map((line) =>
        line
          .getChildren()
          .filter($isTextNode)
          .map((run): [string, number] => [run.getTextContent(), run.getFormat()]),
      ),
  );
}

/** Lines of plain runs, as Ketcher's dialog would open them: [text, format] per run. */
function setLines(editor: LexicalEditor, lines: [string, number][][]): void {
  editor.update(
    () => {
      const root = $getRoot().clear();
      for (const line of lines) {
        const paragraph = $createParagraphNode();
        for (const [text, format] of line) paragraph.append($createTextNode(text).setFormat(format));
        root.append(paragraph);
      }
    },
    { discrete: true },
  );
}

/** Types at the end of the text, one character per update, as keys do. */
function type(editor: LexicalEditor, text: string): void {
  for (const char of text) {
    editor.update(
      () => {
        $getRoot().selectEnd();
        const selection = $getSelection();
        if ($isRangeSelection(selection)) selection.insertText(char);
      },
      { discrete: true },
    );
  }
}

describe('startFormula', () => {
  it('formats the text already there when it is turned on', () => {
    const editor = newEditor();
    setLines(editor, [[['H2SO4 Cu2+', 0]]]);
    startFormula(editor);
    expect(runs(editor)).toEqual([
      [
        ['H', 0],
        ['2', SUB],
        ['SO', 0],
        ['4', SUB],
        [' Cu', 0],
        ['2+', SUP],
      ],
    ]);
  });

  it('formats as the student types, raising the 2 of Cu2+ once the + arrives', () => {
    const editor = newEditor();
    setLines(editor, [[]]);
    startFormula(editor);
    type(editor, 'Cu2');
    expect(runs(editor)).toEqual([
      [
        ['Cu', 0],
        ['2', SUB],
      ],
    ]);
    type(editor, '+');
    expect(runs(editor)).toEqual([
      [
        ['Cu', 0],
        ['2+', SUP],
      ],
    ]);
  });

  it('formats each line on its own', () => {
    const editor = newEditor();
    setLines(editor, [[['H2O', 0]], [['Cu2+', 0]]]);
    startFormula(editor);
    expect(runs(editor)).toEqual([
      [
        ['H', 0],
        ['2', SUB],
        ['O', 0],
      ],
      [
        ['Cu', 0],
        ['2+', SUP],
      ],
    ]);
  });

  it('keeps bold, italic and font size', () => {
    const editor = newEditor();
    setLines(editor, [[['H2O', IS_BOLD | IS_ITALIC]]]);
    editor.update(
      () => {
        const run = $getRoot().getFirstDescendant();
        if ($isTextNode(run)) run.setStyle('font-size: 20px;');
      },
      { discrete: true },
    );
    startFormula(editor);
    expect(runs(editor)).toEqual([
      [
        ['H', IS_BOLD | IS_ITALIC],
        ['2', IS_BOLD | IS_ITALIC | SUB],
        ['O', IS_BOLD | IS_ITALIC],
      ],
    ]);
    const styles = editor.read(() => $getRoot().getAllTextNodes().map((run) => run.getStyle()));
    expect(styles).toEqual(['font-size: 20px;', 'font-size: 20px;', 'font-size: 20px;']);
  });

  it('reformats a line when a run is removed from it', () => {
    const editor = newEditor();
    setLines(editor, [[['Cu2+', 0]]]);
    startFormula(editor);
    // Remove the "Cu" run: what is left, "2+", is no charge on its own.
    editor.update(() => $getRoot().getFirstDescendant()?.remove(), { discrete: true });
    expect(runs(editor)).toEqual([[['2+', 0]]]);
  });

  it('formats a state put back by Undo or Redo', () => {
    const editor = newEditor();
    setLines(editor, [[['H2O', 0]]]);
    const plain = editor.getEditorState();
    startFormula(editor);
    runs(editor); // settled, as between two key presses
    // What the history plugin does on Undo: an earlier state, set with the historic tag.
    editor.setEditorState(plain, { tag: HISTORIC_TAG });
    expect(runs(editor)).toEqual([
      [
        ['H', 0],
        ['2', SUB],
        ['O', 0],
      ],
    ]);
  });

  it('leaves the text as it is once it is turned off', () => {
    const editor = newEditor();
    setLines(editor, [[['H2O', 0]]]);
    const stop = startFormula(editor);
    stop();
    setLines(editor, [[['Cu2+', 0]]]);
    expect(runs(editor)).toEqual([[['Cu2+', 0]]]);
    editor.update(
      () => {
        const run = $getRoot().getFirstDescendant();
        if ($isTextNode(run)) run.setFormat(SUP);
      },
      { discrete: true },
    );
    expect(runs(editor)).toEqual([[['Cu2+', SUP]]]);
  });

  it('settles: formatting a formatted text changes nothing', () => {
    const editor = newEditor();
    setLines(editor, [[['[Fe(CN)6]3- SO42-', 0]]]);
    startFormula(editor);
    const once = runs(editor); // read() flushes the pending update first
    const state = editor.getEditorState().toJSON();
    startFormula(editor);
    expect(runs(editor)).toEqual(once);
    expect(editor.getEditorState().toJSON()).toEqual(state);
  });
});

describe('$isFormulaText', () => {
  function isFormula(lines: [string, number][][]): boolean {
    const editor = newEditor();
    setLines(editor, lines);
    return editor.read($isFormulaText);
  }

  it('is true for text formatted exactly as Formula formats it', () => {
    expect(
      isFormula([
        [
          ['H', 0],
          ['2', SUB],
          ['O', IS_BOLD],
        ],
        [
          ['Cu', 0],
          ['2+', SUP],
        ],
      ]),
    ).toBe(true);
  });

  it('is false for plain text, even when Formula would leave it as it is', () => {
    expect(isFormula([[['H2O', 0]]])).toBe(false);
    expect(isFormula([[['Add the acid', 0]]])).toBe(false);
    expect(isFormula([[]])).toBe(false);
  });

  it('is false for formatting by hand that Formula would not give', () => {
    expect(
      isFormula([
        [
          ['13', SUP],
          ['CO', 0],
          ['2', SUB],
        ],
      ]),
    ).toBe(false);
  });
});
