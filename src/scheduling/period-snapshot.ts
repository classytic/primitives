/**
 * Period snapshot — a balance materialised when a period is locked, and the plan that says how a
 * balance-as-of read was answered.
 *
 * Shared vocabulary for every "balance as of D" a kernel keeps (ledger accounts today; stock
 * valuation and partner openings later). No mongoose, no ledger types. Amounts are integer minor
 * units. Design: `spine/docs/scale-architecture.md` §3a.
 */

export interface SnapshotKey {
  /** The period the row closes. */
  periodId: string;
  /** Last instant of the period, inclusive. */
  periodEnd: Date;
  /** Account id, `skuRef@location`, partner id. */
  subject: string;
  /** Closed set of dimensions, declared per book (e.g. `{ branch }`). */
  dims: Readonly<Record<string, string | null>>;
  /** ISO 4217. */
  currency: string;
}

export interface SnapshotAmounts {
  /** Movement inside the period. */
  periodDebit: bigint;
  periodCredit: bigint;
  /** Cumulative since inception, through `periodEnd`. */
  closingDebit: bigint;
  closingCredit: bigint;
}

export type SnapshotState = 'current' | 'superseded';

export interface SnapshotRow extends SnapshotKey, SnapshotAmounts {
  state: SnapshotState;
  /** Increments on every re-close of the same period. */
  generation: number;
  sourceFingerprint: string;
}

/** How a balance-as-of read was answered. Echoed so a slow path is visible, never silent. */
export interface BalancePlan {
  /** End of the last contiguous current snapshot used, or `null` when none was. */
  watermark: Date | null;
  /** First instant the tail read; `null` = inception. */
  tailFrom: Date | null;
  /** Journal documents the tail read; `null` on a full scan, which does not count them. */
  tailEntries: number | null;
  source: 'snapshot+tail' | 'scan';
  /** Why the snapshot path was not taken, when `source` is `'scan'`. */
  reason?: string | undefined;
}

/** One as-of read: the comparable rows and the plan. */
export interface SnapshotReadResult<TRow> {
  rows: readonly TRow[];
  plan: BalancePlan;
}

export interface SnapshotReaderConformanceInput<TRow> {
  /** The as-of instants to compare at. Include instants on, before and after every snapshot end. */
  asOf: readonly Date[];
  /** The reader under test. */
  read(asOf: Date): Promise<SnapshotReadResult<TRow>>;
  /** The oracle: the same answer from a full scan. */
  scan(asOf: Date): Promise<SnapshotReadResult<TRow>>;
  /** Stable identity of a row (subject + dims + currency). */
  key(row: TRow): string;
  /** Comparable amounts of a row. */
  amounts(row: TRow): readonly (number | bigint)[];
  /** Assert at least this many reads took the snapshot path, so a reader that always scans fails. */
  minSnapshotReads: number;
}

export interface SnapshotReaderMismatch {
  asOf: Date;
  key: string;
  reader: readonly (number | bigint)[] | null;
  scan: readonly (number | bigint)[] | null;
}

/**
 * The reader must return exactly what a full scan returns at every instant. Returns the
 * mismatches (empty = conformant) and throws when the snapshot path ran fewer than
 * `minSnapshotReads` times — an always-scanning reader is trivially "equal".
 */
export async function runSnapshotReaderConformance<TRow>(
  input: SnapshotReaderConformanceInput<TRow>,
): Promise<{ mismatches: SnapshotReaderMismatch[]; snapshotReads: number }> {
  const mismatches: SnapshotReaderMismatch[] = [];
  let snapshotReads = 0;
  const index = (rows: readonly TRow[]) => {
    const out = new Map<string, readonly (number | bigint)[]>();
    for (const row of rows) {
      const k = input.key(row);
      if (out.has(k)) throw new Error(`runSnapshotReaderConformance: duplicate row key "${k}"`);
      out.set(k, input.amounts(row));
    }
    return out;
  };
  for (const asOf of input.asOf) {
    const [read, scan] = await Promise.all([input.read(asOf), input.scan(asOf)]);
    if (read.plan.source === 'snapshot+tail') snapshotReads++;
    const a = index(read.rows);
    const b = index(scan.rows);
    for (const k of new Set([...a.keys(), ...b.keys()])) {
      const x = a.get(k) ?? null;
      const y = b.get(k) ?? null;
      const same =
        x !== null && y !== null && x.length === y.length && x.every((v, i) => v === y[i]);
      if (!same) mismatches.push({ asOf, key: k, reader: x, scan: y });
    }
  }
  if (snapshotReads < input.minSnapshotReads) {
    throw new Error(
      `runSnapshotReaderConformance: only ${snapshotReads} of ${input.asOf.length} reads used a snapshot ` +
        `(required ${input.minSnapshotReads}); equality against a scan proves nothing about a reader that only scans.`,
    );
  }
  return { mismatches, snapshotReads };
}
