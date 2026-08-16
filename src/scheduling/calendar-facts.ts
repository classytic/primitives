/**
 * CALENDAR FACTS — attested sets of civil dates, and a lookup that can say "I do not know".
 *
 * A calendar fact is "this date is listed in a dataset somebody vouches for". It is deliberately NOT
 * "this is a working day": that conclusion also depends on weekly schedules, shifts, substitutions and
 * whichever law is asking. Consumers convert facts into their own verdicts — a tax pack into
 * `holiday | working-day | unknown`, payroll into a premium rate, leave into whether balance is
 * consumed. See {@link DateFactLookup}.
 *
 * ## Why this is a sibling of `sla-policy`, not a field on it
 *
 * `WorkingHours` in `./sla-policy` is an SLA SCHEDULE — weekdays plus start/end minutes, with an
 * optional list of skipped dates. Gazette authority and completeness are not schedule properties, and
 * bolting them on would couple statutory tax evidence to support hours while leaving the meaning of the
 * shared field ambiguous per consumer. So these are separate types over the same `CivilDate`.
 *
 * ## The property everything else rests on: COVERAGE
 *
 * A bare `string[]` of holidays cannot express *unknown*. A date absent from the list is
 * indistinguishable from a date nobody has entered yet, so a 2029 deadline checked against a 2026 list
 * reads as a working day — a confident wrong answer, from data that was simply not there.
 *
 * An {@link CoveredDateEdition} therefore carries the bounds it is asserted COMPLETE for. Inside them,
 * absent means not-listed. Outside them, absent means `unknown`. A dataset cannot prove its own
 * completeness, so someone has to declare it — the same reasoning as a tax pack's gazette-coverage
 * claim, and the reason a missing edition can never silently become an empty-but-complete one.
 *
 * ## Input is a LIST, storage is date-KEYED — and that is not incidental
 *
 * The constructors take an array (what an importer or a spreadsheet produces) and return a record keyed
 * by date. Two reasons:
 *
 *   1. **duplicates are caught at construction.** A list can carry the same date twice with different
 *      labels; a record cannot, and building one silently would drop whichever came first.
 *   2. **records overlay safely, arrays do not.** A config layer that merges a branch override onto a
 *      company default REPLACES arrays wholesale — so a branch list would erase the company list with
 *      no error at all. Keyed entries merge per date.
 */

import {
  type CivilDate,
  civilDateOf,
  civilDaysBetween,
  isCivilDate,
  isValidTimeZone,
} from './timezone.js';

/** Inclusive civil-date bounds a dataset is asserted COMPLETE for. */
export interface DateCoverage {
  readonly from: CivilDate;
  readonly through: CivilDate;
}

/**
 * A set of dated facts plus the window it is complete for.
 *
 * ## The key type documents intent and CANNOT enforce it
 *
 * `Record<CivilDate, T>` is a mapped type over a branded string, which TypeScript collapses to a plain
 * string index signature — so the brand does not survive in key position and any string is accepted at
 * the type level. The brand is kept because it states what the keys MEAN; every key is validated at
 * construction instead. Do not assume a value of this type has pre-validated keys unless it came from
 * {@link defineDateEdition} or a schema that performs the same checks.
 */
export interface CoveredDateEdition<TEntry extends object> {
  readonly coverage: DateCoverage;
  readonly dates: Readonly<Record<CivilDate, TEntry>>;
}

/**
 * Why a lookup could not answer. Each is a DIFFERENT operator remedy, which is why this is not a
 * boolean:
 *
 *   - `missing-edition` — nobody has entered this year. Enter it.
 *   - `outside-coverage` — the year exists but does not claim to cover this date. Extend the coverage.
 *   - `unattested` — data exists but no authorized party has vouched for it. Approve it.
 *
 * `unattested` is never produced by this module: attestation is a property of how a dataset was STORED
 * and by whom, which a pure function cannot observe. It lives in the union so a config layer can return
 * it through the same shape rather than inventing a fourth state.
 */
export type DateFactUnknownReason = 'missing-edition' | 'outside-coverage' | 'unattested';

