/**
 * Suspension policy — a time-bounded pause with a per-period allowance.
 *
 * ## What this is, and what it is not
 *
 * `/hold` already models a BLOCKING hold: a document cannot progress until someone
 * resolves it (fraud review, customs detention). It has no duration, no allowance
 * and no automatic end, because those are meaningless for a blocker.
 *
 * This models the other thing: a pause the subject is ENTITLED to take, bounded by
 * an allowance, that ends by itself. Three unrelated kernels need exactly that:
 *
 *   - a gym membership freeze — "60 days a year, minimum a week"
 *   - a subscription pause — the Netflix-style hold
 *   - unpaid leave — an annual cap, distinct from accrued paid leave
 *
 * (`hr/leave`'s balance is an accruing PERSISTED document — a different shape.
 * This is pure computation over a history, so it stays a primitive.)
 *
 * ## `autoResumeAt` is the whole point
 *
 * Without a computed end, "pause" is an indefinite free hold. Someone freezes in
 * February and the business quietly stops earning until an audit notices — which
 * is a revenue hole, not a bug report, so nobody files it. `evaluateSuspension`
 * always returns the instant the pause MUST end, so a sweep can resume it whether
 * or not the subject ever comes back.
 *
 * ## Dates
 *
 * Day boundaries come from `/calendar`'s offset-based helpers and periods from
 * `/period` — never server-local getters. A "60 days per year" allowance computed
 * with `getMonth()` shifts with the deploy machine's `TZ`, so the same member would
 * have a different balance in two regions. The offset is a CALLER decision
 * (business timezone), which is why it is a parameter with no default beyond UTC.
 *
 * PURE: no clock reads beyond the `at` you pass, no I/O. The same evaluation runs
 * on the server, in an admin preview, and in a test.
 */

import { addMonths, startOfDay, type UtcOffsetMinutes } from '../scheduling/calendar.js';
import { type DateRange, rangesOverlap } from '../scheduling/period.js';
import type { StatusChangeEntry } from './status-history.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * One suspension, past or current.
 *
 * `endedAt` absent or `null` means STILL OPEN — counted up to the evaluation
 * instant, because an open freeze is consuming allowance right now. Treating an
 * open span as zero is how an indefinite pause looks free.
 */
export interface SuspensionSpan {
  readonly startedAt: Date;
  readonly endedAt?: Date | null;
  readonly reason?: string;
}

/**
 * The rulebook. Every field optional; an empty policy permits an unbounded pause,
 * so a host that has not decided yet gets today's (lenient) behaviour rather than
 * a surprise refusal.
 */
export interface SuspensionPolicy {
  /** `false` refuses outright — many gyms allow a freeze only on medical grounds. */
  readonly allowed?: boolean;
  /** Total suspended days permitted per period. Omit for unlimited. */
  readonly maxDaysPerPeriod?: number;
  /** Length of the allowance period in months. Default 12. */
  readonly periodMonths?: number;
  /** Shortest permitted single pause — stops pause-every-weekend gaming. */
  readonly minDays?: number;
  /** Longest permitted single pause, independent of the period allowance. */
  readonly maxDays?: number;
  /** How many may be open at once. Default 1. */
  readonly maxConcurrent?: number;
  /** Days of advance notice required before a pause may start. */
  readonly noticeDays?: number;
  /**
   * Does resuming push the access window out by the frozen duration?
   *
   * Carried here because it is the same decision, made by the same person, as the
   * rest of the pause rules — but note this primitive only REPORTS it. Applying it
   * is the entitlement kernel's job (`resume({ creditFrozenDays })`), because only
   * that kernel owns the window.
   */
  readonly creditsWindow?: boolean;
}

export type SuspensionRefusal =
  | 'not_allowed'
  | 'allowance_exhausted'
  | 'below_minimum'
  | 'above_maximum'
  | 'already_suspended'
  | 'insufficient_notice';

export interface SuspensionDecision {
  readonly allowed: boolean;
  readonly reason: SuspensionRefusal | 'approved';
  /** Operator-facing explanation. Present on every refusal. */
  readonly message?: string;
  /**
   * When the pause must end — `min(requested end, allowance cap)`.
   *
   * `null` only when the policy sets no bound at all. A sweep resumes on this
   * instant regardless of whether the subject asks.
   */
  readonly autoResumeAt?: Date | null;
  /** Days already consumed in the period containing the requested start. */
  readonly daysUsedInPeriod: number;
  /** Remaining allowance, or `null` when unlimited. */
  readonly daysRemainingInPeriod: number | null;
}

export interface SuspensionRequest {
  readonly startsAt: Date;
  /** Requested end. Omit for open-ended — the allowance then decides. */
  readonly endsAt?: Date | null;
  /** When the request is being made, for the notice check. Defaults to `startsAt`. */
  readonly requestedAt?: Date;
}

export interface SuspensionEvalOptions {
  /** Minutes east of UTC for day boundaries — the BUSINESS timezone offset. */
  readonly offsetMinutes?: UtcOffsetMinutes;
}

