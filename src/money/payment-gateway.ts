/**
 * Payment-gateway data shapes — the cross-package vocabulary every
 * gateway provider (Stripe, Razorpay, SSLCommerz, PayPal, bKash, Nagad,
 * manual cash, …) speaks when exchanging data with a payment engine.
 *
 * Anchored on `Money` from `@classytic/primitives/money` (integer minor
 * units, `number`). Same precision discipline as bank-transaction;
 * money never leaks into JS floats anywhere.
 *
 * **What lives here:** pure data interfaces — `CreateIntentParams`,
 * `ProviderIntent`, `PaymentResult`, `RefundResult`, `WebhookEvent`,
 * `ProviderCapabilities`. Zero runtime, zero classes, zero deps.
 *
 * **What lives in `@classytic/revenue`:** the `PaymentProvider` abstract
 * class (the *contract* — what a gateway must implement), plus the
 * `TransactionRepository` and state machines that consume these shapes.
 *
 * **Why this separation matters.** A `revenue-stripe` package can
 * declare `@classytic/primitives` as its only peer dep — no mongoose,
 * no mongokit, no transaction-state-machine baggage. Same loose-
 * coupling story `@classytic/fin-io/adapters/revenue` already uses for
 * bank-feed providers: shapes in primitives, contracts in revenue,
 * implementations anywhere.
 *
 * @example A minimal Stripe provider
 * ```ts
 * import type {
 *   CreateIntentParams,
 *   ProviderIntent,
 *   PaymentResult,
 * } from '@classytic/primitives/payment-gateway';
 *
 * export class StripeProvider {
 *   readonly name = 'stripe';
 *
 *   async createIntent(params: CreateIntentParams): Promise<ProviderIntent> {
 *     const stripeIntent = await stripe.paymentIntents.create({
 *       amount: params.amount.amount,        // already integer minor units
 *       currency: params.amount.currency.toLowerCase(),
 *       metadata: params.metadata,
 *     });
 *     return {
 *       id: stripeIntent.id,
 *       provider: 'stripe',
 *       status: stripeIntent.status,
 *       amount: params.amount,
 *       paymentIntentId: stripeIntent.id,
 *       clientSecret: stripeIntent.client_secret ?? undefined,
 *       raw: stripeIntent,
 *     };
 *   }
 *   // verifyPayment, refund, handleWebhook, ...
 * }
 * ```
 */

import type { Money } from './money.js';
import type { PaymentMethodKind } from './payment-method-kind.js';

// ─── Provider capabilities ───────────────────────────────────────────────

/**
 * Static capability declaration — providers expose this so the engine
 * can branch on what's supported (e.g. skip the refund button for
 * cash providers, route 3DS-required cards to verification flows).
 */
export interface ProviderCapabilities {
  /** Provider exposes a webhook endpoint the host can register. */
  supportsWebhooks: boolean;
  /** Provider can reverse a captured charge. */
  supportsRefunds: boolean;
  /** Provider can refund less than the captured amount. */
  supportsPartialRefunds: boolean;
  /**
   * Verification requires a human (admin marks "received") rather than
   * an API call. True for cash, manual bank transfer, mobile-money
   * outside an API window.
   */
  requiresManualVerification: boolean;
}

// ─── Create-intent input ─────────────────────────────────────────────────

/**
 * Arguments to `provider.createIntent(...)`. Engine constructs this
 * from the host's checkout payload and the resolved currency. The
 * `metadata` blob is opaque pass-through — providers MAY forward it to
 * the upstream gateway (Stripe attaches it to its own PaymentIntent), but
 * MUST NOT mutate or interpret it.
 */
