/**
 * Generic, immutable status-change log.
 *
 * Every domain aggregate that has a state machine (Order, Lead, Opportunity,
 * Campaign, Subscription, Approval, Shipment, …) ends up reinventing the same
 * triple: `{ status, occurredAt, by? }` + an append-only array on the entity.
 * This module gives that pattern one canonical type and one zero-allocation
 * helper, so domains stay focused on their *transitions* not the bookkeeping.
 *
 * Pairs naturally with `state-machine`: the machine decides if a transition
 * is legal; this helper records the move that happened.
 *
 * Recording `durationInPriorMs` at write time means funnel-velocity reports
 * (avg time spent in "Qualification") fall out of a single field instead of
 * a re-walk over raw timestamps later.
 *
 * @example
 *   import { appendStatus, type StatusHistory } from '@classytic/primitives/status-history';
 *   import { defineStateMachine } from '@classytic/primitives/state-machine';
 *
 *   type LeadStatus = 'new' | 'qualified' | 'converted' | 'disqualified';
 *   const MACHINE = defineStateMachine<LeadStatus>({ ... });
 *
 *   function qualify(lead: Lead, by: string): Lead {
 *     MACHINE.assertTransition(lead.id, lead.status, 'qualified');
 *     return {
 *       ...lead,
 *       status: 'qualified',
 *       statusHistory: appendStatus(lead.statusHistory, 'qualified', { by }),
 *     };
 *   }
 */

/**
 * One row of the immutable history. Generic over the status enum so each
 * domain stays type-safe (`StatusChangeEntry<LeadStatus>` rejects
 * `'shipped'` at compile time).
 */
export interface StatusChangeEntry<TStatus extends string> {
  readonly status: TStatus;
  readonly occurredAt: Date;
  /** Who triggered the transition (user id, system actor name, etc.). */
  readonly by?: string;
  /** Free-form note — disqualify reason, comments, etc. */
  readonly note?: string;
  /**
   * Milliseconds spent in the previous status. `0` for the first entry.
   * Computed at write time so downstream funnel-velocity / SLA aggregates
   * never need to walk timestamps.
   */
  readonly durationInPriorMs: number;
}

/**
 * Convenience alias for entity fields: `statusHistory: StatusHistory<LeadStatus>`.
 */
export type StatusHistory<TStatus extends string> = readonly StatusChangeEntry<
  TStatus
>[];

export interface AppendOptions {
  by?: string;
  note?: string;
  /** Override the timestamp — useful for replay / migration. Defaults to `new Date()`. */
  at?: Date;
}

/**
 * Append a new status entry, computing `durationInPriorMs` from the last
 * entry (or `0` for the first row). Returns a fresh array — never mutates.
 *
 * The previous-entry lookup is `O(1)` (last element), so this is safe to
 * call from hot paths.
 */
export function appendStatus<TStatus extends string>(
  history: StatusHistory<TStatus>,
  status: TStatus,
  options: AppendOptions = {},
): StatusHistory<TStatus> {
  const now = options.at ?? new Date();
  const prior = history.length === 0 ? undefined : history[history.length - 1];
  const durationInPriorMs =
    prior === undefined
      ? 0
      : Math.max(0, now.getTime() - prior.occurredAt.getTime());

  const entry: StatusChangeEntry<TStatus> = {
    status,
    occurredAt: now,
    durationInPriorMs,
    ...(options.by !== undefined ? { by: options.by } : {}),
    ...(options.note !== undefined ? { note: options.note } : {}),
  };

  return [...history, entry];
}

/**
 * Time spent in a status across the entire history. Used for funnel-velocity
 * dashboards: "how long did this lead sit in `qualified` before it converted?".
 *
 * Counts duration on the entries that EXITED `status`. If the entity is
 * currently in `status` and hasn't transitioned out, the still-elapsing time
 * is added from `now`.
 */
export function timeInStatus<TStatus extends string>(
  history: StatusHistory<TStatus>,
  status: TStatus,
  now: Date = new Date(),
): number {
  let total = 0;
  for (let i = 0; i < history.length; i++) {
    const entry = history[i]!;
    if (i > 0 && history[i - 1]!.status === status) {
      // Entry `i` is the row that exited `status`. Its `durationInPriorMs`
      // is the time spent in `status`.
      total += entry.durationInPriorMs;
    }
  }
  // If the current (last) status is the target, add the still-running interval.
  if (history.length > 0 && history[history.length - 1]!.status === status) {
    total += Math.max(
      0,
      now.getTime() - history[history.length - 1]!.occurredAt.getTime(),
    );
  }
  return total;
}

/** Most recent entry, or `null` for an empty history. */
export function latestEntry<TStatus extends string>(
  history: StatusHistory<TStatus>,
): StatusChangeEntry<TStatus> | null {
  return history.length === 0 ? null : history[history.length - 1]!;
}

/** Most recent occurrence of `status`, or `null` if it never appeared. */
export function lastTransitionTo<TStatus extends string>(
  history: StatusHistory<TStatus>,
  status: TStatus,
): StatusChangeEntry<TStatus> | null {
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i]!.status === status) return history[i]!;
  }
  return null;
}
