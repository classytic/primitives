/**
 * Phone number value object.
 *
 * `PersonName` and `Address` are typed; phones have been a plain `string` in
 * `ContactInfo` so far. This primitive closes that gap with a tiny,
 * zero-dependency wrapper that:
 *   1. Normalizes E.164 input (strips formatting, keeps the leading `+`).
 *   2. Captures the country calling code as a discrete field for routing /
 *      regional analytics.
 *   3. Surfaces parse failures via `Result<PhoneNumber, PhoneError>` so
 *      callers don't deal with thrown errors at value-object construction.
 *
 * Deliberately NOT a full libphonenumber dep — that ships ~500 KB of metadata
 * and is per-locale. We accept E.164 input and validate format; deeper
 * validation (region-of-issue, mobile-vs-landline) is the host's call to
 * layer on top. This keeps `@classytic/primitives` zero-dep and tree-shakeable.
 *
 * @example
 *   import { parsePhone, formatPhone, type PhoneNumber } from '@classytic/primitives/phone';
 *
 *   const parsed = parsePhone('+1 (415) 555-0182');
 *   if (parsed.ok) {
 *     formatPhone(parsed.value); // '+14155550182'
 *     parsed.value.callingCode;  // '1'
 *   }
 */

import { err, ok, type Result } from '../composition/result.js';

export type PhoneErrorCode = 'EMPTY' | 'MISSING_PLUS' | 'NOT_E164' | 'TOO_SHORT' | 'TOO_LONG';

