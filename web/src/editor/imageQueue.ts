// Image and conversion requests to Indigo go one at a time.
//
// ketcher-standalone 3.18 hands every image answer from its worker to one shared event,
// and each request listens `once`, keeping the answer only if it is for its own input.
// So with two requests for different drawings in flight, the first answer also removes
// the second request's listener, and the second never settles (measured: every time).
// Ketcher's Save dialog preview, its Copy Image and the app's Export and Copy all ask for
// images, so the struct service's image method is wrapped before Ketcher binds it.
// Conversions (`convert`: getSmiles(), getMolfile(), the Save dialog's preview) work the same
// way on their own shared event, so Get name's SMILES could be lost to a conversion of
// another drawing; they wait in the same queue (the worker answers one request at a time).
// InChIKeys (`getInChIKey`, Practice mode's Check) have a shared event too, and an answer
// doesn't even say which drawing it is for: two requests in flight both got the first one's
// key (measured). They wait in the same queue.
import type { StructService } from 'ketcher-core';

export type QueuedService = Pick<StructService, 'generateImageAsBase64' | 'convert' | 'getInChIKey'>;

/** Returns a function that makes a service's `generateImageAsBase64`, `convert` and
 * `getInChIKey` wait until every earlier request through the same queue has settled. One
 * queue for the whole page. */
export function imageQueue(): <S extends QueuedService>(service: S) => S {
  let last: Promise<unknown> = Promise.resolve();
  function enqueue<T>(start: () => Promise<T>): Promise<T> {
    const run = last.then(start);
    last = run.catch(() => undefined); // a failed request doesn't hold up the next one
    return run;
  }
  return (service) => {
    const target: QueuedService = service;
    const generate = target.generateImageAsBase64.bind(service);
    target.generateImageAsBase64 = (data, options) => enqueue(() => generate(data, options));
    const convert = target.convert.bind(service);
    target.convert = (data, options) => enqueue(() => convert(data, options));
    const inchiKey = target.getInChIKey.bind(service);
    target.getInChIKey = (struct) => enqueue(() => inchiKey(struct));
    return service;
  };
}
