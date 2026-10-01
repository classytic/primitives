import { describe, expect, it } from 'vitest';
import { InvalidEnvError, readEnv } from '../../../src/composition/environment.js';

describe('readEnv — a set value must mean something', () => {
  const env = readEnv({
    ON: 'true',
    ONE: '1',
    OFF: ' FALSE ',
    NO: 'no',
    TYPO: 'ture',
    N: '42',
    BAD_N: '4x',
    BLANK: '  ',
    MODE: 'on_receive',
    LIST: 'a, b,,c',
  });

  it('unset or blank → the fallback', () => {
    expect(env.bool('MISSING', true)).toBe(true);
    expect(env.bool('BLANK', false)).toBe(false);
    expect(env.int('MISSING', 7)).toBe(7);
    expect(env.oneOf('MISSING', ['off', 'on'], 'off')).toBe('off');
    expect(env.list('MISSING')).toEqual([]);
  });

  it('reads recognised values, trimmed and case-insensitive for booleans', () => {
    expect(env.bool('ON', false)).toBe(true);
    expect(env.bool('ONE', false)).toBe(true);
    expect(env.bool('OFF', true)).toBe(false);
    expect(env.bool('NO', true)).toBe(false);
    expect(env.int('N', 0)).toBe(42);
    expect(env.oneOf('MODE', ['off', 'on_receive'], 'off')).toBe('on_receive');
    expect(env.list('LIST')).toEqual(['a', 'b', 'c']);
  });

  it('a typo THROWS, naming the variable — it never reads as the default', () => {
    expect(() => env.bool('TYPO', false)).toThrow(InvalidEnvError);
    expect(() => env.bool('TYPO', false)).toThrow(/TYPO="ture"/);
    expect(() => env.int('BAD_N', 0)).toThrow(/integer/);
    expect(() => env.oneOf('TYPO', ['off', 'on'], 'off')).toThrow(/off \| on/);
  });

  it('enforces bounds, reads decimals, and an optional setting stays undefined', () => {
    expect(() => env.int('N', 0, { max: 10 })).toThrow(InvalidEnvError);
    expect(readEnv({ R: '0.02' }).number('R', 0)).toBe(0.02);
    expect(() => readEnv({ R: '2%' }).number('R', 0)).toThrow(/R="2%"/);
    expect(env.int('MISSING', undefined)).toBeUndefined();
  });
});
