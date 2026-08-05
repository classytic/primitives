/**
 * Payment domain event payload contracts.
 *
 * Shared across every payment-aware package (`@classytic/invoice`,
 * `@classytic/revenue`, `@classytic/order`, future POS / AP /
 * subscription packages). Each package publishes / consumes these
 * payloads via the standard `DomainEvent<T>` envelope and
 * `EventTransport` defined in `./events.ts`.
 *
 * **Wire contract only.** Pure TS payload types — no Zod, no class,
 * no runtime. Packages that need runtime validation (e.g. revenue's
 * event catalog) wrap these with their own validators. Type identity
 * across packages guarantees compile-time alignment regardless.
 *
 * Causation + correlation live on `EventMeta` (the envelope), never on
 * the payload — populate via {@link createChildEvent}. Payloads carry
 * only domain facts about what happened to the payment.
 *
 * Anchored on `Money` (integer minor units) and `PaymentMethodKind`
 * from `@classytic/primitives/money`. Same precision and vocabulary
 * discipline used everywhere else in the package family.
 */

import type { Money } from '../money/money.js';
import type { ProviderUnknownCause } from '../money/payment-gateway.js';
import type { PaymentMethodKind } from '../money/payment-method-kind.js';

/**
 * Canonical event-name constants. Packages SHOULD publish events
 * keyed by these strings so consumers can subscribe by type without
 * importing per-package catalogues.
 */
export const PAYMENT_EVENT_TYPE = {
  INITIATED: 'payment.initiated',
  SUCCEEDED: 'payment.succeeded',
  FAILED: 'payment.failed',
  REFUNDED: 'payment.refunded',
  REVERSED: 'payment.reversed',
  RECONCILED: 'payment.reconciled',
  AUTHORIZED: 'payment.authorized',
  CAPTURED: 'payment.captured',
  AUTH_VOIDED: 'payment.auth_voided',
  DISPUTED: 'payment.disputed',
  DISPUTE_WON: 'payment.dispute_won',
  DISPUTE_LOST: 'payment.dispute_lost',
  SETTLED: 'payment.settled',
  /**
   * The provider command produced NO observable outcome — timeout, abort,
   * network fault, or a provider that holds no record and refuses to guess.
   *
   * This member exists because the port contract (`ProviderCommandResult` in
   * `/payment-gateway`) is three-valued — `confirmed | declined | unknown` —
   * while this catalogue was two-valued. An adapter that hit the third case had
   * nowhere to publish it, so the only shapes on the bus were SUCCEEDED and
   * FAILED, and an unobserved outcome had to be forced into one of them.
   * Forcing it into FAILED is the one that double-charges: it licenses a retry
   * for a command that may already have moved money.
   */
  UNKNOWN: 'payment.unknown',
} as const satisfies Record<string, string>;

export type PaymentEventType = (typeof PAYMENT_EVENT_TYPE)[keyof typeof PAYMENT_EVENT_TYPE];

/**
 * A payment attempt has been started against a provider — intent
 * created, checkout session opened, manual record drafted. The
 * obligation is NOT settled yet; consumers should treat this as
 * "money in flight" not "money received".
 */
export interface PaymentInitiatedPayload {
  /** Discriminant — narrows {@link PaymentEventPayload}. */
  readonly eventType: typeof PAYMENT_EVENT_TYPE.INITIATED;
  /** Stable payment identifier owned by the emitting package. */
  paymentId: string;
  /**
   * Provider's reference for this attempt — Stripe payment intent id,
   * bKash sessionId, internal sequence number for manual entries.
   */
  providerRef?: string;
  /** Provider name — `'stripe'`, `'bkash'`, `'manual'`, host-defined. */
  providerCode: string;
  amount: Money;
  methodKind: PaymentMethodKind;
  /**
   * Host-specific method code from the host's PaymentMethod registry
   * (e.g. `'bkash'`, `'stripe_card'`). Optional because not every host
   * runs a registry; when absent, `methodKind` is the only classifier.
   */
  methodCode?: string;
  occurredAt: Date;
  metadata?: Record<string, unknown>;
}