/** The allowance period containing `at`, as a half-open range. */
export function allowancePeriod(
  at: Date,
  periodMonths = 12,
  offsetMinutes: UtcOffsetMinutes = 0,
): DateRange {
  // Trailing window, not a calendar year: a calendar allowance resets every
  // 1 January and lets a member freeze December and January back to back for
  // double the intended cap.
  //
  // The START is day-aligned so the window does not slide by the second (two
  // evaluations moments apart must agree), but the END is `at` itself — NOT
  // `startOfDay(at)`. Ending at the start of today excludes today's frozen hours,
  // which under-counts usage by up to a day on every evaluation and therefore
  // hands out allowance nobody granted. Found by a test that expected 10 days
  // remaining and got 11.
  const anchor = startOfDay(at, offsetMinutes);
  return { start: addMonths(anchor, -periodMonths), end: at };
}

/**
 * Whole days of suspension inside `period`.
 *
 * Counts the OVERLAP, not the spans that merely start inside — a freeze running
 * 15 Dec → 15 Feb must consume only its December days against the period ending in
 * December. Ignoring that double-counts a straddling pause in both periods and
 * refuses a member who is within their allowance.
 */
export function suspendedDaysInPeriod(
  history: readonly SuspensionSpan[],
  period: DateRange,
  /** Now — bounds still-open spans. Defaults to the period end. */
  at?: Date,
): number {
  const openEnd = at ?? period.end;
  let ms = 0;
  for (const span of history) {
    const spanEnd = span.endedAt ?? openEnd;
    // Defensive: a reversed span (bad data, a clock correction) would otherwise
    // contribute negative days and INFLATE the remaining allowance.
    if (spanEnd.getTime() <= span.startedAt.getTime()) continue;
    const range: DateRange = { start: span.startedAt, end: spanEnd };
    if (!rangesOverlap(range, period)) continue;
    const from = Math.max(range.start.getTime(), period.start.getTime());
    const to = Math.min(range.end.getTime(), period.end.getTime());
    ms += Math.max(0, to - from);
  }
  // Round rather than floor: a 30-day freeze recorded with a few seconds of clock
  // skew must count as 30, not 29.
  return Math.round(ms / MS_PER_DAY);
}

/** Is any span still open at `at`? */
export function openSpans(history: readonly SuspensionSpan[], at: Date): readonly SuspensionSpan[] {
  return history.filter(
    (s) => (s.endedAt ?? null) === null && s.startedAt.getTime() <= at.getTime(),
  );
}

/**
 * Decide a pause request, and say when it must end.
 *
 * Refusal precedence is deliberate — most categorical first, so the message names
 * the reason a human would give:
 *   1. `not_allowed`          — the product has no freeze at all
 *   2. `already_suspended`    — concurrency
 *   3. `insufficient_notice`  — asked too late
 *   4. `below_minimum` / `above_maximum` — this single pause is the wrong length
 *   5. `allowance_exhausted`  — nothing left in the period
 */
export function evaluateSuspension(
  request: SuspensionRequest,
  history: readonly SuspensionSpan[],
  policy: SuspensionPolicy = {},
  options: SuspensionEvalOptions = {},
): SuspensionDecision {
  const offset = options.offsetMinutes ?? 0;
  const periodMonths = policy.periodMonths ?? 12;
  const period = allowancePeriod(request.startsAt, periodMonths, offset);
  const daysUsed = suspendedDaysInPeriod(history, period, request.startsAt);
  const cap = policy.maxDaysPerPeriod;
  const remaining = cap === undefined ? null : Math.max(0, cap - daysUsed);

  const refuse = (reason: SuspensionRefusal, message: string): SuspensionDecision => ({
    allowed: false,
    reason,
    message,
    daysUsedInPeriod: daysUsed,
    daysRemainingInPeriod: remaining,
  });

  if (policy.allowed === false) {
    return refuse('not_allowed', 'Pausing is not available on this product.');
  }

  const maxConcurrent = policy.maxConcurrent ?? 1;
  if (openSpans(history, request.startsAt).length >= maxConcurrent) {
    return refuse('already_suspended', 'There is already an active pause.');
  }

  if (policy.noticeDays !== undefined && policy.noticeDays > 0) {
    const requestedAt = request.requestedAt ?? request.startsAt;
    const noticeGiven = Math.round(
      (startOfDay(request.startsAt, offset).getTime() - startOfDay(requestedAt, offset).getTime()) /
        MS_PER_DAY,
    );
    if (noticeGiven < policy.noticeDays) {
      return refuse(
        'insufficient_notice',
        `${policy.noticeDays} day(s) notice required; ${noticeGiven} given.`,
      );
    }
  }

  // Requested length, when the caller named an end.
  const requestedDays =
    request.endsAt != null
      ? Math.round((request.endsAt.getTime() - request.startsAt.getTime()) / MS_PER_DAY)
      : null;

  if (requestedDays !== null) {
    if (requestedDays <= 0) {
      return refuse('below_minimum', 'A pause must end after it starts.');
    }
    if (policy.minDays !== undefined && requestedDays < policy.minDays) {
      return refuse(
        'below_minimum',
        `The shortest pause is ${policy.minDays} day(s); ${requestedDays} requested.`,
      );
    }
    if (policy.maxDays !== undefined && requestedDays > policy.maxDays) {
      return refuse(
        'above_maximum',
        `The longest single pause is ${policy.maxDays} day(s); ${requestedDays} requested.`,
      );
    }
  }

  if (remaining !== null && remaining <= 0) {
    return refuse(
      'allowance_exhausted',
      `The ${periodMonths}-month allowance of ${cap!} day(s) is used up.`,
    );
  }

  // ── The cap. `min(requested end, allowance end, single-pause max) ──────────
  const candidates: number[] = [];
  if (request.endsAt != null) candidates.push(request.endsAt.getTime());
  if (remaining !== null) candidates.push(request.startsAt.getTime() + remaining * MS_PER_DAY);
  if (policy.maxDays !== undefined) {
    candidates.push(request.startsAt.getTime() + policy.maxDays * MS_PER_DAY);
  }

  return {
    allowed: true,
    reason: 'approved',
    // `null` ONLY when nothing bounds it — an open-ended request under a policy
    // with no allowance and no maximum. That is a deliberate configuration, and a
    // caller can refuse it if an unbounded pause is unacceptable.
    autoResumeAt: candidates.length > 0 ? new Date(Math.min(...candidates)) : null,
    daysUsedInPeriod: daysUsed,
    daysRemainingInPeriod: remaining,
  };
}

