/**
 * WHERE received cash landed, as an INTENT — never a chart-of-accounts code.
 *
 * The one vocabulary a request body, a domain event, a client SDK and a
 * settlement dialog all speak. The accounting tier maps an intent to whatever
 * account the active chart assigns, so a chart renumber cannot reach any of
 * them. A literal code in a client once named a bank account the chart had
 * already renumbered, and every settlement it sent was refused.
 *
 * `cash` — the business's bank / current account, the default for a courier
 *          remittance, a card payout or a transfer.
 * `petty_cash` — cash in hand, for an in-person handover at the till.
 */
export const CASH_DESTINATIONS = ['cash', 'petty_cash'] as const;

export type CashDestination = (typeof CASH_DESTINATIONS)[number];

export function isCashDestination(value: unknown): value is CashDestination {
  return typeof value === 'string' && (CASH_DESTINATIONS as readonly string[]).includes(value);
}

/** Human label for a destination — the ONE place the wording lives. */
export function cashDestinationLabel(destination: CashDestination): string {
  switch (destination) {
    case 'cash':
      return 'Bank account';
    case 'petty_cash':
      return 'Cash in hand';
    default: {
      const unreachable: never = destination;
      throw new Error(`unknown cash destination ${String(unreachable)}`);
    }
  }
}