/**
 * A payment has cleared — funds are confirmed received by the merchant
 * (gateway success, manual confirmation, bank credit). This is the
 * trigger for AR settlement, invoice paymentStatus updates, and
 * downstream fulfilment unlocks.
 */
export interface PaymentSucceededPayload {
  /** Discriminant — narrows {@link PaymentEventPayload}. */
  readonly eventType: typeof PAYMENT_EVENT_TYPE.SUCCEEDED;
  paymentId: string;
  providerRef?: string;
  providerCode: string;
  amount: Money;
  methodKind: PaymentMethodKind;
  methodCode?: string;
  occurredAt: Date;
  metadata?: Record<string, unknown>;
}

/**
 * A payment attempt failed before clearing — card declined, wallet
 * timeout, manual rejection. The obligation remains unsettled;
 * consumers may retry, prompt the customer, or mark the invoice
 * overdue.
 */
export interface PaymentFailedPayload {
  /** Discriminant — narrows {@link PaymentEventPayload}. */
  readonly eventType: typeof PAYMENT_EVENT_TYPE.FAILED;
  paymentId: string;
  providerRef?: string;
  providerCode: string;
  amount: Money;
  methodKind: PaymentMethodKind;
  methodCode?: string;
  /** Human-readable reason from the provider or operator. */
  reason: string;
  /** Machine code for failure classification — e.g. `'card_declined'`. */
  reasonCode?: string;
  occurredAt: Date;
  metadata?: Record<string, unknown>;
}

/**
 * A previously-succeeded payment has been refunded — partial or full.
 * Distinct from {@link PaymentReversedPayload}: a refund returns money
 * to the customer (post-settlement); a reversal undoes the settlement
 * itself (pre- or post-clearing, often due to operator error).
 */
export interface PaymentRefundedPayload {
  /** Discriminant — narrows {@link PaymentEventPayload}. */
  readonly eventType: typeof PAYMENT_EVENT_TYPE.REFUNDED;
  paymentId: string;
  /** Refund identifier (separate from `paymentId`). */
  refundId: string;
  providerRef?: string;
  providerCode: string;
  /** Amount refunded in this event — may be less than the original payment. */
  refundedAmount: Money;
  /** Original payment total — present so consumers can compute remaining refundable without a Payment lookup. */
  originalAmount: Money;
  /** `true` if this refund returns less than the original payment total. */
  isPartial: boolean;
  reason?: string;
  occurredAt: Date;
  metadata?: Record<string, unknown>;
}

/**
 * A payment has been reversed — the settlement is being unwound,
 * typically because of operator error, duplicate capture, or
 * pre-clearing cancellation. Allocations referencing this payment
 * MUST be unwound by consumers; AR balance restores to pre-payment
 * state.
 */
export interface PaymentReversedPayload {
  /** Discriminant — narrows {@link PaymentEventPayload}. */
  readonly eventType: typeof PAYMENT_EVENT_TYPE.REVERSED;
  paymentId: string;
  providerRef?: string;
  providerCode: string;
  /** Amount being unwound — equals the original payment for full reversal, less for partial. */
  reversedAmount: Money;
  /** Original payment total — present so consumers can detect partial vs full without a Payment lookup. */
  originalAmount: Money;
  /** `true` when reversedAmount < originalAmount. */
  isPartial: boolean;
  reason: string;
  occurredAt: Date;
  metadata?: Record<string, unknown>;
}

/**
 * An allocation (the row that ties a payment to an obligation — invoice,
 * order, claim) has been reconciled against a bank-statement line or
 * processor settlement record. Triggers GL posting in country-aware
 * ledger bridges and closes the audit loop.
 */
