/**
 * Higher-order SLA: priority matrix + first-response/rolling semantics.
 *
 * `./sla` already ships a tight, single-duration SLA value object. That's
 * the right shape for "fulfillment must complete in 2h" — one duration, one
 * breach policy. CRM-style SLAs are richer: a `lead` has a *first-response*
 * SLA (SDR replies within Xh) AND a *rolling-response* SLA (every reply
 * within Yh), and both depend on lead priority + the company's working
 * hours. This module captures that shape — Priority matrix +
 * first-response/rolling semantics + working-hours window + holidays.
 *
 * Composition: this module DOES NOT replace `./sla`. It derives concrete
 * `SLA` instances from a higher-order `SLAPolicy` + a priority key + a
 * starting timestamp. Existing consumers of `./sla` keep working unchanged.
 *
 * @example
 *   import {
 *     defineSLAPolicy,
 *     deriveFirstResponseSLA,
 *     evaluateSLAStatus,
 *   } from '@classytic/primitives/sla-policy';
 *
 *   const policy = defineSLAPolicy({
 *     name: 'Lead response',
 *     priorities: {
 *       urgent: { firstResponseMs: 30 * 60_000,  rollingResponseMs: 60 * 60_000 },
 *       high:   { firstResponseMs:  2 * 3600_000, rollingResponseMs: 4 * 3600_000 },
 *       normal: { firstResponseMs:  8 * 3600_000, rollingResponseMs: 24 * 3600_000 },
 *     },
 *     defaultPriority: 'normal',
 *     workingHours: {
 *       weekdays: [1, 2, 3, 4, 5], // Mon–Fri
 *       startMinute: 9 * 60,        // 09:00 local
 *       endMinute: 18 * 60,         // 18:00 local
 *     },
 *   });
 *
 *   const status = evaluateSLAStatus(policy, {
 *     priority: 'urgent',
 *     startedAt: lead.createdAt,
 *     firstRespondedAt: null,
 *     lastRespondedAt: null,
 *   });
 *   // → { kind: 'FirstResponseDue', responseBy: Date, breached: boolean, ... }
 */

import type { IsoWeekday } from './cadence.js';
import { isBreached as isSLABreached, remainingMs, type SLA } from './sla.js';

// ─── Policy ───────────────────────────────────────────────────────────────

/**
 * Tier of severity. Hosts decide the keys ('urgent' / 'p0' / 'gold' / etc.) —
 * keep them stable across the org so reports and routing stay consistent.
 */
export type PriorityKey = string;

export interface PriorityRule {
  /** Time allotted for the FIRST reply. */
  readonly firstResponseMs: number;
  /** Time allotted for EACH subsequent reply (after first response was made). */
  readonly rollingResponseMs: number;
}

/**
 * Working-hours window. Times are minutes-since-midnight in the org's
 * timezone — same convention as `cadence` for ISO weekdays.
 *
 * For simple "always on" SLAs, omit this field entirely.
 */
export interface WorkingHours {
  /** ISO weekdays when work happens (1=Mon … 7=Sun). */
  readonly weekdays: readonly IsoWeekday[];
  readonly startMinute: number;
  readonly endMinute: number;
  /**
   * IANA timezone (e.g. `'Asia/Dhaka'`). Optional — pure math here is UTC,
   * but the host can localize when displaying.
   */
  readonly timezone?: string;
  /**
   * Dates to skip entirely (holidays). Stored as YYYY-MM-DD strings so
   * round-trips through JSON stay lossless.
   */
  readonly holidays?: readonly string[];
}

export interface SLAPolicy {
  readonly id?: string;
  readonly name: string;
  /** Map of priority → durations. Must include `defaultPriority`. */
  readonly priorities: Readonly<Record<PriorityKey, PriorityRule>>;
  readonly defaultPriority: PriorityKey;
  /** Optional — omit for 24/7 SLAs. */
  readonly workingHours?: WorkingHours;
  /** Optional human label for dashboards. */
  readonly label?: string;
}

