/**
 * Standard error contract — a framework-agnostic JSON shape that maps cleanly
 * to HTTP responses, worker failure logs, and inter-service errors. Matches
 * RFC 7807 (`application/problem+json`) loosely.
 *
 * Packages should throw `Error` instances. Hosts (HTTP adapters, workers)
 * serialize those errors into this shape on the wire.
 */
export interface ErrorContract {
  /** Machine-readable, hierarchical code — e.g. 'order.validation.missing_line'. */
  code: string;
  /** Human-readable, safe-for-client message. */
  message: string;
  /** Suggested HTTP status code — hosts may override. */
  status?: number;
  /** Field-scoped validation errors. */
  details?: ReadonlyArray<ErrorDetail>;
  /** Correlation / trace identifier for support lookups. */
  correlationId?: string;
  /** Non-PII metadata (safe to log, safe to return to clients). */
  meta?: Readonly<Record<string, unknown>>;
}

export interface ErrorDetail {
  /** Dot-path pointer to the offending field, e.g. 'lines.0.quantity'. */
  path?: string;
  code: string;
  message: string;
  meta?: Readonly<Record<string, unknown>>;
}

/**
 * Canonical error codes. Packages add their own (`order.validation.*`,
 * `payment.gateway.*`) — these are the cross-cutting ones.
 */
export const ERROR_CODES = {
  VALIDATION: 'validation_error',
  NOT_FOUND: 'not_found',
  CONFLICT: 'conflict',
  UNAUTHORIZED: 'unauthorized',
  FORBIDDEN: 'forbidden',
  RATE_LIMITED: 'rate_limited',
  IDEMPOTENCY_CONFLICT: 'idempotency_conflict',
  PRECONDITION_FAILED: 'precondition_failed',
  INTERNAL: 'internal_error',
  UNAVAILABLE: 'service_unavailable',
  TIMEOUT: 'timeout',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];