export interface CreateIntentParams {
  /** Amount + currency. Integer minor units; provider converts to its native shape. */
  amount: Money;
  /** Host-side customer id, if any. Forwarded to the gateway. */
  customerId?: string;
  /** Where the customer returns after off-site payment (Stripe Checkout, PayPal). */
  returnUrl?: string;
  /** Pass-through metadata. Visible on the gateway dashboard / webhook events. */
  metadata?: Record<string, unknown>;
  /**
   * Provider-specific knobs. Each gateway documents its own keys —
   * Stripe has `payment_method_types`, SSLCommerz has `tran_id`, bKash
   * has `intent`, etc. Engine doesn't peek inside.
   */
  [key: string]: unknown;
}

// ─── Status unions ───────────────────────────────────────────────────────

/**
 * Closed set of intent lifecycle states the engine recognises. Modelled on
 * Stripe's PaymentIntent status because every other gateway maps cleanly
 * INTO this set; gateways that lack a state simply never emit it.
 */
export type ProviderIntentStatus =
  | 'requires_payment_method'
  | 'requires_confirmation'
  | 'requires_action'
  | 'processing'
  | 'requires_capture'
  | 'canceled'
  | 'succeeded';

/** Closed set of refund lifecycle states the engine recognises. */
export type RefundResultStatus =
  | 'pending'
  | 'requires_action'
  | 'succeeded'
  | 'failed'
  | 'canceled';

// ─── Payment intent (creation result) ────────────────────────────────────

/**
 * What `provider.createIntent(...)` returns. The engine persists
 * `id` / `paymentIntentId` / `sessionId` on the Transaction's
 * `gateway` block so subsequent `verify` / webhook lookups can find
 * the row.
 */
/**
 * A PROVIDER-side intent reference — what the gateway calls this payment.
 *
 * Named `ProviderIntent`, not `PaymentIntent`, because the domain aggregate that models the
 * customer's obligation is also called a payment intent, and one name cannot span both layers.
 * This is the narrow thing: a gateway-scoped id, the provider's own status mapped onto our closed
 * union, and the amount it locked in. It belongs to ONE attempt against ONE provider account.
 *
 * See `spine/docs/payments-architecture.md` §3.3.
 */
export interface ProviderIntent {
  /** Unique gateway-scoped id for this intent (`pi_xxx`, `ch_xxx`, etc.). */
  id: string;
  /** Lowercase gateway name (`'stripe'`, `'razorpay'`, `'sslcommerz'`, `'bkash'`, `'manual'`). */
  provider: string;
  /**
   * Lifecycle status — closed union the engine state-machines branch on.
   * Adapters MUST map provider-native strings into this set.
   */
  status: ProviderIntentStatus;
  /** Amount + currency that the intent locks in. */
  amount: Money;

  /**
   * Session token for hosted checkout flows (Stripe Checkout `session_id`,
   * SSLCommerz `sessionkey`, bKash `paymentID`). When the gateway
   * uses a redirect-style flow this is the lookup key.
   */
  sessionId?: string | null;
  /**
   * Stripe-style `pi_xxx` payment-intent id. May equal `id` for
   * gateways that don't distinguish session vs intent.
   */
  paymentIntentId?: string | null;

  /** Frontend hand-off — Stripe Elements / Razorpay Checkout consume this. */
  clientSecret?: string;
  /** Off-site redirect URL (PayPal `approve` link, SSLCommerz GatewayPageURL). */
  paymentUrl?: string;
  /** Manual-flow instructions ("transfer to A/c 1234, reference X"). */
  instructions?: string;
  /** Canonical method kind if known at intent creation (customer pre-selected). */
  methodKind?: PaymentMethodKind;

  /** Pass-through metadata echoed from the create call. */
  metadata?: Record<string, unknown>;
  /** Raw provider response — kept for audit. Consumers MUST NOT rely on shape. */
  raw?: unknown;
}

// ─── Verify result ───────────────────────────────────────────────────────

/**
 * What `provider.verifyPayment(intentId)` returns. The engine maps
 * this to its `TRANSACTION_STATUS` state machine.
 */
