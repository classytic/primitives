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

import type { Brand } from "../composition/brand.js";

/**
 * A resolved STOCK key — the string quants, moves and reservations are keyed by.
 *
 * Branded so a port that moves stock cannot accept a bare string: the only way
 * to obtain one is {@link stockKeyOf} / {@link requireStockKey}, which apply the
 * `skuRef ?? sku` rule. A merchandising label passed where a stock key belongs
 * finds no quant and reports "out of stock" against a full shelf.
 */
export type StockKey = Brand<string, "StockKey">;

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
export function stockKeyOf(
  item: SkuFields,
  fallback?: string | { toString(): string },
): StockKey | undefined {
  return (nonEmpty(item.skuRef) ??
    nonEmpty(item.sku) ??
    (fallback !== undefined ? String(fallback) : undefined)) as StockKey | undefined;
}

/** The minimal product shape {@link stockKeyFor} reads. */
export interface StockKeySource {
  _id: string | { toString(): string };
  variants?: ReadonlyArray<SkuFields> | null;
}

/**
 * WHAT THE CALLER HAS — never what the key should be.
 *
 * - `sole`    nothing selected (a simple product, or a whole-product read)
 * - `label`   an operator-typed / scanned SKU label
 * - `variant` one variant record in hand, from iterating `variants`
 */
export type StockKeySelector =
  | { readonly kind: "sole" }
  | { readonly kind: "label"; readonly sku: string }
  | { readonly kind: "variant"; readonly variant: SkuFields };

/**
 * THE product-level stock key. One precedence, for every package.
 *
 *   1. the variant's STAMPED `skuRef` — assigned once at birth, immutable
 *   2. a SOLE variant with no stamp -> the product's `_id`. Never the label:
 *      legacy writers derived `variantSku || productId`, and for one variant
 *      that key IS the `_id`
 *   3. a SIBLING with no stamp -> its label, which genuinely IS its legacy key
 *   4. nothing addressable -> the product's `_id`
 *
 * The caller declares only what it HAS; the sole-vs-sibling decision is
 * internal, so a caller cannot make it wrong. That choice previously lived at
 * every call site across three packages, in two functions with different
 * fallbacks — they disagreed on a sole, unstamped, labelled variant, and the
 * read then looked up a key no quant is stored under.
 *
 * Lives HERE, below every domain, because `@spinekit/order` and
 * `@spinekit/catalog` must not import a peer domain — the rule being one layer
 * too high is exactly why each re-derived it.
 */
export function stockKeyFor(product: StockKeySource, selector: StockKeySelector): StockKey {
  const productId = String(product._id);
  const variants = product.variants ?? [];
  // A product with one variant (or none) is keyed by its own id.
  const sole = variants.length <= 1;

  switch (selector.kind) {
    case "sole":
      // The soleness test is REQUIRED: `variants[0]` on a multi-variant product
      // is one sibling's quant, picked by array order.
      if (!sole) return productId as StockKey;
      return (nonEmpty(variants[0]?.skuRef) ?? productId) as StockKey;
    case "label": {
      const matched = variants.find((v) => v.sku === selector.sku);
      const stamp = nonEmpty(matched?.skuRef);
      if (stamp !== undefined) return stamp as StockKey;
      // A sole variant keys by the product id EVEN WHEN ADDRESSED BY LABEL —
      // returning the label here is what made the old resolver disagree with
      // its own no-selector branch for one product.
      if (sole) return productId as StockKey;
      return selector.sku as StockKey;
    }
    case "variant": {
      const stamp = nonEmpty(selector.variant.skuRef);
      if (stamp !== undefined) return stamp as StockKey;
      if (sole) return productId as StockKey;
      return (stockKeyOf(selector.variant, productId) as StockKey);
    }
  }
}

/**
 * {@link stockKeyOf} that THROWS. Use wherever the key feeds a stock movement:
 * a reservation on `undefined` returns "out of stock" instead of failing.
 */
export function requireStockKey(item: SkuFields, context?: string): StockKey {
  const key = stockKeyOf(item);
  if (key === undefined) {
    throw new Error(
      `stock key missing: neither skuRef nor sku is set${context ? ` (${context})` : ""}`,
    );
  }
  return key;
}

/**
 * The brand is proved HERE, not in tests — this package's tsconfig excludes
 * test files, so a `@ts-expect-error` in one is never evaluated. Deleting the
 * brand from {@link StockKey} makes the next line an error.
 */
type AssertNotAssignable<A, B> = A extends B ? never : true;
const _bareStringIsNotAStockKey: AssertNotAssignable<string, StockKey> = true;
void _bareStringIsNotAStockKey;

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
