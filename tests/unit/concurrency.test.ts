import { describe, expect, it } from 'vitest';
import { chunked, mapBounded } from '../../src/composition/concurrency.js';

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

describe('mapBounded', () => {
  it('never runs more than `concurrency` at once and keeps input order', async () => {
    let inFlight = 0;
    let peak = 0;
    const out = await mapBounded(
      Array.from({ length: 50 }, (_, i) => i),
      5,
      async (n) => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await tick();
        inFlight--;
        return n * 2;
      },
    );
    expect(peak).toBe(5);
    expect(out).toEqual(Array.from({ length: 50 }, (_, i) => i * 2));
  });

  it('passes the index and preserves order when items finish out of order', async () => {
    const out = await mapBounded(['a', 'b', 'c', 'd'], 4, async (s, i) => {
      for (let k = 0; k < 4 - i; k++) await tick();
      return `${s}${i}`;
    });
    expect(out).toEqual(['a0', 'b1', 'c2', 'd3']);
  });

  it('a rejection stops new work and surfaces only after in-flight items settle', async () => {
    const started: number[] = [];
    let inFlight = 0;
    let inFlightAtReject = -1;
    await expect(
      mapBounded(
        Array.from({ length: 100 }, (_, i) => i),
        4,
        async (n) => {
          started.push(n);
          inFlight++;
          await tick();
          inFlight--;
          if (n === 6) throw new Error('boom');
          return n;
        },
      ).catch((err) => {
        inFlightAtReject = inFlight;
        throw err;
      }),
    ).rejects.toThrow('boom');
    expect(inFlightAtReject).toBe(0);
    expect(started.length).toBeLessThan(20);
  });

  it('an empty list resolves; a concurrency below 1 or infinite still makes progress', async () => {
    expect(await mapBounded([], 8, async () => 1)).toEqual([]);
    expect(await mapBounded([1, 2], 0, async (n) => n)).toEqual([1, 2]);
    expect(await mapBounded([1, 2], -3, async (n) => n)).toEqual([1, 2]);
    expect(await mapBounded([1, 2, 3], Number.POSITIVE_INFINITY, async (n) => n)).toEqual([
      1, 2, 3,
    ]);
    expect(await mapBounded([1, 2], Number.NEGATIVE_INFINITY, async (n) => n)).toEqual([1, 2]);
  });

  it('-Infinity runs one at a time; NaN throws RangeError before any call', async () => {
    let inFlight = 0;
    let peak = 0;
    await mapBounded([1, 2, 3, 4], Number.NEGATIVE_INFINITY, async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 1));
      inFlight--;
    });
    expect(peak).toBe(1);
    let calls = 0;
    await expect(
      mapBounded([1, 2], Number.NaN, async () => {
        calls++;
      }),
    ).rejects.toThrow(RangeError);
    expect(calls).toBe(0);
  });
});

describe('chunked', () => {
  it('splits into consecutive chunks', () => {
    expect(chunked([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunked([1, 2], 5)).toEqual([[1, 2]]);
    expect(chunked([], 3)).toEqual([]);
  });

  it('throws RangeError for a size that would loop forever or split nonsensically', () => {
    for (const size of [0, -1, 1.5, Number.NaN])
      expect(() => chunked([1, 2], size)).toThrow(RangeError);
  });
});
