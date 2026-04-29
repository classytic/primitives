/**
 * Unit tests for the `defineStateMachine` primitive.
 *
 * Pin the contract: declarative transitions table → `canTransition` /
 * `assertTransition` / `isTerminal` accessors. Hosts adopt by declaring
 * one machine per aggregate.
 */

import { describe, expect, it } from 'vitest';
import {
  defineStateMachine,
  IllegalTransitionError,
  type TransitionErrorContext,
} from '../../src/state-machine.js';

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