export interface PaymentResult {
  /** Gateway-scoped id (intent id, charge id, tran id — whatever the gateway uses). */
  id: string;
  /** Lowercase gateway name. */
  provider: string;
  /**
   * Closed status set — narrower than `ProviderIntent.status` because
   * verification has settled the lifecycle.
   *
   * - `'succeeded'` — payment captured, funds owed to merchant.
   * - `'failed'` — terminal failure. Engine moves Transaction to FAILED.
   * - `'processing'` — async processing (ACH, e-wallet pending bank).
   * - `'requires_action'` — 3DS, OTP, or out-of-band approval pending.
   */
  status: 'succeeded' | 'failed' | 'processing' | 'requires_action';

  /** Captured amount as the gateway reports it (may differ from intent on partial capture). */
  amount?: Money;
  /** When the gateway booked the capture. */
  paidAt?: Date;
  /** Canonical method kind chosen by the customer (typically known post-settlement). */
  methodKind?: PaymentMethodKind;
  /** Pass-through metadata (gateway customer id, fee breakdown, etc.). */
  metadata?: Record<string, unknown>;
  /** Raw response — audit only. */
  raw?: unknown;
}

// ─── Refund result ───────────────────────────────────────────────────────

/**
 * What `provider.refund(...)` returns. Successful refunds become a
 * new `'refund'` Transaction (flow: `'outflow'`) on the engine side.
 */
export interface RefundResult {
  /** Gateway-scoped refund id (Stripe `re_xxx`, etc.). */
  id: string;
  /** Lowercase gateway name. */
  provider: string;
  status: RefundResultStatus;

  /** Amount reversed, as the gateway reports it. May be partial. */
  amount?: Money;
  /** When the gateway booked the refund. */
  refundedAt?: Date;
  /** Reason string forwarded from the engine call (or filled by the gateway). */
  reason?: string;
  metadata?: Record<string, unknown>;
  raw?: unknown;
}

// ─── Webhook ─────────────────────────────────────────────────────────────

/**
 * Parsed webhook event from a gateway's HTTP delivery. Engine stamps
 * `id` on the Transaction's `webhook.eventId` for atomic dedup —
 * replays of the same `id` are no-ops.
 */
export interface WebhookEvent {
  /**
   * Gateway-scoped event id (Stripe `evt_xxx`, Razorpay
   * `webhook_event_id`). Used as the dedup key — repeating delivery
   * attempts MUST share the same id.
   */
  id: string;
  /** Lowercase gateway name. */
  provider: string;
  /** Event type (`'payment.succeeded'`, `'charge.refunded'`, etc.). */
  type: string;
  /**
   * Routing fields the engine uses to find the matching Transaction:
   *   - `sessionId` — for redirect-style flows.
   *   - `paymentIntentId` — for Stripe-style flows.
   * Plus arbitrary additional gateway data.
   */
  data: {
    sessionId?: string;
    paymentIntentId?: string;
    [key: string]: unknown;
  };
  /** When the gateway emitted the event. */
  createdAt?: Date;
  /** Canonical method kind derived from the event payload, when present. */
  methodKind?: PaymentMethodKind;
  /** Provider signature header value — kept for delayed verification / audit replay. */
  signature?: string;
  /** Signature timestamp the provider asserted — for replay-window enforcement. */
  signatureTimestamp?: Date;
  /** Connected-account id for multi-tenant routing — Stripe Connect uses `event.account`. */
  accountId?: string;
  /** Test vs production mode — Stripe's `livemode`. False / undefined = test. */
  livemode?: boolean;
  /** Raw provider payload — audit only. */
  raw?: unknown;
}

