/**
 * Race a promise against a deadline without leaking the loser.
 *
 * A call that can hang — no throw, no response, the underlying layer just
 * never settles — must not block its caller forever. Nothing here cancels
 * the original promise; it keeps running after the deadline, so its eventual
 * settlement is swallowed rather than surfaced a second time to a caller
 * that already moved on.
 */
export class DeadlineExceededError extends Error {
  constructor(label: string, timeoutMs: number) {
    super(`${label} timed out after ${timeoutMs}ms`);
    this.name = 'DeadlineExceededError';
  }
}

export function withDeadline<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new DeadlineExceededError(label, timeoutMs)), timeoutMs);
    timer.unref?.();
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}
