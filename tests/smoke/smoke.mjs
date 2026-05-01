#!/usr/bin/env node
/**
 * Smoke test — verifies the built dist/ is importable via every subpath
 * declared in package.json "exports" and that each subpath's headline symbol
 * is actually present at runtime.
 *
 * Runs outside vitest. Exits with non-zero on any failure. Designed to catch
 * packaging regressions (missing exports entries, bad dist paths, tsdown
 * tree-shaking a re-export away) that unit tests — which import from src/ —
 * would never see.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(here, '..', '..');
const pkg = JSON.parse(readFileSync(resolve(pkgRoot, 'package.json'), 'utf-8'));

/** Dynamic import a local file — works on Windows (requires file:// URL). */
const loadDist = (relPath) => import(pathToFileURL(resolve(pkgRoot, relPath)).href);

const checks = [
  ['./money', 'addMoney'],
  ['./money', 'fromMajor'],
  ['./currency', 'minorUnitFactor'],
  ['./address', 'toGeoJsonPoint'],
  ['./period', 'isWithin'],
  ['./reference', 'idToString'],
  ['./context', null],
  ['./events', 'createEvent'],
  ['./events', 'matchEventPattern'],
  ['./result', 'ok'],
  ['./result', 'err'],
  ['./brand', null],
  ['./state-machine', 'defineStateMachine'],
  ['./state-machine', 'IllegalTransitionError'],
];

const failures = [];

for (const [subpath, symbol] of checks) {
  const exp = pkg.exports[subpath];
  assert.ok(exp, `package.json missing export "${subpath}"`);
  try {
    const mod = await loadDist(exp.default);
    if (symbol !== null) {
      if (!(symbol in mod)) {
        failures.push(`[${subpath}] missing runtime export: ${symbol}`);
        continue;
      }
    }
    console.log(`  ok  ${subpath.padEnd(18)} ${symbol ?? '(types-only)'}`);
  } catch (err) {
    failures.push(`[${subpath}] import failed: ${err.message}`);
  }
}

// Functional smoke: money arithmetic works from the built artifact
const { fromMajor, addMoney, toMajor } = await loadDist(pkg.exports['./money'].default);
const total = addMoney(fromMajor(9.99, 'USD'), fromMajor(5.0, 'USD'));
if (total.amount !== 1499 || total.currency !== 'USD') {
  failures.push(`money smoke: expected { amount: 1499, currency: 'USD' }, got ${JSON.stringify(total)}`);
}
if (toMajor(total) !== 14.99) {
  failures.push(`money smoke: toMajor expected 14.99, got ${toMajor(total)}`);
}

// Functional smoke: event bus shape is Arc-compatible
const { createEvent, matchEventPattern } = await loadDist(pkg.exports['./events'].default);
const evt = createEvent('order:placed', { id: 1 }, { organizationId: 'org_1' });
assert.equal(evt.type, 'order:placed');
assert.equal(typeof evt.meta.id, 'string');
assert.ok(evt.meta.timestamp instanceof Date);
assert.equal(matchEventPattern('order:*', 'order:placed'), true);

// Functional smoke: state-machine declarative transitions
const { defineStateMachine, IllegalTransitionError } = await loadDist(
  pkg.exports['./state-machine'].default,
);
const sm = defineStateMachine({
  name: 'SmokeOrder',
  transitions: {
    draft: ['posted', 'cancelled'],
    posted: [],
    cancelled: [],
  },
});
assert.equal(sm.canTransition('draft', 'posted'), true);
assert.equal(sm.canTransition('posted', 'draft'), false);
assert.equal(sm.isTerminal('posted'), true);
let smThrew = null;
try {
  sm.assertTransition('id-1', 'posted', 'draft');
} catch (err) {
  smThrew = err;
}
assert.ok(smThrew instanceof IllegalTransitionError, 'state-machine: expected IllegalTransitionError');
assert.equal(smThrew.code, 'illegal_transition');
assert.equal(smThrew.entityId, 'id-1');

if (failures.length > 0) {
  console.error('\n smoke FAILED:');
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

console.log(`\n smoke OK — ${checks.length} subpath exports + functional checks passed`);
