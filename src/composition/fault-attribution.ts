/**
 * Fault attribution value object + pure helpers.
 *
 * Answers ONE question every domain eventually asks: **when something goes
 * wrong, who bears the cost?** A returned item's shipping, a redelivery after a
 * failed drop, a re-issued card, an SLA credit, a scrapped inbound transfer —
 * all the same shape: a reason code implies a responsible party, and whoever is
 * responsible pays.
 *
 * The primitive is *pure data + pure helpers* — no persistence, no events, and
 * deliberately NO vocabulary of its own. Each domain owns its reason codes and
 * supplies a `FaultPolicy` mapping them to parties; the primitive owns the
 * attribution RULES, which are what actually drift between implementations.
 *
 * Consumers: `@classytic/order` (RMA return-shipping liability),
 * `@classytic/flow` (damaged inbound), `@classytic/carrier` (failed delivery
 * attempts), and any SLA credit built on `primitives/sla-policy`.
 *
 * ## Why this exists as a primitive
 *
 * `@classytic/order` documented "`merchantPaysReturnShipping` defaults from the
 * line-level reasons" and then shipped `input.merchantPaysReturnShipping ??
 * false`. The lookup never ran, so a `damaged_in_transit` return — squarely the
 * merchant's fault — billed the CUSTOMER for return shipping. Nothing threw;
 * the field held a plausible boolean.
 *
 * A boolean is the wrong type for this. `false` cannot distinguish "the
 * customer is responsible" from "nobody has decided yet", so the unset case
 * silently becomes a verdict against whoever `false` happens to mean. Modelling
 * the PARTY, with `unknown` as a real member, makes that impossible to express
 * by accident.
 *
 * @example
 * import { attributeFault, bearsCost } from '@classytic/primitives/fault-attribution';
 *
 * const RETURN_FAULT = {
 *   defective: 'merchant',
 *   damaged_in_transit: 'merchant',
 *   changed_mind: 'customer',
 * } as const;
 *
 * attributeFault(RETURN_FAULT, ['damaged_in_transit']);            // 'merchant'
 * attributeFault(RETURN_FAULT, ['changed_mind'], 'merchant');      // 'merchant' — explicit wins
 * attributeFault(RETURN_FAULT, ['act_of_god']);                    // 'unknown' — NOT 'customer'
 * bearsCost(attributeFault(RETURN_FAULT, ['defective']), 'merchant'); // true
 */

/**
 * Who is responsible for the cost.
 *
 * `unknown` is a first-class member, not a gap. An unrecognised reason is an
 * unanswered question, and answering it by default is how a system quietly
 * bills the wrong party — the same asymmetry that makes a payment timeout
 * `unknown` rather than `declined`.
 *
 * `shared` exists because real disputes settle that way (split shipping,
 * goodwill on a customer-fault return). It is a DECISION, so it is only ever
 * reachable through an explicit override — never inferred from a reason.
 */
export type FaultParty = 'merchant' | 'customer' | 'carrier' | 'shared' | 'unknown';

/** Reason code → responsible party. The domain owns the keys. */
export type FaultPolicy<TReason extends string = string> = Readonly<
  Partial<Record<TReason, FaultParty>>
>;

/**
 * Attribute fault across one or more reasons.
 *
 * Rules, in order:
 *
 * 1. **An explicit decision always wins.** A human or an upstream policy that
 *    said "the merchant covers this" outranks any reason lookup — a general
 *    default must never override a specific instruction.
 * 2. **Merchant fault is sticky.** If ANY reason is the merchant's fault, the
 *    whole claim is: a customer returning three items, one of them defective,
 *    is not asked to part-pay the shipping. This is the single rule most likely
 *    to be re-implemented differently per call site, which is why it lives here.
 * 3. **Carrier before customer.** A carrier-fault reason is not the customer's
 *    problem even though the merchant may recover it separately.
 * 4. **Otherwise the reasons must AGREE.** Mixed or unmapped reasons yield
 *    `unknown` rather than a guess.
 * 5. **No reasons at all is `unknown`**, never a party.
 */
export function attributeFault<TReason extends string>(
  policy: FaultPolicy<TReason>,
  reasons: readonly TReason[],
  explicit?: FaultParty | undefined,
): FaultParty {
  if (explicit !== undefined) return explicit;
  if (reasons.length === 0) return 'unknown';

  const parties = reasons.map((r) => policy[r] ?? 'unknown');
  if (parties.includes('merchant')) return 'merchant';
  if (parties.includes('carrier')) return 'carrier';

  const first = parties[0] as FaultParty;
  return parties.every((p) => p === first) ? first : 'unknown';
}

/**
 * Does `party` bear the cost?
 *
 * `shared` bears it for every named party — a split is not an escape from
 * paying. `unknown` bears nothing: an undecided claim must not auto-charge
 * anyone, which is the whole reason `unknown` is modelled.
 */
export function bearsCost(attributed: FaultParty, party: Exclude<FaultParty, 'unknown'>): boolean {
  if (attributed === 'unknown') return false;
  if (attributed === 'shared') return true;
  return attributed === party;
}

/**
 * True when attribution is still open and a human (or a later signal) must
 * decide. Use it to route a claim to review instead of letting it settle at a
 * default — an `unknown` that silently behaves like `customer` is the defect
 * this primitive exists to prevent.
 */
export function needsFaultReview(attributed: FaultParty): boolean {
  return attributed === 'unknown';
}
