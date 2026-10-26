# Workflow: state machines, status history, holds, conditions

Subpaths: `/state-machine`, `/state-diagram`, `/status-history`, `/hold`, `/condition`. All helpers are pure and return new values; nothing mutates its input.

## /state-machine
`defineStateMachine({ name, transitions, errorFactory? })`: `transitions` maps every status to its legal targets; a status with an empty list is terminal.
- Instance: `canTransition(from, to)`, `assertTransition(entityId, from, to)`, `isTerminal(status)`, `validTargets(from)`, `validSources(to)`, `terminal` (set), `transitions`.
- A bad transition throws `IllegalTransitionError` (code `illegal_transition`, `status` 422, fields `entityType`, `entityId`, `from`, `to`). Pass `errorFactory(ctx)` to throw the host error type instead.
- `assertAndClaim(machine, repo, id, { from, to, patch?, field?, where?, options? })` asserts every listed source, then calls `repo.claim(...)` (an atomic compare-and-set). It returns the updated document or `null` when another writer won; treat `null` as a conflict.

```ts
import { defineStateMachine } from "@classytic/primitives/state-machine";

type OrderStatus = "draft" | "placed" | "paid" | "cancelled";
export const orderMachine = defineStateMachine<OrderStatus>({
  name: "order",
  transitions: { draft: ["placed", "cancelled"], placed: ["paid", "cancelled"], paid: [], cancelled: [] },
});
console.log(orderMachine.canTransition("draft", "placed"), orderMachine.isTerminal("paid"), orderMachine.validTargets("placed"));
try {
  orderMachine.assertTransition("o1", "paid", "draft");
} catch (error) {
  console.log((error as { code?: string }).code);
}
```

Claim through a repository (any object with a matching `claim`):

```ts
import { assertAndClaim, defineStateMachine } from "@classytic/primitives/state-machine";

const machine = defineStateMachine<"planned" | "released" | "cancelled">({
  name: "wave",
  transitions: { planned: ["released", "cancelled"], released: ["cancelled"], cancelled: [] },
});
const repo = {
  claim: async (id: string, t: { from: unknown; to: unknown }) => ({ id, status: t.to }),
};
const updated = await assertAndClaim(machine, repo, "w1", { from: "planned", to: "released", patch: { releasedAt: new Date() } });
console.log(updated);
```

## /state-diagram
`toMermaid(machine, { initial?, current?, title?, labels?, showTerminal? })` returns `stateDiagram-v2` text. `describeStateMachine(machine)` lists each status with `targets`, `sources`, `terminal`. `unreachableStates(machine, initial)` finds dead statuses (assert it is empty in tests).

## /status-history
An append-only audit list of status changes, stored on the aggregate.
- `appendStatus(history, status, { by, note, at })` returns a new list; each entry is `{ status, occurredAt, by?, note?, durationInPriorMs }` (0 for the first).
- `timeInStatus(history, status, now?)` total milliseconds, counting an open last entry up to `now`. `latestEntry(history)`, `lastTransitionTo(history, status)`.
- Types: `StatusHistory<S>`, `StatusChangeEntry<S>`. Feed it to `spansFromStatusHistory` in `/suspension`.

```ts
import { appendStatus, latestEntry, timeInStatus } from "@classytic/primitives/status-history";

let history = appendStatus<"draft" | "placed">([], "draft", { by: "u1", at: new Date("2026-01-01T00:00:00Z") });
history = appendStatus(history, "placed", { at: new Date("2026-01-01T01:00:00Z") });
console.log(latestEntry(history)?.durationInPriorMs, timeInStatus(history, "draft"));
```

## /hold
Multiple concurrent reasons an entity is blocked (payment review, legal hold). A hold is `{ id, code, actor, createdAt, resolvedAt?, ... }`; actors are `{ id, kind: 'user'|'system'|'service' }`.
- `addHold(holds, { code, actor, id?, note? })`, `resolveHold(holds, id, { actor, note? })`.
- `activeHolds`, `resolvedHolds`, `isOnHold(holds)`, `hasActiveHoldOfCode(holds, code)`.
- Errors: `HoldError` (`UNKNOWN_HOLD_ID`, `ALREADY_RESOLVED`, `INVALID_CODE`, `DUPLICATE_HOLD_ID`).

```ts
import { addHold, isOnHold, resolveHold } from "@classytic/primitives/hold";

const actor = { id: "u1", kind: "user" as const };
let holds = addHold([], { id: "h1", code: "payment_review", actor });
const blocked = isOnHold(holds);
holds = resolveHold(holds, "h1", { actor });
console.log(blocked, isOnHold(holds));
```

## /condition
A JSON rule tree for stored rules (approval thresholds, routing). Leaf: `{ field: 'a.b', op, value }` with ops `eq neq gt gte lt lte in nin contains startsWith endsWith isNull isNotNull`; groups `{ all: [] }`, `{ any: [] }`, `{ not: c }`.
- `evaluate(condition, target)` never throws on target shape; a missing path is `undefined`.
- `validateCondition(condition)` throws `ConditionError` (`EMPTY_GROUP`, `INVALID_OP`, `MISSING_VALUE`, ...); call it when a rule is saved.

```ts
import { evaluate, validateCondition, type Condition } from "@classytic/primitives/condition";

const rule: Condition = { all: [{ field: "amount", op: "gt", value: 100 }, { field: "category.name", op: "eq", value: "travel" }] };
validateCondition(rule);
console.log(evaluate(rule, { amount: 150, category: { name: "travel" } }));
```
