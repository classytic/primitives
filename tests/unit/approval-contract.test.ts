import { describe, expect, it } from 'vitest';
import {
  APPROVAL_ACTIONS,
  applyDecision,
  attachRequest,
  createChain,
  decidableStepIds,
} from '../../src/workflow/approval.js';

const twoStep = () =>
  createChain({
    order: 'sequential',
    steps: [
      { id: 'manager', approvers: [{ id: 'm1' }, { id: 'm2' }] },
      { id: 'finance', approvers: [{ id: 'f1' }] },
    ],
  });

describe('APPROVAL_ACTIONS', () => {
  it('names the two verbs the server mounts', () => {
    expect(APPROVAL_ACTIONS).toEqual({ submit: 'submit_for_approval', decide: 'decide' });
  });
});

describe('decidableStepIds', () => {
  it('gives a named approver the active step only', () => {
    const chain = twoStep();
    expect(decidableStepIds(chain, 'm1')).toEqual(['manager']);
    expect(decidableStepIds(chain, 'f1')).toEqual([]);
  });

  it('gives an actor the chain does not name nothing', () => {
    expect(decidableStepIds(twoStep(), 'admin')).toEqual([]);
    expect(decidableStepIds(twoStep(), null)).toEqual([]);
  });

  it('advances with the chain and never re-offers a decided step', () => {
    const after = applyDecision(twoStep(), { stepId: 'manager', approverId: 'm1', decision: 'approved' });
    expect(decidableStepIds(after, 'm1')).toEqual([]);
    expect(decidableStepIds(after, 'f1')).toEqual(['finance']);
  });

  it('offers every pending step of a parallel chain the actor is on', () => {
    const chain = createChain({
      order: 'parallel',
      steps: [
        { id: 'a', approvers: [{ id: 'x' }] },
        { id: 'b', approvers: [{ id: 'x' }, { id: 'y' }] },
      ],
    });
    expect(decidableStepIds(chain, 'x')).toEqual(['a', 'b']);
  });

  it('never offers the requester a step (maker-checker removes them)', () => {
    const chain = attachRequest(twoStep(), { by: 'm1', at: new Date() });
    expect(decidableStepIds(chain, 'm1')).toEqual([]);
    expect(decidableStepIds(chain, 'm2')).toEqual(['manager']);
  });

  it('reads the JSON form of a chain', () => {
    const wire = JSON.parse(JSON.stringify(twoStep()));
    expect(decidableStepIds(wire, 'm2')).toEqual(['manager']);
  });

  it('answers nothing once the chain is settled', () => {
    const rejected = applyDecision(twoStep(), { stepId: 'manager', approverId: 'm1', decision: 'rejected' });
    expect(decidableStepIds(rejected, 'm2')).toEqual([]);
  });
});
