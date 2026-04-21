import { describe, expect, it } from 'vitest';
import { emptyKeysetPage, emptyOffsetPage } from '../../src/pagination.js';

describe('emptyOffsetPage', () => {
  it('defaults to limit 20', () => {
    const p = emptyOffsetPage();
    expect(p).toEqual({
      docs: [],
      total: 0,
      page: 1,
      limit: 20,
      pages: 0,
      hasNext: false,
      hasPrev: false,
    });
  });

  it('honours explicit limit', () => {
    expect(emptyOffsetPage(50).limit).toBe(50);
  });

  it('typed doc shape flows through', () => {
    const p = emptyOffsetPage<{ id: string }>();
    // @ts-expect-error docs are typed — pushing wrong shape is a compile error
    p.docs.push({ wrong: true });
  });
});

describe('emptyKeysetPage', () => {
  it('defaults to limit 20 with null cursors', () => {
    expect(emptyKeysetPage()).toEqual({
      docs: [],
      nextCursor: null,
      prevCursor: null,
      limit: 20,
    });
  });

  it('honours explicit limit', () => {
    expect(emptyKeysetPage(100).limit).toBe(100);
  });
});
