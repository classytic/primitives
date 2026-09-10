/**
 * CSV cell safety (@classytic/primitives/csv).
 *
 * The NUMBERS block is the half that keeps this from being a fix that breaks
 * the product: a blanket prefix would turn every negative amount into text and
 * silently break `SUM` in every finance export.
 */
import { describe, expect, it } from 'vitest';
import { escapeCsvCell, neutralizeCsvFormula } from '../../src/serialization/csv.js';

describe('neutralizeCsvFormula', () => {
  it.each([
    ['=1+1', "'=1+1"],
    ["=cmd|'/c calc'!A1", "'=cmd|'/c calc'!A1"],
    ['@SUM(A1:A9)', "'@SUM(A1:A9)"],
    ['+1+1', "'+1+1"],
    ["-2+3+cmd|'/c calc'!A0", "'-2+3+cmd|'/c calc'!A0"],
    ['\tDDE', "'\tDDE"],
    ['\r=1+1', "'\r=1+1"],
  ])('neutralizes %j', (input, expected) => {
    expect(neutralizeCsvFormula(input)).toBe(expected);
  });

  describe('leaves real numbers alone — a prefixed number breaks SUM', () => {
    it.each([
      '-1500',
      '-1500.75',
      '+42',
      '0',
      '1e6',
      '-1.5e-3',
      '.5',
      '-.5',
    ])('%s is unchanged', (input) => {
      expect(neutralizeCsvFormula(input)).toBe(input);
    });

    it('accepts a negative JS number, not just its string', () => {
      expect(neutralizeCsvFormula(-1500.75)).toBe('-1500.75');
    });

    it('still neutralizes a number with anything appended', () => {
      expect(neutralizeCsvFormula('-1500+cmd')).toBe("'-1500+cmd");
    });
  });

  it('leaves an ordinary value alone', () => {
    expect(neutralizeCsvFormula('Rahim Uddin')).toBe('Rahim Uddin');
    expect(neutralizeCsvFormula('TRX-8891')).toBe('TRX-8891');
  });

  it('maps null and undefined to an empty cell', () => {
    expect(neutralizeCsvFormula(null)).toBe('');
    expect(neutralizeCsvFormula(undefined)).toBe('');
  });
});

describe('escapeCsvCell', () => {
  it('quoting alone would not have been enough — the prefix is inside the quotes', () => {
    // A spreadsheet strips the quotes and evaluates what is left, so the
    // leading character is the only thing that stops execution.
    expect(escapeCsvCell('=1+1,2')).toBe('"\'=1+1,2"');
  });

  it.each([
    ['plain', 'plain'],
    ['has,comma', '"has,comma"'],
    ['has"quote', '"has""quote"'],
    ['has\nnewline', '"has\nnewline"'],
    ['has\r\ncrlf', '"has\r\ncrlf"'],
  ])('RFC 4180: %j', (input, expected) => {
    expect(escapeCsvCell(input)).toBe(expected);
  });

  it('does not double-prefix a value already led by an apostrophe', () => {
    // `'` is not a formula lead — the cell is already inert.
    expect(escapeCsvCell("'=1+1")).toBe("'=1+1");
  });

  it('keeps a negative amount usable as a number', () => {
    expect(escapeCsvCell(-1500)).toBe('-1500');
  });
});
