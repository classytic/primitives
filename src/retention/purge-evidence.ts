/**
 * `PurgeEvidence` — the persisted evidence record for a GDPR / data-retention
 * purge operation.
 *
 * When a host redacts, soft-deletes, or hard-deletes a slice of data to
 * satisfy a right-to-be-forgotten request or a retention window, it must be
 * able to PROVE — to an auditor, a DPA, or a court — what was purged, over
 * what scope, by whom, why, and whether analytical measures were retained.
 * This value object is that proof. Hosts persist one record per purge op
 * alongside the mutation.
 *
 * A **legal hold is the opposite of a purge trigger** — a hold PREVENTS the
 * purge from running. It is never a reason recorded here; if a hold applies,
 * no `PurgeEvidence` is produced for the held subject in the first place.
 *
 * Pure data + pure builder — no persistence, no I/O, no events. The
 * `strategy` enum is a SUBSET of repo-core's `TenantPurgeStrategy['type']`
 * (`hard` | `soft` | `anonymize`) — a purge that ran a `skip` strategy did
 * nothing, so it produces no evidence, and there is no `custom` variant.
 *
 * **Validation convention.** `@classytic/primitives` is deliberately
 * dependency-free (no Zod, no runtime schema library) so it stays a
 * zero-footprint building block for ~73 downstream consumers. Structural
 * validation is therefore a pure type-guard ({@link isPurgeEvidence}) plus a
 * throwing assertion ({@link assertPurgeEvidence}), matching every other
 * primitive (`isExternalRef`, `isBankTransaction`, ...). Hosts that need a
 * Zod schema derive one at their edge from {@link PurgeEvidence}.
 *
 * @example
 * import { createPurgeEvidence } from '@classytic/primitives/retention';
 *
 * const evidence = createPurgeEvidence({
 *   subject: { ref: 'customer:c_123', model: 'Customer' },
 *   scope: 'org:org_bd_dhaka',
 *   strategy: 'anonymize',
 *   measuresRetained: true,        // sales measures kept; PII dimension redacted
 *   processed: 4210,
 *   actor: { ref: 'user:admin_7', kind: 'user' },
 *   reason: 'GDPR erasure request #4821',
 *   legalBasis: 'GDPR Art. 17',
 * });
 * // evidence.id and evidence.occurredAt are auto-filled.
 */

/**
 * Strategy that produced the evidence. SUBSET of repo-core's
 * `TenantPurgeStrategy['type']` — `skip` is excluded (a skipped purge
 * mutates nothing, so it has no evidence to record).
 */
export type PurgeStrategyKind = 'hard' | 'soft' | 'anonymize';

/** What the purge targeted — a reference plus an optional logical model. */
export interface PurgeSubject {
  /**
   * Opaque reference to the purged subject. Any stable string form —
   * `'customer:c_123'`, a bare id, an ExternalRef-style `model:id`. The
   * primitive does not parse it; it is round-tripped verbatim for audit.
   */
  readonly ref: string;
  /** Optional logical model / type name — e.g. `'Customer'`, `'Lead'`. */
  readonly model?: string;
}

/** Who ran the purge. */
export interface PurgeActor {
  /** Opaque reference to the actor — `'user:admin_7'`, `'service:retention-cron'`. */
  readonly ref: string;
  /** Actor category, for filtering audit reports by human vs automated action. */
  readonly kind: 'user' | 'system' | 'service';
}

/**
 * Terminal outcome of the purge operation the evidence records.
 *   - `completed` — every targeted resource succeeded.
 *   - `partial`   — some resources succeeded, others failed (see {@link
 *                   PurgeEvidence.results}); the operation is resumable.
 *   - `failed`    — the operation did not achieve its intended effect.
 * A `partial`/`failed` record is STILL evidence — "we attempted X, this is
 * exactly how far it got" — never suppressed.
 */
export type PurgeStatus = 'completed' | 'partial' | 'failed';

/**
 * Per-resource / per-provider breakdown of a multi-step purge — one entry
 * per logical resource the operation touched. Optional: a single-resource
 * purge needs only the top-level {@link PurgeEvidence.processed}.
 */
export interface PurgeResourceResult {
  /** Logical resource / module / provider name — NOT a collection name. */
  readonly resource: string;
  /** Rows this resource processed (non-negative integer). */
  readonly processed: number;
  /** Whether this resource's step succeeded. */
  readonly ok: boolean;
  /** Failure message when `ok` is false. */
  readonly error?: string;
}

/**
 * Compact verification summary — the recipe's own post-checks, not a raw
 * delete count. `A successful Mongo delete count alone is not success.`
 */
