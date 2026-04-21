/**
 * Tenant / scope configuration primitives.
 *
 * Every multi-tenant-capable package accepts a config block shaped like
 * {@link TenantConfig}. It controls how the package stores and casts the
 * tenant identifier on its models, and which key on
 * `OperationContext` to read the tenant value from.
 *
 * Field names match `@classytic/mongokit`'s `MultiTenantOptions` so the
 * resolved config can be forwarded straight into `multiTenantPlugin(...)`.
 *
 * Three strategies are supported:
 * - `'field'` (default) — filter every query by a scalar field on documents.
 *   The common case; used by `multiTenantPlugin`.
 * - `'none'` — disable scoping entirely (single-tenant app). Equivalent to
 *   `enabled: false`; `strategy: 'none'` is the explicit form.
 * - `'custom'` — caller supplies a `resolve(ctx)` function that returns the
 *   filter shape to inject. Covers multi-field composite tenants, context-
 *   derived filters (region + partner id), or non-scalar scope keys.
 *
 * See PACKAGE_RULES.md §9 for the full pattern.
 */

/**
 * Mongo storage type for the tenant identifier.
 *
 * - `'objectId'` (recommended for new packages) — `Schema.Types.ObjectId` with
 *   `ref`. Enables `$lookup`, `.populate()`, QueryParser `?lookup=...`.
 * - `'string'` — plain string. Use when the host auth system issues UUIDs or
 *   slugs rather than ObjectIds.
 */
export type TenantFieldType = 'objectId' | 'string';

/** Scope resolution strategy. */
export type TenantStrategy = 'field' | 'none' | 'custom';

export interface TenantConfig {
  /**
   * Scope strategy. Omit for the common `'field'` case — explicit `'none'`
   * / `'custom'` lets packages collapse what used to live in a separate
   * `ScopeConfig` type.
   *
   * @default 'field'
   */
  strategy?: TenantStrategy;

  /**
   * Whether tenant scoping is active. When `false`, the package runs in
   * single-tenant mode — no filter injection, no tenant field on documents.
   * Equivalent to `strategy: 'none'`.
   *
   * @default true
   */
  enabled?: boolean;

  /**
   * Document field name that stores the tenant id. Matches mongokit's
   * `MultiTenantOptions.tenantField`. Used when `strategy === 'field'`.
   *
   * @default 'organizationId'
   */
  tenantField?: string;

  /**
   * How to store / cast the tenant id. Matches mongokit's `fieldType`.
   *
   * @default 'objectId'
   */
  fieldType?: TenantFieldType;

  /**
   * Mongoose ref for `'objectId'` types. Ignored when `fieldType === 'string'`.
   *
   * @default 'organization'
   */
  ref?: string;

  /**
   * Which key on `OperationContext` to read the tenant id from.
   *
   * @default 'organizationId'
   */
  contextKey?: string;

  /**
   * Whether the field is required. When `false`, the package permits
   * unscoped / cross-tenant reads (typically only for admin paths).
   *
   * @default true
   */
  required?: boolean;

  /**
   * Custom resolver — called when `strategy === 'custom'` to produce the
   * filter object injected into queries. Packages pass the request context;
   * the resolver returns the filter shape.
   *
   * Example:
   * ```ts
   * {
   *   strategy: 'custom',
   *   resolve: (ctx) => ({
   *     organizationId: ctx.organizationId,
   *     region: ctx.region,
   *   }),
   * }
   * ```
   */
  resolve?: (ctx: Record<string, unknown>) => Record<string, unknown>;
}

/** Sensible defaults for a freshly-built package (field strategy). */
export const DEFAULT_TENANT_CONFIG: Required<
  Pick<
    TenantConfig,
    'strategy' | 'enabled' | 'tenantField' | 'fieldType' | 'ref' | 'contextKey' | 'required'
  >
> = {
  strategy: 'field',
  enabled: true,
  tenantField: 'organizationId',
  fieldType: 'objectId',
  ref: 'organization',
  contextKey: 'organizationId',
  required: true,
};

/**
 * Resolved shape returned by {@link resolveTenantConfig}. Always includes the
 * field defaults (so packages can inspect field names even when `enabled:
 * false`) and threads `resolve` when `strategy === 'custom'`.
 */
export type ResolvedTenantConfig = typeof DEFAULT_TENANT_CONFIG & {
  resolve?: TenantConfig['resolve'];
};

/**
 * Resolve a possibly-partial {@link TenantConfig} against the defaults.
 *
 * - `false` → `enabled: false`, `strategy: 'none'`.
 * - `true` / `undefined` → default field strategy.
 * - Object with `strategy: 'custom'` → `resolve` is required; throws otherwise.
 * - Object with `strategy: 'none'` → `enabled: false`.
 */
export function resolveTenantConfig(config?: TenantConfig | boolean): ResolvedTenantConfig {
  if (config === false) {
    return { ...DEFAULT_TENANT_CONFIG, strategy: 'none', enabled: false, required: false };
  }
  if (config === true || config === undefined) {
    return { ...DEFAULT_TENANT_CONFIG };
  }

  const strategy: TenantStrategy = config.strategy ?? (config.enabled === false ? 'none' : 'field');

  if (strategy === 'none') {
    // Preserve user-supplied `tenantField`, `fieldType`, `ref`, `contextKey`
    // — even when scoping is disabled, the doc field still needs to be
    // typed correctly (e.g. a host that stores string orgIds but opts out
    // of plugin-level enforcement).
    return {
      ...DEFAULT_TENANT_CONFIG,
      ...config,
      strategy: 'none',
      enabled: false,
      required: false,
    };
  }

  if (strategy === 'custom') {
    if (typeof config.resolve !== 'function') {
      throw new Error("[primitives] TenantConfig.strategy 'custom' requires a 'resolve' function");
    }
    return {
      ...DEFAULT_TENANT_CONFIG,
      ...config,
      strategy: 'custom',
      enabled: config.enabled ?? true,
      resolve: config.resolve,
    };
  }

  return {
    ...DEFAULT_TENANT_CONFIG,
    ...config,
    strategy: 'field',
    enabled: config.enabled ?? true,
  };
}
