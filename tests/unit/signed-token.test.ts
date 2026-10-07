/**
 * Signed tokens: what one side signs the other verifies, and every way a token can be wrong is a
 * named refusal — never a pass.
 */
import { describe, expect, it } from 'vitest';
import {
  generateSigningJwk,
  importSigningKey,
  importVerifyingKey,
  publicJwkOf,
  signToken,
  verifyToken,
} from '../../src/security/signed-token.js';

const TYP = 'till-grant+jwt';
const now = new Date('2026-10-07T10:00:00.000Z');
const at = (s: number) => Math.floor(now.getTime() / 1000) + s;

async function keys(kid = 'k1') {
  const privateJwk = await generateSigningJwk();
  return {
    signing: { kid, privateKey: await importSigningKey(privateJwk) },
    verifying: await importVerifyingKey(publicJwkOf(privateJwk)),
    privateJwk,
  };
}

describe('signed tokens', () => {
  it('verifies what was signed, with its claims and key id', async () => {
    const k = await keys();
    const token = await signToken({ sub: 'TILL-1', exp: at(60) }, k.signing, { typ: TYP });
    const read = await verifyToken<{ sub: string }>(token, (kid) => (kid === 'k1' ? k.verifying : undefined), { typ: TYP, now });
    expect(read).toEqual({ ok: true, kid: 'k1', claims: { sub: 'TILL-1', exp: at(60) } });
  });

  it('refuses a changed claim, a token of another type, an unknown key, and another key’s signature', async () => {
    const k = await keys();
    const other = await keys('k1');
    const token = await signToken({ sub: 'TILL-1', exp: at(60) }, k.signing, { typ: TYP });
    const [h, , s] = token.split('.');
    const forged = `${h}.${Buffer.from(JSON.stringify({ sub: 'TILL-2', exp: at(60) })).toString('base64url')}.${s}`;
    const keyOf = () => k.verifying;
    expect(await verifyToken(forged, keyOf, { typ: TYP, now })).toEqual({ ok: false, reason: 'bad_signature' });
    expect(await verifyToken(token, keyOf, { typ: 'other+jwt', now })).toEqual({ ok: false, reason: 'wrong_type' });
    expect(await verifyToken(token, () => undefined, { typ: TYP, now })).toEqual({ ok: false, reason: 'unknown_key' });
    expect(await verifyToken(token, () => other.verifying, { typ: TYP, now })).toEqual({ ok: false, reason: 'bad_signature' });
    expect(await verifyToken('a.b', keyOf, { typ: TYP, now })).toEqual({ ok: false, reason: 'malformed' });
  });

  it('refuses a token with no expiry, an expired one, and one not yet valid', async () => {
    const k = await keys();
    const keyOf = () => k.verifying;
    const sign = (claims: Record<string, unknown>) => signToken(claims, k.signing, { typ: TYP });
    expect(await verifyToken(await sign({ sub: 'x' }), keyOf, { typ: TYP, now })).toEqual({ ok: false, reason: 'no_expiry' });
    expect(await verifyToken(await sign({ exp: at(0) }), keyOf, { typ: TYP, now })).toEqual({ ok: false, reason: 'expired' });
    expect(await verifyToken(await sign({ exp: at(60), nbf: at(30) }), keyOf, { typ: TYP, now })).toEqual({ ok: false, reason: 'not_yet_valid' });
    expect((await verifyToken(await sign({ exp: at(0) }), keyOf, { typ: TYP, now, leewaySeconds: 5 })).ok).toBe(true);
  });

  it('refuses another algorithm in the header, even with a valid-looking signature', async () => {
    const k = await keys();
    const token = await signToken({ exp: at(60) }, k.signing, { typ: TYP });
    const [, p, s] = token.split('.');
    const none = Buffer.from(JSON.stringify({ alg: 'none', typ: TYP, kid: 'k1' })).toString('base64url');
    expect(await verifyToken(`${none}.${p}.${s}`, () => k.verifying, { typ: TYP, now })).toEqual({ ok: false, reason: 'unsupported' });
  });

  it('the signing key cannot be exported, and the published half has no private member', async () => {
    const k = await keys();
    await expect(crypto.subtle.exportKey('jwk', k.signing.privateKey)).rejects.toThrow();
    expect(Object.keys(publicJwkOf(k.privateJwk)).sort()).toEqual(['crv', 'kty', 'x', 'y']);
  });
});