export type SLAPolicyErrorCode =
  | 'EMPTY_PRIORITIES'
  | 'UNKNOWN_DEFAULT'
  | 'INVALID_DURATION'
  | 'INVALID_HOURS';

export class SLAPolicyError extends Error {
  override readonly name = 'SLAPolicyError';
  readonly code: SLAPolicyErrorCode;
  constructor(code: SLAPolicyErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

/** Validate + freeze. Use this when registering a policy at app boot. */
export function defineSLAPolicy(spec: SLAPolicy): SLAPolicy {
  const keys = Object.keys(spec.priorities);
  if (keys.length === 0) {
    throw new SLAPolicyError('EMPTY_PRIORITIES', 'priorities map is empty');
  }
  if (!keys.includes(spec.defaultPriority)) {
    throw new SLAPolicyError(
      'UNKNOWN_DEFAULT',
      `defaultPriority '${spec.defaultPriority}' is not present in priorities map`,
    );
  }
  for (const [key, rule] of Object.entries(spec.priorities)) {
    if (
      !Number.isFinite(rule.firstResponseMs) ||
      rule.firstResponseMs <= 0 ||
      !Number.isFinite(rule.rollingResponseMs) ||
      rule.rollingResponseMs <= 0
    ) {
      throw new SLAPolicyError('INVALID_DURATION', `priority '${key}' has non-positive duration`);
    }
  }
  if (spec.workingHours !== undefined) {
    const wh = spec.workingHours;
    if (
      wh.startMinute < 0 ||
      wh.startMinute >= 24 * 60 ||
      wh.endMinute <= wh.startMinute ||
      wh.endMinute > 24 * 60 ||
      wh.weekdays.length === 0
    ) {
      throw new SLAPolicyError('INVALID_HOURS', 'workingHours bounds are invalid');
    }
  }
  return spec;
}

// ─── Deriving a concrete SLA from the policy + priority ───────────────────

/**
 * Convert a `SLAPolicy + priority` into the simpler `SLA` value object the
 * `./sla` module already knows how to evaluate. The host stores the policy
 * once; per-entity it persists `{ slaPolicyId, priority, startedAt }` and
 * derives the SLA on demand.
 */
export function deriveFirstResponseSLA(policy: SLAPolicy, priority?: PriorityKey): SLA {
  const rule = priorityRule(policy, priority);
  return {
    targetDurationMs: rule.firstResponseMs,
    breachPolicy: 'escalate',
    label: `${policy.name} · first response · ${priority ?? policy.defaultPriority}`,
  };
}

export function deriveRollingResponseSLA(policy: SLAPolicy, priority?: PriorityKey): SLA {
  const rule = priorityRule(policy, priority);
  return {
    targetDurationMs: rule.rollingResponseMs,
    breachPolicy: 'escalate',
    label: `${policy.name} · rolling response · ${priority ?? policy.defaultPriority}`,
  };
}

function priorityRule(policy: SLAPolicy, priority?: PriorityKey): PriorityRule {
  const key = priority ?? policy.defaultPriority;
  const rule = policy.priorities[key] ?? policy.priorities[policy.defaultPriority];
  if (rule === undefined) {
    // Defensive — `defineSLAPolicy` would have rejected this at construction.
    throw new SLAPolicyError(
      'UNKNOWN_DEFAULT',
      `priority '${key}' not found and defaultPriority resolution failed`,
    );
  }
  return rule;
}

// ─── Status evaluator ─────────────────────────────────────────────────────

/**
 * Materialized SLA state at evaluation time. Hosts persist the inputs
 * (`startedAt`, `firstRespondedAt`, `lastRespondedAt`); the output is derived
 * on read so changes to the policy take effect immediately.
 */
export type SLAStatusKind =
  | 'FirstResponseDue'
  | 'FirstResponseFulfilled'
  | 'RollingResponseDue'
  | 'Failed';

export interface SLAStatus {
  readonly kind: SLAStatusKind;
  readonly responseBy: Date;
  readonly remainingMs: number;
  readonly breached: boolean;
  /** Which SLA was driving the deadline calculation. */
  readonly underlying: SLA;
}

export interface SLAInputs {
  readonly priority?: PriorityKey;
  readonly startedAt: Date;
  /** Set when the first agent reply has been recorded. */
  readonly firstRespondedAt: Date | null;
  /**
   * Set to the most recent agent reply that closed the rolling window.
   * Falls back to `firstRespondedAt` when no rolling cycle has elapsed.
   */
  readonly lastRespondedAt: Date | null;
}

/**
 * Compute current SLA status against a policy. Pure — no clock side effects
 * beyond the explicit `now` argument.
 *
 * Decision table:
 *   - firstRespondedAt == null  → FirstResponseDue/Failed against firstResponseMs
 *   - firstRespondedAt set, no further outstanding cycle → FirstResponseFulfilled
 *   - firstRespondedAt set + a rolling cycle has started → RollingResponseDue/Failed
 *
 * The "rolling cycle has started" half is host-driven: when the customer
 * replies again, the host sets `lastRespondedAt` to the prior agent reply
 * and the SLA clock resumes from there. Until that happens, the status is
 * `FirstResponseFulfilled`.
 */
export function evaluateSLAStatus(
  policy: SLAPolicy,
  inputs: SLAInputs,
  now: Date = new Date(),
): SLAStatus {
  if (inputs.firstRespondedAt === null) {
    const sla = deriveFirstResponseSLA(policy, inputs.priority);
    const responseBy = new Date(inputs.startedAt.getTime() + sla.targetDurationMs);
    const breached = isSLABreached(sla, inputs.startedAt, now);
    return {
      kind: breached ? 'Failed' : 'FirstResponseDue',
      responseBy,
      remainingMs: remainingMs(sla, inputs.startedAt, now),
      breached,
      underlying: sla,
    };
  }

  // First response is done. If there's no rolling cycle outstanding, we're
  // in the fulfilled-but-watchful state.
  const rollingBase = inputs.lastRespondedAt ?? inputs.firstRespondedAt;
  if (rollingBase === inputs.firstRespondedAt && inputs.lastRespondedAt === null) {
    // Host hasn't opened a rolling window — treat as fulfilled.
    const sla = deriveFirstResponseSLA(policy, inputs.priority);
    return {
      kind: 'FirstResponseFulfilled',
      responseBy: new Date(inputs.firstRespondedAt.getTime()),
      remainingMs: 0,
      breached: false,
      underlying: sla,
    };
  }

  const sla = deriveRollingResponseSLA(policy, inputs.priority);
  const responseBy = new Date(rollingBase.getTime() + sla.targetDurationMs);
  const breached = isSLABreached(sla, rollingBase, now);
  return {
    kind: breached ? 'Failed' : 'RollingResponseDue',
    responseBy,
    remainingMs: remainingMs(sla, rollingBase, now),
    breached,
    underlying: sla,
  };
}

// ─── Working-hours helpers ────────────────────────────────────────────────

/**
 * Is `instant` within the policy's working hours? Returns `true` when the
 * policy has no `workingHours` defined (always-on SLA).
 *
 * NOTE: math here is UTC-based for determinism — if the host needs the
 * policy in local time, normalize `instant` to the policy's `timezone`
 * before passing in. Bringing a tz lib into `@classytic/primitives` is a
 * dep we don't want.
 */
export function isWithinWorkingHours(policy: SLAPolicy, instant: Date): boolean {
  if (!policy.workingHours) return true;
  const wh = policy.workingHours;

  // UTC-ISO 8601 weekday: getUTCDay() returns 0=Sun…6=Sat; convert to 1=Mon…7=Sun.
  const weekday: IsoWeekday = (((instant.getUTCDay() + 6) % 7) + 1) as IsoWeekday;
  if (!wh.weekdays.includes(weekday)) return false;

  if (wh.holidays !== undefined && wh.holidays.length > 0) {
    const isoDate = instant.toISOString().slice(0, 10);
    if (wh.holidays.includes(isoDate)) return false;
  }

  const minuteOfDay = instant.getUTCHours() * 60 + instant.getUTCMinutes();
  return minuteOfDay >= wh.startMinute && minuteOfDay < wh.endMinute;
}