/**
 * Is this open pause past the instant it should have ended?
 *
 * What an auto-resume sweep asks. Kept separate from `evaluateSuspension` because
 * the sweep has an ALREADY-DECIDED `autoResumeAt` and must not re-derive it — the
 * policy may have changed since the pause began, and silently re-deciding would
 * move a date the member was told.
 */
export function dueForAutoResume(
  span: SuspensionSpan & { readonly autoResumeAt?: Date | null },
  at: Date,
): boolean {
  if ((span.endedAt ?? null) !== null) return false;
  const due = span.autoResumeAt ?? null;
  return due !== null && due.getTime() <= at.getTime();
}

/**
 * Derive suspension spans from a status log — the seam that makes an allowance
 * ENFORCEABLE rather than caller-supplied.
 *
 * ## Why this exists
 *
 * `evaluateSuspension` needs the history of every past pause. Aggregates do not
 * carry that: they carry a single `suspendedAt` that each new freeze overwrites, so
 * "60 days per year" is unenforceable — a member could freeze twelve times and the
 * eleventh looks identical to the first.
 *
 * What they DO carry (or should, per `/status-history`) is an append-only status
 * log. Every pause is already in there as a transition INTO the paused status, and
 * every resume as the transition out. This turns that log into the spans the
 * allowance maths needs, so nothing has to be denormalised twice and the two
 * primitives compose instead of overlapping.
 *
 * ## Assumes the log is chronological
 *
 * `appendStatus` guarantees that by construction (it appends and computes
 * `durationInPriorMs` from the previous element), so this does not re-sort — a sort
 * here would silently paper over a corrupt log that the caller should be told
 * about, and would cost O(n log n) on a hot read.
 *
 * @param pausedStatus the status that MEANS suspended (`'suspended'`, `'paused'`,
 *   `'on_hold'` — domains name it differently, so it is a parameter)
 */
export function spansFromStatusHistory<TStatus extends string>(
  history: readonly StatusChangeEntry<TStatus>[],
  pausedStatus: TStatus,
  options: {
    /**
     * The aggregate's status NOW. When it is not the paused status, a trailing
     * paused entry is treated as CLOSED — the log simply has not recorded the
     * resume yet (a crash between the write and the append). Leaving it open would
     * charge the member allowance for time they were not frozen.
     */
    readonly currentStatus?: TStatus | undefined;
    /** Closes a genuinely-open trailing span for counting. Defaults to open. */
    readonly openEndedAt?: Date | undefined;
  } = {},
): SuspensionSpan[] {
  const spans: SuspensionSpan[] = [];
  for (let i = 0; i < history.length; i += 1) {
    const entry = history[i]!;
    if (entry.status !== pausedStatus) continue;

    const next = history[i + 1];
    if (next !== undefined) {
      spans.push({
        startedAt: entry.occurredAt,
        endedAt: next.occurredAt,
        ...(entry.note !== undefined ? { reason: entry.note } : {}),
      });
      continue;
    }

    // Trailing entry — open only if the aggregate is still paused.
    const stillPaused =
      options.currentStatus === undefined || options.currentStatus === pausedStatus;
    spans.push({
      startedAt: entry.occurredAt,
      endedAt: stillPaused ? (options.openEndedAt ?? null) : entry.occurredAt,
      ...(entry.note !== undefined ? { reason: entry.note } : {}),
    });
  }
  return spans;
}