export class PhoneError extends Error {
  override readonly name = 'PhoneError';
  readonly code: PhoneErrorCode;
  constructor(code: PhoneErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

/**
 * Parsed phone number. Stored E.164 (always begins with `+`, digits only after).
 * `callingCode` is the 1–3 digit country dial code (`'1'` US, `'44'` UK,
 * `'880'` BD, etc.) — useful for routing without re-parsing.
 *
 * Construction goes through `parsePhone()` (never assemble by hand) so the
 * invariants are guaranteed by the parser.
 */
export interface PhoneNumber {
  readonly e164: string;
  readonly callingCode: string;
  /** The national-number portion (digits after the calling code). */
  readonly nationalNumber: string;
}

/**
 * E.164 country calling codes by length. We accept 1–3 digits and let the
 * longest-prefix-match decide. Source: ITU-T E.164 assignments (snapshot —
 * stable across decades).
 *
 * Kept inline (not exported) because it's an implementation detail of the
 * parser. Length is the only thing we actually need for the split.
 */
const E164_PREFIXES_3: ReadonlySet<string> = new Set([
  '210',
  '211',
  '212',
  '213',
  '216',
  '218',
  '220',
  '221',
  '222',
  '223',
  '224',
  '225',
  '226',
  '227',
  '228',
  '229',
  '230',
  '231',
  '232',
  '233',
  '234',
  '235',
  '236',
  '237',
  '238',
  '239',
  '240',
  '241',
  '242',
  '243',
  '244',
  '245',
  '246',
  '247',
  '248',
  '249',
  '250',
  '251',
  '252',
  '253',
  '254',
  '255',
  '256',
  '257',
  '258',
  '260',
  '261',
  '262',
  '263',
  '264',
  '265',
  '266',
  '267',
  '268',
  '269',
  '290',
  '291',
  '297',
  '298',
  '299',
  '350',
  '351',
  '352',
  '353',
  '354',
  '355',
  '356',
  '357',
  '358',
  '359',
  '370',
  '371',
  '372',
  '373',
  '374',
  '375',
  '376',
  '377',
  '378',
  '379',
  '380',
  '381',
  '382',
  '383',
  '385',
  '386',
  '387',
  '389',
  '420',
  '421',
  '423',
  '500',
  '501',
  '502',
  '503',
  '504',
  '505',
  '506',
  '507',
  '508',
  '509',
  '590',
  '591',
  '592',
  '593',
  '594',
  '595',
  '596',
  '597',
  '598',
  '599',
  '670',
  '672',
  '673',
  '674',
  '675',
  '676',
  '677',
  '678',
  '679',
  '680',
  '681',
  '682',
  '683',
  '685',
  '686',
  '687',
  '688',
  '689',
  '690',
  '691',
  '692',
  '800',
  '808',
  '850',
  '852',
  '853',
  '855',
  '856',
  '870',
  '878',
  '880',
  '881',
  '882',
  '883',
  '886',
  '888',
  '960',
  '961',
  '962',
  '963',
  '964',
  '965',
  '966',
  '967',
  '968',
  '970',
  '971',
  '972',
  '973',
  '974',
  '975',
  '976',
  '977',
  '979',
  '992',
  '993',
  '994',
  '995',
  '996',
  '998',
]);
const E164_PREFIXES_2: ReadonlySet<string> = new Set([
  '20',
  '27',
  '30',
  '31',
  '32',
  '33',
  '34',
  '36',
  '39',
  '40',
  '41',
  '43',
  '44',
  '45',
  '46',
  '47',
  '48',
  '49',
  '51',
  '52',
  '53',
  '54',
  '55',
  '56',
  '57',
  '58',
  '60',
  '61',
  '62',
  '63',
  '64',
  '65',
  '66',
  '81',
  '82',
  '84',
  '86',
  '90',
  '91',
  '92',
  '93',
  '94',
  '95',
  '98',
]);
// 1-digit calling codes: NANP (1) + Russia/Kazakhstan (7).
const E164_PREFIXES_1: ReadonlySet<string> = new Set(['1', '7']);

/**
 * Parse free-form phone input into a normalized `PhoneNumber`. Accepts:
 *   - `'+14155550182'`           → e164 unchanged
 *   - `'+1 (415) 555-0182'`     → strips spaces / punctuation
 *   - `'+1.415.555.0182'`        → strips dots
 *
 * Rejects anything without a leading `+` — we don't guess the country.
 * If the host knows the user's region, prepend the code before calling.
 */
export function parsePhone(input: string): Result<PhoneNumber, PhoneError> {
  if (typeof input !== 'string' || input.trim().length === 0) {
    return err(new PhoneError('EMPTY', 'phone input is empty'));
  }
  const trimmed = input.trim();
  if (!trimmed.startsWith('+')) {
    return err(
      new PhoneError(
        'MISSING_PLUS',
        `phone must be E.164 (start with '+'): got ${JSON.stringify(input)}`,
      ),
    );
  }

  // Strip everything that isn't a digit after the leading `+`.
  const digits = trimmed.slice(1).replace(/[^0-9]/g, '');
  if (digits.length === 0) {
    return err(new PhoneError('NOT_E164', 'phone has no digits'));
  }
  // E.164 §6.2 — max 15 digits including country code.
  if (digits.length > 15) {
    return err(
      new PhoneError('TOO_LONG', `phone exceeds E.164 15-digit limit: ${digits.length} digits`),
    );
  }
  if (digits.length < 7) {
    return err(new PhoneError('TOO_SHORT', `phone too short to be E.164: ${digits.length} digits`));
  }

  // Longest-prefix-match for the calling code: 3 → 2 → 1 digits.
  const callingCode = E164_PREFIXES_3.has(digits.slice(0, 3))
    ? digits.slice(0, 3)
    : E164_PREFIXES_2.has(digits.slice(0, 2))
      ? digits.slice(0, 2)
      : E164_PREFIXES_1.has(digits.slice(0, 1))
        ? digits.slice(0, 1)
        : null;

  if (callingCode === null) {
    return err(
      new PhoneError('NOT_E164', `unrecognized country calling code in ${JSON.stringify(input)}`),
    );
  }

  return ok({
    e164: `+${digits}`,
    callingCode,
    nationalNumber: digits.slice(callingCode.length),
  });
}

/** Convenience: returns the E.164 string. Useful when piping to a transport. */
export function formatPhone(phone: PhoneNumber): string {
  return phone.e164;
}

/**
 * Best-effort national-format render: groups the national number into 3-digit
 * blocks. Not locale-aware — for display polish, hosts should format per
 * region. Useful as a default in admin UIs.
 *
 * @example formatNational(parsePhone('+14155550182').value!) → '+1 415 555 0182'
 */
export function formatNational(phone: PhoneNumber): string {
  const groups = phone.nationalNumber.match(/.{1,3}/g) ?? [];
  return `+${phone.callingCode} ${groups.join(' ')}`.trim();
}

/** Type guard. */
export function isPhoneNumber(value: unknown): value is PhoneNumber {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as PhoneNumber).e164 === 'string' &&
    typeof (value as PhoneNumber).callingCode === 'string' &&
    typeof (value as PhoneNumber).nationalNumber === 'string' &&
    (value as PhoneNumber).e164.startsWith('+')
  );
}
