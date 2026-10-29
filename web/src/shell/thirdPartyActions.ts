// About's two third-party actions (docs/plans/licence-notices.md, decisions 1 and 3), apart from
// React so a test can hold each answer and force every order of clicks and answers.

/** What the licences panel shows; null while it is closed. */
export type PanelState = null | { loading: true } | { text: string } | { error: string };

/** Open, for its button: loading or showing the text. After an error the button opens it again,
 * so it retries instead of only clearing the message. */
export function isOpen(state: PanelState): boolean {
  return state !== null && !('error' in state);
}

/** The licences panel. Only the latest opening's answer is shown: a close, or a later opening,
 * while one is loading can't be undone by that answer arriving late. */
export function licencesPanel(load: () => Promise<string>, show: (state: PanelState) => void) {
  let request = 0;
  return {
    open() {
      const n = ++request;
      show({ loading: true });
      load().then(
        (text) => n === request && show({ text }),
        () => n === request && show({ error: "The licences couldn't be read." }),
      );
    },
    close() {
      request += 1;
      show(null);
    },
  };
}

/** Saving the InChI and cairo source: one save at a time, so a double click saves it once and
 * a failure shown is always the latest attempt's. */
export function sourceSaver(
  load: () => Promise<Blob>,
  save: (blob: Blob) => void,
  problem: (message: string | null) => void,
) {
  let saving = false;
  return {
    save() {
      if (saving) return;
      saving = true;
      problem(null);
      load()
        .then(save, () => problem("The source couldn't be saved."))
        .finally(() => {
          saving = false;
        });
    },
    /** About is opened again: an old message goes, unless a save is still under way. */
    reset() {
      if (!saving) problem(null);
    },
  };
}
