/**
 * Canonical payment method kinds — the universal vocabulary every
 * payment-aware package speaks (`@classytic/invoice`, `@classytic/revenue`,
 * `@classytic/order`, future POS / AP / subscription packages, …).
 *
 * **Kind vs code.** A `PaymentMethodKind` is the universal category
 * (every payment system on earth has these). A `methodCode` is the
 * host-specific string registered in a host's `PaymentMethod` registry
 * (`'bkash'`, `'nagad'`, `'stripe_card'`, `'cash_register_3'`). Packages
 * speak `kind`; hosts speak `code`. The pair lets UIs branch on kind
 * (show wallet form vs card form vs cash form) while the host owns the
 * concrete method catalogue.
 *
 * The enum is curated for distinct lifecycle / accounting / reporting
 * characteristics, not provider variants. Provider-specific identification
 * belongs in a host `methodCode` (e.g. `'stripe_card'`, `'bkash'`,
 * `'klarna'`) and per-payment metadata. Consumers SHOULD handle unknown
 * values defensively (fall through to `'other'` semantics) since the
 * union may grow in future minor versions.
 *
 * Zero runtime, zero deps. Mirror this exactly anywhere a payment leg's
 * "what kind of payment was this" needs to be typed.
 */

export const PAYMENT_METHOD_KIND = {
  /** Credit / debit card — Visa, Mastercard, Amex, RuPay, UnionPay, … */
  CARD: 'card',
  /** Standard bank transfer — ACH credit, SEPA credit, IMPS, NEFT, RTGS, wire. */
  BANK_TRANSFER: 'bank_transfer',
  /** Real-time bank rails — UPI, Pix, FedNow, PromptPay, FPX, GrabPay rails. */
  INSTANT_BANK_TRANSFER: 'instant_bank_transfer',
  /** Mandate-based bank pull — SEPA Direct Debit, ACH Debit, BACS Direct Debit, AU BECS. */
  DIRECT_DEBIT: 'direct_debit',
  /** Digital wallet — Apple Pay, Google Pay, Link, PayPal, Cashapp, Alipay, WeChat Pay, Revolut Pay. */
  WALLET: 'wallet',
  /** Cash-in/out wallet infrastructure in unbanked markets — bKash, Nagad, M-Pesa, MoMo, GCash. */
  MOBILE_MONEY: 'mobile_money',
  /** Buy now pay later — Klarna, Afterpay, Affirm, Tabby, Tamara. */
  BNPL: 'bnpl',
  /** Customer-purchased prepaid credit / voucher. */
  GIFT_CARD: 'gift_card',
  /** Physical cash. */
  CASH: 'cash',
  /** Paper cheque. */
  CHEQUE: 'cheque',
  /** Cryptocurrency settlement. */
  CRYPTO: 'cryptocurrency',
  /**
   * Operator-recorded settlement that doesn't fit any other kind — e.g.
   * an offline bank deposit confirmed by phone, an in-kind exchange, a
   * manual write-off. Always-valid escape hatch.
   */
  MANUAL: 'manual',
  /** Unknown or vendor-specific kind — last resort. Prefer a specific kind. */
  OTHER: 'other',
} as const satisfies Record<string, string>;

export type PaymentMethodKind = (typeof PAYMENT_METHOD_KIND)[keyof typeof PAYMENT_METHOD_KIND];

const KIND_VALUES = new Set<string>(Object.values(PAYMENT_METHOD_KIND));

export const isPaymentMethodKind = (value: unknown): value is PaymentMethodKind =>
  typeof value === 'string' && KIND_VALUES.has(value);