export interface PaymentReconciledPayload {
  /** Discriminant — narrows {@link PaymentEventPayload}. */
  readonly eventType: typeof PAYMENT_EVENT_TYPE.RECONCILED;
  /** Allocation identifier — NOT the payment id (a payment can have many). */
  allocationId: string;
  paymentId: string;
  /**
   * External reference of the matched record — typically a
   * `BankTransaction.externalId`, processor settlement id, or
   * operator-supplied note.
   */
  externalRef: string;
  reconciledAt: Date;
  /** Actor id who confirmed the match (operator) or `'system'` for auto-match. */
  reconciledBy: string;
  metadata?: Record<string, unknown>;
}

/**
 * Gateway has placed an authorisation hold but has NOT captured funds.
 * Distinct from {@link PaymentSucceededPayload} — auth-only flows split
 * "hold" from "settle"; consumers should NOT treat this as cleared funds.
 */
export interface PaymentAuthorizedPayload {
  /** Discriminant — narrows {@link PaymentEventPayload}. */
  readonly eventType: typeof PAYMENT_EVENT_TYPE.AUTHORIZED;
  paymentId: string;
  providerRef?: string;
  providerCode: string;
  /** Amount the gateway has placed a hold for — may be captured later in full or part. */
  authorizedAmount: Money;
  methodKind: PaymentMethodKind;
  methodCode?: string;
  /** When the auth hold expires if not captured — Stripe defaults to 7 days for cards. */
  expiresAt?: Date;
  occurredAt: Date;
  metadata?: Record<string, unknown>;
}

/**
 * Gateway has captured a previously-authorised payment — funds confirmed.
 * Pairs with {@link PaymentAuthorizedPayload} for two-phase flows.
 */
export interface PaymentCapturedPayload {
  /** Discriminant — narrows {@link PaymentEventPayload}. */
  readonly eventType: typeof PAYMENT_EVENT_TYPE.CAPTURED;
  paymentId: string;
  providerRef?: string;
  providerCode: string;
  /** Amount actually captured — `<=` original auth. */
  capturedAmount: Money;
  /** Total authorised — present so consumers can compute remaining holdable. */
  authorizedAmount: Money;
  /** `true` when capturedAmount < authorizedAmount (partial capture). */
  isPartial: boolean;
  methodKind: PaymentMethodKind;
  methodCode?: string;
  occurredAt: Date;
  metadata?: Record<string, unknown>;
}

/**
 * Authorisation hold released — uncaptured auth voided before settlement.
 */
export interface PaymentAuthVoidedPayload {
  /** Discriminant — narrows {@link PaymentEventPayload}. */
  readonly eventType: typeof PAYMENT_EVENT_TYPE.AUTH_VOIDED;
  paymentId: string;
  providerRef?: string;
  providerCode: string;
  /** Amount released back to the customer's available balance. */
  voidedAmount: Money;
  reason?: string;
  occurredAt: Date;
  metadata?: Record<string, unknown>;
}

/**
 * Customer / issuing bank opened a dispute or chargeback against this
 * payment. The merchant typically has a deadline to submit evidence.
 */
export interface PaymentDisputedPayload {
  /** Discriminant — narrows {@link PaymentEventPayload}. */
  readonly eventType: typeof PAYMENT_EVENT_TYPE.DISPUTED;
  paymentId: string;
  /** Provider's dispute / chargeback id. */
  disputeId: string;
  providerRef?: string;
  providerCode: string;
  /** Amount being disputed — may be less than the original payment for partial chargebacks. */
  disputedAmount: Money;
  /** Provider's category — `'fraudulent'`, `'product_not_received'`, `'duplicate'`, etc. */
  reason: string;
  /** Provider lifecycle phase at the time of emit — `'warning_needs_response'`, `'needs_response'`, `'under_review'`. */
  status: string;
  /** When the host must submit evidence by, if applicable. */
  evidenceDueBy?: Date;
  occurredAt: Date;
  metadata?: Record<string, unknown>;
}

