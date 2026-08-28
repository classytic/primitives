/**
 * Sellable stock has ONE definition, and on-hand cannot be passed for it.
 *
 * The bug this encodes: a storefront cache field named `totalAvailable` was fed
 * `quantityOnHand`, so the shop advertised units already held in open carts and
 * checkout refused the sale it had just promised. Four layers each knew that
 * available is on-hand minus reserved; none owned it.
 */
import { describe, expect, it } from "vitest";

import {
  isOversold,
  levelOf,
  onHand,
  reserved,
  sellable,
  type Sellable,
} from "../../src/inventory/stock-level.js";

describe("sellable", () => {
  it("is on-hand minus reserved", () => {
    expect(sellable({ onHand: onHand(10), reserved: reserved(4) })).toBe(6);
  });

  it("equals on-hand when nothing is held — the case that hides the bug", () => {
    // Every fixture that missed the original defect looked like this one.
    expect(sellable({ onHand: onHand(10), reserved: reserved(0) })).toBe(10);
  });

  it("goes NEGATIVE when more is promised than present, and is not clamped", () => {
    // Stock written off after being reserved. A real state — you cannot
    // un-promise a cart — and the only signal operations has for it.
    const level = { onHand: onHand(6), reserved: reserved(8) };
    expect(sellable(level)).toBe(-2);
    expect(isOversold(level)).toBe(true);
  });

  it("is not oversold at exactly zero", () => {
    expect(isOversold({ onHand: onHand(4), reserved: reserved(4) })).toBe(false);
  });
});

describe("levelOf", () => {
  it("reads a ledger row and treats missing counts as zero", () => {
    expect(sellable(levelOf({ quantityOnHand: 9, quantityReserved: 2 }))).toBe(7);
    expect(sellable(levelOf({ quantityOnHand: 5 }))).toBe(5);
    expect(sellable(levelOf({}))).toBe(0);
  });

  it("RECOMPUTES rather than trusting a stored total", () => {
    // A row whose stored `quantityAvailable` has drifted must not import that
    // drift — the derivation is the authority.
    const row = { quantityOnHand: 10, quantityReserved: 4, quantityAvailable: 999 };
    expect(sellable(levelOf(row))).toBe(6);
  });
});

/**
 * The BRAND is proved in `src/inventory/stock-level.ts`, not here.
 *
 * This package's tsconfig excludes test files, so a `@ts-expect-error` in this
 * file is never evaluated — removing the `Sellable` brand left both the suite
 * and `tsc` green. The assertions that catch that live in `src`, where
 * `npm run typecheck` actually looks; removing the brand makes them 2 errors.
 */
describe("the brand", () => {
  it("erases at runtime — a branded value is just a number", () => {
    const promised: Sellable = sellable({ onHand: onHand(10), reserved: reserved(4) });
    expect(promised).toBe(6);
    expect(typeof promised).toBe("number");
  });
});
