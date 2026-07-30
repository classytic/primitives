/**
 * Rendering a state machine.
 *
 * The point of generating the picture is that it CANNOT drift from the table the
 * runtime CAS enforces. So these tests check the properties that make the output
 * trustworthy — determinism, no invented edges, self-transitions preserved — not
 * a golden blob, which would only pin formatting.
 */
import { describe, expect, it } from 'vitest';
import { defineStateMachine } from '../../src/workflow/state-machine.js';
import {
  describeStateMachine,
  toMermaid,
  unreachableStates,
} from '../../src/workflow/state-diagram.js';

/** The real device-command lifecycle, including its `sent → sent` re-lease. */
const COMMANDS = defineStateMachine<
  'pending' | 'sent' | 'acked' | 'failed' | 'cancelled' | 'expired'
>({
  name: 'DeviceCommand',
  transitions: {
    pending: ['sent', 'cancelled', 'expired', 'failed'],
    sent: ['sent', 'acked', 'pending', 'failed', 'cancelled', 'expired'],
    acked: [],
    failed: [],
    cancelled: [],
    expired: [],
  },
});

describe('mermaid output', () => {
  it('declares a stateDiagram-v2 and every declared edge', () => {
    const out = toMermaid(COMMANDS, { initial: 'pending' });
    expect(out.startsWith('stateDiagram-v2')).toBe(true);
    expect(out).toContain('[*] --> pending');
    expect(out).toContain('pending --> sent');
    expect(out).toContain('sent --> acked');
  });

  it('preserves a SELF-transition — it is a real rule', () => {
    // `sent → sent` is the re-lease after a device collected a command and died.
    // Suppressing loops as "noise" would hide the recovery path entirely.
    expect(toMermaid(COMMANDS)).toContain('sent --> sent');
  });

  it('invents no edges the table does not declare', () => {
    const out = toMermaid(COMMANDS, { showTerminal: false });
    // `acked` is terminal — nothing may leave it, or a replayed device
    // confirmation could appear to reopen a settled command.
    expect(out).not.toMatch(/acked --> (?!\[\*\])/);
    expect(out).not.toContain('cancelled -->');
  });

  it('marks terminal states as ending the lifecycle', () => {
    const out = toMermaid(COMMANDS);
    for (const terminal of ['acked', 'failed', 'cancelled', 'expired']) {
      expect(out).toContain(`${terminal} --> [*]`);
    }
    expect(out).not.toContain('pending --> [*]');
  });

  it('is DETERMINISTIC — a diagram that reorders cannot be committed', () => {
    expect(toMermaid(COMMANDS)).toBe(toMermaid(COMMANDS));
    // Sorted, so an edit to the transition table produces a minimal diff rather
    // than a reshuffled file.
    const edges = toMermaid(COMMANDS, { showTerminal: false })
      .split('\n')
      .slice(1)
      .map((l) => l.trim());
    expect(edges).toEqual([...edges].sort());
  });

  it('labels a transition with the verb that causes it', () => {
    const out = toMermaid(COMMANDS, { labels: { 'sent->acked': 'device confirmed' } });
    expect(out).toContain('sent --> acked: device confirmed');
  });

  it('highlights the current state for a "you are here" view', () => {
    const out = toMermaid(COMMANDS, { current: 'sent' });
    expect(out).toContain('classDef current');
    expect(out).toContain('class sent current');
  });

  it('adds a title as mermaid front-matter', () => {
    expect(toMermaid(COMMANDS, { title: 'Command lifecycle' }).startsWith('---')).toBe(true);
  });

  it('does NOT guess the initial state', () => {
    // A machine with a legal return path into its start (`sent → pending`) makes
    // "the state with no inbound edges" wrong. Drawing the wrong entry point is
    // worse than drawing none, so `[*]` appears only when the caller says so.
    expect(toMermaid(COMMANDS)).not.toContain('[*] -->');
  });

  it('sanitises ids that are not mermaid-safe', () => {
    const odd = defineStateMachine<'in-progress' | 'done'>({
      name: 'Odd',
      transitions: { 'in-progress': ['done'], done: [] },
    });
    const out = toMermaid(odd);
    expect(out).toContain('in_progress --> done');
    expect(out).not.toContain('in-progress -->');
  });
});

describe('describeStateMachine', () => {
  it('gives a UI the legal moves without hardcoding them', () => {
    const described = describeStateMachine(COMMANDS);
    expect(described.name).toBe('DeviceCommand');
    const acked = described.states.find((s) => s.status === 'acked')!;
    expect(acked.terminal).toBe(true);
    expect(acked.targets).toEqual([]);
    // Reverse lookup — what an action bar needs to authorise a move.
    expect(acked.sources).toContain('sent');
  });
});

describe('unreachableStates', () => {
  it('finds nothing wrong with a sound machine', () => {
    expect(unreachableStates(COMMANDS, 'pending')).toEqual([]);
  });

  it('catches a state nothing can reach — a forgotten transition', () => {
    // The symptom in production is a record that can never leave the state it is
    // stuck in, or dead vocabulary nobody removed. Both are cheap to find here.
    const broken = defineStateMachine<'draft' | 'live' | 'orphan'>({
      name: 'Broken',
      transitions: { draft: ['live'], live: [], orphan: ['live'] },
    });
    expect(unreachableStates(broken, 'draft')).toEqual(['orphan']);
  });
});
