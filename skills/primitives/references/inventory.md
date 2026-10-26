# Inventory: quantities, stock levels, item identity, settlement

Subpaths: `/quantity`, `/stock-level`, `/item-identity`, `/item-stock`, `/item-facts`, `/line-settlement`, `/testing/stock-key-seam`. Shelf-life dates are in `references/scheduling.md`.

## /quantity
Decimal quantities on a 6-decimal grid (`QUANTITY_SCALE` 1,000,000), so 0.1 + 0.2 is exactly 0.3.
- `addQuantity(a, b)`, `subtractQuantity(a, b)`: exact on the grid; zero is `0`, never `-0`.
- `compareQuantity(a, b)` (-1, 0, 1), `quantitiesEqual(a, b)`.
- `snapQuantity(qty, step?, mode?)` rounds to the nearest step (half-even default; mode `half-even` or `half-up`).
- `isOnQuantityGrid(v)`, `isQuantityStep(step)` and `isOnStepStrict(qty, step)` never throw (use them on untrusted input). `isOnStep` snaps first and throws on a bad step.
- `quantityToGrid`, `quantityStepToGrid` return bigint grid units. A non-finite operand throws `QuantityError` (`NOT_FINITE`, `INVALID_STEP`, `UNSAFE_QUANTITY`).

```ts
import { addQuantity, compareQuantity, isOnStepStrict, snapQuantity } from "@classytic/primitives/quantity";

console.log(addQuantity(1.2, 1.15), snapQuantity(2.3456, 0.25), isOnStepStrict(1.5, 0.5), compareQuantity(0.1 + 0.2, 0.3));
```

## /stock-level
Branded numbers so on-hand and sellable cannot be swapped: `onHand(n)`, `reserved(n)`, `sellable(level)` = on hand minus reserved, `isOversold(level)`, `levelOf({ quantityOnHand, quantityReserved })`. Types: `OnHand`, `Reserved`, `Sellable`, `StockLevel`.

```ts
import { isOversold, levelOf, sellable } from "@classytic/primitives/stock-level";

const level = levelOf({ quantityOnHand: 10, quantityReserved: 12 });
console.log(sellable(level), isOversold(level));
```

## /item-identity
`skuRef` is the immutable stock identity; `sku` is an editable label. Never use one as the other.
- `stockKeyOf(item, fallback?)` -> branded `StockKey` = `skuRef ?? sku ?? fallback`, or `undefined` when none exists. `requireStockKey(item, context?)` throws instead.
- `stockKeyFor(product, selector)` with selector `{ kind: 'sole' }` (the product id), `{ kind: 'label', sku }` (find a variant by label, return its key) or `{ kind: 'variant', variant }`.
- `skuDisplay(item)` -> `{ label, ref, isRefFallback }` for anything a human reads (`skuLabel ?? sku ?? skuRef`). `looksLikeOpaqueId(v)`.

```ts
import { skuDisplay, stockKeyFor, stockKeyOf } from "@classytic/primitives/item-identity";

const product = { _id: "p1", variants: [{ sku: "RED-L", skuRef: "sku_r1" }] };
console.log(stockKeyOf({ skuRef: "sku_r1", sku: "RED-L" }), stockKeyFor(product, { kind: "label", sku: "RED-L" }), stockKeyFor({ _id: "p2" }, { kind: "sole" }), skuDisplay({ sku: "RED-L" }));
```

## /item-stock
`itemStockOf(item, rowOf, { defaultReorderPoint })` summarises an item's stock in one place. `rowOf(stockKey)` returns a `StockRow` (`quantity`, `isActive`, `costPrice`, `valueMinor`, `reorderPoint`) or undefined. Result `ItemStock`: `quantity`, `inStock`, `lowStock`, `valueMinor?`, `variants?`. Rows are counted once per stock key.

```ts
import { itemStockOf } from "@classytic/primitives/item-stock";

const stock = itemStockOf({ _id: "p1" }, () => ({ quantity: 3, reorderPoint: 5 }), { defaultReorderPoint: 2 });
console.log(stock);
```

## /item-facts
`resolveStockFacts({ item, product })` merges the stock side (`ItemStockSource`: unit, tracking, weight, active) with the sales side (`ProductFacet`: name) into `ItemStockFacts`, or `null` when neither exists. The item owns stock facts; the product owns the display name. Types `TrackingMode` (`none`, `lot`, `serial`).

```ts
import { resolveStockFacts } from "@classytic/primitives/item-facts";

console.log(resolveStockFacts({ product: { skuRef: "s1", sku: "A", displayName: "Item A" } }));
```

## /line-settlement
Split a document line quantity into outcome buckets you name (`received`, `returned`, `canceled`). A line is `{ quantity, settled: { bucket: n } }`.
- `settledTotal`, `outstandingOf`, `settlementState(line)` -> `open | partial | settled`, `documentSettlementState(lines)`, `settledEntirelyIn(lines, bucket)`.
- `planSettlement(line, bucket, qty)` returns a `Result`: the new line, or a refusal `not_positive_quantity` or `exceeds_outstanding` (over-settlement is an error, never trimmed). `clampSettlement(line, bucket, requested)` takes what fits and reports `applied`.
- `shareOfSettled(total, quantity, settledBefore, settledAfter)` splits a line amount across batches so the shares sum exactly to `total`.

```ts
import { outstandingOf, planSettlement, settlementState } from "@classytic/primitives/line-settlement";

const line = { quantity: 10, settled: { received: 4 } };
const over = planSettlement(line, "received", 7);
const ok = planSettlement(line, "received", 6);
console.log(outstandingOf(line), settlementState(line), over.ok ? "ok" : over.error.code, ok.ok && settlementState(ok.value));
```

## /testing/stock-key-seam
Node-only conformance scan: fails when source assigns `skuRef` from a `.sku` label. Run it in a package's test suite: `assertStockKeySeam(srcRoot, { minFiles })` throws on violations or when fewer than `minFiles` files were scanned; `scanStockKeySeam(srcRoot)` returns `{ scanned, violations }`. `takesStockKeyFromLabel(line)` is the line matcher; `STOCK_KEY_SEAM_FIXTURES` holds `mustMatch` and `mustNotMatch` lines to pin it.
