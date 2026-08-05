/**
 * Idempotency claim + lease — the CONTRACT, not the store.
 *
 * ## Why this exists
 *
 * Every module that accepts a command needs to answer the same three-part
 * question when a key arrives: *have I seen this, am I still working on it, or
 * is this the first time?* Three kernels already answer it, incompatibly:
 *
 * | package | states | lease | replay |
 * |---|---|---|---|
 * | `@classytic/cart` | `in_flight` / `succeeded` / `failed` | yes — token + expiry | inline or pointer |
 * | `@classytic/catalog` (offers) | `pending` / `completed` | **no** | serialized string |
 * | `@classytic/contract` (amendments) | implicit — `claimedAt` + `attempts` | partial | none |
 *
 * Only the first models the crash window. The second cannot distinguish "still
 * running" from "crashed mid-write", so a retry either blocks forever on a dead
 * `pending` row or re-applies the mutation — and neither outcome errors. The
 * third has no state at all.
 *
 * Left alone, every spine module that accepts a command invents a fourth shape.
 * This module is the shared vocabulary: types plus PURE state functions. It
 * owns no collection, no index, no driver — the adapter that persists a claim
 * is the caller's.
 *
 * ## The three-valued outcome is the point
 *
 * {@link ClaimOutcome} is `claimed | replayed | in_flight`, and **`in_flight` is
 * not a failure.** A concurrent attempt holding a live lease means the answer is
 * *not yet known*, exactly like a provider timeout: the work may be about to
 * succeed. Mapping it onto an error licenses the caller to retry the mutation,
 * and if the first attempt lands that is a double-apply — the same asymmetry
 * that makes `unknown` a required payment outcome. The correct handling is to
 * wait out {@link InFlightDecision.retryAfterMs} and ask again, never to
 * re-execute.
 *
 * ## Two identifiers that must not be confused
 *
 * - **`key`** — caller-supplied, STABLE across retries of one logical command.
 *   Derive it deterministically; a random fallback defeats deduplication while
 *   looking correctly wired.
 * - **`leaseToken`** — minted fresh per ATTEMPT, and deliberately random. It
 *   answers "am I still the attempt that owns this claim?", so two attempts
 *   must never mint the same one. Deriving it would make a takeover
 *   indistinguishable from the attempt it replaced.
 */

import { canonicalDigest, canonicalJson } from '../serialization/canonical.js';

/** Default crash-window lease, matching `@classytic/cart`'s proven 30s. */
export const DEFAULT_LEASE_MS = 30_000;

/**
 * Persisted state of a claim.
 *
 * `failed` is TERMINAL and replayable: a command that failed deterministically
 * must fail the same way on retry, or the caller learns a different answer to
 * the same question. It is not a licence to re-execute.
 */
export type ClaimState = 'in_flight' | 'succeeded' | 'failed';

/**
 * What a claim attempt is allowed to do next.
 *
 * - `claimed` — this attempt owns the claim; EXECUTE the command.
 * - `replayed` — a terminal record exists; RETURN its stored result, execute nothing.
 * - `in_flight` — another live attempt owns it; WAIT and re-ask. **Not a failure.**
 */
export type ClaimOutcome = 'claimed' | 'replayed' | 'in_flight';

/** The stored outcome of a completed command — replayed verbatim to retries. */
export type ClaimResult<TValue = unknown> =
  | { readonly status: 'succeeded'; readonly value: TValue }
  | { readonly status: 'failed'; readonly error: ClaimError };

/**
 * A replayable failure. `code` is a CLOSED host vocabulary, never a raw vendor
 * string — this value is persisted and returned to callers.
 */
export interface ClaimError {
  readonly code: string;
  readonly message: string;
}

/**
 * The composite identity of a claim.
 *
 * `key` alone is not the identity. Two different operations must never share a
 * key, and a key issued for one aggregate/actor must not satisfy a command
 * against another — so the operation and any scoping segments are part of what
 * the unique index covers. `@classytic/cart` learned this as
 * `(organizationId, cartRef, operation, actorRef, idempotencyKey)`.
 */
export interface IdempotencyIdentity {
  /** The command this key was issued for — `'checkout.finalize'`, `'purchase.pay'`. */
  readonly operation: string;
  /** Caller-supplied key, stable across retries of the SAME logical command. */
  readonly key: string;
  /** Scoping segments — organizationId, aggregate ref, actor ref. */
  readonly scope?: Readonly<Record<string, string>>;
}

