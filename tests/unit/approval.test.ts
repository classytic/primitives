import { describe, expect, it } from 'vitest';
import {
  type ApprovalChain,
  type ApprovalError,
  applyDecision,
  createChain,
  decisionCount,
  isApproved,
  isPending,
  isRejected,
  nextPendingStep,
  pendingSteps,
  skipStep,
} from '../../src/approval.js';

function makeSimpleChain(): ApprovalChain {
  return createChain({
    order: 'sequential',
    steps: [
      { id: 'sales', approvers: [{ id: 'rep1' }] },
      { id: 'finance', approvers: [{ id: 'cfo1' }] },
    ],
  });
}

describe('createChain — validation', () => {
  it('rejects empty step list', () => {
    try {
      createChain({ order: 'sequential', steps: [] });
      expect.fail('should throw');
    } catch (e) {
      expect((e as ApprovalError).code).toBe('EMPTY_STEPS');
    }
  });

  it('rejects duplicate step ids', () => {
    try {
      createChain({
        order: 'sequential',
        steps: [
          { id: 's1', approvers: [{ id: 'a' }] },
          { id: 's1', approvers: [{ id: 'b' }] },
        ],
      });
      expect.fail('should throw');
    } catch (e) {
      expect((e as ApprovalError).code).toBe('DUPLICATE_STEP_ID');
    }
  });

  it('rejects empty approvers', () => {
    try {
      createChain({
        order: 'sequential',
        steps: [{ id: 's1', approvers: [] }],
      });
      expect.fail('should throw');
    } catch (e) {
      expect((e as ApprovalError).code).toBe('EMPTY_APPROVERS');
    }
  });

  it('rejects duplicate approver ids within a step', () => {
    try {
      createChain({
        order: 'sequential',
        steps: [
          {
            id: 's1',
            approvers: [{ id: 'a' }, { id: 'a' }],
          },
        ],
      });
      expect.fail('should throw');
    } catch (e) {
      expect((e as ApprovalError).code).toBe('DUPLICATE_APPROVER_ID');
    }
  });

  it('rejects invalid quorum (zero, negative, > approver count, non-integer)', () => {
    const approvers = [{ id: 'a' }, { id: 'b' }];
    for (const bad of [0, -1, 3, 1.5, Number.NaN]) {
      try {
        createChain({
          order: 'parallel',
          steps: [{ id: 's1', approvers, requiredApprovals: bad }],
        });
        expect.fail(`should throw for quorum=${bad}`);
      } catch (e) {
        expect((e as ApprovalError).code).toBe('INVALID_QUORUM');
      }
    }
  });

  it('defaults requiredApprovals to 1', () => {
    const c = createChain({
      order: 'sequential',
      steps: [{ id: 's1', approvers: [{ id: 'a' }, { id: 'b' }] }],
    });
    expect(c.steps[0]?.requiredApprovals).toBe(1);
  });

  it('initializes chain and all steps in pending status with no decisions', () => {
    const c = makeSimpleChain();
    expect(c.status).toBe('pending');
    expect(c.steps.every((s) => s.status === 'pending')).toBe(true);
    expect(decisionCount(c)).toBe(0);
  });
});

describe('nextPendingStep / pendingSteps — sequential chain', () => {
  it('returns the first pending step only', () => {
    const c = makeSimpleChain();
    expect(nextPendingStep(c)?.id).toBe('sales');
    expect(pendingSteps(c).map((s) => s.id)).toEqual(['sales']);
  });

  it('advances after a step finalises', () => {
    let c = makeSimpleChain();
    c = applyDecision(c, { stepId: 'sales', approverId: 'rep1', decision: 'approved' });
    expect(nextPendingStep(c)?.id).toBe('finance');
  });
});

