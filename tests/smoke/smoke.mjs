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
  // ─── 0.6.0 additions ─────────────────────────────────────────────────
  ['./phone', 'parsePhone'],
  ['./phone', 'formatPhone'],
  ['./status-history', 'appendStatus'],
  ['./status-history', 'timeInStatus'],
  ['./condition', 'evaluate'],
  ['./condition', 'validateCondition'],
  ['./mixin', 'withMixin'],
  ['./mixin', 'getMixin'],
  ['./sla-policy', 'defineSLAPolicy'],
  ['./sla-policy', 'evaluateSLAStatus'],
  ['./retention', 'createPurgeEvidence'],
  ['./retention', 'isPurgeEvidence'],
  ['./canonical', 'canonicalJson'],
  ['./canonical', 'sha256Hex'],
  ['./canonical', 'canonicalDigest'],
  // ─── 0.9.0 additions ─────────────────────────────────────────────────
  ['./calendar', 'startOfDay'],
  ['./timezone', 'zoneOffsetMinutes'],
  ['./timezone', 'localTimeParts'],
  ['./timezone', 'civilDateOf'],
  ['./timezone', 'listTimeZones'],
  // ─── 0.13.0 additions ────────────────────────────────────────────────
  ['./unit-cost-rate', 'unitCostRateFromTotal'],
  ['./unit-cost-rate', 'extendedAmount'],
  ['./events', 'createScopedEvent'],
  ['./events', 'scopedEventMeta'],
  ['./event-infra', 'InProcessEventBus'],
  ['./event-infra', 'createInProcessBus'],
  // 0.20.0: the store moved to its own subpath. `/event-infra` is the BUS —
  // it no longer re-exports `MemoryOutboxStore`, and there is no compat path.
  ['./memory-outbox', 'MemoryOutboxStore'],
  // ─── 0.21.0 additions ────────────────────────────────────────────────
  // Period resolution moved DOWN into primitives (was @spinekit/kit/period
  // + be-prod business-date, both above the kernels).
  ['./period', 'resolvePeriod'],
  ['./period', 'resolveMonth'],
  ['./period', 'resolveDay'],
  ['./period', 'periodOf'],
  ['./period', 'parsePeriod'],
  ['./period', 'inclusiveEnd'],
  ['./idempotency', 'decideClaim'],
  ['./idempotency', 'completeClaim'],
  ['./idempotency', 'fingerprintRequest'],
  ['./idempotency', 'newLeaseToken'],
  ['./approval', 'assertApproved'],
  ['./approval', 'assertApprovedIfPresent'],
  ['./currency', 'currencyCode'],
  ['./currency', 'convertWithSnapshot'],
  ['./money', 'CurrencyMismatchError'],
  ['./payment-events', 'isPaymentEvent'],
  ['./payment-events', 'isFundsReceived'],
  // ─── 0.21.0 additions ────────────────────────────────────────────────
  // The subpath sweep below already proves `./environment` IMPORTS; these prove the symbols
  // survived the build. Both matter here: the whole point of this primitive is that four hosts
  // and arc stop hand-rolling the classifier, so a tree-shaken export would send every one of
  // them back to a raw `NODE_ENV === 'production'` comparison.
  ['./environment', 'classifyEnv'],
  ['./environment', 'isProductionEnv'],
];

const failures = [];

/**
 * EXHAUSTIVE subpath sweep — derived from `package.json#exports`, not from the
 * curated `checks` list below.
 *
 * The docblock at the top of this file claims to verify "every subpath declared
 * in package.json exports". It did not: `checks` is hand-maintained and covered
 * 23 of 43. The other 20 could have lost their tsdown entry — leaving an export
 * map pointing at a file that does not exist — and this gate, which
 * `prepublishOnly` runs, would still print OK. A release gate that enumerates
 * its own subset is not a gate on the surface; deriving the list is what makes
 * the claim true.
 */
const allSubpaths = Object.keys(pkg.exports).filter((k) => k !== './package.json');
for (const subpath of allSubpaths) {
  const exp = pkg.exports[subpath];
  if (!exp?.default || !exp?.types) {
    failures.push(`[${subpath}] exports entry must declare both "types" and "default"`);
    continue;
  }
  try {
    await loadDist(exp.default);
  } catch (err) {
    failures.push(`[${subpath}] import failed: ${err.message}`);
  }
  try {
    readFileSync(resolve(pkgRoot, exp.types));
  } catch {
    failures.push(`[${subpath}] declaration file missing: ${exp.types}`);
  }
}
console.log(`  ok  all ${allSubpaths.length} declared subpaths import + ship declarations`);

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

// Functional smoke: 0.6.0 additions — end-to-end flow combining all five.
const { parsePhone } = await loadDist(pkg.exports['./phone'].default);
const { appendStatus, timeInStatus } = await loadDist(pkg.exports['./status-history'].default);
const { evaluate } = await loadDist(pkg.exports['./condition'].default);
const { withMixin, getMixin } = await loadDist(pkg.exports['./mixin'].default);
const { defineSLAPolicy, evaluateSLAStatus } = await loadDist(
  pkg.exports['./sla-policy'].default,
);

