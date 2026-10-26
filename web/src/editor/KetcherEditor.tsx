import type { Ketcher, StructServiceOptions } from 'ketcher-core';
import { Editor } from 'ketcher-react';
import 'ketcher-react/dist/index.css';
// binaryWasm: Indigo runs in a worker loaded from a real .wasm file (precacheable, no
// blob: worker), instead of the default entry's base64-embedded copy.
import { StandaloneStructServiceProvider } from 'ketcher-standalone/dist/binaryWasm';
import { autosaveKey, setSaveStatus, startAutosave, type AutosaveEditor } from './autosave';
import { groupsKey, startGroups } from './groupStore';
import './editor.css';
import { imageQueue } from './imageQueue';
import { setKetcher } from './instance';
import { DISABLE_MACROMOLECULES_EDITOR, HIDDEN_BUTTONS } from './ketcherUi';

declare global {
  interface Window {
    ketcher?: Ketcher;
  }
}

// Every service this provider creates asks Indigo for images and conversions one at a time
// (imageQueue.ts).
class QueuedImageProvider extends StandaloneStructServiceProvider {
  private readonly queueImages = imageQueue();

  createStructService(options: StructServiceOptions) {
    return this.queueImages(super.createStructService(options));
  }
}

// One provider for the page: Ketcher's standalone services share a single Indigo worker.
const structServiceProvider = new QueuedImageProvider();

// Ketcher reports problems (bad file, Indigo failure) here. Tests listen for the event,
// and for 'editor-ready' below, instead of polling.
function reportError(message: string) {
  console.error('Editor error:', message);
  window.dispatchEvent(new CustomEvent('editor-error', { detail: message }));
}

function autosaveEditor(ketcher: Ketcher): AutosaveEditor {
  return {
    getKet: () => ketcher.getKet(),
    setMolecule: (ket) => ketcher.setMolecule(ket),
    clearHistory: () => ketcher.editor.clearHistory(),
    onChange: (handler) => ketcher.changeEvent.add(handler),
  };
}

// ketcher-react 3.18 calls onInit twice for one Ketcher: once the molecules editor is
// up, and again when its lazily loaded macromolecules editor mounts (even though that
// mode is disabled), up to a second later. Starting autosave twice would restore the
// drawing over the student's first edits, wipe the undo history and save every change
// twice. So: once per Ketcher. Each call is announced ('editor-init') so a test can wait
// for the second one.
const started = new WeakSet<Ketcher>();

function onInit(ketcher: Ketcher) {
  window.dispatchEvent(new Event('editor-init'));
  if (started.has(ketcher)) return;
  started.add(ketcher);
  window.ketcher = ketcher;
  // Ready once the last drawing is back on the canvas and changes are being saved.
  const key = autosaveKey(import.meta.env.BASE_URL);
  void startAutosave(autosaveEditor(ketcher), () => window.localStorage, key, setSaveStatus).then(() => {
    // The groups beside the restored drawing (docs/plans/v2-grouping.md).
    startGroups(ketcher, () => window.localStorage, groupsKey(import.meta.env.BASE_URL));
    setKetcher(ketcher);
    window.dispatchEvent(new Event('editor-ready'));
  });
}

export default function KetcherEditor() {
  return (
    <div className="editor">
      <Editor
        staticResourcesUrl={import.meta.env.BASE_URL}
        structServiceProvider={structServiceProvider}
        errorHandler={reportError}
        buttons={HIDDEN_BUTTONS}
        disableMacromoleculesEditor={DISABLE_MACROMOLECULES_EDITOR}
        onInit={onInit}
      />
    </div>
  );
}
