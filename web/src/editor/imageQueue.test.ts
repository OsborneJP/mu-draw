import type { ConvertData, ConvertResult } from 'ketcher-core';
import { describe, expect, it } from 'vitest';
import { imageQueue } from './imageQueue';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Struct service stand-in: each request starts when called and settles when the test says. */
class FakeService {
  started: string[] = [];
  answers = new Map<string, ReturnType<typeof deferred<string>>>();
  signals = new Map<string, ReturnType<typeof deferred<void>>>();

  generateImageAsBase64(data: string): Promise<string> {
    return this.start(data);
  }
  /** A conversion request, keyed and answered the same way (by its `struct`). */
  convert(data: ConvertData): Promise<ConvertResult> {
    return this.start(data.struct).then((struct) => ({ struct, format: data.output_format }));
  }
  /** An InChIKey request, keyed by its drawing. */
  getInChIKey(struct: string): Promise<string> {
    return this.start(struct);
  }
  private start(data: string): Promise<string> {
    this.started.push(data);
    this.whenStarted(data).resolve();
    const answer = deferred<string>();
    this.answers.set(data, answer);
    return answer.promise;
  }
  /** Resolves once a request for `data` has started. */
  whenStarted(data: string) {
    if (!this.signals.has(data)) this.signals.set(data, deferred<void>());
    return this.signals.get(data)!;
  }
}

describe('imageQueue', () => {
  it('starts a request only after the one before it has settled', async () => {
    const service = imageQueue()(new FakeService());
    const first = service.generateImageAsBase64('first');
    const second = service.generateImageAsBase64('second');
    await service.whenStarted('first').promise;
    // Unqueued, both would have started already.
    expect(service.started).toEqual(['first']);

    service.answers.get('first')!.resolve('image 1');
    expect(await first).toBe('image 1');
    await service.whenStarted('second').promise;
    expect(service.started).toEqual(['first', 'second']);
    service.answers.get('second')!.resolve('image 2');
    expect(await second).toBe('image 2');
  });

  it('runs the next request after a failure, and the failure reaches its own caller', async () => {
    const service = imageQueue()(new FakeService());
    const first = service.generateImageAsBase64('first');
    const second = service.generateImageAsBase64('second');
    await service.whenStarted('first').promise;
    service.answers.get('first')!.reject(new Error('render failed'));
    await expect(first).rejects.toThrow('render failed');

    // The second must start, not inherit the first one's failure.
    const next = await Promise.race([
      service.whenStarted('second').promise.then(() => 'started'),
      second.then(
        () => 'settled without starting',
        (error: Error) => `failed: ${error.message}`,
      ),
    ]);
    expect(next).toBe('started');
    service.answers.get('second')!.resolve('image 2');
    expect(await second).toBe('image 2');
  });

  it('shares one queue between services, as Ketcher may create more than one per worker', async () => {
    const queue = imageQueue();
    const one = queue(new FakeService());
    const two = queue(new FakeService());
    const first = one.generateImageAsBase64('first');
    const second = two.generateImageAsBase64('second');
    await one.whenStarted('first').promise;
    expect(two.started).toEqual([]);

    one.answers.get('first')!.resolve('image 1');
    await first;
    await two.whenStarted('second').promise;
    two.answers.get('second')!.resolve('image 2');
    expect(await second).toBe('image 2');
  });

  it('queues conversions with images, so a conversion waits for an image and the reverse', async () => {
    const service = imageQueue()(new FakeService());
    const image = service.generateImageAsBase64('image');
    const conversion = service.convert({ struct: 'conversion' } as ConvertData);
    const another = service.generateImageAsBase64('another image');
    await service.whenStarted('image').promise;
    // Unqueued, the conversion would have started already.
    expect(service.started).toEqual(['image']);
    service.answers.get('image')!.resolve('image 1');
    await image;
    await service.whenStarted('conversion').promise;
    expect(service.started).toEqual(['image', 'conversion']);
    service.answers.get('conversion')!.resolve('smiles');
    expect((await conversion).struct).toBe('smiles');
    await service.whenStarted('another image').promise;
    service.answers.get('another image')!.resolve('image 2');
    expect(await another).toBe('image 2');
  });

  it('queues InChIKeys with images and conversions', async () => {
    const service = imageQueue()(new FakeService());
    const image = service.generateImageAsBase64('image');
    const first = service.getInChIKey('first drawing');
    const second = service.getInChIKey('second drawing');
    await service.whenStarted('image').promise;
    // Unqueued, both InChIKey requests would have started already.
    expect(service.started).toEqual(['image']);
    service.answers.get('image')!.resolve('image 1');
    await image;
    await service.whenStarted('first drawing').promise;
    expect(service.started).toEqual(['image', 'first drawing']);
    service.answers.get('first drawing')!.resolve('key 1');
    expect(await first).toBe('key 1');
    await service.whenStarted('second drawing').promise;
    service.answers.get('second drawing')!.resolve('key 2');
    expect(await second).toBe('key 2');
  });
});
