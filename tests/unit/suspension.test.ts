/**
 * Suspension policy — the pause rulebook.
 *
 * The expensive cases are the ones that look like edge cases and are not:
 * a straddling freeze double-counted against two periods refuses a member who is
 * within their allowance, and an open-ended pause with no computed end is an
 * indefinite free hold nobody notices.
 */
import { describe, expect, it } from 'vitest';
import {
  allowancePeriod,
  dueForAutoResume,
  evaluateSuspension,
  openSpans,
  suspendedDaysInPeriod,
  type SuspensionSpan,
} from '../../src/workflow/suspension.js';

const d = (iso: string) => new Date(iso);
const DAY = 24 * 60 * 60 * 1000;

describe('counting allowance', () => {
  it('counts a closed span in whole days', () => {
    const period = allowancePeriod(d('2026-07-01T00:00:00Z'));
    const history: SuspensionSpan[] = [
      { startedAt: d('2026-02-01T00:00:00Z'), endedAt: d('2026-03-03T00:00:00Z') },
    ];
    expect(suspendedDaysInPeriod(history, period)).toBe(30);
  });

  it('counts only the OVERLAP of a straddling freeze', () => {
    // 15 Dec → 15 Feb against the period ending 1 Jan: only the December days
    // belong to it. Counting the whole span in both periods would consume ~62 days
    // of a 60-day allowance twice and refuse a member who is well within it.
    const period = allowancePeriod(d('2026-01-01T00:00:00Z'));
    const history: SuspensionSpan[] = [
      { startedAt: d('2025-12-15T00:00:00Z'), endedAt: d('2026-02-15T00:00:00Z') },
    ];
    expect(suspendedDaysInPeriod(history, period)).toBe(17);
  });

  it('counts an OPEN span up to now — an indefinite pause is not free', () => {
    const at = d('2026-04-01T00:00:00Z');
    const period = allowancePeriod(at);
    const history: SuspensionSpan[] = [{ startedAt: d('2026-03-02T00:00:00Z') }];
    expect(suspendedDaysInPeriod(history, period, at)).toBe(30);
  });

  it('ignores a reversed span rather than crediting negative days', () => {
    // Bad data or a clock correction. A negative contribution would INFLATE the
    // remaining allowance and let a member freeze beyond the cap.
    const period = allowancePeriod(d('2026-07-01T00:00:00Z'));
    const history: SuspensionSpan[] = [
      { startedAt: d('2026-03-01T00:00:00Z'), endedAt: d('2026-02-01T00:00:00Z') },
    ];
    expect(suspendedDaysInPeriod(history, period)).toBe(0);
  });

  it('uses a TRAILING period, not a calendar year', () => {
    // A calendar-year allowance resets on 1 January, so a member could freeze all
    // December and all January for double the intended cap.
    const period = allowancePeriod(d('2026-07-01T00:00:00Z'), 12);
    expect(period.start.getUTCFullYear()).toBe(2025);
    expect(period.start.getUTCMonth()).toBe(6); // July 2025
  });
});

