import { defineConfig } from 'tsdown';

/**
 * Source is organized by domain category under `src/<category>/<name>.ts`,
 * but the published surface stays FLAT — consumers import
 * `@classytic/primitives/money`, NOT `@classytic/primitives/money/money`.
 *
 * We achieve that split via the `entry` MAP form below: each key is the
 * output basename (`money`, `phone`, …), each value is the source path.
 * tsdown emits `dist/<key>.mjs` regardless of source nesting, so source
 * layout and public surface stay decoupled.
 *
 * To add a new primitive:
 *   1. Drop the source under the appropriate `src/<category>/`.
 *   2. Add `<name>: 'src/<category>/<name>.ts'` here.
 *   3. Add the matching `./<name>` entry to `package.json#exports`.
 */
export default defineConfig({
  entry: {
    // ─── money ──────────────────────────────────────────────────────────
    money: 'src/money/money.ts',
    currency: 'src/money/currency.ts',
    'split-allocation': 'src/money/split-allocation.ts',
    'bank-transaction': 'src/money/bank-transaction.ts',
    'payment-gateway': 'src/money/payment-gateway.ts',
    'payment-method-kind': 'src/money/payment-method-kind.ts',
    'payment-allocation-status': 'src/money/payment-allocation-status.ts',

    // ─── identity ───────────────────────────────────────────────────────
    person: 'src/identity/person.ts',
    address: 'src/identity/address.ts',
    phone: 'src/identity/phone.ts',

    // ─── scheduling ─────────────────────────────────────────────────────
    period: 'src/scheduling/period.ts',
    cadence: 'src/scheduling/cadence.ts',
    sla: 'src/scheduling/sla.ts',
    'sla-policy': 'src/scheduling/sla-policy.ts',

    // ─── workflow ───────────────────────────────────────────────────────
    'state-machine': 'src/workflow/state-machine.ts',
    'status-history': 'src/workflow/status-history.ts',
    approval: 'src/workflow/approval.ts',
    hold: 'src/workflow/hold.ts',
    condition: 'src/workflow/condition.ts',

    // ─── events ─────────────────────────────────────────────────────────
    events: 'src/events/events.ts',
    outbox: 'src/events/outbox.ts',
    'payment-events': 'src/events/payment-events.ts',

    // ─── composition ────────────────────────────────────────────────────
    mixin: 'src/composition/mixin.ts',
    reference: 'src/composition/reference.ts',
    context: 'src/composition/context.ts',
    brand: 'src/composition/brand.ts',
    result: 'src/composition/result.ts',
  },
  format: ['esm'],
  dts: { sourcemap: false },
  clean: true,
  sourcemap: false,
  treeshake: true,
  target: 'node22',
  outDir: 'dist',
});
