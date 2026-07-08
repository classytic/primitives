/**
 * Identity-verification (eKYC) data shapes — the cross-package vocabulary
 * every verification provider (Sumsub, Persona, Onfido, Stripe Identity,
 * Porichoy/NID, Shufti, manual review, …) speaks when exchanging data with
 * an identity engine.
 *
 * The **identity twin of `payment-gateway`**: shapes here, contracts in the
 * consuming engines, provider implementations anywhere. One vocabulary serves
 * three consumers across the stack —
 *
 *   - `@classytic/esign`  — WHO is signing (the `IdentityBridge` port).
 *   - `@classytic/payee`  — KYC of a payout recipient (the `ComplianceBridge`).
 *   - a payment gateway / PSP — KYC of a MERCHANT before settlement.
 *
 * Anchored on `PersonName` from `@classytic/primitives/person`. Pure data:
 * zero runtime, zero classes, zero deps beyond sibling primitives.
 *
 * @example A minimal Porichoy (BD NID) provider
 * ```ts
 * import type {
 *   CreateVerificationParams, VerificationSession,
 * } from '@classytic/primitives/identity-verification';
 *
 * export class PorichoyProvider {
 *   readonly name = 'porichoy';
 *   async startVerification(p: CreateVerificationParams): Promise<VerificationSession> {
 *     const res = await porichoy.verifyNid({ nid: p.documents?.[0]?.number, dob: p.subject.dateOfBirth });
 *     return { id: res.reference, provider: 'porichoy', level: p.level,
 *       status: res.matched ? 'verified' : 'rejected', checks: [
 *         { check: 'database', outcome: res.matched ? 'pass' : 'fail' },
 *       ], raw: res };
 *   }
 * }
 * ```
 */

import type { PersonName } from './person.js';

// ─── Documents & checks ──────────────────────────────────────────────────────

/**
 * Government / institutional identity documents. `trade_license` and
 * `tin_certificate` support MERCHANT (business) onboarding — a payment gateway
 * KYBs the business, not just a person.
 */
export type IdentityDocumentType =
  | 'nid' // national ID (BD NID, Aadhaar, …)
  | 'passport'
  | 'driving_license'
  | 'birth_certificate'
  | 'residence_permit'
  | 'trade_license' // business (KYB)
  | 'tin_certificate' // business (KYB)
  | 'other';

/** A single verification check a session can run. Providers advertise support. */
export type VerificationCheck =
  | 'document' // document authenticity / OCR
  | 'liveness' // active/passive liveness
  | 'face_match' // selfie ↔ document photo
  | 'database' // authoritative source lookup (NID DB, DVS, …)
  | 'address' // proof-of-address
  | 'sanctions' // sanctions/watchlist screening
  | 'pep' // politically-exposed-person screening
  | 'adverse_media';

/**
 * Assurance tier — mirrors the market (Stripe Identity / Persona levels).
 * Higher tiers imply a superset of checks; the exact mapping is host policy.
 */
export type VerificationLevel = 'basic' | 'standard' | 'enhanced';

/** The kind of subject under verification — a natural person or a business. */
export type SubjectKind = 'individual' | 'business';

export interface DocumentReference {
  readonly type: IdentityDocumentType;
  /** Document number (NID/passport no.). May be redacted/tokenized at rest. */
  readonly number?: string;
  /** ISO 3166-1 alpha-2 issuing country. */
  readonly country?: string;
  /** ISO date (YYYY-MM-DD). */
  readonly expiresOn?: string;
}

export interface IdentitySubject {
  readonly kind: SubjectKind;
  readonly name?: PersonName;
  /** Legal/business name when `kind === 'business'`. */
  readonly legalName?: string;
  /** ISO date (YYYY-MM-DD). */
  readonly dateOfBirth?: string;
  /** ISO 3166-1 alpha-2. */
  readonly country?: string;
}

// ─── Provider capabilities ───────────────────────────────────────────────────

