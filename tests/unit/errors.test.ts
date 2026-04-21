import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from '../../src/errors.js';

describe('ERROR_CODES', () => {
  it('exposes the canonical cross-cutting codes', () => {
    expect(ERROR_CODES).toMatchObject({
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
    });
  });

  it('values are snake_case strings', () => {
    for (const value of Object.values(ERROR_CODES)) {
      expect(value).toMatch(/^[a-z_]+$/);
    }
  });

  it('all values are unique', () => {
    const values = Object.values(ERROR_CODES);
    expect(new Set(values).size).toBe(values.length);
  });
});
