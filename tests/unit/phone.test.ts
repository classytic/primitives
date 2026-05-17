import { describe, expect, it } from 'vitest';
import {
  formatNational,
  formatPhone,
  isPhoneNumber,
  parsePhone,
  PhoneError,
} from '../../src/identity/phone.js';

describe('parsePhone', () => {
  it('parses a clean E.164 number', () => {
    const r = parsePhone('+14155550182');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.e164).toBe('+14155550182');
      expect(r.value.callingCode).toBe('1');
      expect(r.value.nationalNumber).toBe('4155550182');
    }
  });

  it('strips spaces, parentheses, and dashes', () => {
    const r = parsePhone('+1 (415) 555-0182');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.e164).toBe('+14155550182');
  });

  it('strips dots and other punctuation', () => {
    const r = parsePhone('+1.415.555.0182');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.e164).toBe('+14155550182');
  });

  it('identifies 2-digit country codes (UK)', () => {
    const r = parsePhone('+442079460000');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.callingCode).toBe('44');
      expect(r.value.nationalNumber).toBe('2079460000');
    }
  });

  it('identifies 3-digit country codes (Bangladesh)', () => {
    const r = parsePhone('+8801711123456');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.callingCode).toBe('880');
      expect(r.value.nationalNumber).toBe('1711123456');
    }
  });

  it('rejects empty input with EMPTY error', () => {
    const r = parsePhone('   ');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBeInstanceOf(PhoneError);
      expect(r.error.code).toBe('EMPTY');
    }
  });

  it('rejects missing leading + with MISSING_PLUS', () => {
    const r = parsePhone('14155550182');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('MISSING_PLUS');
  });

  it('rejects exceeding the E.164 15-digit limit', () => {
    const r = parsePhone('+1234567890123456');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('TOO_LONG');
  });

  it('rejects too-short numbers', () => {
    const r = parsePhone('+11234');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('TOO_SHORT');
  });

  it('rejects unknown country calling codes', () => {
    // 999 is not assigned by ITU-T E.164.
    const r = parsePhone('+9991234567');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('NOT_E164');
  });
});

describe('formatPhone / formatNational', () => {
  it('formatPhone returns canonical E.164', () => {
    const r = parsePhone('+1 (415) 555-0182');
    if (!r.ok) throw new Error('parse failed');
    expect(formatPhone(r.value)).toBe('+14155550182');
  });

  it('formatNational groups the national number in 3-digit blocks', () => {
    const r = parsePhone('+14155550182');
    if (!r.ok) throw new Error('parse failed');
    expect(formatNational(r.value)).toBe('+1 415 555 018 2');
  });
});

describe('isPhoneNumber', () => {
  it('returns true for a well-formed PhoneNumber', () => {
    const r = parsePhone('+14155550182');
    if (!r.ok) throw new Error('parse failed');
    expect(isPhoneNumber(r.value)).toBe(true);
  });

  it('returns false for a plain string', () => {
    expect(isPhoneNumber('+14155550182')).toBe(false);
  });

  it('returns false for objects missing the leading +', () => {
    expect(
      isPhoneNumber({ e164: '14155550182', callingCode: '1', nationalNumber: '4155550182' }),
    ).toBe(false);
  });

  it('returns false for null / undefined', () => {
    expect(isPhoneNumber(null)).toBe(false);
    expect(isPhoneNumber(undefined)).toBe(false);
  });
});