export interface PurgeVerificationSummary {
  /** Whether every verification invariant held. */
  readonly ok: boolean;
  /** How many invariants were checked. */
  readonly checks?: number;
  /** Short human-readable note (e.g. `'trial balance clean; stock reseeded'`). */
  readonly note?: string;
}

/**
 * Persisted evidence for one purge operation.
 */
export interface PurgeEvidence {
  /** Unique evidence-record identifier (UUID v4 recommended). */
  readonly id: string;
  /**
   * Optional stable operation id correlating this evidence with the run's
   * logs, audit events, and (for a Cleanup Center) its durable run record.
   * Distinct from {@link id} (the evidence-record id): many evidence rows
   * can share one `operationId`.
   */
  readonly operationId?: string;
  /** What was purged. */
  readonly subject: PurgeSubject;
  /**
   * The scope the purge ran over — free-form but conventionally a
   * `kind:value` tag so reports group cleanly. Examples:
   * `'generation:5'` (retention generation), `'occurrence:<dedupeKey>'`
   * (a specific event occurrence), `'org:<id>'` (a tenant/branch window).
   */
  readonly scope: string;
  /** Strategy that ran — `hard` | `soft` | `anonymize`. */
  readonly strategy: PurgeStrategyKind;
  /** Terminal outcome. Defaults to `completed` from the builder. */
  readonly status: PurgeStatus;
  /**
   * True when analytical MEASURES were retained (the anonymize/soft case
   * where PII dimensions are redacted but aggregates survive); false for a
   * hard deletion that removed the rows entirely.
   */
  readonly measuresRetained: boolean;
  /** Rows actually processed by the purge (non-negative integer). */
  readonly processed: number;
  /**
   * When the purge STARTED, if known. Distinct from {@link completedAt} /
   * {@link occurredAt} so a report can show duration + ordering.
   */
  readonly startedAt?: Date;
  /** When the purge finished, if distinguished from {@link occurredAt}. */
  readonly completedAt?: Date;
  /** When the evidence was recorded (canonical audit timestamp). */
  readonly occurredAt: Date;
  /** Who ran it. */
  readonly actor: PurgeActor;
  /** Human-readable justification — surfaces in audit reports. */
  readonly reason: string;
  /** Optional legal basis citation — e.g. `'GDPR Art. 17'`, `'CCPA §1798.105'`. */
  readonly legalBasis?: string;
  /** Optional per-resource breakdown of a multi-step purge. */
  readonly results?: readonly PurgeResourceResult[];
  /** Optional verification summary — the recipe's own post-checks. */
  readonly verification?: PurgeVerificationSummary;
}

/**
 * Input to {@link createPurgeEvidence}. `id` and `occurredAt` are optional —
 * the builder fills them when absent. Everything else is caller-supplied.
 */
export interface CreatePurgeEvidenceInput {
  readonly id?: string;
  readonly operationId?: string;
  readonly subject: PurgeSubject;
  readonly scope: string;
  readonly strategy: PurgeStrategyKind;
  /** Defaults to `'completed'` when omitted. */
  readonly status?: PurgeStatus;
  readonly measuresRetained: boolean;
  readonly processed: number;
  readonly startedAt?: Date;
  readonly completedAt?: Date;
  readonly occurredAt?: Date;
  readonly actor: PurgeActor;
  readonly reason: string;
  readonly legalBasis?: string;
  readonly results?: readonly PurgeResourceResult[];
  readonly verification?: PurgeVerificationSummary;
}

const STRATEGY_KINDS: ReadonlySet<string> = new Set(['hard', 'soft', 'anonymize']);
const ACTOR_KINDS: ReadonlySet<string> = new Set(['user', 'system', 'service']);
const STATUS_KINDS: ReadonlySet<string> = new Set(['completed', 'partial', 'failed']);

/** Non-empty string check — the guard's baseline for every required label. */
function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

function isValidDate(v: unknown): v is Date {
  return v instanceof Date && !Number.isNaN(v.getTime());
}

/**
 * Build a {@link PurgeEvidence} record with auto-filled `id` + `occurredAt`.
 *
 * Pure and side-effect-free at module scope — the id generator and the
 * timestamp are only invoked when the function runs (mirrors
 * `@classytic/primitives/events` `createEvent`), never at import time, so the
 * module stays tree-shakeable and deterministic to load.
 *
 * Caller-supplied `id` / `occurredAt` win over the generated defaults.
 */
