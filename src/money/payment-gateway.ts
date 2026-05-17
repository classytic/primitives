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
 * `PaymentIntent`, `PaymentResult`, `RefundResult`, `WebhookEvent`,
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
 *   PaymentIntent,
 *   PaymentResult,
 * } from '@classytic/primitives/payment-gateway';
 *
 * export class StripeProvider {
 *   readonly name = 'stripe';
 *
 *   async createIntent(params: CreateIntentParams): Promise<PaymentIntent> {
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
 * the upstream gateway (Stripe attaches it to the PaymentIntent), but
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

// ─── Payment intent (creation result) ────────────────────────────────────

/**
 * What `provider.createIntent(...)` returns. The engine persists
 * `id` / `paymentIntentId` / `sessionId` on the Transaction's
 * `gateway` block so subsequent `verify` / webhook lookups can find
 * the row.
 */
export interface PaymentIntent {
  /** Unique gateway-scoped id for this intent (`pi_xxx`, `ch_xxx`, etc.). */
  id: string;
  /** Lowercase gateway name (`'stripe'`, `'razorpay'`, `'sslcommerz'`, `'bkash'`, `'manual'`). */
  provider: string;
  /**
   * Lifecycle status as the gateway reports it. Free-form string —
   * engine maps known values to its own state machine. Common values:
   * `'pending'`, `'processing'`, `'requires_action'`, `'succeeded'`,
   * `'failed'`, `'cancelled'`.
   */
  status: string;
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
   * Closed status set — narrower than `PaymentIntent.status` because
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
  status: 'succeeded' | 'failed' | 'processing';

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
  /** Raw provider payload — audit only. */
  raw?: unknown;
}
