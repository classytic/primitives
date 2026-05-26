/**
 * Allocation + reconciliation status enums for payment legs.
 *
 * Two orthogonal dimensions sit on every PaymentAllocation row (or
 * equivalent in any package that settles money against an invoice /
 * order / claim):
 *
 *   1. **Allocation status** — has this payment been *applied* against
 *      the obligation(s) it's meant to settle? (`unallocated`,
 *      `partial`, `allocated`, `over_allocated`)
 *   2. **Reconciliation status** — has this allocation been *matched*
 *      to a bank statement line / processor settlement record?
 *      (`unreconciled`, `matched`, `manual`, `disputed`)
 *
 * Both are needed because a payment can be allocated (the AR ledger
 * thinks it's done) without being reconciled (the bank statement
 * hasn't been imported / matched yet), and vice versa.
 *
 * Zero runtime, zero deps.
 */

export const PAYMENT_ALLOCATION_STATUS = {
  /** No portion of the payment has been applied to any obligation yet. */
  UNALLOCATED: 'unallocated',
  /** Some of the payment is applied; remainder is available credit. */
  PARTIAL: 'partial',
  /** Fully applied — `sum(allocations) === payment.totalAmount`. */
  ALLOCATED: 'allocated',
  /**
   * Sum of allocations exceeds the payment total — invariant violation
   * that should be flagged for operator review, never silently accepted.
   */
  OVER_ALLOCATED: 'over_allocated',
} as const satisfies Record<string, string>;

export type PaymentAllocationStatus =
  (typeof PAYMENT_ALLOCATION_STATUS)[keyof typeof PAYMENT_ALLOCATION_STATUS];

export const RECONCILIATION_STATUS = {
  /** No bank statement line / settlement record has been linked yet. */
  UNRECONCILED: 'unreconciled',
  /** Auto-matched to a `BankTransaction` by amount + date + reference. */
  MATCHED: 'matched',
  /** Operator-confirmed match (auto-match failed or was overridden). */
  MANUAL: 'manual',
  /**
   * Match was contested — amount mismatch, duplicate claim, chargeback
   * in flight. Halts further automated processing until resolved.
   */
  DISPUTED: 'disputed',
} as const satisfies Record<string, string>;

export type ReconciliationStatus =
  (typeof RECONCILIATION_STATUS)[keyof typeof RECONCILIATION_STATUS];

const ALLOCATION_VALUES = new Set<string>(Object.values(PAYMENT_ALLOCATION_STATUS));
const RECONCILIATION_VALUES = new Set<string>(Object.values(RECONCILIATION_STATUS));

export const isPaymentAllocationStatus = (value: unknown): value is PaymentAllocationStatus =>
  typeof value === 'string' && ALLOCATION_VALUES.has(value);

export const isReconciliationStatus = (value: unknown): value is ReconciliationStatus =>
  typeof value === 'string' && RECONCILIATION_VALUES.has(value);