/**
 * The three-state answer.
 *
 * **`not-listed` does not mean "working day".** It means this attested dataset does not list the date.
 * Converting that into a working-day, a pay rate or a leave deduction is the consuming domain's job,
 * because the same fact supports different conclusions in each.
 */
export type DateFactLookup<TEntry> =
  | { readonly kind: 'listed'; readonly entry: TEntry }
  | { readonly kind: 'not-listed' }
  | { readonly kind: 'unknown'; readonly reason: DateFactUnknownReason };

/** Who published a dataset. Required, and required to be non-empty — see {@link defineDateEdition}. */
export interface DateAuthority {
  /** The publishing body, e.g. a ministry. Never an aggregator API that merely relayed it. */
  readonly issuer: string;
  /** The citable instrument — a gazette or circular number. */
  readonly reference: string;
  readonly publishedOn?: CivilDate | undefined;
}

/** An edition that names its own authority. The unit of completeness for a jurisdiction fact. */
export interface AttributedDateEdition<TEntry extends object> extends CoveredDateEdition<TEntry> {
  readonly authority: DateAuthority;
}

/** One listed date, as an importer supplies it. */
export interface DateEntryInput<TEntry extends object> {
  readonly date: string;
  readonly entry: TEntry;
}

export interface DefineDateEditionInput<TEntry extends object> {
  /**
   * The edition key, `YYYY`. Checked AGAINST the coverage rather than derived from it — an edition
   * filed under the wrong year is a data-entry error that would otherwise make every lookup in that
   * year report `missing-edition` while the data sat one key away.
   */
  readonly year: string;
  readonly coverage: { readonly from: string; readonly through: string };
  readonly authority: DateAuthority;
  readonly dates: readonly DateEntryInput<TEntry>[];
  /**
   * Permit an edition covering less than the whole year.
   *
   * OFF by default. An annual public-holiday gazette covers a full year, so partial coverage is
   * usually a half-finished import — and a half-finished import that presents as authoritative is
   * precisely the failure this module exists to prevent. Opt in only where a consumer genuinely needs
   * a partial window.
   */
  readonly allowPartialYear?: boolean;
}

/** Thrown by {@link defineDateEdition}. Carries every problem, not the first. */
export class InvalidDateEditionError extends Error {
  readonly problems: readonly string[];

  constructor(year: string, problems: readonly string[]) {
    super(
      `[primitives] Cannot define a date edition for "${year}" — ${problems.length} problem(s):\n` +
        problems.map((p) => `  - ${p}`).join('\n'),
    );
    this.name = 'InvalidDateEditionError';
    this.problems = problems;
  }
}

const YEAR_PATTERN = /^\d{4}$/;

/**
 * Build a validated edition, or throw naming every problem.
 *
 * REPORTS ALL problems rather than the first: an operator fixing a year's holiday list wants the whole
 * list of bad rows, and returning one at a time turns one correction into twenty round trips.
 */
