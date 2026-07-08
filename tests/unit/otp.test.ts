import { describe, expect, it } from 'vitest';
import {
  type CreateOtpOptions,
  createOtpChallenge,
  isOtpActive,
  isOtpVerified,
  type OtpChallenge,
  verifyOtpChallenge,
} from '../../src/identity/otp.js';

const SECRET = 'server-side-hmac-key';
const T0 = new Date('2026-01-01T00:00:00.000Z');
const at = (ms: number) => new Date(T0.getTime() + ms);

function mint(overrides: Partial<CreateOtpOptions> = {}) {
  return createOtpChallenge({ secret: SECRET, now: T0, ...overrides });
}

describe('createOtpChallenge', () => {
  it('never persists the plaintext code — only its HMAC digest', () => {
    const { challenge, code } = mint();
    expect(challenge.hash).not.toContain(code);
    // HMAC-SHA256 → 32 bytes → 64 hex chars.
    expect(challenge.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('generates a numeric code of the requested length', () => {
    expect(mint().code).toMatch(/^\d{6}$/);
    expect(mint({ length: 8 }).code).toMatch(/^\d{8}$/);
  });

  it('stamps expiry from the injected clock + ttl, and starts pending', () => {
    const { challenge } = mint({ ttlMs: 60_000 });
    expect(challenge.expiresAt).toBe(at(60_000).toISOString());
    expect(challenge.status).toBe('pending');
    expect(challenge.attempts).toBe(0);
  });

  it('draws fresh codes (CSPRNG, not a constant)', () => {
    const codes = new Set(Array.from({ length: 50 }, () => mint().code));
    // Collisions are astronomically unlikely; a constant generator would give 1.
    expect(codes.size).toBeGreaterThan(40);
  });

  it('rejects a missing secret / too-short length / bad bounds', () => {
    expect(() => createOtpChallenge({ secret: '', now: T0 })).toThrow(/secret/);
    expect(() => mint({ length: 3 })).toThrow(/length/);
    expect(() => mint({ ttlMs: 0 })).toThrow(/ttlMs/);
    expect(() => mint({ maxAttempts: 0 })).toThrow(/maxAttempts/);
  });
});

describe('verifyOtpChallenge — happy path', () => {
  it('verifies the correct code and marks the challenge verified', () => {
    const { challenge, code } = mint();
    const result = verifyOtpChallenge(challenge, code, { secret: SECRET, now: at(1000) });
    expect(result.outcome).toBe('verified');
    expect(result.challenge.status).toBe('verified');
    expect(isOtpVerified(result.challenge)).toBe(true);
  });
});

describe('verifyOtpChallenge — brute force resistance', () => {
  it('increments attempts on a wrong code without settling', () => {
    const { challenge } = mint();
    const r = verifyOtpChallenge(challenge, '000000', { secret: SECRET, now: at(1000) });
    expect(r.outcome).toBe('incorrect');
    expect(r.challenge.attempts).toBe(1);
    expect(r.challenge.status).toBe('pending');
  });

  it('locks the challenge on the maxAttempts-th wrong code', () => {
    let challenge = mint({ maxAttempts: 3 }).challenge;
    for (let i = 0; i < 2; i += 1) {
      challenge = verifyOtpChallenge(challenge, 'wrong!', { secret: SECRET, now: at(1000) })
        .challenge;
    }
    const last = verifyOtpChallenge(challenge, 'wrong!', { secret: SECRET, now: at(1000) });
    expect(last.outcome).toBe('locked');
    expect(last.challenge.status).toBe('failed');
  });

  it('a locked challenge rejects even the CORRECT code (fail-closed)', () => {
    const { challenge, code } = mint({ maxAttempts: 1 });
    const locked = verifyOtpChallenge(challenge, 'nope', { secret: SECRET, now: at(1000) })
      .challenge;
    expect(locked.status).toBe('failed');
    const retry = verifyOtpChallenge(locked, code, { secret: SECRET, now: at(1000) });
    expect(retry.outcome).toBe('locked');
    expect(retry.challenge.status).toBe('failed');
  });
});

describe('verifyOtpChallenge — expiry', () => {
  it('rejects a correct code presented after the TTL', () => {
    const { challenge, code } = mint({ ttlMs: 30_000 });
    const r = verifyOtpChallenge(challenge, code, { secret: SECRET, now: at(30_001) });
    expect(r.outcome).toBe('expired');
    expect(r.challenge.status).toBe('expired');
  });

  it('accepts a correct code at exactly the expiry boundary', () => {
    const { challenge, code } = mint({ ttlMs: 30_000 });
    const r = verifyOtpChallenge(challenge, code, { secret: SECRET, now: at(30_000) });
    expect(r.outcome).toBe('verified');
  });
});

describe('verifyOtpChallenge — replay / single-use', () => {
  it('a verified challenge cannot be reused', () => {
    const { challenge, code } = mint();
    const verified = verifyOtpChallenge(challenge, code, { secret: SECRET, now: at(1000) })
      .challenge;
    const replay = verifyOtpChallenge(verified, code, { secret: SECRET, now: at(2000) });
    expect(replay.outcome).toBe('already_used');
    expect(replay.challenge.status).toBe('verified');
  });
});

describe('verifyOtpChallenge — secret binding', () => {
  it('the correct code fails under a different secret (HMAC is key-bound)', () => {
    const { challenge, code } = mint();
    const r = verifyOtpChallenge(challenge, code, { secret: 'other-key', now: at(1000) });
    expect(r.outcome).toBe('incorrect');
  });

  it('rejects a missing secret at verify time', () => {
    const { challenge, code } = mint();
    expect(() => verifyOtpChallenge(challenge, code, { secret: '' })).toThrow(/secret/);
  });
});

describe('verifyOtpChallenge — malformed stored hash', () => {
  it('a corrupt (odd-length / non-hex) stored hash never throws — just fails', () => {
    const bad: OtpChallenge = {
      hash: 'not-hex-zzz',
      expiresAt: at(60_000).toISOString(),
      attempts: 0,
      maxAttempts: 5,
      status: 'pending',
    };
    const r = verifyOtpChallenge(bad, '123456', { secret: SECRET, now: at(1000) });
    expect(r.outcome).toBe('incorrect');
  });
});

describe('isOtpActive', () => {
  it('is true while pending + unexpired, false once expired or settled', () => {
    const { challenge, code } = mint({ ttlMs: 30_000 });
    expect(isOtpActive(challenge, at(1000))).toBe(true);
    expect(isOtpActive(challenge, at(30_001))).toBe(false);
    const verified = verifyOtpChallenge(challenge, code, { secret: SECRET, now: at(1000) })
      .challenge;
    expect(isOtpActive(verified, at(2000))).toBe(false);
  });
});
