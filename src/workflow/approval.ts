/**
 * Approval chain value object and pure state-transition helpers.
 *
 * Hosts embed an `ApprovalChain` on domain documents (quotation, return,
 * high-value transaction, etc.) as a subdocument — this primitive is
 * purely data + pure functions; no persistence, no I/O, no events.
 *
 * Supports:
 *   - sequential chains (step 2 activates only after step 1 approves)
 *   - parallel chains (all pending steps active at once)
 *   - per-step quorum (requiredApprovals out of N approvers)
 *   - skipping steps when a host-evaluated condition fails
 *
 * Chain status is computed from step statuses:
 *   - any step `rejected`                    → chain `rejected`
 *   - all required steps `approved`|`skipped` → chain `approved`
 *   - otherwise                               → chain `pending`
 *
 * @example
 * import { createChain, applyDecision, isApproved } from '@classytic/primitives/approval';
 *
 * let chain = createChain({
 *   order: 'sequential',
 *   steps: [
 *     { id: 'sales',   approvers: [{ id: 'rep1' }] },
 *     { id: 'finance', approvers: [{ id: 'cfo1' }, { id: 'cfo2' }], requiredApprovals: 1 },
 *   ],
 * });
 * chain = applyDecision(chain, { stepId: 'sales',   approverId: 'rep1', decision: 'approved' });
 * chain = applyDecision(chain, { stepId: 'finance', approverId: 'cfo1', decision: 'approved' });
 * isApproved(chain); // → true
 */

export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'skipped';
export type ChainOrder = 'sequential' | 'parallel';

export interface Approver {
  readonly id: string;
  readonly name?: string;
  readonly role?: string;
}

export interface ApprovalDecision {
  readonly approverId: string;
  readonly decision: 'approved' | 'rejected';
  readonly note?: string;
  readonly decidedAt: Date;
}

/**
 * Optional threshold gate. The primitive does not evaluate this — it's
 * metadata the host reads when deciding whether to mark a step `skipped`
 * (via {@link skipStep}). Captures the intent in structured form so the
 * reason for the skip is auditable.
 */
export interface ApprovalThreshold {
  readonly field: string;
  readonly op: 'gt' | 'gte' | 'lt' | 'lte' | 'eq';
  readonly value: number;
}

export interface ApprovalStep {
  readonly id: string;
  readonly name?: string;
  readonly approvers: readonly Approver[];
  /** How many distinct approver decisions of `approved` are needed. Default: 1. */
  readonly requiredApprovals: number;
  readonly threshold?: ApprovalThreshold;
  readonly status: ApprovalStatus;
  readonly decisions: readonly ApprovalDecision[];
  /** Populated when status transitions to `skipped`. */
  readonly skippedReason?: string;
}

export interface ApprovalChain {
  readonly order: ChainOrder;
  readonly steps: readonly ApprovalStep[];
  readonly status: ApprovalStatus;
  /**
   * Provenance for a chain built by {@link notRequiredChain} — why no approval
   * was needed. PROVENANCE ONLY: never branch on it. A subject schema that
   * does not declare this field STRIPS it on write (Mongoose strict mode), so
   * a predicate reading it would answer differently before and after the save.
   * {@link isNotRequired} tests the structure instead, which no schema can drop.
   */
  readonly notRequiredReason?: string;
}

export interface CreateChainInput {
  readonly order: ChainOrder;
  readonly steps: readonly CreateStepInput[];
}

export interface CreateStepInput {
  readonly id: string;
  readonly name?: string;
  readonly approvers: readonly Approver[];
  readonly requiredApprovals?: number;
  readonly threshold?: ApprovalThreshold;
}

export type ApprovalErrorCode =
  | 'EMPTY_STEPS'
  | 'DUPLICATE_STEP_ID'
  | 'EMPTY_APPROVERS'
  | 'DUPLICATE_APPROVER_ID'
  | 'INVALID_QUORUM'
  | 'UNKNOWN_STEP'
  | 'UNAUTHORIZED_APPROVER'
  | 'STEP_NOT_ACTIVE'
  | 'STEP_ALREADY_DECIDED_BY_APPROVER'
  /** A finalize/commit was attempted while the chain has not reached
   *  `approved` (still `pending`, or `rejected`). The single canonical
   *  "not yet approved" gate — hosts route it through arc-approval's
   *  `rethrowApprovalError` to the `approval.chain_incomplete` wire code. */
  | 'CHAIN_INCOMPLETE'
  /** A finalize/commit was attempted with NO chain at all. Distinct from
   *  `CHAIN_INCOMPLETE`: the chain is not unfinished, it is absent — the
   *  document never carried one, or a schema that never declared the field
   *  stripped it on write. See {@link assertApproved}. */
  | 'CHAIN_MISSING';

