import { describe, expect, it } from 'vitest';
import { err, isErr, isOk, mapError, mapResult, ok, unwrap } from '../../src/composition/result.js';

describe('ok / err constructors', () => {
  it('builds a success variant', () => {
    expect(ok(42)).toEqual({ ok: true, value: 42 });
  });

  it('builds an error variant', () => {
    const e = new Error('fail');
    expect(err(e)).toEqual({ ok: false, error: e });
  });
});

describe('isOk / isErr type guards', () => {
  it('narrows ok correctly', () => {
    const r = ok('hello');
    expect(isOk(r)).toBe(true);
    expect(isErr(r)).toBe(false);
    if (isOk(r)) {
      expect(r.value).toBe('hello');
    }
  });

  it('narrows err correctly', () => {
    const r = err(new Error('boom'));
    expect(isErr(r)).toBe(true);
    expect(isOk(r)).toBe(false);
    if (isErr(r)) {
      expect(r.error.message).toBe('boom');
    }
  });
});

describe('mapResult', () => {
  it('transforms success values', () => {
    expect(mapResult(ok(2), (n) => n * 3)).toEqual({ ok: true, value: 6 });
  });

  it('passes errors through untouched', () => {
    const e = new Error('nope');
    const r = mapResult(err<Error>(e), (n: number) => n * 3);
    expect(r).toEqual({ ok: false, error: e });
  });
});

describe('mapError', () => {
  it('transforms error values', () => {
    const r = mapError(err('raw'), (s) => new Error(s));
    expect(isErr(r)).toBe(true);
    if (isErr(r)) expect(r.error).toBeInstanceOf(Error);
  });

  it('passes values through untouched', () => {
    expect(mapError(ok<number>(5), (e: string) => new Error(e))).toEqual({
      ok: true,
      value: 5,
    });
  });
});

describe('unwrap', () => {
  it('returns value on ok', () => {
    expect(unwrap(ok(7))).toBe(7);
  });

  it('throws the error on err', () => {
    const e = new Error('unwrap-boom');
    expect(() => unwrap(err(e))).toThrow(e);
  });
});
