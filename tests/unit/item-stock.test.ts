/**
 * One item's stock from its rows. The fixtures carry the shape production has: a sole variant whose
 * stock key IS the product id, with the item-level and the variant lookup BOTH populated and equal.
 * Quantities are never zero — a zero passes against a doubling bug.
 */
import { describe, expect, it } from "vitest";
import type { StockKey } from "../../src/identity/item-identity.js";
import { itemStockOf, type StockRow } from "../../src/inventory/item-stock.js";

const options = { defaultReorderPoint: 10 };
/** Rows as a source files them: the item row under the id, variant rows under their stock keys. */
const source = (id: string, rows: Record<string, StockRow>) => (key: StockKey | null) => rows[key ?? id];

describe("itemStockOf", () => {
  it("counts a sole variant's row once, though both lookups reach it", () => {
    const mug = { _id: "p1", variants: [{ sku: "MUG-RED", skuRef: "p1" }] };
    const stock = itemStockOf(mug, source("p1", { p1: { quantity: 5 } }), options);
    expect(stock.quantity).toBe(5); // not 10
    expect(stock.variants).toEqual([{ sku: "MUG-RED", quantity: 5 }]);
  });

  it("sums sibling variants by stock key and reports each by its label", () => {
    const tee = { _id: "p2", variants: [{ sku: "TEE-S", skuRef: "r-s" }, { sku: "TEE-M", skuRef: "r-m" }] };
    const stock = itemStockOf(tee, source("p2", { "r-s": { quantity: 2 }, "r-m": { quantity: 3 } }), options);
    expect(stock).toMatchObject({ quantity: 5, inStock: true, lowStock: true });
    expect(stock.variants).toEqual([
      { sku: "TEE-S", quantity: 2 },
      { sku: "TEE-M", quantity: 3 },
    ]);
  });

  it("skips inactive variants and deactivated rows", () => {
    const tee = {
      _id: "p3",
      variants: [
        { sku: "A", skuRef: "r-a" },
        { sku: "B", skuRef: "r-b", isActive: false },
        { sku: "C", skuRef: "r-c" },
      ],
    };
    const rows = { "r-a": { quantity: 1 }, "r-b": { quantity: 7 }, "r-c": { quantity: 2, isActive: false } };
    const stock = itemStockOf(tee, source("p3", rows), options);
    expect(stock.quantity).toBe(1);
    expect(stock.variants).toEqual([{ sku: "A", quantity: 1 }]);
  });

  it("is low at or below the item row's reorder point, else the default", () => {
    const simple = { _id: "p4" };
    expect(itemStockOf(simple, source("p4", { p4: { quantity: 3, reorderPoint: 2 } }), options).lowStock).toBe(false);
    expect(itemStockOf(simple, source("p4", { p4: { quantity: 2, reorderPoint: 2 } }), options).lowStock).toBe(true);
    expect(itemStockOf(simple, source("p4", { p4: { quantity: 11 } }), options).lowStock).toBe(false);
  });

  it("states a value only when every stocked row carries one", () => {
    const tee = { _id: "p5", variants: [{ sku: "S", skuRef: "r-s" }, { sku: "M", skuRef: "r-m" }] };
    const valued = { "r-s": { quantity: 1, valueMinor: 100 }, "r-m": { quantity: 2, valueMinor: 250 } };
    expect(itemStockOf(tee, source("p5", valued), options).valueMinor).toBe(350);
    const partly = { "r-s": { quantity: 1, valueMinor: 100 }, "r-m": { quantity: 2 } };
    expect(itemStockOf(tee, source("p5", partly), options).valueMinor).toBeUndefined();
  });

  it("an item with no rows is out of stock, not unknown", () => {
    expect(itemStockOf({ _id: "p6" }, () => undefined, options)).toEqual({ quantity: 0, inStock: false, lowStock: false });
  });
});
