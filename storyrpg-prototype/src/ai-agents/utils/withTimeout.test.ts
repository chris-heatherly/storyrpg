import { TimeoutError, withTimeout } from './withTimeout';

describe('withTimeout', () => {
  it('rejects with TimeoutError and invokes the timeout callback', async () => {
    let timedOut = false;

    const promise = withTimeout(
      new Promise<string>(() => {
        // Intentionally never resolves.
      }),
      10,
      'slow task',
      () => {
        timedOut = true;
      },
    );

    await expect(promise).rejects.toBeInstanceOf(TimeoutError);
    expect(timedOut).toBe(true);
  });

  it('resolves successful work before the timeout fires', async () => {
    await expect(withTimeout(Promise.resolve('ok'), 100, 'fast task')).resolves.toBe('ok');
  });
});