export function createPurgeEvidence(input: CreatePurgeEvidenceInput): PurgeEvidence {
  const evidence: PurgeEvidence = {
    id: input.id ?? randomEvidenceId(),
    subject: input.subject,
    scope: input.scope,
    strategy: input.strategy,
    status: input.status ?? 'completed',
    measuresRetained: input.measuresRetained,
    processed: input.processed,
    occurredAt: input.occurredAt ?? new Date(),
    actor: input.actor,
    reason: input.reason,
    ...(input.operationId !== undefined ? { operationId: input.operationId } : {}),
    ...(input.startedAt !== undefined ? { startedAt: input.startedAt } : {}),
    ...(input.completedAt !== undefined ? { completedAt: input.completedAt } : {}),
    ...(input.legalBasis !== undefined ? { legalBasis: input.legalBasis } : {}),
    ...(input.results !== undefined ? { results: input.results } : {}),
    ...(input.verification !== undefined ? { verification: input.verification } : {}),
  };
  return evidence;
}

/**
 * Structural type guard — validates the full {@link PurgeEvidence} shape,
 * including the nested `subject` / `actor` objects and the two closed enums.
 * Zero-dependency stand-in for a runtime schema.
 */
export function isPurgeEvidence(value: unknown): value is PurgeEvidence {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;

  if (!isNonEmptyString(v.id)) return false;
  if (v.operationId !== undefined && !isNonEmptyString(v.operationId)) return false;
  if (!isNonEmptyString(v.scope)) return false;
  if (typeof v.strategy !== 'string' || !STRATEGY_KINDS.has(v.strategy)) return false;
  if (typeof v.status !== 'string' || !STATUS_KINDS.has(v.status)) return false;
  if (typeof v.measuresRetained !== 'boolean') return false;
  // processed must be a NON-NEGATIVE INTEGER — fractional counts are meaningless.
  if (typeof v.processed !== 'number' || !Number.isInteger(v.processed) || v.processed < 0) {
    return false;
  }
  if (v.startedAt !== undefined && !isValidDate(v.startedAt)) return false;
  if (v.completedAt !== undefined && !isValidDate(v.completedAt)) return false;
  if (!isValidDate(v.occurredAt)) return false;
  if (!isNonEmptyString(v.reason)) return false;
  if (v.legalBasis !== undefined && !isNonEmptyString(v.legalBasis)) return false;

  const subject = v.subject as Record<string, unknown> | null | undefined;
  if (typeof subject !== 'object' || subject === null) return false;
  if (!isNonEmptyString(subject.ref)) return false;
  if (subject.model !== undefined && !isNonEmptyString(subject.model)) return false;

  const actor = v.actor as Record<string, unknown> | null | undefined;
  if (typeof actor !== 'object' || actor === null) return false;
  if (!isNonEmptyString(actor.ref)) return false;
  if (typeof actor.kind !== 'string' || !ACTOR_KINDS.has(actor.kind)) return false;

  if (v.results !== undefined) {
    if (!Array.isArray(v.results)) return false;
    for (const r of v.results) {
      if (typeof r !== 'object' || r === null) return false;
      const rr = r as Record<string, unknown>;
      if (!isNonEmptyString(rr.resource)) return false;
      if (typeof rr.processed !== 'number' || !Number.isInteger(rr.processed) || rr.processed < 0) {
        return false;
      }
      if (typeof rr.ok !== 'boolean') return false;
      if (rr.error !== undefined && typeof rr.error !== 'string') return false;
    }
  }

  if (v.verification !== undefined) {
    if (typeof v.verification !== 'object' || v.verification === null) return false;
    const ver = v.verification as Record<string, unknown>;
    if (typeof ver.ok !== 'boolean') return false;
    if (ver.checks !== undefined && (!Number.isInteger(ver.checks) || (ver.checks as number) < 0)) {
      return false;
    }
    if (ver.note !== undefined && typeof ver.note !== 'string') return false;
  }

  return true;
}

/**
 * Throwing assertion form of {@link isPurgeEvidence}. Use at trust
 * boundaries (deserialized audit rows, cross-service payloads) where an
 * invalid record must fail loudly rather than propagate.
 *
 * @throws {TypeError} when `value` is not a well-formed {@link PurgeEvidence}.
 */
export function assertPurgeEvidence(value: unknown): asserts value is PurgeEvidence {
  if (!isPurgeEvidence(value)) {
    throw new TypeError('Invalid PurgeEvidence: value does not satisfy the PurgeEvidence shape');
  }
}

/**
 * UUID-v4-style identifier. Uses `crypto.randomUUID` when available; falls
 * back to an RFC-4122 v4 string only on very old runtimes without Web Crypto.
 * Mirrors the generator in `@classytic/primitives/events`.
 */
function randomEvidenceId(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  if (g.crypto?.randomUUID) return g.crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const val = c === 'x' ? r : (r & 0x3) | 0x8;
    return val.toString(16);
  });
}
