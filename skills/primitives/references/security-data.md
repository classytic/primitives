# Security and data: signed tokens, canonical JSON, CSV, purge evidence

Subpaths: `/signed-token`, `/canonical`, `/csv`, `/retention`. One-time codes are in `references/identity.md`.

## /signed-token
Compact JWS tokens, ES256 over WebCrypto (server and offline devices share the code). `typ` is required on both sides so one token kind is never accepted as another; a token without `exp` is refused.
- Keys: `generateSigningJwk()` -> private JWK; `publicJwkOf(privateJwk)`; `importSigningKey(privateJwk)` and `importVerifyingKey(publicJwk)` -> `CryptoKey`.
- `signToken(claims, { kid, privateKey }, { typ })` -> token string. `claims` must carry `exp` (seconds since epoch); `nbf` and `iat` are also read.
- `verifyToken<Claims>(token, keyOf, { typ, now?, leewaySeconds? })` -> `{ ok: true, claims, kid }` or `{ ok: false, reason }`; it never throws on a bad token. `keyOf(kid)` returns the verifying key (sync or async). Reasons: `malformed`, `unsupported`, `wrong_type`, `unknown_key`, `bad_signature`, `no_expiry`, `expired`, `not_yet_valid`.

```ts
import { generateSigningJwk, importSigningKey, importVerifyingKey, publicJwkOf, signToken, verifyToken } from "@classytic/primitives/signed-token";

const jwk = await generateSigningJwk();
const privateKey = await importSigningKey(jwk);
const publicKey = await importVerifyingKey(publicJwkOf(jwk));
const token = await signToken({ sub: "u1", exp: Math.floor(Date.now() / 1000) + 60 }, { kid: "k1", privateKey }, { typ: "check-in" });
const good = await verifyToken<{ sub: string }>(token, (kid) => (kid === "k1" ? publicKey : undefined), { typ: "check-in" });
const wrong = await verifyToken(token, () => publicKey, { typ: "other" });
console.log(good.ok && good.claims.sub, !wrong.ok && wrong.reason);
```

## /canonical
Deterministic JSON for stable checksums. Keys sort recursively; a `Date` becomes `{"$date":"<iso>"}`; ambiguous values (`undefined`, `NaN`, `BigInt`, `Map`, `Set`, functions, cycles) throw `CanonicalizeError`.
- `canonicalJson(value)`, `sha256Hex(string)`, `canonicalDigest(value)` (hash of the canonical form).
- These are integrity checksums, not tamper-proof seals; pair with signatures where tampering matters.

```ts
import { canonicalDigest, canonicalJson } from "@classytic/primitives/canonical";

console.log(canonicalJson({ b: 1, a: [2, { d: 1, c: 2 }] }), canonicalDigest({ b: 1, a: 2 }) === canonicalDigest({ a: 2, b: 1 }));
```

## /csv
`escapeCsvCell(value)` is the one call for CSV export: it neutralizes spreadsheet formulas (a leading `=`, `+`, `-`, `@`, tab or CR gets a quote prefix, except a plain number such as `-5`) and applies RFC 4180 quoting. `neutralizeCsvFormula(value)` is the formula step alone; `null` and `undefined` become an empty cell.

```ts
import { escapeCsvCell } from "@classytic/primitives/csv";

console.log(["=SUM(A1)", "a,b", 'say "hi"', null].map(escapeCsvCell).join(","));
```

## /retention
`PurgeEvidence` is the record that a purge happened (not a retention policy and not a TTL).
- `createPurgeEvidence({ subject: { ref, model? }, scope, strategy, measuresRetained, processed, actor: { ref, kind }, reason, status?, legalBasis?, results?, verification?, occurredAt? })`. Strategies: `hard`, `soft`, `anonymize`. Status defaults to `completed`; `partial` and `failed` are allowed.
- `isPurgeEvidence(v)` guard and `assertPurgeEvidence(v)` assertion for stored or received records.

```ts
import { createPurgeEvidence } from "@classytic/primitives/retention";

const evidence = createPurgeEvidence({
  subject: { ref: "u1" },
  scope: "user-data",
  strategy: "anonymize",
  measuresRetained: false,
  processed: 3,
  actor: { ref: "system", kind: "system" },
  reason: "erasure request",
});
console.log(evidence.status, evidence.strategy);
```
