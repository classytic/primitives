# Foundations: result, brand, reference, context, mixin, environment, fault

Subpaths: `/result`, `/brand`, `/reference`, `/context`, `/mixin`, `/environment`, `/fault-attribution`. Pagination, tenant config and error contracts are not here; they live in `@classytic/repo-core` (`/pagination`, `/tenant`, `/errors`).

## /result
`Result<T, E>` is `{ ok: true, value } | { ok: false, error }`. `ok(v)`, `err(e)`, `isOk(r)`, `isErr(r)`, `mapResult(r, fn)`, `mapError(r, fn)`, `unwrap(r)` (throws the error when not ok). Use for expected refusals (`parsePhone`, `planSettlement`); throw for programmer errors.

```ts
import { err, mapResult, ok, unwrap, type Result } from "@classytic/primitives/result";

const half = (n: number): Result<number, string> => (n % 2 === 0 ? ok(n / 2) : err("odd"));
console.log(half(4), mapResult(half(4), (v) => v + 1), half(3), unwrap(half(8)));
```

## /brand
Type-only helpers: `Brand<T, 'Name'>` (nominal type), `Prettify`, `DeepPartial`, `DeepReadonly`, `RequireKeys`, `OptionalKeys`, `Nullable`, `KeysMatching`, `NonEmptyArray`.

## /reference
`IdLike` (a string or any object with `toString`, so ObjectId fits without a database import), `idToString(id)`, `ExternalRef` (`{ sourceId, sourceModel }` for ids from another package or service), `isExternalRef(v)`, `DocumentRef` (`{ collection, id }`).

## /context
Types only. `OperationContext`: `actorId`, `organizationId`, `traceId`, `correlationId`, `requestId`, `idempotencyKey`, `session`, `mode` (`soft` or `hard`), `metadata`. Also `ActorRef` (`id`, `type`, `name`) and `StructuredLogger`. Pass one context object through service calls instead of loose arguments.

## /mixin
Attach typed extension data to an entity under `mixins.<key>`. `withMixin(base, key, data)`, `getMixin(entity, key)` (null when absent), `hasMixin`, `withoutMixin`. All return new objects.

```ts
import { getMixin, hasMixin, withMixin } from "@classytic/primitives/mixin";

const base: { id: string; mixins?: Record<string, unknown> } = { id: "1" };
const item = withMixin(base, "tax", { rate: 5 });
console.log(item, getMixin<{ rate: number }>(item, "tax"), hasMixin(item, "other"));
```

## /environment
Strict configuration reads. A value that is set must be valid or boot fails with `InvalidEnvError` naming the variable.
- `readEnv(process.env)` -> reader with `bool(name, fallback)`, `int(name, fallback, { min, max })`, `number(...)`, `oneOf(name, allowed, fallback)`, `list(name)` (comma split, trimmed).
- `classifyEnv(value)` -> `production` (`production`, `prod`), `test` (`test`, `qa`), else `development`; trims and ignores case. An unrecognised value (a typo) classifies as `development`, so validate it yourself where that matters.
- `isProductionEnv(value)` is the only predicate; use it instead of comparing strings.

```ts
import { classifyEnv, isProductionEnv, readEnv } from "@classytic/primitives/environment";

const env = readEnv({ PORT: "3000", DEBUG: "true", HOSTS: "a, b" });
console.log(env.int("PORT", 3000, { min: 1, max: 65535 }), env.bool("DEBUG", false), env.list("HOSTS"), env.oneOf("MODE", ["fast", "safe"], "safe"), classifyEnv("prod"), isProductionEnv(undefined));
```

## /fault-attribution
Who bears the cost of a return or claim. Parties: `merchant`, `customer`, `carrier`, `shared`, `unknown`.
- `attributeFault(policy, reasons, explicit?)`: an explicit decision wins; any merchant reason makes the whole claim the merchant's; then carrier; otherwise reasons must agree, else `unknown`. No reasons gives `unknown`.
- `bearsCost(attributed, party)`: `shared` bears for every named party, `unknown` bears nothing. `needsFaultReview(attributed)` is true for `unknown`.

```ts
import { attributeFault, bearsCost, needsFaultReview } from "@classytic/primitives/fault-attribution";

const policy = { damaged: "carrier", wrong_item: "merchant" } as const;
console.log(attributeFault(policy, ["damaged"]), attributeFault(policy, ["damaged", "wrong_item"]), bearsCost("carrier", "merchant"), needsFaultReview("unknown"));
```
