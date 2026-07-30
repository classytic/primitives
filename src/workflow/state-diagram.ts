/**
 * Render a `StateMachine` as a diagram.
 *
 * ## Why this belongs next to `defineStateMachine`
 *
 * The transition table is the most reviewable thing in a domain package and the
 * least visible. `DeviceCommand` has 6 states, `Entitlement` 7, a leave request
 * and an order several more — and today the only way to see any of them is to read
 * an adjacency list in source. So the table gets copied into a prose comment,
 * which then drifts from the code it describes. Every one of those comments is a
 * diagram somebody drew by hand and will not maintain.
 *
 * Generating the picture from the SAME object the runtime CAS enforces removes
 * that class of drift entirely: if the diagram is wrong, the machine is wrong.
 *
 * ## Mermaid, because it renders where the readers are
 *
 * GitHub, most docs pipelines and this org's artifact tooling all render mermaid
 * natively from a fenced block, so a generated `stateDiagram-v2` needs no build
 * step, no image asset and no binary in a diff. An admin UI can render the same
 * string to show an operator which transitions are legal from where they are.
 *
 * PURE — a string in, a string out, no I/O and no clock. Safe in a test, a
 * script, a docs generator or a request handler.
 */

import type { StateMachine } from './state-machine.js';

export interface StateDiagramOptions<TStatus extends string> {
  /**
   * The state a new aggregate starts in. Drawn as `[*] --> initial`.
   *
   * NOT inferred: a machine's entry point is a domain fact the adjacency list does
   * not carry. "The state with no inbound transitions" guesses wrong the moment a
   * machine has a legal return path into its own start (a retry going
   * `sent → pending`), and silently drawing the wrong entry point is worse than
   * drawing none.
   */
  readonly initial?: TStatus;
  /**
   * Highlight one state — "you are here" for an operator looking at a record.
   */
  readonly current?: TStatus;
  /** Diagram title, rendered above the graph. */
  readonly title?: string;
  /**
   * Label a transition, keyed `"from->to"`. For naming the VERB that causes it
   * (`"sent->acked": "device confirmed"`), which is the part a reader actually
   * wants and the table cannot know.
   */
  readonly labels?: Readonly<Record<string, string>>;
  /**
   * Draw `terminal --> [*]` edges. Default true — a reader needs to see which
   * states end the lifecycle. Turn off for a dense machine where the extra edges
   * cost more than they explain.
   */
  readonly showTerminal?: boolean;
}

/** Mermaid ids must be identifier-safe; domain statuses are usually snake_case. */
function safeId(status: string): string {
  const id = status.replace(/[^A-Za-z0-9_]/g, '_');
  // A leading digit is not a valid mermaid id.
  return /^[0-9]/.test(id) ? `s_${id}` : id;
}

/**
 * A `stateDiagram-v2` for this machine.
 *
 * Self-transitions are emitted as-is — mermaid draws them as a loop, and they are
 * meaningful (`sent → sent` is the device-command re-lease after a lapsed lease),
 * so suppressing them would hide a real rule.
 */
export function toMermaid<TStatus extends string>(
  machine: StateMachine<TStatus>,
  options: StateDiagramOptions<TStatus> = {},
): string {
  const { initial, current, title, labels = {}, showTerminal = true } = options;
  const lines: string[] = [];

  if (title !== undefined) {
    // Mermaid front-matter — the only supported way to title a state diagram.
    lines.push('---', `title: ${title}`, '---');
  }
  lines.push('stateDiagram-v2');

  if (initial !== undefined) lines.push(`    [*] --> ${safeId(initial)}`);

  // Deterministic output: a diagram that reorders between runs produces noisy
  // diffs and cannot be committed as a golden file.
  const states = Object.keys(machine.transitions).sort() as TStatus[];

  for (const from of states) {
    for (const to of [...machine.validTargets(from)].sort()) {
      const label = labels[`${from}->${to}`];
      lines.push(
        `    ${safeId(from)} --> ${safeId(to)}${label !== undefined ? `: ${label}` : ''}`,
      );
    }
  }

  if (showTerminal) {
    for (const state of states) {
      if (machine.isTerminal(state)) lines.push(`    ${safeId(state)} --> [*]`);
    }
  }

  if (current !== undefined) {
    lines.push(
      '    classDef current fill:#2563eb,stroke:#1e40af,color:#fff,font-weight:bold',
      // `:::` is the inline class operator; `class X current` also works but the
      // inline form survives mermaid's stricter parsers.
      `    class ${safeId(current)} current`,
    );
  }

  return lines.join('\n');
}

/** One row of `describeStateMachine` — a table a UI or a doc can render directly. */
export interface StateDescription<TStatus extends string> {
  readonly status: TStatus;
  readonly targets: readonly TStatus[];
  readonly sources: readonly TStatus[];
  readonly terminal: boolean;
}

/**
 * The machine as data, for a UI that wants a table rather than a picture — an
 * action bar asking "which transitions are legal from where this record is now"
 * reads `targets`, and never has to hardcode a list that drifts from the kernel.
 */
export function describeStateMachine<TStatus extends string>(
  machine: StateMachine<TStatus>,
): {
  readonly name: string;
  readonly states: readonly StateDescription<TStatus>[];
} {
  const states = (Object.keys(machine.transitions) as TStatus[]).sort();
  return {
    name: machine.name,
    states: states.map((status) => ({
      status,
      targets: [...machine.validTargets(status)].sort(),
      sources: [...machine.validSources(status)].sort(),
      terminal: machine.isTerminal(status),
    })),
  };
}

/**
 * States that can never be reached from `initial`.
 *
 * A design smell worth a CI check: an unreachable state is either a transition
 * somebody forgot to declare, or dead vocabulary nobody removed. Both are cheap to
 * find here and expensive to notice in production, where the symptom is a record
 * that can never leave the state it is stuck in.
 */
export function unreachableStates<TStatus extends string>(
  machine: StateMachine<TStatus>,
  initial: TStatus,
): readonly TStatus[] {
  const seen = new Set<TStatus>([initial]);
  const queue: TStatus[] = [initial];
  while (queue.length > 0) {
    for (const next of machine.validTargets(queue.pop()!)) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return (Object.keys(machine.transitions) as TStatus[]).filter((s) => !seen.has(s)).sort();
}
