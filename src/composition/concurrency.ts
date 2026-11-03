/**
 * Bounded concurrency for batch work (imports, sweeps, reconciles): a loop that
 * awaited one record at a time runs a pool instead, without flooding the
 * database or a remote API with every record at once.
 *
 * No timers, no I/O, no configuration: the caller owns its concurrency number.
 */

/**
 * Run `fn` over `items` with at most `concurrency` calls in flight (a worker
 * pool, so one slow item does not hold the others back). Results keep the
 * input order. A `concurrency` below 1 (including `-Infinity`) still makes
 * progress, one at a time; `Infinity` runs everything at once.
 *
 * @throws RangeError when `concurrency` is `NaN` (for example
 * `Number(process.env.X)` on an unset variable), rather than silently running
 * every item at once.
 *
 * The first rejection stops handing out new items and rejects once the
 * in-flight ones settle, so no work is left running after the caller sees the
 * error. Later rejections are dropped.
 */
export async function mapBounded<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (Number.isNaN(concurrency)) {
    throw new RangeError('mapBounded: concurrency is NaN.');
  }
  const results = new Array<R>(items.length);
  let next = 0;
  let failed = false;
  let firstError: unknown;
  const worker = async (): Promise<void> => {
    while (!failed) {
      const index = next++;
      if (index >= items.length) return;
      try {
        results[index] = await fn(items[index] as T, index);
      } catch (err) {
        if (!failed) {
          failed = true;
          firstError = err;
        }
        return;
      }
    }
  };
  const limit = concurrency === Number.POSITIVE_INFINITY ? items.length : Math.floor(concurrency);
  const workers = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: workers }, worker));
  if (failed) throw firstError;
  return results;
}

/**
 * Split `items` into consecutive chunks of at most `size`; the last one may be
 * shorter. Throws `RangeError` when `size` is not an integer of at least 1.
 */
export function chunked<T>(items: readonly T[], size: number): T[][] {
  if (!Number.isInteger(size) || size < 1) {
    throw new RangeError(`chunked: size must be an integer >= 1, got ${size}.`);
  }
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
