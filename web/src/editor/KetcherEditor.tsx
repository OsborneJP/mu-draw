import type { Ketcher } from 'ketcher-core';
import { Editor } from 'ketcher-react';
import 'ketcher-react/dist/index.css';
// binaryWasm: Indigo runs in a worker loaded from a real .wasm file (precacheable, no
// blob: worker), instead of the default entry's base64-embedded copy.
import { StandaloneStructServiceProvider } from 'ketcher-standalone/dist/binaryWasm';
import './editor.css';
import { DISABLE_MACROMOLECULES_EDITOR, HIDDEN_BUTTONS } from './ketcherUi';

declare global {
  interface Window {
    ketcher?: Ketcher;
  }
}

// One provider for the page: Ketcher's standalone services share a single Indigo worker.
const structServiceProvider = new StandaloneStructServiceProvider();

// Ketcher reports problems (bad file, Indigo failure) here. Tests listen for the event,
// and for 'editor-ready' below, instead of polling.
function reportError(message: string) {
  console.error('Editor error:', message);
  window.dispatchEvent(new CustomEvent('editor-error', { detail: message }));
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
        onInit={(ketcher) => {
          window.ketcher = ketcher;
          window.dispatchEvent(new Event('editor-ready'));
        }}
      />
    </div>
  );
}