/**
 * A claim record. The adapter persists exactly these fields (plus whatever it
 * needs for TTL), with a unique index over {@link IdempotencyIdentity}.
 */
export interface IdempotencyClaim<TValue = unknown> {
  readonly identity: IdempotencyIdentity;
  /**
   * Digest of the request body this key was first used with. A retry that
   * presents the same key with a DIFFERENT body is not a retry — see
   * {@link decideClaim}.
   */
  readonly requestFingerprint: string;
  readonly state: ClaimState;
  /** Which ATTEMPT currently owns the claim. Rotates on takeover. */
  readonly leaseToken: string;
  /** After this instant the lease is dead and another attempt may take over. */
  readonly leaseExpiresAt: Date;
  readonly createdAt: Date;
  /** Set when `state` becomes terminal. */
  readonly completedAt?: Date;
  /** Present iff `state` is terminal. Absent on `in_flight`. */
  readonly result?: ClaimResult<TValue>;
  /** Monotonic attempt counter — each successful takeover increments it. */
  readonly attempts: number;
}

export type IdempotencyErrorCode =
  /** Same key, different request body. Never a retry — two commands sharing one key. */
  | 'FINGERPRINT_MISMATCH'
  /** A terminal claim carrying no stored result. Unreplayable; must not answer "ok". */
  | 'MISSING_REPLAY'
  /** The attempt no longer owns the lease — another attempt took over. */
  | 'LEASE_LOST'
  /** Completing / renewing a claim that already reached a terminal state. */
  | 'ALREADY_TERMINAL'
  /** Malformed input (empty key, non-positive lease, invalid instant). */
  | 'INVALID_CLAIM';

export class IdempotencyError extends Error {
  override readonly name = 'IdempotencyError';
  readonly code: IdempotencyErrorCode;

