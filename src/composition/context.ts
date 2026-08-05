import type { IdLike } from './reference.js';

/**
 * Operation context threaded through package APIs.
 *
 * This is NOT the HTTP request context — it's the minimal identity + tracing
 * bag that a package needs to scope a domain operation. Hosts map their
 * request context (Arc, Express, tRPC, worker job) to this shape when calling
 * into a package.
 *
 * All fields are optional so packages can run unauthenticated (e.g. in tests,
 * workers, migration scripts) without a ceremonial context object.
 */
export interface OperationContext {
  /** Authenticated principal (user, service account, API key id). */
  actorId?: IdLike;

  /** Tenant / organization / branch scope. Interpretation is host-defined. */
  organizationId?: IdLike;

  /** Distributed trace identifier (e.g. OpenTelemetry trace-id). */
  traceId?: string;

  /** Correlation identifier, typically per logical operation. */
  correlationId?: string;

  /** Request identifier (e.g. Fastify `req.id`). */
  requestId?: string;

  /** Idempotency key supplied by the caller. */
  idempotencyKey?: string;

  /**
   * Storage-layer session/transaction handle. Opaque here — the consuming
   * package is expected to know how to use it (e.g. Mongoose `ClientSession`).
   */
  session?: unknown;

  /**
   * Soft-delete behaviour toggle — packages that expose delete primitives may
   * respect this. See PACKAGE_RULES.md §10.
   */
  mode?: 'soft' | 'hard';

  /** Free-form metadata the host may attach (locale, timezone, user-agent…). */
  metadata?: Readonly<Record<string, unknown>>;
}

/**
 * Structured logger — OBJECT-FIRST (`warn(fields, message)`), the pino / `fastify.log`
 * convention.
 *
 * ## Why this is separate from `ErrorLogger` / `EventLogger`
 *
 * Those two (in `primitives/events`) are MESSAGE-FIRST — `error(message, ...args)`, the console
 * convention — and `EventLogger`'s own docblock notes it mirrors arc's. The two conventions are
 * not interchangeable: swapping them silently logs an object where a format string was expected,
 * so a port must say which one it wants.
 *
 * This lives here rather than being re-declared per package because it was already declared per
 * package: an identical object-first shape existed in `spine-kit` as `PlacementLogger`, and the
 * next package needing one would have made a fourth. A logger is shared vocabulary, not domain.
 *
 * `warn`/`error` are required; `info` is OPTIONAL on purpose — a hand-written test logger or a
 * script's two-method stub is a legitimate caller, and requiring `info` would break every one of
 * them the day something wanted to log a healthy tick. Reach it as `logger?.info?.(…)`.
 *
 * `fastify.log` and a pino instance both satisfy this structurally, so hosts pass `req.log`
 * with no cast.
 */
export interface StructuredLogger {
  warn(fields: Record<string, unknown>, message: string): void;
  error(fields: Record<string, unknown>, message: string): void;
  info?(fields: Record<string, unknown>, message: string): void;
}

/** An identity shape — useful on audit fields (`createdBy`, `updatedBy`). */
export interface ActorRef {
  id: string;
  type?: 'user' | 'service' | 'system' | 'api-key' | string;
  name?: string;
}
