// The biochem tools' worker: its own Indigo, the same wasm file Ketcher's worker loads (one
// copy in the build and the precache), started when the student first opens the section.
// The page sends Ketcher's monomer library first, then requests; replies keep their order.
import Module from 'indigo-ketcher/binaryWasm';
import { createEngine, type BiochemMessage, type BiochemReply, type Engine } from './indigoBiochem';

let engine: Promise<Engine> | null = null;

const post = (reply: BiochemReply) => self.postMessage(reply);

self.onmessage = (event: MessageEvent<BiochemMessage>) => {
  const message = event.data;
  if (message.kind === 'library') {
    engine = Module().then((indigo) => createEngine(indigo, message.library));
    return;
  }
  if (!engine) {
    post({ failed: 'the monomer library never arrived' });
    return;
  }
  engine.then(
    (ready) => post(ready.compute(message)),
    (error: unknown) => post({ failed: error instanceof Error ? error.message : String(error) }),
  );
};
