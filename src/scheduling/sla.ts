/**
 * Service-Level Agreement value object + breach-detection helpers.
 *
 * Describes a target duration a task must complete within, along with what
 * to do when the deadline lapses. Consumers: `@classytic/flow` (wave picking,
 * shipment), `@classytic/order` (fulfillment), `@classytic/commission`
 * (statement close).
 *
 * Pure data + pure helpers. No scheduler, no events — hosts schedule the
 * check (cron, Temporal activity, webhook) and call {@link isBreached} at
 * evaluation time.
 *
 * @example
 * import { type SLA, isBreached, remainingMs, breachedAt } from '@classytic/primitives/sla';
 *
 * const sla: SLA = { targetDurationMs: 2 * 60 * 60 * 1000, breachPolicy: 'escalate' };
 * const startedAt = new Date('2026-04-17T10:00:00Z');
 * isBreached(sla, startedAt, new Date('2026-04-17T11:00:00Z')); // false (1h elapsed of 2h)
 * isBreached(sla, startedAt, new Date('2026-04-17T13:00:00Z')); // true
 * breachedAt(sla, startedAt); // → Date('2026-04-17T12:00:00Z')
 */

/**
 * Policy describing what a host should do when the SLA is breached. The
 * primitive does *not* execute the policy — the host reads this field and
 * decides (log a warn, page oncall, block the workflow, etc.).
 */
export type BreachPolicy = 'warn' | 'escalate' | 'block';

export interface SLA {
  /** Target duration in milliseconds. Must be a positive integer. */
  readonly targetDurationMs: number;
  readonly breachPolicy: BreachPolicy;
  /**
   * Optional stable reference to a host-defined action (webhook URL, workflow
   * name, alert route). The primitive just carries the string — host resolves.
   */
  readonly breachActionRef?: string;
  /** Optional human label — useful for dashboards and audit logs. */
  readonly label?: string;
}

export type SLAErrorCode = 'INVALID_TARGET' | 'INVALID_START';

export class SLAError extends Error {
  override readonly name = 'SLAError';
  readonly code: SLAErrorCode;

  constructor(code: SLAErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

/** Validate an SLA spec. Call this before storing host-side. */
export function validateSLA(sla: SLA): void {
  if (
    !Number.isInteger(sla.targetDurationMs) ||
    sla.targetDurationMs <= 0 ||
    !Number.isFinite(sla.targetDurationMs)
  ) {
    throw new SLAError(
      'INVALID_TARGET',
      `targetDurationMs must be a positive integer, got ${sla.targetDurationMs}`,
    );
  }
}

/**
 * The timestamp at which the SLA will be (or was) breached — `startedAt +
 * targetDurationMs`.
 */
export function breachedAt(sla: SLA, startedAt: Date): Date {
  validateSLA(sla);
  assertValidDate(startedAt);
  return new Date(startedAt.getTime() + sla.targetDurationMs);
}

/**
 * Milliseconds remaining before breach. Negative if already breached.
 * Clock source is passed explicitly so tests remain deterministic and
 * hosts can evaluate against any reference time.
 */
export function remainingMs(sla: SLA, startedAt: Date, now: Date = new Date()): number {
  validateSLA(sla);
  assertValidDate(startedAt);
  assertValidDate(now);
  const deadline = startedAt.getTime() + sla.targetDurationMs;
  return deadline - now.getTime();
}

/** Elapsed milliseconds since `startedAt`. */
export function elapsedMs(startedAt: Date, now: Date = new Date()): number {
  assertValidDate(startedAt);
  assertValidDate(now);
  return now.getTime() - startedAt.getTime();
}

/** True if `now` is at or past the deadline. */
export function isBreached(sla: SLA, startedAt: Date, now: Date = new Date()): boolean {
  return remainingMs(sla, startedAt, now) <= 0;
}

/**
 * Elapsed-fraction of the SLA window (0 = just started, 1 = exactly at
 * deadline, > 1 = breached). Useful for progress bars and early-warning
 * thresholds (e.g., warn at 80% consumed).
 */
export function consumedFraction(sla: SLA, startedAt: Date, now: Date = new Date()): number {
  validateSLA(sla);
  return elapsedMs(startedAt, now) / sla.targetDurationMs;
}

function assertValidDate(d: Date): void {
  if (Number.isNaN(d.getTime())) {
    throw new SLAError('INVALID_START', 'date is not a valid Date');
  }
}
