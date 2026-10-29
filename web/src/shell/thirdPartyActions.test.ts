import { describe, expect, it } from 'vitest';
import { isOpen, licencesPanel, sourceSaver, type PanelState } from './thirdPartyActions';

/** A load whose answer the test gives when it chooses. */
function held<T>() {
  const answers: { resolve: (value: T) => void; reject: (error: Error) => void }[] = [];
  const load = () => new Promise<T>((resolve, reject) => answers.push({ resolve, reject }));
  return { load, answers };
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('the licences panel', () => {
  it('shows loading, then the text', async () => {
    const shown: PanelState[] = [];
    const { load, answers } = held<string>();
    const panel = licencesPanel(load, (s) => shown.push(s));
    panel.open();
    answers[0].resolve('NOTICES');
    await settle();
    expect(shown).toEqual([{ loading: true }, { text: 'NOTICES' }]);
  });

  it('stays closed when it is closed while loading and the answer comes late', async () => {
    const shown: PanelState[] = [];
    const { load, answers } = held<string>();
    const panel = licencesPanel(load, (s) => shown.push(s));
    panel.open();
    panel.close();
    answers[0].resolve('NOTICES');
    await settle();
    expect(shown).toEqual([{ loading: true }, null]);
  });

  it('shows only the latest opening’s answer, whichever comes first', async () => {
    const shown: PanelState[] = [];
    const { load, answers } = held<string>();
    const panel = licencesPanel(load, (s) => shown.push(s));
    panel.open();
    panel.close();
    panel.open();
    answers[1].resolve('second');
    answers[0].reject(new Error('the first, late'));
    await settle();
    expect(shown).toEqual([{ loading: true }, null, { loading: true }, { text: 'second' }]);
  });

  it('says so when the text cannot be read', async () => {
    const shown: PanelState[] = [];
    const { load, answers } = held<string>();
    licencesPanel(load, (s) => shown.push(s)).open();
    answers[0].reject(new Error('offline and not precached'));
    await settle();
    expect(shown.at(-1)).toEqual({ error: "The licences couldn't be read." });
  });
});

describe('the licences button', () => {
  it('closes the panel while it loads or shows the text, and opens it (retries) after an error', () => {
    expect([null, { loading: true }, { text: 'x' }, { error: 'e' }].map((s) => isOpen(s as PanelState))).toEqual([
      false,
      true,
      true,
      false,
    ]);
  });
});

describe('saving the InChI and cairo source', () => {
  it('saves once for a double click', async () => {
    const saved: Blob[] = [];
    const { load, answers } = held<Blob>();
    const saver = sourceSaver(
      load,
      (b) => saved.push(b),
      () => {},
    );
    saver.save();
    saver.save();
    expect(answers).toHaveLength(1);
    answers[0].resolve(new Blob(['xz']));
    await settle();
    expect(saved).toHaveLength(1);
  });

  it('shows a failure, and clears it when tried again or About reopens', async () => {
    const problems: (string | null)[] = [];
    const { load, answers } = held<Blob>();
    const saver = sourceSaver(
      load,
      () => {},
      (p) => problems.push(p),
    );
    saver.save();
    answers[0].reject(new Error('failed'));
    await settle();
    expect(problems).toEqual([null, "The source couldn't be saved."]);
    saver.reset();
    expect(problems.at(-1)).toBeNull();
    saver.save();
    expect(answers).toHaveLength(2);
  });

  it('keeps a save under way when About reopens', () => {
    const problems: (string | null)[] = [];
    const { load } = held<Blob>();
    const saver = sourceSaver(
      load,
      () => {},
      (p) => problems.push(p),
    );
    saver.save();
    saver.reset();
    expect(problems).toEqual([null]);
  });
});
