/**
 * OTP challenge — the pure, secure *verify* half of one-time-code verification.
 *
 * This primitive owns SECURITY, never delivery. Delivery (SMS / email / push /
 * WhatsApp, templates, retry, fallback) is `@classytic/notifications`; the host
 * passes the returned `code` to whichever channel/provider it likes. This file
 * only guarantees the code cannot be forged, replayed, brute-forced, or leaked:
 *
 *   - the plaintext code is NEVER persisted — only its HMAC-SHA256 digest is
 *     (a stolen challenge row cannot reveal the code);
 *   - comparison is constant-time (`timingSafeEqual`) — no timing oracle;
 *   - the code is drawn from a CSPRNG with rejection-free `randomInt` — no
 *     modulo bias;
 *   - a bounded attempt counter locks the challenge — no online brute force;
 *   - a TTL expires the challenge — no indefinite window;
 *   - a verified challenge is single-use — no replay.
 *
 * The shape is a plain value object: create it, persist `challenge`, and on each
 * attempt feed the stored challenge back through `verifyOtpChallenge` and persist
 * the returned next state. No I/O, no clock capture beyond an injectable `now`.
 *
 * Resend throttling (don't mint a new code too soon) is a host / arc-layer
 * concern — rate-limit calls to `createOtpChallenge`; it is deliberately not
 * modeled here so the verify primitive stays stateless between attempts.
 */

import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';

/** Terminal + in-flight states a persisted challenge can hold. */
export type OtpStatus = 'pending' | 'verified' | 'failed' | 'expired';

/** The result of a single `verifyOtpChallenge` call. */
export type OtpOutcome = 'verified' | 'incorrect' | 'expired' | 'locked' | 'already_used';

/**
 * The persistable challenge. Contains no secret material: `hash` is an HMAC of
 * the code under a server-side `secret`, so the row is useless to a thief who
 * lacks the secret. Persist this verbatim; never add the plaintext code to it.
 */
export interface OtpChallenge {
  /** HMAC-SHA256(code, secret) as hex. The plaintext code is never stored. */
  readonly hash: string;
  /** ISO-8601 instant after which the challenge is dead. */
  readonly expiresAt: string;
  /** Failed attempts so far. */
  readonly attempts: number;
  /** Attempts allowed before the challenge locks (`failed`). */
  readonly maxAttempts: number;
  /** Lifecycle state. */
  readonly status: OtpStatus;
}

export interface CreateOtpOptions {
  /** Server-side HMAC key. Required — a challenge with no secret is forgeable. */
  readonly secret: string;
  /** Number of digits in the code. Default 6. */
  readonly length?: number;
  /** Time-to-live in ms. Default 5 minutes. */
  readonly ttlMs?: number;
  /** Failed attempts before lock. Default 5. */
  readonly maxAttempts?: number;
  /** Injectable clock for deterministic tests. Default `new Date()`. */
  readonly now?: Date;
}

export interface CreatedOtp {
  /** Persist this. Contains only the HMAC digest, never the code. */
  readonly challenge: OtpChallenge;
  /** Deliver this via `@classytic/notifications`. NEVER persist it. */
  readonly code: string;
}

export interface VerifyOtpOptions {
  /** The same server-side HMAC key used at creation. */
  readonly secret: string;
  /** Injectable clock for deterministic tests. Default `new Date()`. */
  readonly now?: Date;
}

export interface OtpVerification {
  /** The next challenge state to persist (attempt count / status advanced). */
  readonly challenge: OtpChallenge;
  /** What happened on this attempt. */
  readonly outcome: OtpOutcome;
}

const DEFAULT_LENGTH = 6;
const DEFAULT_TTL_MS = 5 * 60 * 1000;
const DEFAULT_MAX_ATTEMPTS = 5;

function hmac(code: string, secret: string): string {
  return createHmac('sha256', secret).update(code).digest('hex');
}

/** CSPRNG numeric code with no modulo bias (`randomInt` rejection-samples). */
function generateCode(length: number): string {
  let code = '';
  for (let i = 0; i < length; i += 1) {
    code += randomInt(0, 10).toString();
  }
  return code;
}

/** Constant-time compare of two equal-length hex digests. */
function constantTimeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  // `timingSafeEqual` throws on length mismatch; our digests are always 32 bytes,
  // but guard anyway so a malformed stored hash can never leak via an exception.
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/**
 * Mint a challenge + its one-time code. Persist `challenge`; hand `code` to the
 * delivery layer. The code exists only in this return value and in the delivered
 * message — it is never recoverable from the persisted challenge.
 */
export function createOtpChallenge(options: CreateOtpOptions): CreatedOtp {
  if (!options.secret) {
    throw new Error('[otp] a `secret` is required to HMAC the code.');
  }
  const length = options.length ?? DEFAULT_LENGTH;
  if (length < 4) {
    throw new Error('[otp] `length` must be at least 4 digits.');
  }
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  if (ttlMs <= 0) {
    throw new Error('[otp] `ttlMs` must be positive.');
  }
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  if (maxAttempts < 1) {
    throw new Error('[otp] `maxAttempts` must be at least 1.');
  }
  const now = options.now ?? new Date();
  const code = generateCode(length);

  return {
    code,
    challenge: {
      hash: hmac(code, options.secret),
      expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
      attempts: 0,
      maxAttempts,
      status: 'pending',
    },
  };
}

/**
 * Check `input` against a persisted challenge and return the next state. This is
 * a pure transition — the caller persists `result.challenge`. Fail-closed: any
 * non-`pending` challenge, an expired window, or an over-limit attempt yields a
 * non-`verified` outcome and never re-opens a settled challenge.
 */
export function verifyOtpChallenge(
  challenge: OtpChallenge,
  input: string,
  options: VerifyOtpOptions,
): OtpVerification {
  if (!options.secret) {
    throw new Error('[otp] a `secret` is required to verify the code.');
  }

  // Settled challenges never re-open — single-use + lock are terminal.
  if (challenge.status === 'verified') {
    return { challenge, outcome: 'already_used' };
  }
  if (challenge.status === 'failed') {
    return { challenge, outcome: 'locked' };
  }
  if (challenge.status === 'expired') {
    return { challenge, outcome: 'expired' };
  }

  const now = options.now ?? new Date();
  if (now.getTime() > Date.parse(challenge.expiresAt)) {
    return { challenge: { ...challenge, status: 'expired' }, outcome: 'expired' };
  }

  // Constant-time HMAC compare — a wrong code reveals nothing via timing.
  if (constantTimeEqualHex(hmac(input, options.secret), challenge.hash)) {
    return { challenge: { ...challenge, status: 'verified' }, outcome: 'verified' };
  }

  const attempts = challenge.attempts + 1;
  if (attempts >= challenge.maxAttempts) {
    return { challenge: { ...challenge, attempts, status: 'failed' }, outcome: 'locked' };
  }
  return { challenge: { ...challenge, attempts }, outcome: 'incorrect' };
}

/** True once a challenge has been successfully verified. */
export function isOtpVerified(challenge: OtpChallenge): boolean {
  return challenge.status === 'verified';
}

/** True while a challenge can still accept an attempt (pending + unexpired). */
export function isOtpActive(challenge: OtpChallenge, now: Date = new Date()): boolean {
  return challenge.status === 'pending' && now.getTime() <= Date.parse(challenge.expiresAt);
}