/** Dispute resolved in merchant's favour — funds restored. */
export interface PaymentDisputeWonPayload {
  /** Discriminant — narrows {@link PaymentEventPayload}. */
  readonly eventType: typeof PAYMENT_EVENT_TYPE.DISPUTE_WON;
  paymentId: string;
  disputeId: string;
  providerRef?: string;
  providerCode: string;
  /** Amount restored to the merchant. */
  recoveredAmount: Money;
  occurredAt: Date;
  metadata?: Record<string, unknown>;
}

/** Dispute resolved against merchant — funds permanently lost plus fee. */
export interface PaymentDisputeLostPayload {
  /** Discriminant — narrows {@link PaymentEventPayload}. */
  readonly eventType: typeof PAYMENT_EVENT_TYPE.DISPUTE_LOST;
  paymentId: string;
  disputeId: string;
  providerRef?: string;
  providerCode: string;
  /** Amount permanently debited from the merchant. */
  lostAmount: Money;
  /** Dispute / chargeback fee the merchant pays in addition. */
  feeAmount?: Money;
  occurredAt: Date;
  metadata?: Record<string, unknown>;
}

/**
 * Funds have been settled to the merchant bank account by the gateway —
 * the gross-vs-net delta is the processor fee. Use for bank-statement
 * reconciliation in country-aware ledger bridges.
 */
export interface PaymentSettledPayload {
  /** Discriminant — narrows {@link PaymentEventPayload}. */
  readonly eventType: typeof PAYMENT_EVENT_TYPE.SETTLED;
  paymentId: string;
  providerRef?: string;
  providerCode: string;
  /** Net amount transferred to the merchant bank account (gross - fees). */
  settledAmount: Money;
  /** Provider fee deducted before settlement. */
  feeAmount?: Money;
  /** Provider's payout / settlement batch identifier — useful for bank-statement matching. */
  payoutId?: string;
  /** When the funds become available in the merchant account. */
  expectedArrivalAt?: Date;
  occurredAt: Date;
  metadata?: Record<string, unknown>;
}

/**
 * The provider command produced no observable outcome. **This is not a
 * failure**, and it is not a success — it is the absence of an answer.
 *
 * The obligation's state is genuinely unknown: the capture may have landed at
 * the gateway with the acknowledgement lost in transit. The ONLY correct
 * reaction is to reconcile the payment's real status before acting. A blind
 * retry is a double charge; marking it failed and releasing the order is a
 * shipped-but-unpaid order. Both are silent.
 *
 * Consumers MUST NOT treat this as a terminal state. It is a prompt to go and
 * find out, and it resolves later into `payment.succeeded` or `payment.failed`.
 */
export interface PaymentUnknownPayload {
  /** Discriminant — narrows {@link PaymentEventPayload}. */
  readonly eventType: typeof PAYMENT_EVENT_TYPE.UNKNOWN;
  paymentId: string;
  providerRef?: string;
  providerCode: string;
  /** Which command went unanswered — the retry policy differs per verb. */
  operation: 'create_intent' | 'verify' | 'authorize' | 'capture' | 'refund' | 'void';
  /** The amount at stake, when the command carried one. */
  amount?: Money;
  methodKind?: PaymentMethodKind;
  methodCode?: string;
  /**
   * NORMALIZED reason the outcome was not observed — mirrors
   * `ProviderUnknownCause` from `/payment-gateway`. Never a raw vendor error
   * string: this value is persisted and displayed, and vendor errors embed
   * request URLs, tokens and body fragments.
   */
  causeCode: ProviderUnknownCause;
  /** The idempotency key the command carried — what reconciliation asks with. */
  idempotencyKey?: string;
  occurredAt: Date;
  metadata?: Record<string, unknown>;
}

/**
 * Union of all payment event payload types.
 *
 * DISCRIMINATED on `eventType`. Before the discriminant existed,
 * `PaymentInitiatedPayload` and `PaymentSucceededPayload` were structurally
 * IDENTICAL — so a handler typed for "funds received" accepted "money in
 * flight" with no error anywhere, and TypeScript could not tell them apart even
 * in principle. Structural identity between two events that mean opposite
 * things is precisely where a nominal tag has to carry the meaning.
 */
