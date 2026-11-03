/**
 * Identifiers typed or pasted by people: staff numbers, national IDs, membership
 * codes, e-mail. Spreadsheets exported in Arabic, Persian or Indic locales carry
 * native digits and invisible bidi marks; none of those may make an otherwise
 * correct identifier invalid or create a second spelling of the same one.
 *
 * Identifiers only, never prose: `stripInvisible` drops ZWJ / ZWNJ, which
 * Persian, Indic and emoji text need to render correctly.
 *
 * Case and inner whitespace are left alone. The domain decides those (a staff
 * number upper-cases, an e-mail lower-cases, a national ID drops spaces), so
 * wrap `cleanIdentifier` in a one-line helper per identifier kind.
 *
 * Pure, zero-dependency, safe in the browser.
 */

const NON_ASCII_DIGIT = /(?![0-9])\p{Nd}/gu;
const DECIMAL_DIGIT = /^\p{Nd}$/u;
const FORMAT_CHAR = /\p{Cf}/gu;

function assertString(value: unknown, fn: string): asserts value is string {
  if (typeof value !== 'string') {
    throw new TypeError(`${fn}: expected a string, got ${value === null ? 'null' : typeof value}.`);
  }
}

/**
 * The value of a decimal digit. Unicode encodes every `Nd` digit in contiguous
 * runs of exactly ten, 0 to 9, and adjacent runs are aligned (the stability
 * policy for `Numeric_Type=Decimal`), so the distance back to the run start,
 * mod 10, is the digit. No per-script table to keep current.
 */
function digitValue(cp: number): number {
  let steps = 0;
  while (steps < 60 && DECIMAL_DIGIT.test(String.fromCodePoint(cp - steps - 1))) steps++;
  return steps % 10;
}

/**
 * Map every non-ASCII Unicode decimal digit (`\p{Nd}`: Arabic-Indic, Persian,
 * Bengali, Devanagari, Thai, fullwidth, mathematical, ...) to its ASCII digit.
 * Other numerals (superscripts, Roman numerals) are not decimal digits and stay.
 *
 * @throws TypeError when `value` is not a string.
 */
export function asciiDigits(value: string): string {
  assertString(value, 'asciiDigits');
  return value.replace(NON_ASCII_DIGIT, (ch) => String(digitValue(ch.codePointAt(0) as number)));
}

/**
 * Remove invisible format characters (`\p{Cf}`): zero-width space and joiners,
 * LRM / RLM, the Arabic letter mark, bidi embeddings and isolates, word joiner,
 * soft hyphen and the BOM. For identifiers, not prose.
 *
 * @throws TypeError when `value` is not a string.
 */
export function stripInvisible(value: string): string {
  assertString(value, 'stripInvisible');
  return value.replace(FORMAT_CHAR, '');
}

/**
 * The base of every identifier comparison: invisible marks removed, then
 * NFKC (folds fullwidth forms and NBSP), digits to ASCII, trimmed. Stripping
 * comes first so a mark between a letter and its combining accent cannot
 * leave a pair that a second NFKC would compose: the result is idempotent.
 *
 * @example
 * cleanIdentifier('\u200F ١٢٣٤ ') // '1234'
 * const staffNumber = (v: string) => cleanIdentifier(v).toUpperCase();
 *
 * @throws TypeError when `value` is not a string.
 */
export function cleanIdentifier(value: string): string {
  assertString(value, 'cleanIdentifier');
  return asciiDigits(stripInvisible(value).normalize('NFKC')).trim();
}
