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
} as const satisfies Record<string, string>;

export type PaymentEventType = (typeof PAYMENT_EVENT_TYPE)[keyof typeof PAYMENT_EVENT_TYPE];

/**
 * A payment attempt has been started against a provider — intent
 * created, checkout session opened, manual record drafted. The
 * obligation is NOT settled yet; consumers should treat this as
 * "money in flight" not "money received".
 */
export interface PaymentInitiatedPayload {
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
  paymentId: string;
  /** Refund identifier (separate from `paymentId`). */
  refundId: string;
  providerRef?: string;
  providerCode: string;
  /** Amount refunded in this event — may be less than the original payment. */
  refundedAmount: Money;
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
  paymentId: string;
  providerRef?: string;
  providerCode: string;
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

/** Union of all payment event payload types — convenient for exhaustive switches. */
export type PaymentEventPayload =
  | PaymentInitiatedPayload
  | PaymentSucceededPayload
  | PaymentFailedPayload
  | PaymentRefundedPayload
  | PaymentReversedPayload
  | PaymentReconciledPayload;
