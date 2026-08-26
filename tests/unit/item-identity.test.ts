/**
 * The two fallback DIRECTIONS are the contract, and each has shipped backwards.
 *
 * Both mistakes type-check and both return a plausible string, so nothing but a
 * test distinguishes them:
 *
 *   - the LABEL used as a stock key — placement reserved against `sku` after the
 *     split, and a product with 119 units on hand rejected every order with
 *     `INSUFFICIENT_STOCK … available 0`. A quant lookup against a key that owns
 *     no quants is indistinguishable from being out of stock, so it surfaced as
 *     an ordinary business rejection;
 *   - the KEY used as a label — planning screens rendered a raw `skuRef` under a
 *     column headed "SKU", showing an operator `6a501546e42c37ca838cb095`.
 *
 * So: `stockKeyOf` must prefer `skuRef`, `skuDisplay` must prefer the label, and
 * each must still fall back — dropping either fallback breaks a real shape (a
 * pre-split order line; a read model whose label join a host never wired).
 */
import { describe, expect, it } from 'vitest';
import {
  looksLikeOpaqueId,
  requireStockKey,
  skuDisplay,
  stockKeyOf,
} from '../../src/identity/item-identity.js';

describe('stockKeyOf — the reservation / quant key', () => {
  it('prefers skuRef over the merchandising label', () => {
    expect(stockKeyOf({ sku: 'HERITAGECERAMICMUG350ML', skuRef: '6a501546e42c37ca838cb095' })).toBe(
      '6a501546e42c37ca838cb095',
    );
  });

  it('falls back to sku when no skuRef was stamped (pre-split snapshot)', () => {
    // Absent skuRef means the producer never distinguished the two, so `sku` IS
    // the key. Dropping this would re-key every order written before the split.
    expect(stockKeyOf({ sku: 'LEGACY-SKU' })).toBe('LEGACY-SKU');
  });

  it('treats blank and whitespace as absent, not as a key', () => {
    // A stamped-but-empty field is the worst case: truthy in a `??` chain if you
    // check for presence rather than content, and it keys nothing.
    expect(stockKeyOf({ sku: 'REAL', skuRef: '' })).toBe('REAL');
    expect(stockKeyOf({ sku: 'REAL', skuRef: '   ' })).toBe('REAL');
    expect(stockKeyOf({})).toBeUndefined();
  });

  it('never returns skuLabel — a resolved display value is not an identity', () => {
    expect(stockKeyOf({ skuLabel: 'Pretty Name' })).toBeUndefined();
  });

  it('falls back to the owning entity when the record carries neither field', () => {
    // The "variant, else the product" ledger key three packages re-derived by
    // hand — this closes it to one call.
    expect(stockKeyOf({}, '6a501546e42c37ca838cb095')).toBe('6a501546e42c37ca838cb095');
    expect(stockKeyOf({}, { toString: () => 'obj-id' })).toBe('obj-id');
  });

  it('never reaches the fallback when skuRef or sku is present', () => {
    expect(stockKeyOf({ sku: 'REAL' }, 'fallback-id')).toBe('REAL');
  });
});

describe('requireStockKey', () => {
  it('throws rather than letting a missing key become "out of stock"', () => {
    expect(() => requireStockKey({}, 'line_0')).toThrow(/stock key missing/);
    expect(() => requireStockKey({}, 'line_0')).toThrow(/line_0/);
  });

  it('returns the key when present', () => {
    expect(requireStockKey({ skuRef: 'K' })).toBe('K');
  });
});

describe('skuDisplay — what a human sees', () => {
  it('prefers a resolved skuLabel, and keeps the ref alongside', () => {
    const d = skuDisplay({ skuRef: '6a501546e42c37ca838cb095', skuLabel: 'Heritage Mug' });
    expect(d.label).toBe('Heritage Mug');
    expect(d.ref, 'the ref stays — it is the join key an operator quotes').toBe(
      '6a501546e42c37ca838cb095',
    );
    expect(d.isRefFallback).toBe(false);
  });

  it('uses sku when no server-resolved label exists', () => {
    const d = skuDisplay({ sku: 'HERITAGECERAMICMUG350ML', skuRef: '6a501546e42c37ca838cb095' });
    expect(d.label).toBe('HERITAGECERAMICMUG350ML');
    expect(d.isRefFallback).toBe(false);
  });

  it('FLAGS the fallback when only the ref exists', () => {
    // This is the flag that stops an opaque id being presented as a SKU.
    const d = skuDisplay({ skuRef: '6a501546e42c37ca838cb095' });
    expect(d.label).toBe('6a501546e42c37ca838cb095');
    expect(d.isRefFallback, 'a surface must be able to style this as an id').toBe(true);
  });

  it('reports nothing to show rather than an empty string', () => {
    expect(skuDisplay({})).toEqual({ label: undefined, ref: undefined, isRefFallback: false });
  });
});

describe('looksLikeOpaqueId — a presentation hint only', () => {
  it('recognises a 24-char hex id', () => {
    expect(looksLikeOpaqueId('6a501546e42c37ca838cb095')).toBe(true);
  });

  it('does not claim a merchandising code is opaque', () => {
    expect(looksLikeOpaqueId('HERITAGECERAMICMUG350ML')).toBe(false);
    expect(looksLikeOpaqueId('DEADBEEF')).toBe(false); // hex, but not 24 chars
    expect(looksLikeOpaqueId(undefined)).toBe(false);
  });
});
