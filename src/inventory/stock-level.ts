import type { Brand } from "../composition/brand.js";

/**
 * Stock quantities as NOMINAL types, so "how many are there" and "how many may
 * I still promise" cannot be passed for one another.
 *
 * They are different questions with the same JavaScript type, and every layer
 * re-derived the relationship between them: the flow ledger, the catalog
 * bridge, the quant invariants, and the storefront cache each knew that
 * available is on-hand minus reserved, and one of them still shipped on-hand
 * into a field named `totalAvailable` — so the shop advertised units already
 * held in someone else's cart and checkout refused the sale it had promised.
 *
 * Same fix as money's `MinorUnits<C>` brand, and for the same reason: a unit
 * confusion that a reviewer must notice becomes one the compiler refuses.
 * Zero runtime cost — the brands erase at compile time.
 */

/** Units physically present. INCLUDES units promised to open carts. */
export type OnHand = Brand<number, "OnHand">;

/** Units held against an owner (cart, order, move group) — present, not free. */
export type Reserved = Brand<number, "Reserved">;

/**
 * Units that may still be promised to a NEW buyer: `onHand - reserved`.
 *
 * Constructible only via {@link sellable}, which is what makes passing on-hand
 * where sellable is required a type error rather than an oversell.
 */
export type Sellable = Brand<number, "Sellable">;

/** What a location holds, as the ledger records it. */
export interface StockLevel {
  readonly onHand: OnHand;
  readonly reserved: Reserved;
}

export const onHand = (n: number): OnHand => n as OnHand;
export const reserved = (n: number): Reserved => n as Reserved;

/**
 * The ONE definition of sellable stock.
 *
 * Deliberately NOT clamped at zero. Writing stock off below what is already
 * reserved (goods damaged after being promised) is a real state, not an error —
 * you cannot un-promise a cart. A negative reads as OVERSOLD, and every
 * consumer already treats `<= 0` as unsellable; clamping would erase the only
 * signal operations has that the condition exists.
 */
export const sellable = (level: StockLevel): Sellable =>
  (level.onHand - level.reserved) as Sellable;

/** `true` when more is promised than is physically present. */
export const isOversold = (level: StockLevel): boolean => sellable(level) < 0;

/**
 * Build a level from a ledger row, whatever it calls its fields.
 *
 * A quant reports all three; `available` is IGNORED on purpose and recomputed,
 * so a source whose stored total has drifted cannot import that drift.
 */
export const levelOf = (row: {
  quantityOnHand?: number;
  quantityReserved?: number;
}): StockLevel => ({
  onHand: onHand(row.quantityOnHand ?? 0),
  reserved: reserved(row.quantityReserved ?? 0),
});

/**
 * COMPILE-TIME PROOF that the brands hold, placed in `src` because that is
 * where `npm run typecheck` looks: this package's tsconfig excludes test files,
 * so a `@ts-expect-error` written in a test is a comment, not a guarantee —
 * removing the `Sellable` brand left the suite green and `tsc` at zero.
 *
 * If a brand erodes to plain `number`, the conditional resolves to `never` and
 * the assignment below stops compiling.
 */
type AssertNotAssignable<A, B> = A extends B ? never : true;
const _onHandIsNotSellable: AssertNotAssignable<OnHand, Sellable> = true;
const _reservedIsNotOnHand: AssertNotAssignable<Reserved, OnHand> = true;
const _plainNumberIsNotSellable: AssertNotAssignable<number, Sellable> = true;
void _onHandIsNotSellable;
void _reservedIsNotOnHand;
void _plainNumberIsNotSellable;