// ─────────────────────────────────────────────────────────────────────────────
// The PORT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The contract a payment provider must satisfy — declared HERE, in primitives, so an
 * adapter can be written against it with **no runtime dependency on the engine**.
 *
 * ## Why this moved
 *
 * `@classytic/revenue-manual` imported the abstract `PaymentProvider` CLASS from
 * `@classytic/revenue` — a runtime value, not a type. That coupled every adapter to the
 * engine package: an adapter could not be versioned or published independently, and the
 * dependency ran adapter → engine while the engine also registers adapters.
 *
 * This is the same correction made for `OutboxStore`: primitives owns the CONTRACT, the
 * engine adapts to it, and a kit or a third party can implement it knowing only this file.
 *
 * ## Extending vs implementing
 *
 * `revenue`'s abstract `PaymentProvider` class now *implements* this interface and stays
 * available for the config plumbing it provides (`config`, `defaultCurrency`). Existing
 * adapters that `extends PaymentProvider` are unaffected. New adapters should `implement
 * PaymentProviderPort` directly and depend only on primitives.
 *
 * See `spine/docs/payments-architecture.md` §3.4.1 and phase 1.
 */
export interface PaymentProviderPort {
  /** Stable lowercase provider name — the registry key. */
  readonly name: string;

  /**
   * Create a provider-side intent for an amount.
   *
   * `command` is REQUIRED, not optional. Creating an intent is side-effecting upstream: a
   * timed-out create can leave a live intent at the gateway with no local record, and a
   * retry without a stable idempotency key produces a SECOND one. Making the envelope
   * mandatory is what stops an adapter quietly omitting it.
   */
  createIntent(params: CreateIntentParams, command: PaymentCommandContext): Promise<ProviderIntent>;

  /**
   * Confirm an intent actually succeeded at the provider.
   *
   * A provider that CANNOT know — a stateless manual provider, for instance — must not
   * answer `succeeded`. Reporting success for something it never observed is how a
   * reconciliation path gets a false positive.
   */
  verifyPayment(intentId: string, command?: PaymentCommandContext): Promise<PaymentResult>;

  /**
   * Current provider-side status. Same honesty requirement as `verifyPayment`.
   *
   * `command` is OPTIONAL here and on `verifyPayment`: both are reads, so there is nothing
   * to make idempotent. It is accepted purely for correlation across our logs and the
   * provider's.
   */
  getStatus(intentId: string, command?: PaymentCommandContext): Promise<PaymentResult>;

  /**
   * Reverse a payment, in full or in part.
   *
   * `command` is REQUIRED and carries the idempotency key. It used to be an optional field
   * inside `options`, which made the single most dangerous operation on this port the one
   * where deduplication was easiest to forget. Providers whose gateway supports an
   * idempotency key MUST forward it; those without may ignore it, and the engine still
   * guards with its own claim and a unique index.
   */
  refund(
    paymentId: string,
    amount: number | null | undefined,
    command: PaymentCommandContext,
    options?: { reason?: string },
  ): Promise<RefundResult>;

  handleWebhook(payload: unknown, headers?: Record<string, string>): Promise<WebhookEvent>;

  /**
   * Reject a forged webhook. Returning `true` unconditionally is only acceptable for a
   * provider with no webhook transport at all (manual/dev).
   */
  verifyWebhookSignature(payload: unknown, signature: string): boolean;

  /** Declared capabilities. Callers gate on these rather than probing by failing. */
  getCapabilities(): ProviderCapabilities;
}

/**
 * `setDefaultCurrency` is deliberately NOT on the port.
 *
 * A default currency is ENGINE configuration, not part of the provider execution contract,
 * and every `Money` already carries its own currency. Requiring the mutator would make each
 * adapter stateful and awkward to share across accounts — the same instance cannot then
 * serve two accounts with different defaults.
 *
 * Adapters that want the convenience expose it and the registry feature-detects it; the
 * rest simply read the currency off the amount they were handed.
 */
