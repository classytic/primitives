import { describe, expect, it } from 'vitest';
import {
  type ApprovalChainJson,
  applyDecision,
  attachRequest,
  chainToJson,
  createChain,
  decidableStepIds,
  notRequiredChain,
  skipStep,
} from '../../src/workflow/approval.js';

const at = new Date('2026-10-31T09:15:00.000Z');

function decided() {
  const chain = createChain({
    order: 'sequential',
    steps: [
      {
        id: 'second_person',
        name: 'Second person',
        approvers: [{ id: 'u2', name: 'Huda', role: 'supervisor' }],
      },
      {
        id: 'finance',
        approvers: [{ id: 'u3' }],
        threshold: { field: 'amount', op: 'gt', value: 5000 },
      },
    ],
  });
  const requested = attachRequest(chain, {
    by: 'u1',
    at,
    basis: { amount: 1250, unit: 'minor', category: 'lost_key' },
  });
  const first = applyDecision(requested, {
    stepId: 'second_person',
    approverId: 'u2',
    decision: 'approved',
    note: 'Seen the key',
    decidedAt: new Date('2026-10-31T09:20:00.000Z'),
    actorOrganizationId: 'org-b',
  });
  return skipStep(first, 'finance', 'under threshold');
}

describe('chainToJson', () => {
  it('turns every instant into an ISO string and keeps every field', () => {
    const json = chainToJson(decided());
    expect(json).toEqual({
      order: 'sequential',
      status: 'approved',
      steps: [
        {
          id: 'second_person',
          name: 'Second person',
          approvers: [{ id: 'u2', name: 'Huda', role: 'supervisor' }],
          requiredApprovals: 1,
          status: 'approved',
          decisions: [
            {
              approverId: 'u2',
              decision: 'approved',
              note: 'Seen the key',
              decidedAt: '2026-10-31T09:20:00.000Z',
              actorOrganizationId: 'org-b',
            },
          ],
        },
        {
          id: 'finance',
          approvers: [{ id: 'u3' }],
          requiredApprovals: 1,
          threshold: { field: 'amount', op: 'gt', value: 5000 },
          status: 'skipped',
          decisions: [],
          skippedReason: 'under threshold',
        },
      ],
      request: {
        by: 'u1',
        at: '2026-10-31T09:15:00.000Z',
        basis: { amount: 1250, unit: 'minor', category: 'lost_key' },
      },
    } satisfies ApprovalChainJson);
  });

  it('equals what JSON.stringify would send, with no undefined keys', () => {
    const chain = decided();
    const json = chainToJson(chain);
    expect(JSON.parse(JSON.stringify(chain))).toEqual(json);
    const keysWithUndefined = JSON.stringify(json, (_k, v) =>
      v === undefined ? '__undefined__' : v,
    );
    expect(keysWithUndefined).not.toContain('__undefined__');
  });

  it('does not share structure with the stored chain', () => {
    const chain = decided();
    const json = chainToJson(chain) as { steps: Array<{ approvers: unknown[] }> };
    expect(json.steps[0]?.approvers).not.toBe(chain.steps[0]?.approvers);
    expect((json as unknown as { request: { basis: unknown } }).request.basis).not.toBe(
      chain.request?.basis,
    );
  });

  it('accepts a chain whose instants are already strings (read back from JSON) and keeps them', () => {
    const fromWire = JSON.parse(JSON.stringify(decided())) as ApprovalChainJson;
    expect(chainToJson(fromWire)).toEqual(chainToJson(decided()));
  });

  it('keeps notRequiredReason and a chain with no request', () => {
    expect(chainToJson(notRequiredChain('below limit'))).toEqual({
      order: 'sequential',
      status: 'approved',
      steps: [],
      notRequiredReason: 'below limit',
    });
  });

  it('the JSON form is a DecidableChain', () => {
    const chain = attachRequest(
      createChain({ order: 'parallel', steps: [{ id: 's', approvers: [{ id: 'u2' }] }] }),
      { by: 'u1', at },
    );
    expect(decidableStepIds(chainToJson(chain), 'u2')).toEqual(['s']);
    expect(decidableStepIds(chainToJson(chain), 'u1')).toEqual([]);
  });

  it('refuses an invalid instant instead of sending "Invalid Date"', () => {
    const chain = attachRequest(
      createChain({ order: 'parallel', steps: [{ id: 's', approvers: [{ id: 'u2' }] }] }),
      { by: 'u1', at: new Date('nope') },
    );
    expect(() => chainToJson(chain)).toThrow(RangeError);
  });
});
