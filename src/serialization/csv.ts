/**
 * `@classytic/primitives/csv` — make one value safe to put in a CSV cell.
 *
 * Two defences, deliberately separable because a consumer that already has a
 * real CSV writer must NOT get its quoting done twice:
 *
 *   - `neutralizeCsvFormula` — stops the cell being executed as a formula when
 *     the file is opened in Excel / Sheets / LibreOffice. Use this when a
 *     library (`csv-stringify`, `papaparse`, …) is doing the quoting.
 *   - `escapeCsvCell` — neutralize + RFC 4180 quoting. Use this in a
 *     hand-rolled `rows.map(...).join(',')` serializer.
 *
 * WHY quoting is not enough: a spreadsheet strips the quotes first and
 * evaluates what is left, so `"=cmd|'/c calc'!A1"` still executes. Only
 * changing the LEADING character stops it, which is why these are one module
 * and not a quoting helper someone can use alone.
 *
 * Well-formed numbers are exempt. Prefixing `-1500` would make every negative
 * amount text and break the reader's `SUM` — a fix that quietly corrupts every
 * finance export is worse than the hole. The exemption is the WHOLE cell
 * matching a number, so `-2+3+cmd|'/c calc'!A0` is still neutralized.
 *
 * NOT for a machine-to-machine upload contract with a fixed column spec (a
 * courier's bulk-import CSV, say) — there the receiver is a parser, not a
 * spreadsheet, and an added `'` corrupts the payload.
 */

/** Leading characters a spreadsheet may treat as the start of a formula or DDE call. */
const FORMULA_LEAD = /^[=+\-@\t\r]/;

/** The WHOLE cell is a plain number — no separators, no currency symbol. */
const WHOLE_NUMBER = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/;

/** Characters that force RFC 4180 quoting. */
const NEEDS_QUOTING = /[",\r\n]/;

/**
 * Prefix `'` when the cell would otherwise be evaluated as a formula.
 * `null`/`undefined` become `''`. Numbers are returned unchanged.
 */
export function neutralizeCsvFormula(value: unknown): string {
  const text = value == null ? '' : String(value);
  if (!FORMULA_LEAD.test(text)) return text;
  if (WHOLE_NUMBER.test(text)) return text;
  return `'${text}`;
}

/** `neutralizeCsvFormula` + RFC 4180 quoting. The one-call form. */
export function escapeCsvCell(value: unknown): string {
  const text = neutralizeCsvFormula(value);
  return NEEDS_QUOTING.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
