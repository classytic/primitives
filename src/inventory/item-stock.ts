/**
 * An item's stock in one place (a branch), from the rows its stock source files under stock keys —
 * the ONE summary every reader shows: the server's product reads and an offline till alike.
 *
 *   itemStockOf(product, (key) => rows.get(key ?? productId), { defaultReorderPoint: 10 })
 *
 * Rows are keyed by STOCK KEY (`stockKeyFor`), and a row reached by two lookups is counted once —
 * a sole variant's key IS the product id, so summing lookups instead of rows doubles it.
 */

import { type SkuFields, type StockKey, type StockKeySource, stockKeyFor } from "../identity/item-identity.js";

/** One stock row as the summary reads it. */
export interface StockRow {
  readonly quantity?: number;
  /** Explicitly `false` deactivates the row. Absent means active. */
  readonly isActive?: boolean;
  /** Display cost of one unit, as the source reports it. */
  readonly costPrice?: number;
  /** On-hand value at the source's valuation, integer MINOR units; absent = unvalued. */
  readonly valueMinor?: number;
  /** Units at or below which the item reads as low (the item-level row's). */
  readonly reorderPoint?: number;
}

/** What a reader shows for an item's stock in one place. */
export interface ItemStock {
  quantity: number;
  inStock: boolean;
  lowStock: boolean;
  valueMinor?: number;
  /** Per variant LABEL — a projection of the same rows, not a second source. */
  variants?: Array<{ sku: string; quantity: number; costPrice?: number }>;
}

/** The item shape the summary reads: its id and its variants. */
export interface StockableItem extends StockKeySource {
  readonly variants?: ReadonlyArray<SkuFields & { readonly sku: string; readonly isActive?: boolean }> | null;
}

/**
 * The item's stock. `rowOf(null)` is the item-level row (filed under the item's own id);
 * `rowOf(key)` the row filed under one variant's stock key.
 */
export function itemStockOf(
  item: StockableItem,
  rowOf: (stockKey: StockKey | null) => StockRow | undefined,
  options: { readonly defaultReorderPoint: number },
): ItemStock {
  const itemId = String(item._id);
  const variants = item.variants ?? [];
  const keyOf = (variant: SkuFields) => stockKeyFor({ _id: itemId, variants }, { kind: "variant", variant });

  // The DISTINCT rows, by stock key — counting one row twice is unrepresentable here.
  const rows = new Map<string, StockRow | undefined>();
  const itemRow = rowOf(null);
  if (itemRow) rows.set(itemId, itemRow);
  for (const variant of variants) {
    if (variant.isActive === false) continue;
    const key = keyOf(variant);
    const row = rowOf(key);
    // A missed per-variant lookup must not erase a row the item-level lookup already found.
    if (!row && rows.has(key)) continue;
    rows.set(key, row);
  }

  let quantity = 0;
  // Known only when EVERY stocked row carries a value — a partial sum is not a value.
  let valueMinor: number | undefined = 0;
  for (const row of rows.values()) {
    if (row?.isActive === false) continue;
    const rowQuantity = row?.quantity ?? 0;
    quantity += rowQuantity;
    if (rowQuantity > 0) {
      valueMinor =
        row?.valueMinor === undefined || valueMinor === undefined ? undefined : valueMinor + row.valueMinor;
    }
  }

  // Two variants sharing a stock key each report that row's quantity — that is what sharing means.
  const variantStocks: NonNullable<ItemStock["variants"]> = [];
  for (const variant of variants) {
    if (variant.isActive === false) continue;
    const key = keyOf(variant);
    if (!rows.has(key)) continue;
    const row = rows.get(key);
    if (row?.isActive === false) continue;
    variantStocks.push({
      sku: variant.sku,
      quantity: row?.quantity ?? 0,
      ...(row?.costPrice !== undefined ? { costPrice: row.costPrice } : {}),
    });
  }

  const reorderPoint = itemRow?.reorderPoint ?? options.defaultReorderPoint;
  return {
    quantity,
    inStock: quantity > 0,
    lowStock: quantity > 0 && quantity <= reorderPoint,
    ...(quantity > 0 && valueMinor !== undefined ? { valueMinor } : {}),
    ...(variantStocks.length ? { variants: variantStocks } : {}),
  };
}
