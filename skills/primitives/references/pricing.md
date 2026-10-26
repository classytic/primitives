# Pricing: monetization, price basis, usage rating

Subpaths: `/monetization`, `/price-basis`, `/usage-pricing`. All amounts are `Money` (integer minor units) from `/money`.

## /monetization
One contract for how an item is sold. A `Monetization` is a union tagged by `type`: `free`, `one_time` (`pricing.basePrice`), `subscription` (`plans[]`), `bundle` (`pricingMode` `fixed` or `dynamic`), `usage` (`rating`), `pass` (`passes[]`).
- Kinds: `MONETIZATION_KINDS`, `isMonetizationKind`, `monetizationKindOf(m)`.
- Narrowing guards: `isFreeMonetization`, `isOneTimeMonetization`, `isSubscriptionMonetization`, `isBundleMonetization`, `isUsageMonetization`, `isPassMonetization`.
- Display prices: `unitPriceOf(m)` (null for `free`, `usage`, dynamic bundle), `compareAtPriceOf(m)`, `isOnSale(m)`, `defaultPassOf(m)`, `approxTermDays(duration, unit)`.
- Billing wire names: `toRevenueMonetizationType(kind)` gives `free | purchase | subscription`; `fromRevenueMonetizationType` reverses it.
- Collection modes at checkout: `UPFRONT_COLLECTION_MODES` (`full_payment`, `deposit`, `pay_later`), `isUpfrontCollectionMode`.

```ts
import { money } from "@classytic/primitives/money";
import { isOnSale, monetizationKindOf, toRevenueMonetizationType, unitPriceOf, type Monetization } from "@classytic/primitives/monetization";

const m: Monetization = {
  type: "one_time",
  pricing: { basePrice: money(1000, "USD"), currency: "USD", compareAtPrice: money(1500, "USD") },
};
console.log(unitPriceOf(m), monetizationKindOf(m), toRevenueMonetizationType("one_time"), isOnSale(m));
```

## /price-basis
How a quoted price extends over a quantity. `fixedPriceBasis()` is price times count. `measuredPriceBasis(dimension, quantityUnit, priceUnit, quantityPerPriceUnit)` prices a measured line (grams against a per-kilogram price). Dimensions: `mass`, `duration`, `volume`, `length`, `area`.
- `resolvePriceBasisTotal(unitPriceMinor, quantity, basis?)` returns an integer total, half-even at the minor unit; omit `basis` for fixed.
- `isPriceBasis` guards stored values. Errors: `PriceBasisError` (`INVALID_PRICE`, `INVALID_QUANTITY`, `INVALID_DENOMINATOR`, `INVALID_UNIT`, `UNSAFE_TOTAL`).

```ts
import { measuredPriceBasis, resolvePriceBasisTotal } from "@classytic/primitives/price-basis";

const perKg = measuredPriceBasis("mass", "gram", "kilogram", 1000);
console.log(resolvePriceBasisTotal(25000, 750, perKg), resolvePriceBasisTotal(500, 3));
```

## /usage-pricing
`priceUsage(rating, measured)` prices one measured amount (weight, calls, seats) against a `UsageRating` from `/monetization`. Schemes: `per_unit`, `tiered`, `volume`, `package`. A started unit is a unit (rounds up); float noise is snapped first; `includedUnits` is free.
- Tier fields: `upTo` (omit on the last tier), `perUnit`, `flatPrice`.
- Result `UsageCharge`: `amount` (Money), `billableUnits`, `lines[]` per band.
- `isUsageMeasure({ value, unit })` guards wire input (positive finite value, non-blank unit; `unit` must equal the rating `unitLabel`).
- Every refusal is `UsagePricingError` with a closed `code`; nothing silently prices as zero.
- Not `/price-basis`: a basis extends one rate across the line quantity; usage sets the unit price from a stepped table.

```ts
import { money } from "@classytic/primitives/money";
import { priceUsage } from "@classytic/primitives/usage-pricing";

const courier = {
  scheme: "tiered" as const,
  unitLabel: "kg",
  tiers: [{ upTo: 1, flatPrice: money(6000, "BDT") }, { perUnit: money(2000, "BDT") }],
};
console.log(priceUsage(courier, 2.3).amount);
```