export function defineDateEdition<TEntry extends object>(
  input: DefineDateEditionInput<TEntry>,
): AttributedDateEdition<TEntry> {
  const problems: string[] = [];
  const { year, coverage, authority, dates, allowPartialYear = false } = input;

  if (!YEAR_PATTERN.test(year)) problems.push(`year must be YYYY; got "${year}"`);

  if (!authority || !authority.issuer?.trim()) {
    problems.push(
      'authority.issuer is required and must be non-empty — an unattributed dataset cannot support a statutory claim',
    );
  }
  if (!authority || !authority.reference?.trim()) {
    problems.push(
      'authority.reference is required and must be non-empty — cite the instrument, not the tool that relayed it',
    );
  }
  if (authority?.publishedOn !== undefined && !isCivilDate(authority.publishedOn)) {
    problems.push(
      `authority.publishedOn must be a civil date (YYYY-MM-DD); got "${String(authority.publishedOn)}"`,
    );
  }

  const from = coverage?.from;
  const through = coverage?.through;
  if (!isCivilDate(from))
    problems.push(`coverage.from must be a civil date (YYYY-MM-DD); got "${String(from)}"`);
  if (!isCivilDate(through))
    problems.push(`coverage.through must be a civil date (YYYY-MM-DD); got "${String(through)}"`);

  if (isCivilDate(from) && isCivilDate(through)) {
    if (civilDaysBetween(from, through) < 0) {
      problems.push(`coverage.from (${from}) is after coverage.through (${through})`);
    }
    if (YEAR_PATTERN.test(year)) {
      // The key must agree with the window, in BOTH directions — an edition keyed 2027 covering 2026
      // dates is as broken as the reverse, and each fails a different lookup.
      if (from.slice(0, 4) !== year || through.slice(0, 4) !== year) {
        problems.push(
          `edition key "${year}" disagrees with its coverage (${from} … ${through}) — an edition spans exactly one year`,
        );
      } else if (!allowPartialYear && (from !== `${year}-01-01` || through !== `${year}-12-31`)) {
        problems.push(
          `coverage (${from} … ${through}) is narrower than the full year "${year}". An annual gazette covers ` +
            'the whole year, so this is usually an unfinished import; pass allowPartialYear if it is deliberate',
        );
      }
    }
  }

  const built: Record<string, TEntry> = {};
  const seen = new Set<string>();
  for (const [index, row] of dates.entries()) {
    if (!isCivilDate(row?.date)) {
      problems.push(
        `dates[${index}].date must be a civil date (YYYY-MM-DD); got "${String(row?.date)}"`,
      );
      continue;
    }
    if (seen.has(row.date)) {
      /**
       * A duplicate is REFUSED, never last-write-wins. Two rows for one date disagree about something,
       * and quietly keeping one drops a fact an operator entered on purpose.
       */
      problems.push(`dates[${index}] repeats ${row.date} — a date may be listed once per edition`);
      continue;
    }
    if (isCivilDate(from) && isCivilDate(through)) {
      if (civilDaysBetween(from, row.date) < 0 || civilDaysBetween(row.date, through) < 0) {
        problems.push(
          `dates[${index}] (${row.date}) falls outside the declared coverage ${from} … ${through}`,
        );
        continue;
      }
    }
    if (row.entry === null || typeof row.entry !== 'object') {
      problems.push(`dates[${index}].entry must be an object; got ${String(row.entry)}`);
      continue;
    }
    seen.add(row.date);
    built[row.date] = row.entry;
  }

  if (problems.length > 0) throw new InvalidDateEditionError(year, problems);

  return {
    coverage: { from: from as CivilDate, through: through as CivilDate },
    authority,
    dates: built as Readonly<Record<CivilDate, TEntry>>,
  };
}

/**
 * A jurisdiction's (or an employer's) dated facts, keyed by year.
 *
 * Year-keyed so an amendment replaces one edition rather than the whole history — and so a lookup for
 * an unentered year is distinguishable from a date nobody listed.
 */
export interface DateFactCalendar<TEntry extends object> {
  /** The zone the civil dates are civil IN. A date has no meaning without it. */
  readonly timeZone: string;
  /** Key is `YYYY`. */
  readonly editions: Readonly<Record<string, AttributedDateEdition<TEntry>>>;
}

/** Thrown by {@link defineDateFactCalendar}. */
export class InvalidDateFactCalendarError extends Error {
  readonly problems: readonly string[];

  constructor(problems: readonly string[]) {
    super(
      `[primitives] Cannot define a date-fact calendar — ${problems.length} problem(s):\n` +
        problems.map((p) => `  - ${p}`).join('\n'),
    );
    this.name = 'InvalidDateFactCalendarError';
    this.problems = problems;
  }
}

/**
 * Build a validated calendar. **The timezone is checked here, not trusted.**
 *
 * A civil date has no meaning without a zone, and a WRONG zone is worse than a missing one: it shifts
 * every boundary by the offset while every value still looks like a date. Asia/Dhaka is UTC+6, so a
 * calendar read in UTC disagrees with the business day for six hours at both ends — the same failure
 * that once reported August revenue as July for the last six hours of every month.
 *
 * Also re-checks each edition's key against its own coverage. `defineDateEdition` already enforces that,
 * but a calendar can be assembled from editions that were built elsewhere or filed under the wrong key,
 * and a misfiled edition makes every lookup in its year report `missing-edition` while the data sits one
 * key away.
 */