export interface IdentityProviderCapabilities {
  readonly checks: readonly VerificationCheck[];
  readonly documents: readonly IdentityDocumentType[];
  /** ISO 3166-1 alpha-2 codes; empty ⇒ global. */
  readonly countries: readonly string[];
  /** Delivers async results via webhook (vs poll-only). */
  readonly webhooks: boolean;
  /** Supports business/KYB flows, not just individuals. */
  readonly business: boolean;
}

// ─── Session lifecycle ───────────────────────────────────────────────────────

export type VerificationStatus =
  | 'pending' // created, awaiting subject action
  | 'processing' // provider is evaluating
  | 'verified' // passed
  | 'rejected' // failed
  | 'review' // needs manual review
  | 'expired'; // session or credential lapsed

export type CheckOutcome = 'pass' | 'fail' | 'manual' | 'skipped';

export interface CheckResult {
  readonly check: VerificationCheck;
  readonly outcome: CheckOutcome;
  /** Provider-specific reason/code for a fail/manual outcome. */
  readonly reason?: string;
}

export interface CreateVerificationParams {
  readonly subject: IdentitySubject;
  readonly level: VerificationLevel;
  /** Checks the host requires to consider the subject verified. */
  readonly requiredChecks?: readonly VerificationCheck[];
  readonly documents?: readonly DocumentReference[];
  /** Where the provider redirects the subject after a hosted flow. */
  readonly redirectUrl?: string;
  /** Correlates the session back to a host entity (payee id, signer id, …). */
  readonly reference?: string;
  readonly metadata?: Readonly<Record<string, string>>;
}

export interface VerificationSession {
  /** Provider-side session id — the handle a host stores and polls. */
  readonly id: string;
  readonly provider: string;
  readonly level: VerificationLevel;
  readonly status: VerificationStatus;
  readonly checks: readonly CheckResult[];
  /** Hosted-flow URL for the subject, when the provider uses one. */
  readonly url?: string;
  readonly reference?: string;
  /** ISO timestamp the verification was decided. */
  readonly decidedAt?: string;
  /**
   * ISO timestamp the verification lapses and re-KYC is required. Periodic
   * re-KYC is an AML requirement; consumers gate on this (payee pauses
   * payability, esign re-verifies before signing).
   */
  readonly expiresAt?: string;
  /** Raw provider payload for audit/debugging. */
  readonly raw?: unknown;
}

/** Normalized provider webhook — the async-decision callback shape. */
export interface VerificationWebhookEvent {
  readonly sessionId: string;
  readonly provider: string;
  readonly status: VerificationStatus;
  readonly checks?: readonly CheckResult[];
  readonly occurredAt: string;
  readonly raw?: unknown;
}

// ─── Pure helpers (zero-dep, deterministic) ──────────────────────────────────

/** A session is usable when it passed and has not lapsed at `now`. */
export function isVerified(session: VerificationSession, now?: Date): boolean {
  if (session.status !== 'verified') return false;
  if (!session.expiresAt) return true;
  const at = (now ?? new Date()).toISOString();
  return session.expiresAt > at;
}

/**
 * Do the check RESULTS satisfy the REQUIRED checks? Every required check must
 * have a `pass`. Missing or non-pass required checks ⇒ false. Extra results
 * are ignored.
 */
export function checksSatisfy(
  required: readonly VerificationCheck[],
  results: readonly CheckResult[],
): boolean {
  const passed = new Set(results.filter((r) => r.outcome === 'pass').map((r) => r.check));
  return required.every((c) => passed.has(c));
}

/**
 * Derive a session status from check results alone (for providers that return
 * raw checks without a verdict): any `fail` ⇒ rejected; any `manual` ⇒ review;
 * all required present and `pass` ⇒ verified; otherwise processing.
 */
export function deriveStatus(
  results: readonly CheckResult[],
  required: readonly VerificationCheck[] = [],
): VerificationStatus {
  if (results.some((r) => r.outcome === 'fail')) return 'rejected';
  if (results.some((r) => r.outcome === 'manual')) return 'review';
  if (required.length > 0 && checksSatisfy(required, results)) return 'verified';
  return 'processing';
}
