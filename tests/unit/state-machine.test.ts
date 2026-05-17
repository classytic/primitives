/**
 * Unit tests for the `defineStateMachine` primitive.
 *
 * Pin the contract: declarative transitions table → `canTransition` /
 * `assertTransition` / `isTerminal` accessors. Hosts adopt by declaring
 * one machine per aggregate.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  assertAndClaim,
  type ClaimableRepo,
  defineStateMachine,
  IllegalTransitionError,
  type TransitionErrorContext,
} from '../../src/workflow/state-machine.js';

type Status = 'draft' | 'approved' | 'received' | 'cancelled';

const ORDER_MACHINE = defineStateMachine<Status>({
  name: 'TestOrder',
  transitions: {
    draft: ['approved', 'cancelled'],
    approved: ['received', 'cancelled'],
    received: [],
    cancelled: [],
  },
});

describe('defineStateMachine', () => {
  describe('canTransition', () => {
    it('returns true for explicitly allowed transitions', () => {
      expect(ORDER_MACHINE.canTransition('draft', 'approved')).toBe(true);
      expect(ORDER_MACHINE.canTransition('approved', 'received')).toBe(true);
    });

    it('returns false for transitions not in the table', () => {
      expect(ORDER_MACHINE.canTransition('draft', 'received')).toBe(false);
      expect(ORDER_MACHINE.canTransition('received', 'approved')).toBe(false);
    });

    it('returns false from terminal statuses', () => {
      expect(ORDER_MACHINE.canTransition('received', 'cancelled')).toBe(false);
      expect(ORDER_MACHINE.canTransition('cancelled', 'received')).toBe(false);
    });

    it('returns false for self-transitions unless declared', () => {
      expect(ORDER_MACHINE.canTransition('draft', 'draft')).toBe(false);
    });
  });

  describe('assertTransition (default error)', () => {
    it('does NOT throw on allowed transitions', () => {
      expect(() => ORDER_MACHINE.assertTransition('po-1', 'draft', 'approved')).not.toThrow();
    });

    it('throws IllegalTransitionError with structured fields on disallowed transitions', () => {
      let caught: unknown;
      try {
        ORDER_MACHINE.assertTransition('po-1', 'received', 'approved');
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(IllegalTransitionError);
      const e = caught as IllegalTransitionError;
      expect(e.entityType).toBe('TestOrder');
      expect(e.entityId).toBe('po-1');
      expect(e.from).toBe('received');
      expect(e.to).toBe('approved');
      expect(e.code).toBe('illegal_transition');
      expect(e.status).toBe(422);
    });

    it('produces a human-readable message including entity + arrow', () => {
      let caught: unknown;
      try {
        ORDER_MACHINE.assertTransition('po-7', 'received', 'cancelled');
      } catch (err) {
        caught = err;
      }
      expect((caught as Error).message).toContain('TestOrder po-7');
      expect((caught as Error).message).toContain('received → cancelled');
    });
  });

  describe('assertTransition (custom errorFactory)', () => {
    class HostTransitionError extends Error {
      readonly code = 'host.transition' as const;
      constructor(public readonly ctx: TransitionErrorContext) {
        super(`Host: ${ctx.entityType} ${ctx.from} -> ${ctx.to}`);
      }
    }

    const machine = defineStateMachine<Status>({
      name: 'TestOrder',
      transitions: {
        draft: ['approved', 'cancelled'],
        approved: ['received', 'cancelled'],
        received: [],
        cancelled: [],
      },
      errorFactory: (ctx) => new HostTransitionError(ctx),
    });

    it('throws the host-supplied error when configured', () => {
      let caught: unknown;
      try {
        machine.assertTransition('po-1', 'received', 'approved');
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(HostTransitionError);
      expect(caught).not.toBeInstanceOf(IllegalTransitionError);
    });

    it('factory receives the full transition context', () => {
      try {
        machine.assertTransition('po-77', 'received', 'cancelled');
      } catch (err) {
        const e = err as HostTransitionError;
        expect(e.ctx).toEqual({
          entityType: 'TestOrder',
          entityId: 'po-77',
          from: 'received',
          to: 'cancelled',
        });
      }
    });
  });

  describe('isTerminal / terminal', () => {
    it('flags statuses with empty transition lists as terminal', () => {
      expect(ORDER_MACHINE.isTerminal('received')).toBe(true);
      expect(ORDER_MACHINE.isTerminal('cancelled')).toBe(true);
    });

    it('non-terminal statuses are NOT terminal', () => {
      expect(ORDER_MACHINE.isTerminal('draft')).toBe(false);
      expect(ORDER_MACHINE.isTerminal('approved')).toBe(false);
    });

    it('exposes the terminal Set for callers that filter (counting/move-group)', () => {
      expect(ORDER_MACHINE.terminal).toBeInstanceOf(Set);
      expect(ORDER_MACHINE.terminal.has('received')).toBe(true);
      expect(ORDER_MACHINE.terminal.has('cancelled')).toBe(true);
      expect(ORDER_MACHINE.terminal.has('draft')).toBe(false);
    });
  });

  describe('exhaustiveness', () => {
    it('every status declared in the table has an entry', () => {
      const keys = Object.keys(ORDER_MACHINE.transitions);
      expect(keys.sort()).toEqual(['approved', 'cancelled', 'draft', 'received']);
    });
  });

  describe('table is read-only at runtime', () => {
    it('exposes the transitions map for inspection', () => {
      expect(ORDER_MACHINE.transitions.draft).toEqual(['approved', 'cancelled']);
    });
  });

  describe('validTargets', () => {
    it('returns the readonly forward adjacency for a non-terminal status', () => {
      expect(ORDER_MACHINE.validTargets('draft')).toEqual(['approved', 'cancelled']);
      expect(ORDER_MACHINE.validTargets('approved')).toEqual(['received', 'cancelled']);
    });

    it('returns an empty array for terminal statuses', () => {
      expect(ORDER_MACHINE.validTargets('received')).toEqual([]);
      expect(ORDER_MACHINE.validTargets('cancelled')).toEqual([]);
    });
  });

  describe('validSources', () => {
    it('returns every source status that can transition INTO `to` (reverse adjacency)', () => {
      // approved is reachable only from draft
      expect(ORDER_MACHINE.validSources('approved')).toEqual(['draft']);
      // cancelled is reachable from draft AND approved
      const cancelledSources = [...ORDER_MACHINE.validSources('cancelled')].sort();
      expect(cancelledSources).toEqual(['approved', 'draft']);
      // received is reachable only from approved
      expect(ORDER_MACHINE.validSources('received')).toEqual(['approved']);
    });

    it('returns an empty array for unreachable statuses', () => {
      // draft has no inbound transitions in this table
      expect(ORDER_MACHINE.validSources('draft')).toEqual([]);
    });
  });

  describe('assertAndClaim — sync assert + atomic CAS pairing', () => {
    type Doc = { _id: string; status: Status };

    function makeRepo(result: Doc | null = { _id: 'x', status: 'approved' }): ClaimableRepo<Doc> & {
      claim: ReturnType<typeof vi.fn>;
    } {
      return {
        claim: vi.fn(async () => result),
      };
    }

    it('asserts machine table THEN forwards to repo.claim with the same shape', async () => {
      const repo = makeRepo();
      const updated = await assertAndClaim(ORDER_MACHINE, repo, 'po-1', {
        from: 'draft',
        to: 'approved',
        patch: { approvedAt: new Date('2026-01-01') },
        options: { organizationId: 'org-1' },
      });

      expect(updated).toEqual({ _id: 'x', status: 'approved' });
      expect(repo.claim).toHaveBeenCalledTimes(1);
      const [id, transition, patch, options] = repo.claim.mock.calls[0];
      expect(id).toBe('po-1');
      expect(transition).toMatchObject({ from: 'draft', to: 'approved' });
      expect(patch).toMatchObject({ approvedAt: new Date('2026-01-01') });
      expect(options).toMatchObject({ organizationId: 'org-1' });
    });

    it('throws BEFORE round-tripping when the transition is illegal', async () => {
      const repo = makeRepo();
      await expect(
        assertAndClaim(ORDER_MACHINE, repo, 'po-1', {
          from: 'received', // terminal — no targets
          to: 'cancelled',
        }),
      ).rejects.toThrow(IllegalTransitionError);
      expect(repo.claim).not.toHaveBeenCalled();
    });

    it('returns null on race-loss (passthrough from repo.claim)', async () => {
      const repo = makeRepo(null);
      const updated = await assertAndClaim(ORDER_MACHINE, repo, 'po-1', {
        from: 'draft',
        to: 'approved',
      });
      expect(updated).toBeNull();
      expect(repo.claim).toHaveBeenCalledTimes(1);
    });

    it('multi-source via from: T[] — asserts EVERY listed source legal', async () => {
      const repo = makeRepo();
      // draft → cancelled and approved → cancelled both legal
      await assertAndClaim(ORDER_MACHINE, repo, 'po-1', {
        from: ['draft', 'approved'] as const,
        to: 'cancelled',
        options: { organizationId: 'org-1' },
      });
      expect(repo.claim).toHaveBeenCalledTimes(1);
      expect(repo.claim.mock.calls[0][1]).toMatchObject({
        from: ['draft', 'approved'],
        to: 'cancelled',
      });
    });

    it('multi-source rejects when ANY listed source is illegal', async () => {
      const repo = makeRepo();
      // received is terminal — listing it as a source for any target is illegal
      await expect(
        assertAndClaim(ORDER_MACHINE, repo, 'po-1', {
          from: ['draft', 'received'] as const,
          to: 'cancelled',
        }),
      ).rejects.toThrow(IllegalTransitionError);
      expect(repo.claim).not.toHaveBeenCalled();
    });

    it('composes with validSources for "transition from any legal predecessor"', async () => {
      const repo = makeRepo();
      const sources = ORDER_MACHINE.validSources('cancelled');
      await assertAndClaim(ORDER_MACHINE, repo, 'po-1', {
        from: sources,
        to: 'cancelled',
      });
      expect(repo.claim).toHaveBeenCalledTimes(1);
      const passedFrom = (repo.claim.mock.calls[0][1] as { from: readonly string[] }).from;
      expect([...passedFrom].sort()).toEqual(['approved', 'draft']);
    });
  });

  describe('integration shape — drop-in replacement for hand-rolled assertions', () => {
    type MoveStatus = 'pending' | 'reserved' | 'done' | 'cancelled';
    const machine = defineStateMachine<MoveStatus>({
      name: 'StockMove',
      transitions: {
        pending: ['reserved', 'cancelled'],
        reserved: ['done', 'cancelled'],
        done: [],
        cancelled: [],
      },
    });

    it('assertTransition replaces both the "already-done" and "illegal-step" hand-rolled checks', () => {
      // already-done check: assertion fails on done → cancelled.
      expect(() => machine.assertTransition('move-1', 'done', 'cancelled')).toThrow(
        IllegalTransitionError,
      );
      // illegal-step check: pending → done isn't directly allowed.
      expect(() => machine.assertTransition('move-1', 'pending', 'done')).toThrow(
        IllegalTransitionError,
      );
      // Allowed: pending → reserved → done.
      expect(() => machine.assertTransition('move-1', 'pending', 'reserved')).not.toThrow();
      expect(() => machine.assertTransition('move-1', 'reserved', 'done')).not.toThrow();
    });
  });
});