export function defineDateFactCalendar<TEntry extends object>(input: {
  readonly timeZone: string;
  readonly editions: Readonly<Record<string, AttributedDateEdition<TEntry>>>;
}): DateFactCalendar<TEntry> {
  const problems: string[] = [];

  if (typeof input.timeZone !== 'string' || input.timeZone.length === 0) {
    problems.push(
      'timeZone is required — a civil date has no meaning without the zone it is civil in',
    );
  } else if (!isValidTimeZone(input.timeZone)) {
    problems.push(
      `timeZone "${input.timeZone}" is not a recognised IANA zone. A wrong zone shifts every boundary ` +
        'by its offset while every value still looks like a valid date',
    );
  }

  for (const [key, edition] of Object.entries(input.editions)) {
    if (!YEAR_PATTERN.test(key)) {
      problems.push(`edition key "${key}" must be YYYY`);
      continue;
    }
    if (edition.coverage.from.slice(0, 4) !== key || edition.coverage.through.slice(0, 4) !== key) {
      problems.push(
        `edition "${key}" is filed under a year its coverage (${edition.coverage.from} … ` +
          `${edition.coverage.through}) does not match — every lookup in ${key} would report missing-edition`,
      );
    }
  }

  if (problems.length > 0) throw new InvalidDateFactCalendarError(problems);
  return { timeZone: input.timeZone, editions: input.editions };
}

/**
 * Look up one civil date. NEVER falls back to "not listed" for data that is absent rather than empty.
 *
 * Order matters: the edition is resolved first, then coverage, then membership. Checking membership
 * first would answer `not-listed` for a year nobody has entered — which is the whole bug.
 */
export function lookupDateFact<TEntry extends object>(
  calendar: DateFactCalendar<TEntry>,
  date: CivilDate,
): DateFactLookup<TEntry> {
  const edition = calendar.editions[date.slice(0, 4)];
  if (edition === undefined) return { kind: 'unknown', reason: 'missing-edition' };

  const { from, through } = edition.coverage;
  if (civilDaysBetween(from, date) < 0 || civilDaysBetween(date, through) < 0) {
    return { kind: 'unknown', reason: 'outside-coverage' };
  }

  const entry = edition.dates[date];
  return entry === undefined ? { kind: 'not-listed' } : { kind: 'listed', entry };
}

/**
 * Look up the civil date an INSTANT falls on, resolved in the CALENDAR'S zone.
 *
 * Prefer this over converting yourself. `lookupDateFact` takes a `CivilDate`, and producing one from an
 * instant requires a zone — if the caller picks its own (the server's, or UTC) it will disagree with the
 * calendar near midnight and be wrong by a whole day at the boundary. The calendar already knows the
 * only correct zone, so the conversion belongs here rather than at every call site.
 */
export function lookupDateFactAt<TEntry extends object>(
  calendar: DateFactCalendar<TEntry>,
  instant: Date,
): DateFactLookup<TEntry> {
  return lookupDateFact(calendar, civilDateOf(instant, calendar.timeZone));
}

/** A public holiday, as published. `label` is the occasion's name, for display and audit. */
export interface PublicHolidayEntry {
  readonly label: string;
}

/** A jurisdiction's public-holiday calendar. The company-scoped, statutory one. */
export type PublicHolidayCalendar = DateFactCalendar<PublicHolidayEntry>;

/**
 * An employer closure, which unlike a public holiday can also declare a date OPEN.
 *
 * The `open` arm exists because a branch override must be able to CONTRADICT a company-wide closure —
 * the branch works that day. Modelled as a discriminated union rather than a boolean so a merge
 * replaces the whole value per date; recursively merging `{state:'closed',label}` onto
 * `{state:'open',reason}` would leave both fields and satisfy neither arm.
 */
export type EmployerClosureEntry =
  | { readonly state: 'closed'; readonly label: string }
  | { readonly state: 'open'; readonly reason: string };