describe('deciding a request', () => {
  const policy = { maxDaysPerPeriod: 60, minDays: 7, periodMonths: 12 };

  it('approves a request within the allowance and caps its end', () => {
    const start = d('2026-02-01T00:00:00Z');
    const decision = evaluateSuspension(
      { startsAt: start, endsAt: d('2026-03-01T00:00:00Z') },
      [],
      policy,
    );
    expect(decision.allowed).toBe(true);
    expect(decision.daysUsedInPeriod).toBe(0);
    expect(decision.daysRemainingInPeriod).toBe(60);
    // Requested end is inside the allowance, so it wins.
    expect(decision.autoResumeAt!.toISOString()).toBe('2026-03-01T00:00:00.000Z');
  });

  it('TRUNCATES an open-ended pause to the allowance — the revenue fix', () => {
    // The Feb-to-July case: with a 60-day cap the pause must auto-resume in April,
    // whether or not the member comes back. Without this the business stops
    // earning and nobody files a bug, because nothing looks broken.
    const start = d('2026-02-01T00:00:00Z');
    const decision = evaluateSuspension({ startsAt: start }, [], policy);
    expect(decision.allowed).toBe(true);
    expect(decision.autoResumeAt!.getTime()).toBe(start.getTime() + 60 * DAY);
  });

  it('caps at the REMAINING allowance, not the full one', () => {
    const start = d('2026-06-01T00:00:00Z');
    const history: SuspensionSpan[] = [
      { startedAt: d('2026-01-01T00:00:00Z'), endedAt: d('2026-02-20T00:00:00Z') }, // 50 days
    ];
    const decision = evaluateSuspension({ startsAt: start }, history, policy);
    expect(decision.daysUsedInPeriod).toBe(50);
    expect(decision.daysRemainingInPeriod).toBe(10);
    expect(decision.autoResumeAt!.getTime()).toBe(start.getTime() + 10 * DAY);
  });

  it('refuses when the allowance is used up', () => {
    const history: SuspensionSpan[] = [
      { startedAt: d('2026-01-01T00:00:00Z'), endedAt: d('2026-03-02T00:00:00Z') }, // 60
    ];
    const decision = evaluateSuspension({ startsAt: d('2026-06-01T00:00:00Z') }, history, policy);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('allowance_exhausted');
    expect(decision.message).toContain('60');
  });

  it('refuses a pause shorter than the minimum — anti-gaming', () => {
    const decision = evaluateSuspension(
      { startsAt: d('2026-02-01T00:00:00Z'), endsAt: d('2026-02-03T00:00:00Z') },
      [],
      policy,
    );
    expect(decision.reason).toBe('below_minimum');
  });

  it('refuses a second concurrent pause', () => {
    const history: SuspensionSpan[] = [{ startedAt: d('2026-01-15T00:00:00Z') }];
    const decision = evaluateSuspension({ startsAt: d('2026-02-01T00:00:00Z') }, history, policy);
    expect(decision.reason).toBe('already_suspended');
  });

  it('refuses outright when the product has no freeze', () => {
    const decision = evaluateSuspension(
      { startsAt: d('2026-02-01T00:00:00Z') },
      [],
      { allowed: false },
    );
    expect(decision.reason).toBe('not_allowed');
  });

  it('enforces a notice period', () => {
    const refused = evaluateSuspension(
      {
        startsAt: d('2026-02-02T00:00:00Z'),
        requestedAt: d('2026-02-01T00:00:00Z'),
        endsAt: d('2026-03-01T00:00:00Z'),
      },
      [],
      { ...policy, noticeDays: 7 },
    );
    expect(refused.reason).toBe('insufficient_notice');
    expect(refused.message).toContain('7');

    const ok = evaluateSuspension(
      {
        startsAt: d('2026-02-10T00:00:00Z'),
        requestedAt: d('2026-02-01T00:00:00Z'),
        endsAt: d('2026-03-01T00:00:00Z'),
      },
      [],
      { ...policy, noticeDays: 7 },
    );
    expect(ok.allowed).toBe(true);
  });

  it('caps a single pause independently of the period allowance', () => {
    const start = d('2026-02-01T00:00:00Z');
    const decision = evaluateSuspension({ startsAt: start }, [], {
      maxDaysPerPeriod: 90,
      maxDays: 30,
    });
    // The tighter of the two bounds wins.
    expect(decision.autoResumeAt!.getTime()).toBe(start.getTime() + 30 * DAY);
  });

  it('returns a NULL end only when nothing bounds the pause', () => {
    // A deliberate configuration, reported honestly so a caller can refuse it
    // rather than discovering an unbounded hold later.
    const decision = evaluateSuspension({ startsAt: d('2026-02-01T00:00:00Z') }, [], {});
    expect(decision.allowed).toBe(true);
    expect(decision.autoResumeAt ?? null).toBeNull();
    expect(decision.daysRemainingInPeriod).toBeNull();
  });

  it('refuses an end that precedes its start', () => {
    const decision = evaluateSuspension(
      { startsAt: d('2026-03-01T00:00:00Z'), endsAt: d('2026-02-01T00:00:00Z') },
      [],
      policy,
    );
    expect(decision.allowed).toBe(false);
  });
});

describe('the auto-resume sweep', () => {
  it('fires on an open pause past its computed end', () => {
    const span = {
      startedAt: d('2026-02-01T00:00:00Z'),
      autoResumeAt: d('2026-04-02T00:00:00Z'),
    };
    expect(dueForAutoResume(span, d('2026-04-03T00:00:00Z'))).toBe(true);
    expect(dueForAutoResume(span, d('2026-03-01T00:00:00Z'))).toBe(false);
  });

  it('never fires on an already-closed pause', () => {
    expect(
      dueForAutoResume(
        {
          startedAt: d('2026-02-01T00:00:00Z'),
          endedAt: d('2026-02-20T00:00:00Z'),
          autoResumeAt: d('2026-04-02T00:00:00Z'),
        },
        d('2026-05-01T00:00:00Z'),
      ),
    ).toBe(false);
  });

  it('does NOT re-derive the end from current policy', () => {
    // A pause with no stored end is left alone. Re-deriving it would move a date
    // the member was already told, using a policy that may have changed since.
    expect(dueForAutoResume({ startedAt: d('2026-02-01T00:00:00Z') }, d('2027-01-01T00:00:00Z'))).toBe(
      false,
    );
  });

  it('reports open spans', () => {
    const history: SuspensionSpan[] = [
      { startedAt: d('2026-01-01T00:00:00Z'), endedAt: d('2026-01-10T00:00:00Z') },
      { startedAt: d('2026-02-01T00:00:00Z') },
      { startedAt: d('2026-09-01T00:00:00Z') }, // future — not open yet
    ];
    expect(openSpans(history, d('2026-03-01T00:00:00Z'))).toHaveLength(1);
  });
});

describe('the allowance window includes TODAY', () => {
  it('counts frozen time up to the evaluation instant', () => {
    // Ending the window at `startOfDay(at)` excluded today's hours, so usage was
    // under-counted by up to a day on every evaluation — quietly handing out
    // allowance nobody granted. A member 50 days into a 60-day cap must have 10
    // left, not 11.
    const now = d('2026-06-20T18:30:00Z');
    const history: SuspensionSpan[] = [
      { startedAt: d('2026-05-01T18:30:00Z'), endedAt: now },
    ];
    const period = allowancePeriod(now);
    expect(suspendedDaysInPeriod(history, period, now)).toBe(50);

    const decision = evaluateSuspension({ startsAt: now }, history, {
      maxDaysPerPeriod: 60,
    });
    expect(decision.daysRemainingInPeriod).toBe(10);
  });

  it('keeps the window START day-aligned so it does not slide by the second', () => {
    const a = allowancePeriod(d('2026-06-20T00:00:01Z'));
    const b = allowancePeriod(d('2026-06-20T23:59:59Z'));
    // Two evaluations on the same day must agree on the allowance window.
    expect(a.start.getTime()).toBe(b.start.getTime());
  });
});