export class ApprovalError extends Error {
  override readonly name = 'ApprovalError';
  readonly code: ApprovalErrorCode;

  constructor(code: ApprovalErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

/** Build a fresh chain in `pending` state. Validates inputs. */
export function createChain(input: CreateChainInput): ApprovalChain {
  if (input.steps.length === 0) {
    throw new ApprovalError('EMPTY_STEPS', 'chain must have at least one step');
  }

  const seenStepIds = new Set<string>();
  const steps: ApprovalStep[] = input.steps.map((s) => {
    if (seenStepIds.has(s.id)) {
      throw new ApprovalError('DUPLICATE_STEP_ID', `duplicate step id: ${s.id}`);
    }
    seenStepIds.add(s.id);

    if (s.approvers.length === 0) {
      throw new ApprovalError('EMPTY_APPROVERS', `step ${s.id} has no approvers`);
    }
    const seenApproverIds = new Set<string>();
    for (const a of s.approvers) {
      if (seenApproverIds.has(a.id)) {
        throw new ApprovalError(
          'DUPLICATE_APPROVER_ID',
          `step ${s.id} has duplicate approver id: ${a.id}`,
        );
      }
      seenApproverIds.add(a.id);
    }

    const quorum = s.requiredApprovals ?? 1;
    if (!Number.isInteger(quorum) || quorum < 1 || quorum > s.approvers.length) {
      throw new ApprovalError(
        'INVALID_QUORUM',
        `step ${s.id}: requiredApprovals must be integer in [1, ${s.approvers.length}], got ${quorum}`,
      );
    }

    return {
      id: s.id,
      ...(s.name !== undefined ? { name: s.name } : {}),
      approvers: s.approvers,
      requiredApprovals: quorum,
      ...(s.threshold !== undefined ? { threshold: s.threshold } : {}),
      status: 'pending' as ApprovalStatus,
      decisions: [] as readonly ApprovalDecision[],
    };
  });

  return { order: input.order, steps, status: 'pending' };
}

/**
 * The chain for a subject that needs NO approval — zero steps, already
 * resolved. The explicit, greppable answer to "the policy engine ran and
 * decided this document does not require approval."
 *
 * ## Why this is not a fabricated approval
 *
 * {@link computeChainStatus} already folds an empty step list to `'approved'`
 * — "nothing is outstanding" is what approved MEANS to this primitive, and
 * that fold predates this function. What {@link createChain} refuses
 * (`EMPTY_STEPS`) is building a ROUTING chain that routes nowhere, which is a
 * different mistake and stays refused. So this constructor states the same
 * conclusion the fold reaches, under a name a reviewer can search for, rather
 * than letting a caller reach it by handing `createChain` an empty array.
 *
 * ## Why a chain at all, instead of leaving `approvals` absent
 *
 * Because absence is the one input that occurs by accident. A schema that
 * never declared the field strips it, a failed write leaves it unset — and
 * {@link assertApproved} must keep treating that as CHAIN_MISSING. A present,
 * zero-step chain is distinguishable from both a lost chain (absent) and a
 * granted one (has steps and decisions), so every existing gate keeps working
 * unchanged and no caller needs a second predicate beside `isApproved`.
 *
 * ## The hazard, stated plainly
 *
 * This makes {@link isApproved} true without a human deciding anything. It is
 * only correct where a policy engine ASKED and got "no policy applies" — never
 * as a fallback for a lookup that failed, errored, or was not configured. A
 * resolver that cannot reach its policy store must throw; answering "not
 * required" there would auto-approve every document in the deployment, which
 * is precisely the permissive-default failure this codebase designs against.
 *
 * @param reason Why approval was not required, for the audit trail.
 */
export function notRequiredChain(reason: string): ApprovalChain {
  return {
    order: 'sequential',
    steps: [],
    status: computeChainStatus([]),
    notRequiredReason: reason,
  };
}

/**
 * Returns the next step awaiting a decision — or `null` if none.
 *
 * For `sequential` chains: the first `pending` step in order; later steps
 * remain inactive until earlier ones finalise.
 *
 * For `parallel` chains: returns the first pending step (all pending steps
 * are active simultaneously; host typically iterates with {@link pendingSteps}).
 */
export function nextPendingStep(chain: ApprovalChain): ApprovalStep | null {
  for (const step of chain.steps) {
    if (step.status === 'pending') return step;
  }
  return null;
}

/** All steps currently eligible to receive a decision. */
export function pendingSteps(chain: ApprovalChain): readonly ApprovalStep[] {
  if (chain.order === 'sequential') {
    const next = nextPendingStep(chain);
    return next ? [next] : [];
  }
  return chain.steps.filter((s) => s.status === 'pending');
}

export interface DecisionInput {
  readonly stepId: string;
  readonly approverId: string;
  readonly decision: 'approved' | 'rejected';
  readonly note?: string;
  readonly decidedAt?: Date;
}

/**
 * Apply a decision to a step. Returns a new chain — original is not mutated.
 * Throws if the step is unknown, not active, the approver isn't listed, or
 * the approver has already decided.
 */
export function applyDecision(chain: ApprovalChain, input: DecisionInput): ApprovalChain {
  const stepIndex = chain.steps.findIndex((s) => s.id === input.stepId);
  if (stepIndex === -1) {
    throw new ApprovalError('UNKNOWN_STEP', `no step with id ${input.stepId}`);
  }
  const step = chain.steps[stepIndex];
  if (!step) {
    throw new ApprovalError('UNKNOWN_STEP', `no step with id ${input.stepId}`);
  }

  const active = pendingSteps(chain).some((s) => s.id === input.stepId);
  if (!active) {
    throw new ApprovalError(
      'STEP_NOT_ACTIVE',
      `step ${input.stepId} is not currently active (status=${step.status})`,
    );
  }

  const approverAllowed = step.approvers.some((a) => a.id === input.approverId);
  if (!approverAllowed) {
    throw new ApprovalError(
      'UNAUTHORIZED_APPROVER',
      `approver ${input.approverId} is not listed on step ${input.stepId}`,
    );
  }

  if (step.decisions.some((d) => d.approverId === input.approverId)) {
    throw new ApprovalError(
      'STEP_ALREADY_DECIDED_BY_APPROVER',
      `approver ${input.approverId} has already decided on step ${input.stepId}`,
    );
  }

  const decision: ApprovalDecision = {
    approverId: input.approverId,
    decision: input.decision,
    ...(input.note !== undefined ? { note: input.note } : {}),
    decidedAt: input.decidedAt ?? new Date(),
  };

  const updatedStep = computeStepStatus({
    ...step,
    decisions: [...step.decisions, decision],
  });

  const updatedSteps = chain.steps.map((s, i) => (i === stepIndex ? updatedStep : s));
  return {
    order: chain.order,
    steps: updatedSteps,
    status: computeChainStatus(updatedSteps),
  };
}

/**
 * Mark a step as skipped — for when a host-evaluated condition determines
 * the step is not required (e.g., amount < threshold). Skipped steps count
 * as "completed" for chain approval.
 */
export function skipStep(chain: ApprovalChain, stepId: string, reason?: string): ApprovalChain {
  const stepIndex = chain.steps.findIndex((s) => s.id === stepId);
  if (stepIndex === -1) {
    throw new ApprovalError('UNKNOWN_STEP', `no step with id ${stepId}`);
  }
  const step = chain.steps[stepIndex];
  if (!step) {
    throw new ApprovalError('UNKNOWN_STEP', `no step with id ${stepId}`);
  }
  if (step.status !== 'pending') {
    throw new ApprovalError(
      'STEP_NOT_ACTIVE',
      `step ${stepId} cannot be skipped (status=${step.status})`,
    );
  }

  const updatedStep: ApprovalStep = {
    ...step,
    status: 'skipped',
    ...(reason !== undefined ? { skippedReason: reason } : {}),
  };
  const updatedSteps = chain.steps.map((s, i) => (i === stepIndex ? updatedStep : s));
  return {
    order: chain.order,
    steps: updatedSteps,
    status: computeChainStatus(updatedSteps),
  };
}

export function isApproved(chain: ApprovalChain): boolean {
  return chain.status === 'approved';
}

/**
 * Was this chain built by {@link notRequiredChain} — i.e. approval did not
 * apply, as opposed to having been granted?
 *
 * Both are `isApproved`, and for GATING that is correct: neither blocks the
 * operation. Use this only where the difference is worth showing — an audit
 * trail or an approvals UI, where rendering "Approved" for a document nobody
 * approved misleads the reader.
 *
 * Tests the STRUCTURE (no steps ⇒ nobody was ever asked), not
 * `notRequiredReason`, which a subject schema that never declared the field
 * silently drops on write.
 */
export function isNotRequired(chain: ApprovalChain): boolean {
  return chain.steps.length === 0;
}

export interface AssertApprovedOptions {
  /** Override the thrown message. */
  readonly message?: string;
}

/**
 * The canonical finalize-time gate: assert a chain EXISTS and has reached
 * `approved`, else throw. Use it at every commit/post/finalize boundary that
 * must not proceed unapproved (journal-entry post, PO approve, transfer
 * dispatch, payment release) so they all raise the same two codes instead of
 * hand-rolling divergent ones.
 *
 * ## Absence is not approval
 *
 * This function used to PASS on `null`/`undefined`, documented as "no chain
 * required", with only prose telling callers to check presence separately. That
 * is the permissive default with the widest blast radius: the gate reads as
 * enforced at every call site while doing nothing for the one input most likely
 * to occur by accident.
 *
 * And it occurs by accident routinely — a mongoose schema that never declared
 * `approvalChain` **strips it on write**, so a document that carried a chain in
 * memory reads back without one. The gate then passes, the money moves, and
 * nothing anywhere says so. The flag has to survive the write; a gate that
 * cannot tell "no approval configured" from "approval silently lost" must
 * assume the dangerous one.
 *
 * A caller that genuinely permits an absent chain must say so by name —
 * {@link assertApprovedIfPresent} — which is greppable in review, unlike a
 * `null` that never got checked.
 *
 * @throws ApprovalError `CHAIN_MISSING` when `chain` is null/undefined.
 * @throws ApprovalError `CHAIN_INCOMPLETE` when it exists but is not `approved`.
 */
export function assertApproved(
  chain: ApprovalChain | null | undefined,
  options: AssertApprovedOptions = {},
): void {
  if (chain == null) {
    throw new ApprovalError(
      'CHAIN_MISSING',
      options.message ??
        'no approval chain present at a gate that requires one — an absent chain is not an approved one. ' +
          'If this boundary legitimately runs without approval, call assertApprovedIfPresent() so the exemption is explicit.',
    );
  }
  if (!isApproved(chain)) {
    throw new ApprovalError(
      'CHAIN_INCOMPLETE',
      options.message ?? `approval chain has not reached 'approved' (status='${chain.status}')`,
    );
  }
}

/**
 * The EXPLICIT opt-out: enforce the chain when one is present, allow the
 * operation when none is.
 *
 * Only correct where "no chain" is a configured state the host can distinguish
 * from a lost one — e.g. a policy engine that decided this document needs no
 * approval and recorded that decision elsewhere. If you cannot tell the two
 * apart, use {@link assertApproved}.
 */
export function assertApprovedIfPresent(
  chain: ApprovalChain | null | undefined,
  options: AssertApprovedOptions = {},
): void {
  if (chain == null) return;
  assertApproved(chain, options);
}

export function isRejected(chain: ApprovalChain): boolean {
  return chain.status === 'rejected';
}

export function isPending(chain: ApprovalChain): boolean {
  return chain.status === 'pending';
}

/**
 * Count total decisions across all steps. Useful for audit summaries.
 */
export function decisionCount(chain: ApprovalChain): number {
  return chain.steps.reduce((n, s) => n + s.decisions.length, 0);
}

// ─────────────────────────────────────────────────────────────────────────
// internals
// ─────────────────────────────────────────────────────────────────────────

function computeStepStatus(step: ApprovalStep): ApprovalStep {
  if (step.decisions.some((d) => d.decision === 'rejected')) {
    return { ...step, status: 'rejected' };
  }
  const approvedCount = step.decisions.filter((d) => d.decision === 'approved').length;
  if (approvedCount >= step.requiredApprovals) {
    return { ...step, status: 'approved' };
  }
  return step;
}

function computeChainStatus(steps: readonly ApprovalStep[]): ApprovalStatus {
  if (steps.some((s) => s.status === 'rejected')) {
    return 'rejected';
  }
  const allResolved = steps.every((s) => s.status === 'approved' || s.status === 'skipped');
  return allResolved ? 'approved' : 'pending';
}
