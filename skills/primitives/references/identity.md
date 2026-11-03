# People and identity: person, phone, OTP, verification, subject

Subpaths: `/person`, `/person-parse`, `/phone`, `/otp`, `/identity-verification`, `/subject`, `/legal-form`, `/identifier`. Addresses are in `references/address.md`.

## /person
- `PersonName` is `{ given, family, middle?, prefix?, suffix?, preferred? }`. `formatFullName(name)` joins the parts; `formatDisplayName(name)` prefers `preferred`, else given and family.
- Also types: `ContactInfo`, `EmergencyContact`, `Gender`.

## /person-parse
Boundary helpers for flat names from auth or point-of-sale input.
- `nameFromString(flat, fallback, user?)` -> `PersonName`; a single token goes in `given`.
- `hasUsableName(name)` (false for empty strings), `looksLikeIdentifierNotName(value)` (token-shaped ids), `sanitizeDisplayName(value, fallback)`, `fallbackNameFromUser({ name, email }, defaultLabel)` (email local part when no name).

```ts
import { formatDisplayName, formatFullName } from "@classytic/primitives/person";
import { looksLikeIdentifierNotName, nameFromString } from "@classytic/primitives/person-parse";

const name = nameFromString("Ada Lovelace", "Member");
console.log(name, formatDisplayName(name), formatFullName({ given: "Ada", middle: "K", family: "Lovelace" }), looksLikeIdentifierNotName("user_12345"));
```

## /phone
E.164 only; no country guessing.
- `parsePhone(input)` returns a `Result`, never throws: `{ ok: true, value: { e164, callingCode, nationalNumber } }` or `{ ok: false, error: PhoneError }` with code `EMPTY`, `MISSING_PLUS`, `NOT_E164`, `TOO_SHORT`, `TOO_LONG`.
- `formatPhone(phone)` returns the E.164 string; `formatNational(phone)` groups the national number in threes for admin display (not locale-aware); `isPhoneNumber(v)` guard.
- Records that require a phone before one is known use `placeholderPhone(id)` (`pending_<id>`). `isPlaceholderPhone(v)` detects it; `shownPhone(v)` returns a showable phone or `null`. Never display, dial or dedupe on a placeholder.

```ts
import { formatPhone, parsePhone } from "@classytic/primitives/phone";

const parsed = parsePhone("+8801712345678");
console.log(parsed.ok ? formatPhone(parsed.value) : parsed.error.code, parsePhone("01712345678"));
```

## /otp
Hashed one-time code challenge. Store the challenge, send the code once; the code is never stored.
- `createOtpChallenge({ secret, length?, ttlMs?, maxAttempts?, now? })` -> `{ challenge, code }`. Defaults: 6 digits, 5 minutes, 5 attempts.
- `verifyOtpChallenge(challenge, input, { secret, now? })` -> `{ challenge, outcome }`; persist the returned `challenge` (attempt counts change). Outcomes: `verified`, `incorrect`, `expired`, `locked`, `already_used`.
- `isOtpVerified(challenge)`, `isOtpActive(challenge, now?)`. Resend throttling is the host's job.

```ts
import { createOtpChallenge, isOtpVerified, verifyOtpChallenge } from "@classytic/primitives/otp";

const { challenge, code } = createOtpChallenge({ secret: "server-secret" });
const wrong = verifyOtpChallenge(challenge, "000000", { secret: "server-secret" });
const right = verifyOtpChallenge(wrong.challenge, code, { secret: "server-secret" });
console.log(wrong.outcome, right.outcome, isOtpVerified(right.challenge));
```

## /identity-verification
Provider-neutral KYC vocabulary: `VerificationSession` (`status`: `pending`, `processing`, `verified`, `rejected`, `review`, `expired`), `CheckResult` (`check`, `outcome`: `pass`, `fail`, `manual`, `skipped`), `CreateVerificationParams`, `IdentitySubject`, `DocumentReference`, `IdentityProviderCapabilities`, `VerificationWebhookEvent`.
- `isVerified(session, now?)` is true only when verified and not lapsed.
- `checksSatisfy(required, results)` and `deriveStatus(results, required?)` turn check results into a status.

```ts
import { checksSatisfy, deriveStatus, isVerified } from "@classytic/primitives/identity-verification";

const checks = [{ check: "document" as const, outcome: "pass" as const }];
const session = { id: "s1", provider: "p", level: "basic" as const, status: "verified" as const, checks, expiresAt: "2030-01-01T00:00:00Z" };
console.log(isVerified(session), checksSatisfy(["document", "liveness"], checks), deriveStatus(checks, ["document"]));
```

## /subject
A polymorphic reference `{ subjectModel, subjectRef }` (who or what a record is about).
- `makeSubjectRef(model, id)` returns `null` for a null or undefined id. `formatSubjectRef` -> `model:id`. `subjectRefsEqual(a, b)`, `isSubjectRef(v)`.

```ts
import { formatSubjectRef, makeSubjectRef } from "@classytic/primitives/subject";

const ref = makeSubjectRef("user", "u1");
console.log(ref, ref && formatSubjectRef(ref), makeSubjectRef("user", null));
```

## /legal-form
`LEGAL_FORMS` (`individual`, `partnership`, `company`, `cooperative`, `nonprofit`, `government`), `LEGAL_FORM_LABELS`, `isLegalForm(v)`.

## /identifier
Identifiers typed or pasted by people (staff numbers, national IDs, codes, e-mail). Not for prose: it drops ZWJ / ZWNJ.
- `cleanIdentifier(v)`: invisible format marks removed, then NFKC (fullwidth, NBSP), digits to ASCII, trimmed. Idempotent. Keeps case and inner spaces; wrap it per kind.
- `asciiDigits(v)`: every Unicode decimal digit (Arabic-Indic, Persian, Bengali, Devanagari, Thai, ...) to ASCII. `stripInvisible(v)`: removes `\p{Cf}` (bidi marks, zero-width, soft hyphen, BOM).
- All three throw `TypeError` on a non-string.

```ts
import { cleanIdentifier } from "@classytic/primitives/identifier";

const staffNumber = (v: string) => cleanIdentifier(v).toUpperCase();
const nationalId = (v: string) => cleanIdentifier(v).replace(/\s+/g, "");
console.log(staffNumber("e\u0662\u0660\u0660\u200F"), nationalId("\u0661\u0662 34")); // "E200", "1234"
```
