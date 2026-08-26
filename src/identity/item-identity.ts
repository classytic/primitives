/**
 * `sku` is a LABEL; `skuRef` is the stock IDENTITY. Never one field.
 *
 * | field | mutable? | job |
 * |---|---|---|
 * | `skuRef` | never | keys quants, moves and ledger rows |
 * | `sku` | operator edits it | what a human reads, types, searches |
 *
 * Use `stockKeyOf` for anything that reserves or moves stock, `skuDisplay` for
 * anything a human reads. Never hand-roll either: both fall back, in OPPOSITE
 * directions, and getting one backwards type-checks and returns a plausible
 * string.
 *
 * - stock key = `skuRef ?? sku` — absent `skuRef` means a pre-split producer
 *   whose `sku` still IS the key.
 * - display = `skuLabel ?? sku ?? skuRef` — the ref last, and flagged, because
 *   it can be an opaque id with no merchandising meaning.
 *
 * Pinned by `tests/unit/item-identity.test.ts`.
 */

/** Identifier fields a record may carry — each shape populates a different subset. */
export interface SkuFields {
  /** Merchandising label — mutable, human-facing. */
  sku?: string | undefined;
  /** Stock/ledger identity — immutable, keys quants and moves. */
  skuRef?: string | undefined;
  /** Label resolved server-side for a read model keyed by `skuRef`. */
  skuLabel?: string | undefined;
}

const nonEmpty = (value: string | undefined): string | undefined =>
  typeof value === "string" && value.trim().length > 0 ? value : undefined;

/**
 * The STOCK key to reserve, decrement and post against: `skuRef ?? sku`,
 * falling back to `fallback` (typically the owning entity's `_id`) when the
 * record carries neither — the shape every "variant, else the product"
 * ledger key already re-derives by hand across three packages.
 *
 * `undefined` = the record carries neither AND no `fallback` was given —
 * malformed, not untracked. Use {@link requireStockKey} where that must stop
 * the write.
 */
export function stockKeyOf(item: SkuFields, fallback?: string | { toString(): string }): string | undefined {
  return nonEmpty(item.skuRef) ?? nonEmpty(item.sku) ?? (fallback !== undefined ? String(fallback) : undefined);
}

/**
 * {@link stockKeyOf} that THROWS. Use wherever the key feeds a stock movement:
 * a reservation on `undefined` returns "out of stock" instead of failing.
 */
export function requireStockKey(item: SkuFields, context?: string): string {
  const key = stockKeyOf(item);
  if (key === undefined) {
    throw new Error(
      `stock key missing: neither skuRef nor sku is set${context ? ` (${context})` : ""}`,
    );
  }
  return key;
}

/** What a surface should render for an item, and whether it had a real label. */
export interface SkuDisplay {
  /** Best human-facing value. `undefined` = no identifier at all; render a dash. */
  label: string | undefined;
  /** The stock identity, for subtext or copy-to-clipboard. */
  ref: string | undefined;
  /**
   * TRUE when `label` is really the `ref` (nothing resolved). Style it as an id
   * — monospace, muted — never as a SKU.
   */
  isRefFallback: boolean;
}

/** What to SHOW: `skuLabel ?? sku ?? skuRef`. The ref is returned alongside,
 * never dropped — it is the join key an operator quotes. */
export function skuDisplay(item: SkuFields): SkuDisplay {
  const ref = nonEmpty(item.skuRef);
  const label = nonEmpty(item.skuLabel) ?? nonEmpty(item.sku);
  if (label !== undefined) return { label, ref, isRefFallback: false };
  return { label: ref, ref, isRefFallback: ref !== undefined };
}

/**
 * Looks like an opaque id (24-char hex) rather than a merchandising code.
 * PRESENTATION HINT ONLY — never branch stock logic on it; a deployment may key
 * quants by any stable string.
 */
export function looksLikeOpaqueId(value: string | undefined): boolean {
  return typeof value === "string" && /^[0-9a-f]{24}$/i.test(value);
}