export type PaymentEventPayload =
  | PaymentInitiatedPayload
  | PaymentSucceededPayload
  | PaymentFailedPayload
  | PaymentRefundedPayload
  | PaymentReversedPayload
  | PaymentReconciledPayload
  | PaymentAuthorizedPayload
  | PaymentCapturedPayload
  | PaymentAuthVoidedPayload
  | PaymentDisputedPayload
  | PaymentDisputeWonPayload
  | PaymentDisputeLostPayload
  | PaymentSettledPayload
  | PaymentUnknownPayload;

/** Event type → its payload. The lookup a typed publisher/handler pair needs. */
export interface PaymentEventPayloadMap {
  'payment.initiated': PaymentInitiatedPayload;
  'payment.succeeded': PaymentSucceededPayload;
  'payment.failed': PaymentFailedPayload;
  'payment.refunded': PaymentRefundedPayload;
  'payment.reversed': PaymentReversedPayload;
  'payment.reconciled': PaymentReconciledPayload;
  'payment.authorized': PaymentAuthorizedPayload;
  'payment.captured': PaymentCapturedPayload;
  'payment.auth_voided': PaymentAuthVoidedPayload;
  'payment.disputed': PaymentDisputedPayload;
  'payment.dispute_won': PaymentDisputeWonPayload;
  'payment.dispute_lost': PaymentDisputeLostPayload;
  'payment.settled': PaymentSettledPayload;
  'payment.unknown': PaymentUnknownPayload;
}

// ── Drift guards — compile-time, and they FAIL the build when violated ──────
//
// A map like the one above is exactly the kind of declared-but-unenforced
// alignment that rots: add a member to PAYMENT_EVENT_TYPE, forget the map
// entry, and every runtime path still works while the type lookup silently
// resolves to `never`. These three assertions make each of those a tsc error.

type Assert<T extends true> = T;

/** Every declared event type has a payload in the map. */
type _EveryTypeMapped = Assert<
  PaymentEventType extends keyof PaymentEventPayloadMap ? true : false
>;

/** The map declares no key that is not a real event type. */
type _NoStrayMapKeys = Assert<keyof PaymentEventPayloadMap extends PaymentEventType ? true : false>;

/** Each payload's own `eventType` literal matches the key it is filed under. */
type _DiscriminantMatchesKey = Assert<
  {
    [K in keyof PaymentEventPayloadMap]: PaymentEventPayloadMap[K] extends { eventType: K }
      ? true
      : false;
  }[keyof PaymentEventPayloadMap] extends true
    ? true
    : false
>;

// Reference the aliases so `noUnusedLocals` keeps them (they are the gate).
export type PaymentEventContractGuards = [
  _EveryTypeMapped,
  _NoStrayMapKeys,
  _DiscriminantMatchesKey,
];

/**
 * Narrow a payload by event type at RUNTIME, with the compile-time narrowing
 * to match. `if (isPaymentEvent(PAYMENT_EVENT_TYPE.SUCCEEDED, p)) { … }` —
 * inside the branch `p` is `PaymentSucceededPayload` and cannot be an
 * initiated payload, which is the whole point of the discriminant.
 */
export function isPaymentEvent<T extends PaymentEventType>(
  type: T,
  payload: PaymentEventPayload,
): payload is PaymentEventPayloadMap[T] {
  return payload.eventType === type;
}

/**
 * Is this payload a CLEARED-FUNDS event?
 *
 * The named answer to the question that used to be answerable only by
 * structural shape — and answered wrong, because `initiated` had the same
 * shape. `captured` counts; `initiated`, `authorized` and `unknown` do not.
 */
export function isFundsReceived(payload: PaymentEventPayload): boolean {
  return (
    payload.eventType === PAYMENT_EVENT_TYPE.SUCCEEDED ||
    payload.eventType === PAYMENT_EVENT_TYPE.CAPTURED
  );
}
