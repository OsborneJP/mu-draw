// Image requests to Indigo go one at a time.
//
// ketcher-standalone 3.18 hands every image answer from its worker to one shared event,
// and each request listens `once`, keeping the answer only if it is for its own input.
// So with two requests for different drawings in flight, the first answer also removes
// the second request's listener, and the second never settles (measured: every time).
// Ketcher's Save dialog preview, its Copy Image and the app's Export and Copy all ask for
// images, so the struct service's image method is wrapped before Ketcher binds it.
import type { StructService } from 'ketcher-core';

export type ImageService = Pick<StructService, 'generateImageAsBase64'>;

/** Returns a function that makes a service's `generateImageAsBase64` wait until every
 * earlier request through the same queue has settled. One queue for the whole page. */
export function imageQueue(): <S extends ImageService>(service: S) => S {
  let last: Promise<unknown> = Promise.resolve();
  return (service) => {
    const target: ImageService = service;
    const generate = target.generateImageAsBase64.bind(service);
    target.generateImageAsBase64 = (data, options) => {
      const run = last.then(() => generate(data, options));
      last = run.catch(() => undefined); // a failed request doesn't hold up the next one
      return run;
    };
    return service;
  };
}
