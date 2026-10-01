import { err, ok, type Result } from "../composition/result.js";

/**
 * A document line's quantity, split into OUTCOME buckets — the one definition
 * of "how much of this line is still open".
 *
 * Every kernel that moves goods against a document asks this: an order line is
 * fulfilled / returned / canceled, a transfer line is received / returned /
 * written off, a purchase line is received / rejected. The buckets are the
 * kernel's vocabulary; the arithmetic, the over-settlement guard and the state
 * derivation are this file's, so no two kernels can answer differently.
 *
 * Quantities are whole units. A bucket that is absent counts as zero.
 */
export interface SettlementLine<B extends string> {
  /** What the line promised to move. */
  readonly quantity: number;
  /** What has been settled so far, per outcome. */
  readonly settled: Readonly<Partial<Record<B, number>>>;
}

export type SettlementState = "open" | "partial" | "settled";

/** Sum of every bucket. */
export const settledTotal = <B extends string>(line: SettlementLine<B>): number =>
  Object.values<number | undefined>(line.settled).reduce<number>((sum, n) => sum + (n ?? 0), 0);

/**
 * `quantity − Σ buckets`. NOT clamped at zero: a negative means the line was
 * over-settled by data written outside {@link planSettlement}, and hiding it
 * would erase the only signal that happened.
 */
export const outstandingOf = <B extends string>(line: SettlementLine<B>): number =>
  line.quantity - settledTotal(line);

/** `open` — nothing settled; `settled` — nothing outstanding; otherwise `partial`. */
export const settlementState = <B extends string>(line: SettlementLine<B>): SettlementState => {
  if (outstandingOf(line) <= 0) return "settled";
  return settledTotal(line) === 0 ? "open" : "partial";
};

/** Every line settled ⇒ `settled`; every line untouched ⇒ `open`; else `partial`. */
export const documentSettlementState = <B extends string>(
  lines: ReadonlyArray<SettlementLine<B>>,
): SettlementState => {
  const states = lines.map(settlementState);
  if (states.every((s) => s === "settled")) return "settled";
  if (states.every((s) => s === "open")) return "open";
  return "partial";
};

/** `true` when every line is settled entirely through `bucket` (e.g. all received, nothing lost). */
export const settledEntirelyIn = <B extends string>(
  lines: ReadonlyArray<SettlementLine<B>>,
  bucket: B,
): boolean => lines.every((l) => (l.settled[bucket] ?? 0) >= l.quantity);

export type SettlementRefusal =
  | { readonly code: "not_positive_integer"; readonly requested: number }
  | { readonly code: "exceeds_outstanding"; readonly requested: number; readonly outstanding: number };

/**
 * Settle `quantity` more units into `bucket`, or refuse.
 *
 * Refuses a non-positive or fractional quantity and anything above what is
 * outstanding — an over-settlement is an input error, never silently trimmed.
 * Use {@link clampSettlement} only where the surface's CONTRACT is "take what fits".
 */
export const planSettlement = <B extends string>(
  line: SettlementLine<B>,
  bucket: B,
  quantity: number,
): Result<SettlementLine<B>, SettlementRefusal> => {
  if (!Number.isInteger(quantity) || quantity <= 0) return err({ code: "not_positive_integer", requested: quantity });
  const outstanding = outstandingOf(line);
  if (quantity > outstanding) return err({ code: "exceeds_outstanding", requested: quantity, outstanding });
  return ok(withBucket(line, bucket, quantity));
};

/**
 * Settle up to `requested` units into `bucket`, taking only what is outstanding.
 * `applied` is what was actually settled; `0` leaves the line unchanged.
 */
export const clampSettlement = <B extends string>(
  line: SettlementLine<B>,
  bucket: B,
  requested: number,
): { readonly line: SettlementLine<B>; readonly applied: number } => {
  const applied = Math.max(0, Math.min(Math.trunc(requested), outstandingOf(line)));
  return { line: applied > 0 ? withBucket(line, bucket, applied) : line, applied };
};

/**
 * The share of a line-level amount (a value or a cost, integer MINOR units) owed by one
 * settlement batch, given how many units the whole line had settled before and after it.
 *
 * `floor(total·after/q) − floor(total·before/q)` TELESCOPES: however a line is split into
 * batches, and across every outcome bucket, the shares sum to exactly `total` once the line
 * is fully settled — no remainder to chase, no batch-order dependence.
 */
export const shareOfSettled = (total: number, quantity: number, settledBefore: number, settledAfter: number): number => {
  if (!Number.isInteger(total) || total < 0) throw new RangeError(`total must be a non-negative integer, got ${total}`);
  if (!Number.isInteger(quantity) || quantity <= 0) throw new RangeError(`quantity must be a positive integer, got ${quantity}`);
  if (!(0 <= settledBefore && settledBefore <= settledAfter && settledAfter <= quantity)) {
    throw new RangeError(`need 0 <= before (${settledBefore}) <= after (${settledAfter}) <= quantity (${quantity})`);
  }
  const at = (n: number) => Number((BigInt(total) * BigInt(n)) / BigInt(quantity));
  return at(settledAfter) - at(settledBefore);
};

const withBucket =<B extends string>(line: SettlementLine<B>, bucket: B, quantity: number): SettlementLine<B> => ({
  quantity: line.quantity,
  settled: { ...line.settled, [bucket]: (line.settled[bucket] ?? 0) + quantity },
});
