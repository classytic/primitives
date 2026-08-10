/**
 * `NODE_ENV` classification — the ONE answer to "which environment is this?".
 *
 * ## Why this is a primitive and not four copies
 *
 * `NODE_ENV` has two accepted spellings per bucket in practice — `production` OR `prod`, `test` OR
 * `qa` — so a local comparison against one literal is wrong for the other, and it is wrong in the
 * expensive direction. Almost every call site computes a NEGATIVE (`!== 'production'`,
 * `isProduction === false`), so a missed spelling does not close a gate, it OPENS one.
 *
 * That is not hypothetical. Every item below was found in shipped code, and **not one of them
 * threw**:
 *
 * | site | what `NODE_ENV=prod` did |
 * |---|---|
 * | `arc/plugins/errorHandler.ts` | returned the RAW thrown message of a 500 to the client |
 * | `arc/auth/sessionManager.ts` | issued session cookies **without `Secure`** |
 * | gym: pos / revenue / membership / order / catalog / attendance | permitted NON-TRANSACTIONAL money writes in production |
 * | gym `app.ts` | selected arc's DEVELOPMENT preset in production |
 * | be-prod `media.engine.ts` | enabled the in-memory media driver fallback — uploads 200, files gone on restart |
 * | be-prod `contract.ports.ts`, `crm.module.ts` | non-atomic receivable / lead-conversion writes |
 * | be-prod `logger.ts` | pino's pretty TRANSPORT in production |
 * | be-prod `guest-order.resource.ts` | rate limiter armed under `qa` and nowhere else |
 *
 * `qa` had the mirror problem: classified as development by one host and test by another, so
 * multi-boot support silently vanished on a QA run.
 *
 * **This logic already existed four times** — be-prod `classifyEnv`, gym `businessMode()`, arc's own
 * CLI config template (as a `z.preprocess`), and implicitly in arc's four raw comparison sites. All
 * four agreed on the spellings and the buckets, which is exactly why collapsing them is mechanical
 * rather than a behaviour change. A fifth copy was one new vertical away.
 *
 * ## Why primitives owns it
 *
 * arc's own ownership rule: *primitives owns pure cross-package contracts, arc owns runtime.* This
 * is a pure total function with no dependencies, and its consumers are not all arc apps — kernels,
 * workers, CLIs and the spine need the same answer without pulling in a web framework. primitives
 * is already a required peer of arc, so every arc host has it at no additional cost.
 *
 * ## Prefer an EXPLICIT signal where one exists
 *
 * If a caller already has a declared environment — arc's `preset`, a `deployment.config`, an
 * injected flag — **use that instead**. It is a specific instruction, and this function reads an
 * ambient default. A specific setting must never be overridden by a general one.
 */

/** The three buckets everything downstream reasons about. Mutually exclusive and total. */
export type EnvClass = 'development' | 'test' | 'production';

/**
 * Classify a raw `NODE_ENV` value.
 *
 * Total by construction — every input yields exactly one bucket, so a caller can never observe a
 * fourth state or `undefined`.
 *
 * ## Whitespace IS trimmed, and that is a deliberate divergence from the four copies
 *
 * None of the previous implementations trimmed. A value carrying a trailing space or newline —
 * routine from a `.env` file, a Docker `ENV` line, or a CI variable pasted with a line ending —
 * therefore matched nothing and fell through to `development`. That is the dangerous direction: a
 * genuine production deployment classified as development, which is precisely the failure this
 * function exists to prevent. Trimming can only ever move a value TOWARD the bucket its author
 * plainly intended.
 *
 * ## An unrecognised value falls back to `development`
 *
 * Preserved from all four prior implementations, so adopting this changes no existing behaviour.
 *
 * Be aware of what it costs: a typo (`prodction`) classifies as development and therefore OPENS the
 * gates a production deployment wanted shut. The stricter alternative — normalise known aliases and
 * THROW on anything else — is more defensible ("an input you do not understand must fail, not
 * widen"), but it is a breaking operational change for any deployment currently running an
 * unrecognised value and belongs in its own release with its own test. Do not change it here
 * silently.
 */
export function classifyEnv(env: string | undefined | null): EnvClass {
  switch ((env ?? '').trim().toLowerCase()) {
    case 'production':
    case 'prod':
      return 'production';
    case 'test':
    case 'qa':
      return 'test';
    default:
      return 'development';
  }
}

/**
 * The three predicates, one per bucket.
 *
 * Named functions rather than a `classifyEnv(x) === 'production'` at each call site: a literal
 * comparison against an env string is the exact shape that caused every defect listed above, so
 * this module should not contain one — even a correct one — for the next reader to copy.
 *
 * All three delegate to {@link classifyEnv}, so they cannot disagree with it or with each other,
 * and exactly one is true for any input. That mutual exclusivity is the property hosts rely on
 * when they build a `{ isDevelopment, isTest, isProduction }` triple.
 */
export function isProduction(env: string | undefined | null): boolean {
  return classifyEnv(env) === 'production';
}

export function isTest(env: string | undefined | null): boolean {
  return classifyEnv(env) === 'test';
}

export function isDevelopment(env: string | undefined | null): boolean {
  return classifyEnv(env) === 'development';
}
