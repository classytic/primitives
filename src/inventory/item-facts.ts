/**
 * What a stock system needs to know about one SKU, and how an Item and its
 * Product facet combine to produce it.
 *
 * Lives here because flow, catalog, item and manufacturing all need ONE
 * definition. A structural copy per package type-checks against a shape that has
 * since changed, and the drift is invisible until runtime.
 *
 * An Item is anything that can HOLD STOCK; a Product is anything that can be
 * SOLD. They describe one physical thing from two sides and neither contains the
 * other, so the Item owns stock facts (unit, tracking, weight) and the Product
 * owns merchandising (the name a human reads). Picking one record as the winner
 * for every field is what makes a warehouse show a marketing name in a unit it
 * does not count in.
 */
import type { ShelfLifePolicy } from "../scheduling/shelf-life.js";

/** Coarse lot/serial tracking. `trackingPolicy.mode` wins when both are set. */
export type TrackingMode = "none" | "lot" | "serial";

/** The stock facts an Item contributes. Persistence and classification are the owning package's. */
export interface ItemStockSource {
  skuRef: string;
  sku: string;
  displayName: string;
  /** The canonical STOCK unit — what quants and moves are balanced in. */
  uom: string;
  trackingMode: TrackingMode;
  trackingPolicy?: ShelfLifePolicy | undefined;
  /**
   * Variable-weight item (deli, meat, loose produce): a measured weight is
   * captured per received lot while the piece count stays the stock dimension.
   */
  catchWeight?: boolean | undefined;
  weightUom?: string | undefined;
  weight?: number | undefined;
  volume?: number | undefined;
  barcode?: string[] | undefined;
  /** Retired items are not stockable. Independent of whether a Product sells. */
  isActive: boolean;
}

/** The merchandising side. Every stock fact is optional — the Item owns those. */
export interface ProductFacet {
  skuRef: string;
  sku: string;
  displayName: string;
  uom?: string | undefined;
  trackingMode?: TrackingMode | undefined;
  trackingPolicy?: ShelfLifePolicy | undefined;
  catchWeight?: boolean | undefined;
  weightUom?: string | undefined;
  weight?: number | undefined;
  volume?: number | undefined;
  barcode?: string[] | undefined;
  isActive?: boolean | undefined;
}

/** The resolved answer. `@classytic/flow`'s `SkuDetails` IS this type. */
export interface ItemStockFacts {
  skuRef: string;
  sku: string;
  displayName: string;
  trackingMode: TrackingMode;
  trackingPolicy?: ShelfLifePolicy;
  uom: string;
  catchWeight?: boolean;
  weightUom?: string;
  weight?: number;
  volume?: number;
  barcode?: string[];
  isActive: boolean;
}

/** Unit assumed when neither side declares one. A deployment-wide guess, and a bad one — set a real `uom` on the Item. */
const FALLBACK_UOM = "unit";

const defined = <T>(key: string, value: T | undefined): Record<string, T> =>
  value === undefined ? {} : ({ [key]: value } as Record<string, T>);

/**
 * Merge an Item with its Product facet.
 *
 * - **Neither** ⇒ `null`. An unknown SKU is ordinary (a deleted line), not an error.
 * - **Product only** ⇒ the product's own facts — every deployment before an Item exists.
 * - **Item only** ⇒ the item's facts. A raw material nobody sells.
 * - **Both** ⇒ stock facts from the Item, name and label from the Product.
 *
 * `isActive` follows the ITEM when one exists: a product withdrawn from sale is
 * still stock on a shelf, whereas a retired item is not stockable at all. Taking
 * the product's flag would make unlisting a product silently orphan its stock.
 */
export function resolveStockFacts(input: {
  item?: ItemStockSource | null | undefined;
  product?: ProductFacet | null | undefined;
}): ItemStockFacts | null {
  const { item, product } = input;
  if (!item && !product) return null;

  if (!item) {
    const p = product as ProductFacet;
    return {
      skuRef: p.skuRef,
      sku: p.sku,
      displayName: p.displayName,
      uom: p.uom ?? FALLBACK_UOM,
      trackingMode: p.trackingMode ?? "none",
      ...defined("trackingPolicy", p.trackingPolicy),
      ...defined("catchWeight", p.catchWeight),
      ...defined("weightUom", p.weightUom),
      ...defined("weight", p.weight),
      ...defined("volume", p.volume),
      ...defined("barcode", p.barcode),
      isActive: p.isActive ?? true,
    };
  }

  return {
    skuRef: item.skuRef,
    sku: product?.sku ?? item.sku,
    displayName: product?.displayName ?? item.displayName,
    uom: item.uom,
    trackingMode: item.trackingMode,
    ...defined("trackingPolicy", item.trackingPolicy),
    ...defined("catchWeight", item.catchWeight),
    ...defined("weightUom", item.weightUom),
    ...defined("weight", item.weight),
    ...defined("volume", item.volume),
    ...defined("barcode", item.barcode),
    isActive: item.isActive,
  };
}
