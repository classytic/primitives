import { describe, expect, it } from 'vitest';
import { asciiDigits, cleanIdentifier, stripInvisible } from '../../src/identity/identifier.js';

describe('asciiDigits', () => {
  it('maps Arabic-Indic and Persian digits', () => {
    expect(asciiDigits('٠١٢٣٤٥٦٧٨٩')).toBe('0123456789');
    expect(asciiDigits('۰۱۲۳۴۵۶۷۸۹')).toBe('0123456789');
  });

  it('maps every Unicode decimal digit system, not just Arabic', () => {
    expect(asciiDigits('০৯')).toBe('09'); // Bengali
    expect(asciiDigits('०९')).toBe('09'); // Devanagari
    expect(asciiDigits('๐๙')).toBe('09'); // Thai
    expect(asciiDigits('０９')).toBe('09'); // fullwidth
    // Mathematical digits: five adjacent runs of ten (U+1D7CE..U+1D7FF).
    expect(asciiDigits('\u{1D7CE}\u{1D7D7}')).toBe('09');
    expect(asciiDigits('\u{1D7D8}\u{1D7E1}')).toBe('09');
    expect(asciiDigits('\u{1D7F6}\u{1D7FF}')).toBe('09');
  });

  it('leaves ASCII digits, letters and punctuation alone', () => {
    expect(asciiDigits('AB-12/x')).toBe('AB-12/x');
    expect(asciiDigits('e٢٠٠')).toBe('e200');
    expect(asciiDigits('مرحبا')).toBe('مرحبا');
    expect(asciiDigits('')).toBe('');
  });

  it('does not fold non-decimal numerals (superscripts, Roman numerals)', () => {
    expect(asciiDigits('²Ⅻ')).toBe('²Ⅻ');
  });
});

describe('stripInvisible', () => {
  it('removes the zero-width and bidi controls Arabic spreadsheets carry', () => {
    const marks = [
      0x200b, 0x200c, 0x200d, 0x200e, 0x200f, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066,
      0x2067, 0x2068, 0x2069, 0xfeff,
    ];
    for (const cp of marks) expect(stripInvisible(`A${String.fromCodePoint(cp)}1`)).toBe('A1');
  });

  it('also removes the Arabic letter mark, word joiner and soft hyphen', () => {
    expect(stripInvisible('E\u061C3\u20600\u00AD0')).toBe('E300');
  });

  it('keeps letters, spaces and Arabic text', () => {
    expect(stripInvisible('Ali Khan علي')).toBe('Ali Khan علي');
  });
});

describe('cleanIdentifier', () => {
  it('strips marks, folds digits and trims', () => {
    expect(cleanIdentifier('\u200F ١٢٣٤ \uFEFF')).toBe('1234');
    expect(cleanIdentifier('\u202Bfl-12\u202C ')).toBe('fl-12');
    expect(cleanIdentifier('\u00A0E300\u00A0')).toBe('E300');
    expect(cleanIdentifier('')).toBe('');
  });

  it('folds fullwidth letters and digits (NFKC)', () => {
    expect(cleanIdentifier('ＡＢ１２')).toBe('AB12');
  });

  it('keeps case and inner whitespace (domain wrappers decide those)', () => {
    expect(cleanIdentifier(' Ab 12 ')).toBe('Ab 12');
  });

  it('matches the FLOW app wrappers built on it', () => {
    const staff = (v: string) => cleanIdentifier(v).toUpperCase();
    const nationalId = (v: string) => cleanIdentifier(v).replace(/\s+/g, '');
    const email = (v: string) => cleanIdentifier(v).toLowerCase();
    expect(staff('e٢٠٠')).toBe('E200');
    expect(staff('E۳۰۰')).toBe('E300');
    expect(staff('E300\u200F')).toBe('E300');
    expect(staff('\u202Bfl-12\u202C ')).toBe('FL-12');
    expect(nationalId('١٢٣٤٥٦٧٨٩٠')).toBe('1234567890');
    expect(nationalId('12345 67890\u200F')).toBe('1234567890');
    expect(email('  Ali.Khan@Example.COM\u200F ')).toBe('ali.khan@example.com');
  });

  it('is idempotent', () => {
    const corpus = [
      '\u200F ١٢٣٤ \uFEFF',
      'ＡＢ１２',
      'e٢٠٠',
      ' x\u00AD y ',
      '\u{1D7D8}',
      'ﬁ-٣',
      'e\u200B\u0301',
      'e\u00AD\u0301',
      '\u1100\u200D\u1161',
      '',
    ];
    for (const v of corpus) expect(cleanIdentifier(cleanIdentifier(v))).toBe(cleanIdentifier(v));
  });

  it('composes across a stripped mark: one key per identifier', () => {
    expect(cleanIdentifier('e\u200B\u0301')).toBe('\u00E9');
    expect(cleanIdentifier('e\u00AD\u0301')).toBe(cleanIdentifier('\u00E9'));
  });

  it('throws TypeError on non-string input instead of coercing', () => {
    for (const fn of [cleanIdentifier, asciiDigits, stripInvisible]) {
      expect(() => fn(undefined as unknown as string)).toThrow(TypeError);
      expect(() => fn(123 as unknown as string)).toThrow(TypeError);
    }
  });
});
