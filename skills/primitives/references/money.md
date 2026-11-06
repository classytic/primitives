# Money, currency, allocation, rates, proration

Subpaths: `/money`, `/currency`, `/split-allocation`, `/unit-cost-rate`, `/proration`. Money is `{ amount, currency }`, `amount` an integer in the currency minor unit (cent, paisa, fils).

## /money
- `money(amount, currency)` validates an integer; `fromMajor(19.99, 'USD')` and `toMajor(m)` convert at the currency factor.
- Arithmetic: `addMoney`, `subtractMoney`, `multiplyMoney(m, scalar)` (rounds), `sumMoney(values, currency)` (empty list is zero), `negateMoney`, `absMoney`.
- Compare: `equalsMoney`, `compareMoney` (-1, 0, 1), `isZeroMoney`, `isPositiveMoney`, `isNegativeMoney`, `isMoney` (guard).
- Mixed currencies throw `CurrencyMismatchError` (also exported from `/currency`).
- `percentOfMinor(minor, ratePercent)` returns a rounded integer. `majorToMinorUnits(major, currency)`, `minorUnitsToMajor(minor, currency)`, `formatMinorUnits(minor, currency)` read the exponent from the currency (`currencyExponent`, `/currency`); an unknown code throws `UnknownCurrencyError`. There is no default exponent.
- `MinorUnits<'BDT'>` is a branded number for wire fields; `Money` is for in-process math.
- `CASH_DESTINATIONS` (`cash`, `petty_cash`), `isCashDestination`, `cashDestinationLabel` ship from `/money`.

```ts
import { addMoney, fromMajor, sumMoney, toMajor } from "@classytic/primitives/money";

const total = addMoney(fromMajor(19.99, "USD"), fromMajor(5, "USD"));
console.log(total, toMajor(total), sumMoney([], "USD"));
```

## /currency
- `CURRENCIES`, `MINOR_UNIT_FACTOR` (every ISO 4217 code: JPY 1, USD 100, KWD 1000), `currencyExponent(code)` (throws `UnknownCurrencyError`), `minorUnitFactor(code)` (falls back to 100), `isKnownCurrency`.
- `toCurrencyCode(s)` returns the branded code or `null`; `currencyCode(s)` throws `InvalidCurrencyCodeError`; `isCurrencyCode` guards.
- FX: `convertWithSnapshot(money, fx, { rounding })` is exact (BigInt); `reverseWithSnapshot(base, fx)`; `isFxSnapshot`. Rounding: `half-away-from-zero` (default), `floor`, `ceil`.

```ts
import { convertWithSnapshot } from "@classytic/primitives/currency";
import { money } from "@classytic/primitives/money";

const fx = { sourceCurrency: "USD", baseCurrency: "BDT", rate: 110.15, snapshotAt: new Date("2026-01-01T00:00:00Z") };
console.log(convertWithSnapshot(money(530, "USD"), fx));
```

## /split-allocation
Largest-remainder allocation: parts always sum to `total` exactly. Methods: `equal`, `by-qty`, `by-weight`, `by-volume`, `by-value`, `by-percent` (subjects carry `percent`).
- `allocate(total, subjects, method)` returns `{ total, method, parts }`; `isBalanced(result)`.
- `allocateDiscount(discount, subjects)` returns `Map<id, amount>`; subject `weight` is the line base amount; `discountable: false` skips a line; throws `DISCOUNT_EXCEEDS_BASE`.
- Errors are `SplitAllocationError` with a `code` (`EMPTY_SUBJECTS`, `ZERO_WEIGHT_SUM`, `DUPLICATE_SUBJECT_ID`, ...).

```ts
import { allocate, allocateDiscount } from "@classytic/primitives/split-allocation";

const freight = allocate(1000, [{ id: "L1", weight: 2 }, { id: "L2", weight: 3 }, { id: "L3", weight: 5 }], "by-weight");
const shares = allocateDiscount(100, [{ id: "a", weight: 1000 }, { id: "b", weight: 2000 }]);
console.log(freight.parts.map((p) => p.amount), [...shares]);
```

## /unit-cost-rate
Fractional per-unit cost as a scaled integer (`RATE_SCALE` 1e6). Round once, at the extended total.
- `unitCostRate(minorPerUnit, currency)`, `unitCostRateFromTotal(totalMinor, quantity, currency)`.
- `extendedAmount(rate, quantity, mode?)` returns the integer total. `weightedAverageScaledRate(onHandQty, onHandScaled, inQty, inScaled)` for average costing. `rateMinorPerUnit`, `isUnitCostRate`.

```ts
import { extendedAmount, unitCostRateFromTotal } from "@classytic/primitives/unit-cost-rate";

const rate = unitCostRateFromTotal(100, 3, "BDT");
console.log(rate.scaledAmount, extendedAmount(rate, 3), extendedAmount(rate, 2));
```

## /proration
Pure arithmetic over instants (no clock, no zone). `periodProgress({ periodStart, periodEnd, asOf, granularity })` gives `{ periodDays, elapsedDays, remainingDays, remainingFraction }`; `splitByPeriodFraction(amount, fraction)` returns `{ consumed, remaining }` that sum exactly. `apportion(total, part, whole)` and `allocateMoneyByFraction(money, fraction)` for one-off shares. Errors: `ProrationError`.

```ts
import { money } from "@classytic/primitives/money";
import { periodProgress, splitByPeriodFraction } from "@classytic/primitives/proration";

const f = periodProgress({ periodStart: new Date("2026-01-01T00:00:00Z"), periodEnd: new Date("2026-01-31T00:00:00Z"), asOf: new Date("2026-01-11T00:00:00Z") });
console.log(splitByPeriodFraction(money(3000, "USD"), f));
```
