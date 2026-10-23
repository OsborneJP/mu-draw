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
});
