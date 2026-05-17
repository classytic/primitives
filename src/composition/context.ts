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

/** An identity shape — useful on audit fields (`createdBy`, `updatedBy`). */
export interface ActorRef {
  id: string;
  type?: 'user' | 'service' | 'system' | 'api-key' | string;
  name?: string;
}
