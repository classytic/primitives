/**
 * A closed date range `[start, end]`. Both endpoints inclusive — consumers
 * decide whether to treat them as `[start, end)` at the query layer.
 */
export interface DateRange {
  start: Date;
  end: Date;
}

/**
 * A named accounting / reporting period. At least one of the resolution fields
 * (`month`, `quarter`) should be set, or `start`/`end` for ad-hoc ranges.
 */
export interface Period {
  /** Four-digit calendar year, e.g. 2026. */
  year: number;
  /** 1..12. */
  month?: number;
  /** 1..4. */
  quarter?: 1 | 2 | 3 | 4;
  /** Ad-hoc override — useful when the period spans a non-calendar boundary. */
  start?: Date;
  end?: Date;
}

export function isDateRange(value: unknown): value is DateRange {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as DateRange).start instanceof Date &&
    (value as DateRange).end instanceof Date
  );
}

/** True if `d` is inclusively within `range`. */
export function isWithin(d: Date, range: DateRange): boolean {
  return d.getTime() >= range.start.getTime() && d.getTime() <= range.end.getTime();
}

/** Range duration in milliseconds. */
export function rangeDurationMs(range: DateRange): number {
  return range.end.getTime() - range.start.getTime();
}

/**
 * True if two half-open ranges `[start, end)` overlap.
 *
 * Note: the `DateRange` shape documents its endpoints as closed, but
 * overlap-detection queries almost always want half-open semantics so two
 * adjacent slots (10-11, 11-12) don't register as a conflict. Consumers
 * needing fully-closed semantics can still use `isWithin` against each
 * endpoint.
 *
 * Used by:
 *   - `@classytic/order` booking overlap detection
 *   - `@classytic/flow` reservation window collision
 *   - promo / offer campaign window overlap checks
 */
export function rangesOverlap(a: DateRange, b: DateRange): boolean {
  return a.start.getTime() < b.end.getTime() && b.start.getTime() < a.end.getTime();
}
