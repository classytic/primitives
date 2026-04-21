/**
 * Pagination and sorting primitives shared between repositories, HTTP
 * controllers, and SDKs. Shapes mirror `@classytic/mongokit`'s result types so
 * adapters can flow through without translation.
 */

export type SortDirection = 'asc' | 'desc' | 1 | -1;

/**
 * Sort specification — accepts any of:
 *  - `'field'` / `'-field'` (Mongoose-style prefix)
 *  - `['field1', '-field2']`
 *  - `{ field1: 1, field2: -1 }`
 */
export type SortSpec = string | ReadonlyArray<string> | Readonly<Record<string, SortDirection>>;

export interface PageParams {
  page?: number;
  limit?: number;
  sort?: SortSpec;
}

export interface KeysetParams {
  cursor?: string;
  limit?: number;
  sort?: SortSpec;
}

/**
 * Offset-paginated response. Mirrors `mongokit.OffsetPaginationResult<T>`.
 */
export interface OffsetPage<T> {
  docs: ReadonlyArray<T>;
  total: number;
  page: number;
  limit: number;
  pages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

/**
 * Cursor-paginated response. Mirrors `mongokit.KeysetPaginationResult<T>`.
 */
export interface KeysetPage<T> {
  docs: ReadonlyArray<T>;
  nextCursor: string | null;
  prevCursor: string | null;
  limit: number;
}

/** Aggregation-based pagination response. */
export interface AggregatePage<T> {
  docs: ReadonlyArray<T>;
  total: number;
  page: number;
  limit: number;
  pages: number;
}

export function emptyOffsetPage<T>(limit = 20): OffsetPage<T> {
  return {
    docs: [],
    total: 0,
    page: 1,
    limit,
    pages: 0,
    hasNext: false,
    hasPrev: false,
  };
}

export function emptyKeysetPage<T>(limit = 20): KeysetPage<T> {
  return { docs: [], nextCursor: null, prevCursor: null, limit };
}
