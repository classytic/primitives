/**
 * One rule, one answer â€” whatever the caller happens to hold.
 *
 * Three disagreements this collapse closes, all measured on live data or read
 * directly from the two prior implementations:
 *
 *   A. writer `resolveSkuRef(p, null)` -> product._id  vs
 *      reader `variantLedgerKey(p, v)` -> the label      (cached 0 vs 5 on hand)
 *   B. `resolveSkuRef(p, 'LABEL')` -> label  vs
 *      `resolveSkuRef(p, null)`    -> product._id        (same product, one function)
 *   C. a SIBLING's label IS its legacy key â€” collapsing must not break it.
 */
import { describe, expect, it } from 'vitest';
import { stockKeyFor, type StockKeySource } from '../../src/identity/item-identity.js';

const PID = '6a8fb427000071ac652e1368';

const soleUnstamped: StockKeySource = { _id: PID, variants: [{ sku: 'NUTSET' }] };
const soleStamped: StockKeySource = { _id: PID, variants: [{ sku: 'NUTSET', skuRef: PID }] };
const siblings: StockKeySource = {
  _id: PID,
  variants: [
    { sku: 'RED', skuRef: 'ref-red' },
    { sku: 'BLUE', skuRef: 'ref-blue' },
  ],
};
const siblingsUnstamped: StockKeySource = { _id: PID, variants: [{ sku: 'RED' }, { sku: 'BLUE' }] };

describe('stockKeyFor', () => {
  it('A. every way of addressing a SOLE UNSTAMPED variant gives the SAME key', () => {
    const viaSole = stockKeyFor(soleUnstamped, { kind: 'sole' });
    const viaLabel = stockKeyFor(soleUnstamped, { kind: 'label', sku: 'NUTSET' });
    const viaVariant = stockKeyFor(soleUnstamped, { kind: 'variant', variant: { sku: 'NUTSET' } });

    expect(viaSole).toBe(PID);
    expect(new Set([viaSole, viaLabel, viaVariant]).size).toBe(1);
  });

  it('A2. it is never the LABEL for a sole variant â€” that key holds no quant', () => {
    for (const sel of [
      { kind: 'sole' } as const,
      { kind: 'label', sku: 'NUTSET' } as const,
      { kind: 'variant', variant: { sku: 'NUTSET' } } as const,
    ]) {
      expect(stockKeyFor(soleUnstamped, sel)).not.toBe('NUTSET');
    }
  });

  it('MULTI-VARIANT with nothing selected keys by the product id, never a sibling stamp', () => {
    // `variants[0]` is one sibling's quant chosen by array order. Sibling stamps
    // are opaque ids, so that answer is a key unrelated to the caller's intent.
    expect(stockKeyFor(siblings, { kind: 'sole' })).toBe(PID);
    expect(stockKeyFor(siblings, { kind: 'sole' })).not.toBe('ref-red');
    expect(stockKeyFor(siblingsUnstamped, { kind: 'sole' })).toBe(PID);
  });

  it('the STAMP always wins, by every route', () => {
    expect(stockKeyFor(soleStamped, { kind: 'sole' })).toBe(PID);
    expect(stockKeyFor(siblings, { kind: 'label', sku: 'BLUE' })).toBe('ref-blue');
    expect(stockKeyFor(siblings, { kind: 'variant', variant: { sku: 'BLUE', skuRef: 'ref-blue' } })).toBe(
      'ref-blue',
    );
  });

  it('C. a SIBLING with no stamp keys by its LABEL â€” the legacy convention', () => {
    expect(stockKeyFor(siblingsUnstamped, { kind: 'variant', variant: { sku: 'RED' } })).toBe('RED');
    expect(stockKeyFor(siblingsUnstamped, { kind: 'label', sku: 'BLUE' })).toBe('BLUE');
  });

  it('a product with NO variants keys by its id', () => {
    expect(stockKeyFor({ _id: PID, variants: [] }, { kind: 'sole' })).toBe(PID);
    expect(stockKeyFor({ _id: PID }, { kind: 'sole' })).toBe(PID);
  });

  it('a BLANK stamp is not a key â€” it falls through, it does not win', () => {
    // `''` and `'  '` are absent, not identity. A blank skuRef seeding a quant
    // is a row every reader misses.
    expect(stockKeyFor({ _id: PID, variants: [{ sku: 'X', skuRef: '' }] }, { kind: 'sole' })).toBe(PID);
    expect(
      stockKeyFor({ _id: PID, variants: [{ sku: 'X', skuRef: '   ' }] }, { kind: 'variant', variant: { sku: 'X', skuRef: '   ' } }),
    ).toBe(PID);
  });

  it('an ObjectId-ish _id is stringified once', () => {
    expect(stockKeyFor({ _id: { toString: () => PID }, variants: [{ sku: 'X' }] }, { kind: 'sole' })).toBe(PID);
  });

  it('falsification: the OLD split answered differently here', () => {
    const oldResolveSkuRef = (p: StockKeySource, label?: string | null): string => {
      const vs = p.variants;
      if (label) return vs?.find((v) => v.sku === label)?.skuRef ?? label;
      const only = vs?.length === 1 ? vs[0] : undefined;
      return only?.skuRef ?? String(p._id);
    };
    const oldVariantLedgerKey = (p: StockKeySource, v: { sku?: string; skuRef?: string }): string =>
      v.skuRef ?? v.sku ?? String(p._id);

    expect(oldResolveSkuRef(soleUnstamped, null)).toBe(PID);
    expect(oldResolveSkuRef(soleUnstamped, 'NUTSET')).toBe('NUTSET'); // disagreement B
    expect(oldVariantLedgerKey(soleUnstamped, { sku: 'NUTSET' })).toBe('NUTSET'); // disagreement A

    expect(stockKeyFor(soleUnstamped, { kind: 'sole' })).toBe(PID);
    expect(stockKeyFor(soleUnstamped, { kind: 'label', sku: 'NUTSET' })).toBe(PID);
    expect(stockKeyFor(soleUnstamped, { kind: 'variant', variant: { sku: 'NUTSET' } })).toBe(PID);
  });
});
