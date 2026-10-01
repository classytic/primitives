import { describe, expect, it } from 'vitest';
import { createEventRouter, matchEventPattern } from '../../src/events/events.js';

/** The reference: what every scanning transport does today. */
function naive<T>(store: Map<string, Set<T>>, type: string): T[] {
  const seen = new Set<T>();
  for (const [pattern, values] of store)
    if (matchEventPattern(pattern, type)) for (const v of values) seen.add(v);
  return [...seen];
}

/** Deterministic PRNG so a failure reproduces. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const SEGMENTS = ['order', 'rma', 'flow', 'move', 'placed', 'done', 'fulfillment', 'transition'];
const SEPS = [':', '.'];

function randomName(r: () => number): string {
  const depth = 1 + Math.floor(r() * 3);
  let name = SEGMENTS[Math.floor(r() * SEGMENTS.length)] as string;
  for (let i = 1; i < depth; i++)
    name += SEPS[Math.floor(r() * 2)] + (SEGMENTS[Math.floor(r() * SEGMENTS.length)] as string);
  return name;
}

function randomPattern(r: () => number): string {
  const x = r();
  if (x < 0.05) return '*';
  const name = randomName(r);
  if (x < 0.5) return name;
  return `${name}${SEPS[Math.floor(r() * 2)]}*`;
}

describe('createEventRouter — the scan, indexed', () => {
  it('matches the naive scan exactly — values, order, dedupe — across random subscriptions and removals', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const r = rng(seed);
      const router = createEventRouter<number>();
      const store = new Map<string, Set<number>>();
      const handlers = Array.from({ length: 12 }, (_, i) => i);
      for (let step = 0; step < 80; step++) {
        const pattern = randomPattern(r);
        const handler = handlers[Math.floor(r() * handlers.length)] as number;
        if (r() < 0.25 && store.size > 0) {
          const [p, vs] = [...store][Math.floor(r() * store.size)] as [string, Set<number>];
          const v = [...vs][0] as number;
          vs.delete(v);
          if (vs.size === 0) store.delete(p);
          expect(router.remove(p, v)).toBe(true);
        } else {
          if (!store.has(pattern)) store.set(pattern, new Set());
          store.get(pattern)?.add(handler);
          router.add(pattern, handler);
        }
        const type = randomName(r);
        expect(router.route(type), `seed ${seed} step ${step} type ${type}`).toEqual(
          naive(store, type),
        );
      }
    }
  });

  it('a handler under two matching patterns runs once, at its first registration', () => {
    const router = createEventRouter<string>();
    router.add('order:*', 'a');
    router.add('order:placed', 'b');
    router.add('order:placed', 'a');
    expect(router.route('order:placed')).toEqual(['a', 'b']);
  });

  it('a wildcard matches only at a separator, at any depth', () => {
    const router = createEventRouter<string>();
    router.add('order:*', 'colon');
    router.add('flow.*', 'dot');
    expect(router.route('order:fulfillment.transition')).toEqual(['colon']);
    expect(router.route('orders:placed')).toEqual([]);
    expect(router.route('flow.move.done')).toEqual(['dot']);
  });

  it('the memo never serves a stale answer after a change', () => {
    const router = createEventRouter<string>();
    router.add('order:placed', 'a');
    expect(router.route('order:placed')).toEqual(['a']);
    router.add('*', 'all');
    expect(router.route('order:placed')).toEqual(['a', 'all']);
    router.remove('order:placed', 'a');
    expect(router.route('order:placed')).toEqual(['all']);
  });
});
