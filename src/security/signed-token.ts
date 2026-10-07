/**
 * Signed tokens: compact JWS (RFC 7515), ES256 over WebCrypto — a server and an offline device sign
 * and verify the same bytes with no dependency. Claims follow RFC 7519 (`exp`/`nbf`/`iat` in
 * seconds).
 *
 *   const token = await signToken({ sub, exp }, { kid, privateKey }, { typ: 'till-grant+jwt' });
 *   const read = await verifyToken<Grant>(token, (kid) => keys.get(kid), { typ: 'till-grant+jwt' });
 *
 * `typ` is required on both sides, so one kind of token is never accepted as another, and a token
 * without `exp` is refused.
 */

export const SIGNED_TOKEN_ALG = 'ES256';

/** A P-256 key as JWK; `d` only on a private key. */
export interface EcJwk {
  kty?: string;
  crv?: string;
  x?: string;
  y?: string;
  d?: string;
  [member: string]: unknown;
}

const ECDSA = { name: 'ECDSA', namedCurve: 'P-256' } as const;
const SIGN = { name: 'ECDSA', hash: 'SHA-256' } as const;

export interface SigningKey {
  /** Published with the public key; names it in each token's header. */
  readonly kid: string;
  readonly privateKey: CryptoKey;
}

export type TokenRefusal =
  | 'malformed'
  | 'unsupported'
  | 'wrong_type'
  | 'unknown_key'
  | 'bad_signature'
  | 'no_expiry'
  | 'expired'
  | 'not_yet_valid';

export type VerifiedToken<T> =
  | { readonly ok: true; readonly claims: T; readonly kid: string }
  | { readonly ok: false; readonly reason: TokenRefusal };

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) return null;
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function parseJson(segment: string): Record<string, unknown> | null {
  const bytes = fromBase64Url(segment);
  if (!bytes) return null;
  try {
    const value: unknown = JSON.parse(decoder.decode(bytes));
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export async function signToken(claims: Record<string, unknown>, key: SigningKey, options: { typ: string }): Promise<string> {
  const header = toBase64Url(encoder.encode(JSON.stringify({ alg: SIGNED_TOKEN_ALG, typ: options.typ, kid: key.kid })));
  const payload = toBase64Url(encoder.encode(JSON.stringify(claims)));
  const input = `${header}.${payload}`;
  const signature = new Uint8Array(await crypto.subtle.sign(SIGN, key.privateKey, encoder.encode(input)));
  return `${input}.${toBase64Url(signature)}`;
}

export async function verifyToken<T>(
  token: string,
  keyOf: (kid: string) => CryptoKey | undefined | Promise<CryptoKey | undefined>,
  options: { typ: string; now?: Date | undefined; leewaySeconds?: number | undefined },
): Promise<VerifiedToken<T>> {
  const parts = typeof token === 'string' ? token.split('.') : [];
  if (parts.length !== 3) return { ok: false, reason: 'malformed' };
  const [headerPart, payloadPart, signaturePart] = parts as [string, string, string];
  const header = parseJson(headerPart);
  const claims = parseJson(payloadPart);
  const signature = fromBase64Url(signaturePart);
  if (!header || !claims || !signature) return { ok: false, reason: 'malformed' };
  if (header.alg !== SIGNED_TOKEN_ALG || header.crit !== undefined) return { ok: false, reason: 'unsupported' };
  if (header.typ !== options.typ) return { ok: false, reason: 'wrong_type' };
  if (typeof header.kid !== 'string') return { ok: false, reason: 'unknown_key' };
  const key = await keyOf(header.kid);
  if (!key) return { ok: false, reason: 'unknown_key' };
  const valid = await crypto.subtle.verify(SIGN, key, signature, encoder.encode(`${headerPart}.${payloadPart}`));
  if (!valid) return { ok: false, reason: 'bad_signature' };

  const now = Math.floor((options.now ?? new Date()).getTime() / 1000);
  const leeway = options.leewaySeconds ?? 0;
  if (typeof claims.exp !== 'number') return { ok: false, reason: 'no_expiry' };
  if (now >= claims.exp + leeway) return { ok: false, reason: 'expired' };
  if (typeof claims.nbf === 'number' && now < claims.nbf - leeway) return { ok: false, reason: 'not_yet_valid' };
  return { ok: true, claims: claims as T, kid: header.kid };
}

/** A P-256 private JWK as a non-extractable signing key. */
export function importSigningKey(privateJwk: EcJwk): Promise<CryptoKey> {
  return crypto.subtle.importKey('jwk', privateJwk, ECDSA, false, ['sign']);
}

/** A P-256 public JWK as a verifying key. */
export function importVerifyingKey(publicJwk: EcJwk): Promise<CryptoKey> {
  const { kty, crv, x, y } = publicJwk;
  return crypto.subtle.importKey('jwk', { kty, crv, x, y }, ECDSA, false, ['verify']);
}

/** The public half of a P-256 private JWK — what is published. */
export function publicJwkOf(privateJwk: EcJwk): EcJwk {
  const { kty, crv, x, y } = privateJwk;
  return { kty, crv, x, y };
}

/** A fresh key pair as JWKs — for provisioning a deployment's signing key. */
export async function generateSigningJwk(): Promise<EcJwk> {
  const pair = (await crypto.subtle.generateKey(ECDSA, true, ['sign', 'verify'])) as { privateKey: CryptoKey };
  return (await crypto.subtle.exportKey('jwk', pair.privateKey)) as EcJwk;
}
