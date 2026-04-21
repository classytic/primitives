/**
 * Type utilities for building nominal types and transforming shapes.
 *
 * These have zero runtime cost — all erase at compile time.
 */

declare const __brand: unique symbol;

/**
 * Nominal typing via an intersection brand.
 *
 * @example
 * type UserId = Brand<string, 'UserId'>;
 * type OrderId = Brand<string, 'OrderId'>;
 * const u: UserId = 'abc' as UserId;
 * const o: OrderId = u; // type error — brands differ
 */
export type Brand<T, B extends string> = T & { readonly [__brand]: B };

/** Flattens intersection types for nicer IDE hover output. */
export type Prettify<T> = { [K in keyof T]: T[K] } & {};

/** Recursive partial — every leaf becomes optional. */
export type DeepPartial<T> = T extends (...args: readonly unknown[]) => unknown
  ? T
  : T extends ReadonlyArray<infer U>
    ? ReadonlyArray<DeepPartial<U>>
    : T extends object
      ? { [K in keyof T]?: DeepPartial<T[K]> }
      : T;

/** Recursive readonly — every leaf becomes immutable. */
export type DeepReadonly<T> = T extends (...args: readonly unknown[]) => unknown
  ? T
  : T extends ReadonlyArray<infer U>
    ? ReadonlyArray<DeepReadonly<U>>
    : T extends object
      ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
      : T;

/** Make specific keys required while leaving the rest as-is. */
export type RequireKeys<T, K extends keyof T> = T & { [P in K]-?: T[P] };

/** Make specific keys optional while leaving the rest as-is. */
export type OptionalKeys<T, K extends keyof T> = Omit<T, K> & {
  [P in K]?: T[P];
};

/** A value that may be absent in three flavours — `T | null | undefined`. */
export type Nullable<T> = T | null | undefined;

/** Keys of T whose value type is assignable to V. */
export type KeysMatching<T, V> = {
  [K in keyof T]-?: T[K] extends V ? K : never;
}[keyof T];

/** Non-empty array guard type. */
export type NonEmptyArray<T> = readonly [T, ...T[]];