export interface DefaultCurrencyAware {
  setDefaultCurrency(currency: string): void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Command envelope + three-valued outcome
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The envelope every money-changing provider command carries.
 *
 * Idempotency used to be supplied on `refund` alone. It belongs on every command: a
 * retried authorize or capture double-charges just as readily as a retried refund, and the
 * retry is usually the client's, not ours.
 *
 * Adapters whose gateway supports an idempotency key MUST forward it. The engine still keeps
 * its own atomic claim/result store, because not every provider offers one and a provider's
 * word is not a guarantee we control.
 */
export interface PaymentCommandContext {
  /**
   * Caller-supplied, stable across retries of the SAME logical operation. Two different
   * operations must never share one; one operation retried must never change it.
   */
  idempotencyKey: string;
  /** Correlates this attempt across our logs, the provider's, and the audit trail. */
  requestId: string;
  /** Our reference for the thing being paid for — order number, invoice number. */
  merchantReference: string;
  /** Branch / tenant scope. */
  organizationId: string;
  /** Cancels an in-flight command (a cashier abandoning a terminal prompt, a shutdown). */
  signal?: AbortSignal;
}

/** Why a provider said no. A DECISION, distinct from an unanswered question. */
export interface PaymentDecline {
  /** Normalized reason. Adapters map their vendor's vocabulary onto this. */
  reason:
    | 'insufficient_funds'
    | 'card_declined'
    | 'expired'
    | 'invalid_details'
    | 'limit_exceeded'
    | 'duplicate'
    | 'not_permitted'
    | 'provider_error'
    | 'other';
  /** The provider's own code and message, preserved verbatim for support and reconciliation. */
  providerCode?: string;
  providerMessage?: string;
  /** Whether trying again could plausibly succeed. `false` for a hard decline. */
  retryable: boolean;
}

/**
 * The outcome of a provider command. **Three-valued, and the third one is the point.**
 *
 * A timeout is NOT a failure. When a capture request times out, the money may well have
 * moved — we simply did not hear back. Treating that as `declined` and retrying is the
 * canonical way to double-charge a customer, and it is invisible until reconciliation.
 *
 * `unknown` also covers a provider that legitimately cannot answer: a stateless manual
 * provider asked for the status of a payment it never stored. Today's two-valued shape
 * forces such a provider to invent an answer, and `revenue-manual` invented `succeeded`.
 *
 * **The only correct response to `unknown` is to reconcile status before acting** — never
 * a blind retry.
 */
export type ProviderCommandResult<T> =
  | { outcome: 'confirmed'; value: T }
  | { outcome: 'declined'; error: PaymentDecline }
  | {
      outcome: 'unknown';
      /** Whatever handle we have for asking again later. */
      providerReference?: string;
      /**
       * NORMALIZED reason we do not know — never a raw exception message.
       *
       * Vendor errors routinely embed request URLs, tokens, account identifiers and
       * fragments of the request body. This value is persisted on the transaction, returned
       * to callers and read by operators, so it must be safe to store and display. The raw
       * error belongs in a redacted diagnostic log, not here.
       */
      causeCode?: ProviderUnknownCause;
    };

/** Why an outcome went unobserved. Coarse on purpose — it drives handling, not diagnosis. */
export type ProviderUnknownCause =
  | 'timeout'
  | 'aborted'
  | 'network'
  | 'status_unavailable'
  | 'unclassified';

/**
 * Thrown by a provider that cannot answer a status query, rather than guessing.
 *
 * Classified as `unknown`. The engine's correct reaction is to consult the stored record:
 * for a manual method there is no external money-movement authority, so the record IS the
 * authority (see `spine/docs/payments-architecture.md` §1).
 */
export class ProviderStatusUnavailableError extends Error {
  readonly providerName: string;
  constructor(providerName: string, message?: string) {
    super(
      message ??
        `provider "${providerName}" cannot report status for this payment — it holds no ` +
          'record of it. Read the stored transaction instead of asking the provider.',
    );
    this.name = 'ProviderStatusUnavailableError';
    this.providerName = providerName;
  }
}
