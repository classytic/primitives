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
 * Zero runtime, zero deps. Mirror this exactly anywhere a payment leg's
 * "what kind of payment was this" needs to be typed.
 */

export const PAYMENT_METHOD_KIND = {
  /** Credit / debit card — Visa, Mastercard, Amex, RuPay, UnionPay, … */
  CARD: 'card',
  /** Direct bank transfer — ACH, SEPA, IMPS, NEFT, RTGS, wire, … */
  BANK_TRANSFER: 'bank_transfer',
  /** Digital wallet — bKash, Nagad, PayPal, Apple Pay, Google Pay, Alipay, … */
  WALLET: 'wallet',
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
