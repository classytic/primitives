# Approval chains and idempotency

Subpaths: `/approval`, `/idempotency`. Both are pure state transitions over plain objects; persistence is yours. Every function returns a new value.

## /approval
A chain has an `order` (`sequential` or `parallel`), `steps[]` and an overall `status` (`pending`, `approved`, `rejected`, `skipped`). Each step has `approvers`, `requiredApprovals` (quorum) and optional `threshold` (`field`, `op`, `value`).
- Build: `createChain({ order, steps: [{ id, approvers, requiredApprovals?, name?, threshold? }] })`; `notRequiredChain(reason)` for an auto-approved case; `attachRequest(chain, { by, at, basis? })` records the requester.
- Decide: `applyDecision(chain, { stepId, approverId, decision: 'approved'|'rejected', note?, decidedAt? })`; `skipStep(chain, stepId, reason?)`.
- `attachRequest` removes the requester from every step's approvers (maker-checker) and throws `NO_INDEPENDENT_APPROVER` when a step then has fewer approvers than its quorum; approving your own request is `SELF_APPROVAL`. Other codes: `UNAUTHORIZED_APPROVER`, `STEP_NOT_ACTIVE`, `STEP_ALREADY_DECIDED_BY_APPROVER`, `INVALID_QUORUM`, `UNKNOWN_STEP`. All are `ApprovalError` with a `code`.
- Read: `nextPendingStep(chain)`, `pendingSteps(chain)`, `decidableStepIds(chain, actorId)` (steps this actor may decide now), `isApproved`, `isRejected`, `isPending`, `isNotRequired`, `decisionCount`.
- `notRequiredChain(reason)` is already `approved` and passes `assertApproved`; record the reason for the audit trail.
- Gate a mutation: `assertApproved(chain)` throws `CHAIN_MISSING` for no chain and `CHAIN_INCOMPLETE` otherwise; `assertApprovedIfPresent(chain)` allows a missing chain.
- JSON: `chainToJson(chain)` -> `ApprovalChainJson` (every instant an ISO string, no `undefined` keys, invalid instant throws `RangeError`); the response and evidence form, a `DecidableChain`.
- Wire constants for routes: `APPROVAL_ACTIONS` (`submit_for_approval`, `decide`), `APPROVAL_DECISIONS`, `APPROVAL_CHAIN_SOURCES`, `APPROVAL_NOTE_MAX_LENGTH` (1000), `ApprovalSubmitBody`, `ApprovalDecideBody`.

```ts
import { applyDecision, assertApproved, attachRequest, createChain, decidableStepIds, isApproved, nextPendingStep } from "@classytic/primitives/approval";

let chain = createChain({
  order: "sequential",
  steps: [
    { id: "manager", approvers: [{ id: "u1" }] },
    { id: "finance", approvers: [{ id: "u2" }, { id: "u3" }], requiredApprovals: 1 },
  ],
});
chain = attachRequest(chain, { by: "u9", at: new Date("2026-01-01T00:00:00Z") });
console.log(nextPendingStep(chain)?.id, decidableStepIds(chain, "u1"), decidableStepIds(chain, "u2"));
chain = applyDecision(chain, { stepId: "manager", approverId: "u1", decision: "approved" });
chain = applyDecision(chain, { stepId: "finance", approverId: "u2", decision: "approved" });
assertApproved(chain);
console.log(chain.status, isApproved(chain));
```

## /idempotency
A claim record for "do this request once" with a lease, so a crashed worker's claim can be taken over. The store (database) holds `IdempotencyClaim`; these functions decide.
- Identity: `{ operation, key, scope? }`. `identityKey(identity)` makes a stable string key; `sameIdentity(a, b)`.
- `fingerprintRequest(body)` hashes the request body; the same key with a different fingerprint throws `FINGERPRINT_MISMATCH`.
- `decideClaim(existing, { identity, requestFingerprint, now, leaseToken, leaseMs? })` returns one of: `claimed` (run it; persist `decision.claim`), `replayed` (return `decision.result`), `in_flight` (another worker holds a live lease; wait `retryAfterMs`). An expired lease is taken over (`tookOverFrom`).
- `completeClaim(claim, { leaseToken, now, result })` with `result` of `{ status: 'succeeded', value }` or `{ status: 'failed', error: { code, message } }`; `renewLease(claim, { leaseToken, now })` for long work.
- `newLeaseToken()`, `isLeaseExpired(claim, now)`, `holdsLease(claim, token, now)`, `isInFlight(decision)`, `DEFAULT_LEASE_MS` (30000). Errors: `IdempotencyError` (`LEASE_LOST`, `ALREADY_TERMINAL`, `MISSING_REPLAY`, `INVALID_CLAIM`).

```ts
import { completeClaim, decideClaim, fingerprintRequest, newLeaseToken } from "@classytic/primitives/idempotency";

const identity = { operation: "create-order", key: "k1", scope: { orgId: "org1" } };
const requestFingerprint = fingerprintRequest({ sku: "a", qty: 1 });
const first = decideClaim<{ id: string }>(null, { identity, requestFingerprint, now: new Date(), leaseToken: newLeaseToken() });
if (first.outcome !== "claimed") throw new Error("expected a fresh claim");
const done = completeClaim(first.claim, { leaseToken: first.claim.leaseToken, now: new Date(), result: { status: "succeeded", value: { id: "o1" } } });
const again = decideClaim(done, { identity, requestFingerprint, now: new Date(), leaseToken: newLeaseToken() });
console.log(first.outcome, again.outcome);
```