describe('pendingSteps — parallel chain', () => {
  it('returns all pending steps at once', () => {
    const c = createChain({
      order: 'parallel',
      steps: [
        { id: 'a', approvers: [{ id: 'u1' }] },
        { id: 'b', approvers: [{ id: 'u2' }] },
        { id: 'c', approvers: [{ id: 'u3' }] },
      ],
    });
    expect(pendingSteps(c).map((s) => s.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('applyDecision — happy path', () => {
  it('marks step approved when quorum met (default quorum=1)', () => {
    let c = makeSimpleChain();
    c = applyDecision(c, { stepId: 'sales', approverId: 'rep1', decision: 'approved' });
    expect(c.steps[0]?.status).toBe('approved');
    expect(c.status).toBe('pending'); // finance still pending
  });

  it('marks chain approved when all steps complete', () => {
    let c = makeSimpleChain();
    c = applyDecision(c, { stepId: 'sales', approverId: 'rep1', decision: 'approved' });
    c = applyDecision(c, { stepId: 'finance', approverId: 'cfo1', decision: 'approved' });
    expect(isApproved(c)).toBe(true);
    expect(isPending(c)).toBe(false);
  });

  it('preserves immutability — returns new chain, original unchanged', () => {
    const before = makeSimpleChain();
    const after = applyDecision(before, {
      stepId: 'sales',
      approverId: 'rep1',
      decision: 'approved',
    });
    expect(before.steps[0]?.status).toBe('pending');
    expect(after.steps[0]?.status).toBe('approved');
    expect(before).not.toBe(after);
  });

  it('records decidedAt and note on the decision', () => {
    const when = new Date('2026-04-17T12:00:00Z');
    const c = applyDecision(makeSimpleChain(), {
      stepId: 'sales',
      approverId: 'rep1',
      decision: 'approved',
      note: 'approved per Q2 policy',
      decidedAt: when,
    });
    const d = c.steps[0]?.decisions[0];
    expect(d?.note).toBe('approved per Q2 policy');
    expect(d?.decidedAt).toBe(when);
  });
});

describe('applyDecision — quorum', () => {
  it('parallel quorum: step approved when requiredApprovals met (even with more approvers)', () => {
    let c = createChain({
      order: 'sequential',
      steps: [
        {
          id: 'finance',
          approvers: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
          requiredApprovals: 2,
        },
      ],
    });
    c = applyDecision(c, { stepId: 'finance', approverId: 'a', decision: 'approved' });
    expect(c.steps[0]?.status).toBe('pending'); // 1 of 2
    c = applyDecision(c, { stepId: 'finance', approverId: 'b', decision: 'approved' });
    expect(c.steps[0]?.status).toBe('approved'); // 2 of 2
    expect(isApproved(c)).toBe(true);
  });

  it('any rejection on a step immediately rejects it and the chain', () => {
    let c = createChain({
      order: 'sequential',
      steps: [
        {
          id: 'finance',
          approvers: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
          requiredApprovals: 2,
        },
      ],
    });
    c = applyDecision(c, { stepId: 'finance', approverId: 'a', decision: 'approved' });
    c = applyDecision(c, { stepId: 'finance', approverId: 'b', decision: 'rejected' });
    expect(c.steps[0]?.status).toBe('rejected');
    expect(isRejected(c)).toBe(true);
  });
});

describe('applyDecision — error cases', () => {
  it('throws on unknown step', () => {
    try {
      applyDecision(makeSimpleChain(), {
        stepId: 'missing',
        approverId: 'x',
        decision: 'approved',
      });
      expect.fail('should throw');
    } catch (e) {
      expect((e as ApprovalError).code).toBe('UNKNOWN_STEP');
    }
  });

  it('throws when decising on a step that is not active yet (sequential gating)', () => {
    try {
      applyDecision(makeSimpleChain(), {
        stepId: 'finance',
        approverId: 'cfo1',
        decision: 'approved',
      });
      expect.fail('should throw');
    } catch (e) {
      expect((e as ApprovalError).code).toBe('STEP_NOT_ACTIVE');
    }
  });

  it('throws when deciding on an already-finalized step', () => {
    let c = makeSimpleChain();
    c = applyDecision(c, { stepId: 'sales', approverId: 'rep1', decision: 'approved' });
    try {
      applyDecision(c, {
        stepId: 'sales',
        approverId: 'rep1',
        decision: 'rejected',
      });
      expect.fail('should throw');
    } catch (e) {
      expect((e as ApprovalError).code).toBe('STEP_NOT_ACTIVE');
    }
  });

  it('throws when approver is not listed on the step', () => {
    try {
      applyDecision(makeSimpleChain(), {
        stepId: 'sales',
        approverId: 'stranger',
        decision: 'approved',
      });
      expect.fail('should throw');
    } catch (e) {
      expect((e as ApprovalError).code).toBe('UNAUTHORIZED_APPROVER');
    }
  });

  it('throws when the same approver tries to decide twice on a step', () => {
    let c = createChain({
      order: 'sequential',
      steps: [
        {
          id: 's',
          approvers: [{ id: 'a' }, { id: 'b' }],
          requiredApprovals: 2,
        },
      ],
    });
    c = applyDecision(c, { stepId: 's', approverId: 'a', decision: 'approved' });
    try {
      applyDecision(c, { stepId: 's', approverId: 'a', decision: 'rejected' });
      expect.fail('should throw');
    } catch (e) {
      expect((e as ApprovalError).code).toBe('STEP_ALREADY_DECIDED_BY_APPROVER');
    }
  });
});

describe('skipStep', () => {
  it('marks a pending step as skipped and carries chain forward', () => {
    let c = createChain({
      order: 'sequential',
      steps: [
        { id: 'sales', approvers: [{ id: 'rep1' }] },
        { id: 'finance', approvers: [{ id: 'cfo1' }] },
      ],
    });
    c = applyDecision(c, { stepId: 'sales', approverId: 'rep1', decision: 'approved' });
    c = skipStep(c, 'finance', 'amount below threshold');
    expect(c.steps[1]?.status).toBe('skipped');
    expect(c.steps[1]?.skippedReason).toBe('amount below threshold');
    expect(isApproved(c)).toBe(true);
  });

  it('throws when skipping an unknown step', () => {
    try {
      skipStep(makeSimpleChain(), 'missing');
      expect.fail('should throw');
    } catch (e) {
      expect((e as ApprovalError).code).toBe('UNKNOWN_STEP');
    }
  });

  it('throws when skipping a finalized step', () => {
    let c = makeSimpleChain();
    c = applyDecision(c, { stepId: 'sales', approverId: 'rep1', decision: 'approved' });
    try {
      skipStep(c, 'sales');
      expect.fail('should throw');
    } catch (e) {
      expect((e as ApprovalError).code).toBe('STEP_NOT_ACTIVE');
    }
  });
});

describe('parallel chain with threshold skips — realistic scenario', () => {
  it('auto-skip + approve flow', () => {
    let c = createChain({
      order: 'parallel',
      steps: [
        { id: 'manager', approvers: [{ id: 'mgr' }] },
        {
          id: 'cfo',
          approvers: [{ id: 'cfo' }],
          threshold: { field: 'amount', op: 'gt', value: 10000 },
        },
      ],
    });
    // Host evaluates threshold against amount=500 and skips.
    c = skipStep(c, 'cfo', 'amount 500 does not exceed 10000');
    c = applyDecision(c, { stepId: 'manager', approverId: 'mgr', decision: 'approved' });
    expect(isApproved(c)).toBe(true);
  });
});