  constructor(code: IdempotencyErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Identity + fingerprint
// ─────────────────────────────────────────────────────────────────────────

/**
 * The deterministic string form of an identity — safe as a single unique-index
 * key when a compound index is not available.
 *
 * Built with canonical JSON rather than `join(':')`: a delimiter-joined
 * composite lets `{ ref: 'a:b', actor: 'c' }` and `{ ref: 'a', actor: 'b:c' }`
 * produce the SAME key, which silently makes one caller's claim satisfy
 * another's command.
 */
export function identityKey(identity: IdempotencyIdentity): string {
  assertNonEmpty(identity.operation, 'identity.operation');
  assertNonEmpty(identity.key, 'identity.key');
  return canonicalJson({
    operation: identity.operation,
    key: identity.key,
    scope: identity.scope ?? {},
  });
}

/** True when two identities address the same claim. */
export function sameIdentity(a: IdempotencyIdentity, b: IdempotencyIdentity): boolean {
  return identityKey(a) === identityKey(b);
}

/**
 * Fingerprint a request body — `sha256(canonicalJson(body))`.
 *
 * Deterministic and key-order independent, so a client that reserializes its
 * body does not read as a different request. Use the WHOLE body that decides
 * the mutation; fingerprinting a subset means two genuinely different commands
 * share a fingerprint and one silently replays the other's result.
 */
export function fingerprintRequest(body: unknown): string {
  return canonicalDigest(body);
}

// ─────────────────────────────────────────────────────────────────────────
// Lease
// ─────────────────────────────────────────────────────────────────────────

/**
 * Mint a lease token for ONE attempt.
 *
 * Random on purpose — see the module docblock. This is the one identifier in
 * the idempotency contract that must NOT be derived.
 */
export function newLeaseToken(): string {
  const c = globalThis.crypto as { randomUUID?: () => string } | undefined;
  if (typeof c?.randomUUID === 'function') return c.randomUUID();
  return `lease_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
}

/** Has the crash-window lease lapsed at `now`? Expiry is exclusive of `now`. */
export function isLeaseExpired(claim: IdempotencyClaim<unknown>, now: Date): boolean {
  return now.getTime() >= claim.leaseExpiresAt.getTime();
}

/** Does `leaseToken` still own this claim at `now`? */
export function holdsLease(
  claim: IdempotencyClaim<unknown>,
  leaseToken: string,
  now: Date,
): boolean {
  return claim.leaseToken === leaseToken && !isLeaseExpired(claim, now);
}

// ─────────────────────────────────────────────────────────────────────────
// The decision
// ─────────────────────────────────────────────────────────────────────────

export interface ClaimRequest {
  readonly identity: IdempotencyIdentity;
  readonly requestFingerprint: string;
  /** Injected clock — no ambient `new Date()`, so the crash window is testable. */
  readonly now: Date;
  /** Injected token for THIS attempt — see {@link newLeaseToken}. */
  readonly leaseToken: string;
  /** Crash-window length. Default {@link DEFAULT_LEASE_MS}. */
  readonly leaseMs?: number;
}

/** This attempt owns the claim and must EXECUTE the command. */
export interface ClaimedDecision<TValue> {
  readonly outcome: 'claimed';
  readonly claim: IdempotencyClaim<TValue>;
  /**
   * Present when this claim took over a lapsed lease — the dead attempt's
   * token. Persist the takeover as a CONDITIONAL update on that token so two
   * simultaneous takeovers cannot both win.
   */
  readonly tookOverFrom?: string;
}

/** A terminal record exists: RETURN its result, execute nothing. */
export interface ReplayedDecision<TValue> {
  readonly outcome: 'replayed';
  readonly claim: IdempotencyClaim<TValue>;
  readonly result: ClaimResult<TValue>;
}

/**
 * Another attempt holds a live lease. **Not a failure** — the answer is not yet
 * known. Wait `retryAfterMs` and re-ask; never re-execute.
 */
export interface InFlightDecision<TValue> {
  readonly outcome: 'in_flight';
  readonly claim: IdempotencyClaim<TValue>;
  /** How long until the incumbent's lease lapses. Always > 0. */
  readonly retryAfterMs: number;
}

export type ClaimDecision<TValue = unknown> =
  | ClaimedDecision<TValue>
  | ReplayedDecision<TValue>
  | InFlightDecision<TValue>;

/**
 * The whole state machine, as one pure function.
 *
 * | stored state | lease | decision |
 * |---|---|---|
 * | (none) | — | `claimed` — fresh claim |
 * | `in_flight` | live | `in_flight` — wait, do NOT execute |
 * | `in_flight` | lapsed | `claimed` — takeover, `tookOverFrom` set |
 * | `succeeded` / `failed` | — | `replayed` — return the stored result |
 *
 * Two conditions throw rather than returning a decision, because both mean the
 * question itself was wrong:
 *
 * - **`FINGERPRINT_MISMATCH`** — the same key with a different body. That is
 *   two commands, not one retried command; answering either way is wrong.
 *   Surface it as a 4xx (Stripe returns 400 here), never as a fresh claim.
 * - **`MISSING_REPLAY`** — a terminal record with no stored result. There is
 *   nothing to replay, and inventing an empty success is precisely the silent
 *   permissive default this codebase keeps getting bitten by.
 */
export function decideClaim<TValue = unknown>(
  existing: IdempotencyClaim<TValue> | null | undefined,
  request: ClaimRequest,
): ClaimDecision<TValue> {
  assertNonEmpty(request.requestFingerprint, 'request.requestFingerprint');
  assertNonEmpty(request.leaseToken, 'request.leaseToken');
  assertInstant(request.now, 'request.now');
  const leaseMs = request.leaseMs ?? DEFAULT_LEASE_MS;
  if (!Number.isFinite(leaseMs) || leaseMs <= 0) {
    throw new IdempotencyError(
      'INVALID_CLAIM',
      `leaseMs must be a positive number of milliseconds, got ${String(request.leaseMs)} — ` +
        'a zero or negative lease is instantly expired, so every concurrent attempt takes over and executes.',
    );
  }

  if (existing == null) {
    return { outcome: 'claimed', claim: mintClaim<TValue>(request, leaseMs, 1) };
  }

  if (existing.requestFingerprint !== request.requestFingerprint) {
    throw new IdempotencyError(
      'FINGERPRINT_MISMATCH',
      `Idempotency key '${existing.identity.key}' was first used with a different request body ` +
        `(stored ${existing.requestFingerprint.slice(0, 12)}…, presented ${request.requestFingerprint.slice(0, 12)}…). ` +
        'Two distinct commands are sharing one key — replaying the first would return the wrong result, and claiming afresh would apply the second under a key already spent.',
    );
  }

  if (existing.state === 'succeeded' || existing.state === 'failed') {
    if (existing.result === undefined) {
      throw new IdempotencyError(
        'MISSING_REPLAY',
        `Claim '${existing.identity.key}' is terminal (${existing.state}) but stores no result, so the retry cannot be answered. ` +
          'Reporting success here would fabricate an outcome that was never observed.',
      );
    }
    return { outcome: 'replayed', claim: existing, result: existing.result };
  }

  if (!isLeaseExpired(existing, request.now)) {
    return {
      outcome: 'in_flight',
      claim: existing,
      retryAfterMs: existing.leaseExpiresAt.getTime() - request.now.getTime(),
    };
  }

  return {
    outcome: 'claimed',
    claim: {
      ...mintClaim<TValue>(request, leaseMs, existing.attempts + 1),
      createdAt: existing.createdAt,
    },
    tookOverFrom: existing.leaseToken,
  };
}

function mintClaim<TValue>(
  request: ClaimRequest,
  leaseMs: number,
  attempts: number,
): IdempotencyClaim<TValue> {
  identityKey(request.identity); // validates operation + key are non-empty
  return {
    identity: request.identity,
    requestFingerprint: request.requestFingerprint,
    state: 'in_flight',
    leaseToken: request.leaseToken,
    leaseExpiresAt: new Date(request.now.getTime() + leaseMs),
    createdAt: request.now,
    attempts,
  };
}

/**
 * Extend a live lease — for a command that legitimately outruns the crash
 * window. Throws `LEASE_LOST` when the caller no longer owns the claim, so a
 * superseded attempt cannot silently keep working and then write its result
 * over the winner's.
 */
export function renewLease<TValue>(
  claim: IdempotencyClaim<TValue>,
  input: { readonly leaseToken: string; readonly now: Date; readonly leaseMs?: number },
): IdempotencyClaim<TValue> {
  assertInstant(input.now, 'now');
  if (claim.state !== 'in_flight') {
    throw new IdempotencyError('ALREADY_TERMINAL', `cannot renew a ${claim.state} claim`);
  }
  if (!holdsLease(claim, input.leaseToken, input.now)) {
    throw new IdempotencyError(
      'LEASE_LOST',
      `lease token does not own this claim at ${input.now.toISOString()} (expired or taken over) — ` +
        'continuing would let two attempts believe they are the live one.',
    );
  }
  return {
    ...claim,
    leaseExpiresAt: new Date(input.now.getTime() + (input.leaseMs ?? DEFAULT_LEASE_MS)),
  };
}

/**
 * Move a claim to a terminal state with the result retries will replay.
 *
 * The lease check is the important part: an attempt whose lease lapsed and was
 * taken over must NOT write its result. Without it, the slow attempt's answer
 * overwrites the takeover's, and every subsequent retry replays an outcome that
 * does not match what was actually applied.
 */
export function completeClaim<TValue>(
  claim: IdempotencyClaim<TValue>,
  input: {
    readonly leaseToken: string;
    readonly now: Date;
    readonly result: ClaimResult<TValue>;
  },
): IdempotencyClaim<TValue> {
  assertInstant(input.now, 'now');
  if (claim.state !== 'in_flight') {
    throw new IdempotencyError(
      'ALREADY_TERMINAL',
      `claim is already ${claim.state}; completing it again would replace a result that retries may already have replayed.`,
    );
  }
  if (claim.leaseToken !== input.leaseToken) {
    throw new IdempotencyError(
      'LEASE_LOST',
      'lease token does not own this claim — another attempt took it over, and writing this result would overwrite theirs.',
    );
  }
  return {
    ...claim,
    state: input.result.status,
    result: input.result,
    completedAt: input.now,
  };
}

/**
 * Narrowing helper for the one outcome callers keep getting wrong.
 *
 * `in_flight` is neither success nor failure. Route it to a 409 + `Retry-After`
 * (or an internal wait), never to the command's error path.
 */
export function isInFlight<TValue>(
  decision: ClaimDecision<TValue>,
): decision is InFlightDecision<TValue> {
  return decision.outcome === 'in_flight';
}

function assertNonEmpty(value: unknown, label: string): void {
  if (typeof value !== 'string' || value.length === 0) {
    throw new IdempotencyError(
      'INVALID_CLAIM',
      `${label} must be a non-empty string, got ${String(value)}`,
    );
  }
}

function assertInstant(value: unknown, label: string): void {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new IdempotencyError(
      'INVALID_CLAIM',
      `${label} must be a valid Date, got ${String(value)}`,
    );
  }
}
