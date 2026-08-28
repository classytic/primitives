/**
 * Item owns STOCK facts; Product owns MERCHANDISING. Each test below pins one
 * side of that split — the whole reason this is a merge and not a precedence.
 */
import { describe, expect, it } from 'vitest';
import type { ItemStockSource as Item } from '../../src/inventory/item-facts.js';
import {
  resolveStockFacts,
  type ProductFacet,
} from '../../src/inventory/item-facts.js';

const flour: Item = {
  skuRef: 'sku_flour',
  sku: 'FLOUR-25KG',
  displayName: 'Plain flour, 25kg sack',
  uom: 'kg',
  trackingMode: 'lot',
  isActive: true,
};

const retailFlour: ProductFacet = {
  skuRef: 'sku_flour',
  sku: 'FLOUR-RETAIL-1KG',
  displayName: 'Stone-Ground Flour 1kg',
  isActive: true,
};

describe('resolveStockFacts', () => {
  it('returns null when the SKU is neither an item nor a product', () => {
    // A deleted line. Ordinary, not an error.
    expect(resolveStockFacts({})).toBeNull();
  });

  it('PRODUCT ONLY — unchanged from today, before any Item exists', () => {
    const facts = resolveStockFacts({ product: retailFlour });
    expect(facts).toMatchObject({
      skuRef: 'sku_flour',
      displayName: 'Stone-Ground Flour 1kg',
      uom: 'unit',
      trackingMode: 'none',
      isActive: true,
    });
  });

  it('ITEM ONLY — a raw material nobody sells still has a name and a unit', () => {
    // This is the case that has no answer at all today.
    const facts = resolveStockFacts({ item: flour });
    expect(facts).toMatchObject({
      displayName: 'Plain flour, 25kg sack',
      uom: 'kg',
      trackingMode: 'lot',
    });
  });

  it('BOTH — stock facts from the Item, display name from the Product', () => {
    // Retail flour also used in the kitchen: one physical thing, two roles.
    const facts = resolveStockFacts({ item: flour, product: retailFlour });

    expect(facts?.uom).toBe('kg');
    expect(facts?.trackingMode).toBe('lot');
    expect(facts?.displayName).toBe('Stone-Ground Flour 1kg');
    expect(facts?.sku).toBe('FLOUR-RETAIL-1KG');
  });

  it('never takes the UNIT from the selling side', () => {
    // A product listed in 1kg bags must not redefine the unit a warehouse
    // counts a 25kg sack in.
    const facts = resolveStockFacts({
      item: flour,
      product: { ...retailFlour, uom: 'bag' },
    });
    expect(facts?.uom).toBe('kg');
  });

  it('withdrawing a product from sale does NOT orphan its stock', () => {
    // isActive follows the ITEM: unlisted is not the same as not on the shelf.
    const facts = resolveStockFacts({
      item: flour,
      product: { ...retailFlour, isActive: false },
    });
    expect(facts?.isActive).toBe(true);
  });

  it('retiring the ITEM makes it unstockable even while the product still sells', () => {
    const facts = resolveStockFacts({
      item: { ...flour, isActive: false },
      product: retailFlour,
    });
    expect(facts?.isActive).toBe(false);
  });

  it('carries shelf-life policy from the Item — the reason perishables need this at all', () => {
    const perishable: Item = {
      ...flour,
      trackingPolicy: { mode: 'lot', shelfLifeDays: 90 } as Item['trackingPolicy'],
    };
    const facts = resolveStockFacts({ item: perishable, product: retailFlour });
    expect(facts?.trackingPolicy).toEqual({ mode: 'lot', shelfLifeDays: 90 });
  });

  it('omits absent optional facts rather than emitting undefined keys', () => {
    const facts = resolveStockFacts({ item: flour });
    expect('catchWeight' in (facts as object)).toBe(false);
    expect('weight' in (facts as object)).toBe(false);
  });
});
