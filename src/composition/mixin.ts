/**
 * Additive composition for domain entities — without subclassing.
 *
 * Most mixin system (good idea, heavy implementation) lets a `Contact`
 * become a `Contact & Customer` without rewriting the type or copying
 * fields. We replicate the GOOD bit (additive type composition stored as
 * nested data) with none of the bad bits (no decorators, no global class
 * registry, no proxies).
 *
 * Pattern: store mixin payloads on a known well-typed key (`mixins.customer`,
 * `mixins.lead-fit`, …) instead of spreading them onto the entity root. This
 * keeps the base type stable and lets each mixin own its own keyspace —
 * additive schema evolution without breaking exhaustiveness.
 *
 * @example
 *   import { withMixin, getMixin, hasMixin } from '@classytic/primitives/mixin';
 *
 *   interface Contact { id: string; name: string; mixins?: Record<string, unknown>; }
 *   interface CustomerFacts { lifetimeValue: number; firstOrderAt: Date; }
 *
 *   const c: Contact = { id: 'c1', name: 'Acme' };
 *   const enriched = withMixin<Contact, 'customer', CustomerFacts>(c, 'customer', {
 *     lifetimeValue: 9200,
 *     firstOrderAt: new Date('2024-09-12'),
 *   });
 *
 *   getMixin<CustomerFacts>(enriched, 'customer')?.lifetimeValue; // 9200
 *   hasMixin(enriched, 'customer');                               // true
 *
 *   // Domain stays exhaustive — the base type didn't change, only the
 *   // optional `mixins` namespace did.
 */

/**
 * Marker interface — entities that participate in the mixin protocol declare
 * `mixins?: Mixinable['mixins']`. Hosts can opt in retroactively by widening
 * their existing types via intersection.
 */
export interface Mixinable {
  readonly mixins?: Readonly<Record<string, unknown>>;
}

/**
 * Result type: the base `T` with `mixins[K]` typed as `M`. The intersection
 * keeps callers exhaustive over the original entity while exposing the
 * mixin payload through a well-typed accessor.
 */
export type WithMixin<T, K extends string, M> = T & {
  readonly mixins: Readonly<Record<string, unknown>> & { readonly [P in K]: M };
};

/**
 * Attach (or overwrite) a mixin on a base entity. Returns a NEW object —
 * never mutates. The other mixins on the entity are preserved by spread.
 *
 * Type-level: caller picks the mixin key and the mixin payload shape; we
 * intersect them into the return type so chained reads stay precise.
 */
export function withMixin<T extends Mixinable, K extends string, M>(
  base: T,
  key: K,
  data: M,
): WithMixin<T, K, M> {
  return {
    ...base,
    mixins: {
      ...(base.mixins ?? {}),
      [key]: data,
    },
  } as WithMixin<T, K, M>;
}

/**
 * Pull a mixin payload off an entity by key. Returns `null` (not `undefined`)
 * so call sites can use `??` to fall through to a default without ambiguity
 * with a real `undefined` field on the payload itself.
 */
export function getMixin<M>(entity: Mixinable, key: string): M | null {
  if (entity.mixins === undefined || entity.mixins === null) return null;
  const found = entity.mixins[key];
  return found === undefined ? null : (found as M);
}

/** Cheap presence check — useful for `if (hasMixin(c, 'customer')) …` branches. */
export function hasMixin(entity: Mixinable, key: string): boolean {
  return entity.mixins !== undefined && entity.mixins !== null && entity.mixins[key] !== undefined;
}

/**
 * Remove a mixin. Returns a new entity. No-op if the mixin isn't present.
 * Useful for migrations / GDPR scrubs ("remove `customer` payload but keep
 * the base `Contact` row").
 */
export function withoutMixin<T extends Mixinable>(entity: T, key: string): T {
  if (!hasMixin(entity, key)) return entity;
  const next: Record<string, unknown> = { ...entity.mixins };
  delete next[key];
  return { ...entity, mixins: next } as T;
}
