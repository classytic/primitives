import { describe, expect, it } from 'vitest';
import { classifyEnv, isProductionEnv } from '../../src/composition/environment.js';

/**
 * The invariants that matter are NOT "classifyEnv('production') === 'production'".
 *
 * Every real defect this function replaces came from the SECOND spelling of a bucket
 * (`prod`, `qa`) missing from a hand-written comparison, and from the negative form
 * (`!== 'production'`) that turns a miss into an OPEN gate. So the cases below are
 * organised by bucket-with-both-spellings, and each asserts the derived boolean too —
 * because that boolean, not the label, is what gated money and disclosure.
 */

/** Every input that must land in each bucket. The table IS the contract. */
const CASES: ReadonlyArray<readonly [input: string | undefined | null, expected: string]> = [
  ['production', 'production'],
  ['prod', 'production'],
  ['PRODUCTION', 'production'],
  ['Prod', 'production'],
  ['  production  ', 'production'],
  ['prod\n', 'production'],
  ['test', 'test'],
  ['qa', 'test'],
  ['TEST', 'test'],
  ['QA', 'test'],
  [' test ', 'test'],
  ['development', 'development'],
  ['dev', 'development'],
  ['', 'development'],
  ['   ', 'development'],
  [undefined, 'development'],
  [null, 'development'],
  ['prodction', 'development'],
  ['staging', 'development'],
];

describe('classifyEnv', () => {
  for (const [input, expected] of CASES) {
    it(`${JSON.stringify(input)} → ${expected}`, () => {
      expect(classifyEnv(input)).toBe(expected);
    });
  }

  it('is TOTAL — every input yields exactly one of the three buckets', () => {
    // Guards against a future edit introducing a fourth state or an undefined return, which a
    // per-case table cannot see (it only checks the inputs someone thought to list).
    const buckets = new Set(['development', 'test', 'production']);
    for (const junk of ['', '?', 'PRODUCTION_LIKE', '0', 'null', 'undefined', 'prod-eu', '🚀']) {
      expect(buckets.has(classifyEnv(junk)), `classifyEnv(${JSON.stringify(junk)})`).toBe(true);
    }
  });

  it('BOTH production spellings are production — the miss that opened gates', () => {
    /**
     * The single most important assertion in this file. `prod` classifying as development is what
     * permitted non-transactional money writes in six gym modules, shipped cookies without
     * `Secure`, and returned raw 500 messages to clients — all silently.
     */
    expect(classifyEnv('production')).toBe('production');
    expect(classifyEnv('prod')).toBe('production');
  });

  it('BOTH test spellings are test — `qa` must not read as development', () => {
    // `qa` classifying as development is how multi-boot support silently vanished on QA runs.
    expect(classifyEnv('test')).toBe('test');
    expect(classifyEnv('qa')).toBe('test');
  });

  it('trims — a trailing newline must not demote production to development', () => {
    /**
     * The deliberate divergence from the four implementations this replaces. A `.env` file, a
     * Docker `ENV` line or a pasted CI variable routinely carries trailing whitespace; untrimmed,
     * `'production\n'` matched nothing and fell through to development — a production deployment
     * classified as dev, which is the dangerous direction.
     */
    expect(classifyEnv('production\n')).toBe('production');
    expect(classifyEnv('prod ')).toBe('production');
    expect(classifyEnv('\tqa')).toBe('test');
  });
});

describe('isProductionEnv', () => {
  it('agrees with classifyEnv for every case in the table', () => {
    // The two must never disagree: callers mix them freely, and a divergence would mean two
    // answers to one question — the exact condition this module was created to remove.
    for (const [input] of CASES) {
      expect(isProductionEnv(input)).toBe(classifyEnv(input) === 'production');
    }
  });

  it('is false for the NEGATIVE-form traps', () => {
    /**
     * Call sites overwhelmingly write `!isProduction`. These are the inputs where a hand-rolled
     * check got it wrong, so they are asserted directly rather than left implicit in the table.
     */
    expect(isProductionEnv('prod')).toBe(true);
    expect(isProductionEnv('production')).toBe(true);
    expect(isProductionEnv('qa')).toBe(false);
    expect(isProductionEnv('staging')).toBe(false);
    expect(isProductionEnv(undefined)).toBe(false);
  });
});