// phone: free-form input → E.164 + decomposed country code.
const phone = parsePhone('+1 (415) 555-0182');
assert.equal(phone.ok, true);
assert.equal(phone.value.e164, '+14155550182');
assert.equal(phone.value.callingCode, '1');

// status-history: timeline math is correct and immutable.
const t0 = new Date('2026-01-01T10:00:00Z');
const t1 = new Date('2026-01-01T10:30:00Z');
let history = appendStatus([], 'new', { at: t0 });
history = appendStatus(history, 'qualified', { at: t1 });
assert.equal(history[1].durationInPriorMs, 30 * 60_000);
assert.equal(timeInStatus(history, 'new'), 30 * 60_000);

// condition: composite predicate against a target object.
assert.equal(
  evaluate(
    { all: [{ field: 'status', op: 'eq', value: 'won' }, { field: 'score', op: 'gt', value: 50 }] },
    { status: 'won', score: 75 },
  ),
  true,
);

// mixin: additive composition reads back through getMixin.
const enriched = withMixin({ id: 'c1' }, 'customer', { lifetimeValue: 9200 });
assert.equal(getMixin(enriched, 'customer').lifetimeValue, 9200);

// sla-policy: priority matrix → derived SLA → status evaluation.
const slaPolicy = defineSLAPolicy({
  name: 'lead-response',
  priorities: {
    urgent: { firstResponseMs: 30 * 60_000, rollingResponseMs: 60 * 60_000 },
    normal: { firstResponseMs: 8 * 3_600_000, rollingResponseMs: 24 * 3_600_000 },
  },
  defaultPriority: 'normal',
});
const status = evaluateSLAStatus(
  slaPolicy,
  {
    priority: 'urgent',
    startedAt: new Date('2026-01-01T10:00:00Z'),
    firstRespondedAt: null,
    lastRespondedAt: null,
  },
  new Date('2026-01-01T11:00:00Z'),
);
assert.equal(status.kind, 'Failed');
assert.equal(status.breached, true);

// Functional smoke: the business month is the LOCAL month, from the built dist.
const { resolveMonth, resolvePeriod, periodOf } = await loadDist(pkg.exports['./period'].default);
const august = resolveMonth(2026, 8, 'Asia/Dhaka');
assert.equal(august.start.toISOString(), '2026-07-31T18:00:00.000Z', 'period: Dhaka August must start six hours before the UTC month');
assert.equal(august.end.toISOString(), '2026-08-31T18:00:00.000Z');
assert.deepEqual(periodOf(new Date('2026-07-31T18:30:00Z'), 'month', 'Asia/Dhaka'), {
  year: 2026,
  month: 8,
  timezone: 'Asia/Dhaka',
});
let periodThrew = null;
try {
  resolvePeriod({ year: 2026, month: 8 });
} catch (err) {
  periodThrew = err;
}
assert.ok(periodThrew, 'period: resolving with no timezone must throw, never fall back to UTC');

// Functional smoke: idempotency's three-valued outcome from the built dist.
const { decideClaim, completeClaim, fingerprintRequest, DEFAULT_LEASE_MS } = await loadDist(
  pkg.exports['./idempotency'].default,
);
const idemNow = new Date('2026-08-05T10:00:00Z');
const idemIdentity = { operation: 'checkout.finalize', key: 'k1' };
const idemFp = fingerprintRequest({ total: 100 });
const first = decideClaim(null, {
  identity: idemIdentity,
  requestFingerprint: idemFp,
  now: idemNow,
  leaseToken: 'lease-A',
});
assert.equal(first.outcome, 'claimed');
const concurrent = decideClaim(first.claim, {
  identity: idemIdentity,
  requestFingerprint: idemFp,
  now: new Date(idemNow.getTime() + 1000),
  leaseToken: 'lease-B',
});
assert.equal(concurrent.outcome, 'in_flight', 'idempotency: a live lease is in_flight, not a failure');
assert.ok(concurrent.retryAfterMs > 0 && concurrent.retryAfterMs <= DEFAULT_LEASE_MS);
const settled = completeClaim(first.claim, {
  leaseToken: 'lease-A',
  now: new Date(idemNow.getTime() + 2000),
  result: { status: 'succeeded', value: 'ok' },
});
assert.equal(
  decideClaim(settled, {
    identity: idemIdentity,
    requestFingerprint: idemFp,
    now: new Date(idemNow.getTime() + 3000),
    leaseToken: 'lease-C',
  }).outcome,
  'replayed',
);

if (failures.length > 0) {
  console.error('\n smoke FAILED:');
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

console.log(
  `\n smoke OK — ${allSubpaths.length} declared subpaths swept, ` +
    `${checks.length} headline-symbol checks + functional checks passed`,
);
