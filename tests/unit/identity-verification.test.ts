import { describe, expect, it } from 'vitest';
import {
  type CheckResult,
  checksSatisfy,
  deriveStatus,
  isVerified,
  type VerificationSession,
} from '../../src/identity/identity-verification.js';

function session(over: Partial<VerificationSession> = {}): VerificationSession {
  return {
    id: 's1',
    provider: 'test',
    level: 'standard',
    status: 'verified',
    checks: [],
    ...over,
  };
}

describe('isVerified', () => {
  it('true only for a verified, non-expired session', () => {
    expect(isVerified(session())).toBe(true);
    expect(isVerified(session({ status: 'pending' }))).toBe(false);
    expect(isVerified(session({ status: 'rejected' }))).toBe(false);
  });

  it('respects expiry (re-KYC)', () => {
    const now = new Date('2026-07-07T00:00:00Z');
    expect(isVerified(session({ expiresAt: '2026-08-01T00:00:00Z' }), now)).toBe(true);
    expect(isVerified(session({ expiresAt: '2026-06-01T00:00:00Z' }), now)).toBe(false);
  });
});

describe('checksSatisfy', () => {
  const results: CheckResult[] = [
    { check: 'document', outcome: 'pass' },
    { check: 'liveness', outcome: 'pass' },
    { check: 'sanctions', outcome: 'fail' },
  ];

  it('all required must pass', () => {
    expect(checksSatisfy(['document', 'liveness'], results)).toBe(true);
    expect(checksSatisfy(['document', 'sanctions'], results)).toBe(false); // sanctions failed
    expect(checksSatisfy(['pep'], results)).toBe(false); // missing
    expect(checksSatisfy([], results)).toBe(true); // vacuously true
  });
});

describe('deriveStatus', () => {
  it('any fail → rejected (outranks manual)', () => {
    expect(
      deriveStatus([
        { check: 'document', outcome: 'manual' },
        { check: 'sanctions', outcome: 'fail' },
      ]),
    ).toBe('rejected');
  });

  it('any manual (no fail) → review', () => {
    expect(deriveStatus([{ check: 'document', outcome: 'manual' }])).toBe('review');
  });

  it('all required pass → verified', () => {
    expect(
      deriveStatus([{ check: 'document', outcome: 'pass' }], ['document']),
    ).toBe('verified');
  });

  it('required not all present → processing', () => {
    expect(
      deriveStatus([{ check: 'document', outcome: 'pass' }], ['document', 'liveness']),
    ).toBe('processing');
  });

  it('no required checks → processing (cannot conclude verified)', () => {
    expect(deriveStatus([{ check: 'document', outcome: 'pass' }])).toBe('processing');
  });
});
