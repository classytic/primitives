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
  | 'STEP_ALREADY_DECIDED_BY_APPROVER';

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
