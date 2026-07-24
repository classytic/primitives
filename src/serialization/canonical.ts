/**
 * `@classytic/primitives/canonical` — strict, deterministic JSON canonicalization
 * + a SHA-256 hex helper.
 *
 * Cross-domain vocabulary: any subsystem that needs a STABLE checksum of
 * structured data (a cleanup plan/manifest, a financial-close evidence
 * manifest, an audit seal) canonicalizes here so the digest is:
 *
 *   - invariant to object key insertion order (keys sorted recursively);
 *   - explicit about `Date` (serialized as `{"$date":"<iso>"}`), so timestamps
 *     actually participate in the digest instead of collapsing to `{}` the way
 *     a naive `JSON.stringify` of a `Date`-bearing object would; and
 *   - STRICT — ambiguous / non-portable values (`undefined`, `NaN`/`Infinity`,
 *     `BigInt`, `function`, `symbol`, `Map`, `Set`, cyclic refs) are REJECTED
 *     with a `CanonicalizeError` rather than silently mis-hashed.
 *
 * These are integrity CHECKSUMS (accidental-corruption + drift detection), NOT
 * tamper-proof seals: plain SHA-256 does not stop an actor with write access
 * from replacing a record and recomputing its digest. Pair with access control
 * / keyed signatures where that matters.
 *
 * `node:crypto` is used directly (precedent: `@classytic/primitives/identity`
 * OTP already imports `node:crypto`); the zero-runtime-dependency policy covers
 * third-party deps, not Node built-ins.
 */

import { createHash } from 'node:crypto';

export class CanonicalizeError extends Error {
  constructor(message: string) {
    super(`canonicalize: ${message}`);
    this.name = 'CanonicalizeError';
  }
}

function canonicalize(value: unknown, seen: WeakSet<object>): string {
  if (value === null) return 'null';

  const t = typeof value;
  if (t === 'string') return JSON.stringify(value);
  if (t === 'boolean') return value ? 'true' : 'false';
  if (t === 'number') {
    if (!Number.isFinite(value as number)) {
      throw new CanonicalizeError(`non-finite number ${String(value)}`);
    }
    return JSON.stringify(value);
  }
  if (t === 'undefined') throw new CanonicalizeError('undefined is not serializable');
  if (t === 'bigint') throw new CanonicalizeError('bigint is not serializable');
  if (t === 'function' || t === 'symbol') throw new CanonicalizeError(`${t} is not serializable`);

  // Objects
  if (value instanceof Date) {
    const time = value.getTime();
    if (Number.isNaN(time)) throw new CanonicalizeError('invalid Date');
    return `{"$date":${JSON.stringify(value.toISOString())}}`;
  }
  if (value instanceof Map || value instanceof Set) {
    throw new CanonicalizeError(
      `${value.constructor.name} is not supported — use a plain object/array`,
    );
  }

  const obj = value as object;
  if (seen.has(obj)) throw new CanonicalizeError('cyclic reference');
  seen.add(obj);
  try {
    if (Array.isArray(value)) {
      return `[${value.map((v) => canonicalize(v, seen)).join(',')}]`;
    }
    const rec = value as Record<string, unknown>;
    const keys = Object.keys(rec).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(rec[k], seen)}`).join(',')}}`;
  } finally {
    seen.delete(obj);
  }
}

/**
 * Strict canonical JSON string of any value. Deterministic (sorted keys),
 * `Date`-explicit; throws {@link CanonicalizeError} on unsupported/ambiguous
 * input. Arrays keep their order (semantically meaningful).
 */
export function canonicalJson(value: unknown): string {
  return canonicalize(value, new WeakSet());
}

/** `sha256(input)` as a lowercase hex digest. */
export function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

/** Convenience: `sha256Hex(canonicalJson(value))` — the integrity digest of a value. */
export function canonicalDigest(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}
