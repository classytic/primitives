import { describe, expect, it } from 'vitest';
import { DEFAULT_TENANT_CONFIG, resolveTenantConfig } from '../../src/tenant.js';

describe('resolveTenantConfig', () => {
  it('returns defaults when undefined', () => {
    expect(resolveTenantConfig()).toEqual(DEFAULT_TENANT_CONFIG);
  });

  it('returns defaults when true', () => {
    expect(resolveTenantConfig(true)).toEqual(DEFAULT_TENANT_CONFIG);
  });

  it('disables cleanly when false', () => {
    const cfg = resolveTenantConfig(false);
    expect(cfg.strategy).toBe('none');
    expect(cfg.enabled).toBe(false);
    expect(cfg.required).toBe(false);
    // Other defaults retained so packages can still inspect field names
    expect(cfg.tenantField).toBe('organizationId');
    expect(cfg.fieldType).toBe('objectId');
    expect(cfg.ref).toBe('organization');
    expect(cfg.contextKey).toBe('organizationId');
  });

  it('merges partial override onto defaults', () => {
    const cfg = resolveTenantConfig({ tenantField: 'tenantId', fieldType: 'string' });
    expect(cfg).toEqual({
      strategy: 'field',
      enabled: true,
      tenantField: 'tenantId',
      fieldType: 'string',
      ref: 'organization',
      contextKey: 'organizationId',
      required: true,
    });
  });

  it('allows every field to be overridden', () => {
    const cfg = resolveTenantConfig({
      enabled: true,
      tenantField: 'workspaceId',
      fieldType: 'string',
      ref: 'workspace',
      contextKey: 'workspaceId',
      required: false,
    });
    expect(cfg).toEqual({
      strategy: 'field',
      enabled: true,
      tenantField: 'workspaceId',
      fieldType: 'string',
      ref: 'workspace',
      contextKey: 'workspaceId',
      required: false,
    });
  });
});

describe('resolveTenantConfig — strategy', () => {
  it('defaults to field strategy when unspecified', () => {
    expect(resolveTenantConfig()).toMatchObject({ strategy: 'field' });
    expect(resolveTenantConfig(true)).toMatchObject({ strategy: 'field' });
    expect(resolveTenantConfig({ tenantField: 'branchId' })).toMatchObject({
      strategy: 'field',
    });
  });

  it('accepts explicit strategy: "none" (same as false)', () => {
    const cfg = resolveTenantConfig({ strategy: 'none' });
    expect(cfg.strategy).toBe('none');
    expect(cfg.enabled).toBe(false);
    expect(cfg.required).toBe(false);
  });

  it('maps legacy enabled: false to strategy: "none"', () => {
    const cfg = resolveTenantConfig({ enabled: false });
    expect(cfg.strategy).toBe('none');
    expect(cfg.enabled).toBe(false);
  });

  it('accepts custom strategy with resolve function', () => {
    const resolve = (ctx: Record<string, unknown>) => ({
      organizationId: ctx.organizationId,
      region: ctx.region,
    });
    const cfg = resolveTenantConfig({ strategy: 'custom', resolve });
    expect(cfg.strategy).toBe('custom');
    expect(cfg.enabled).toBe(true);
    expect(cfg.resolve).toBe(resolve);
  });

  it("throws when strategy is 'custom' without a resolve function", () => {
    expect(() => resolveTenantConfig({ strategy: 'custom' })).toThrow(
      /strategy 'custom' requires a 'resolve' function/,
    );
  });

  it('custom resolver receives context and returns the filter shape', () => {
    const cfg = resolveTenantConfig({
      strategy: 'custom',
      resolve: (ctx) => ({ 'context.tenantId': ctx.tenantId }),
    });
    expect(cfg.resolve?.({ tenantId: 'org_123' })).toEqual({
      'context.tenantId': 'org_123',
    });
  });
});

describe('DEFAULT_TENANT_CONFIG', () => {
  it('matches AGENTS.md convention (objectId, organization, scope required)', () => {
    expect(DEFAULT_TENANT_CONFIG).toEqual({
      strategy: 'field',
      enabled: true,
      tenantField: 'organizationId',
      fieldType: 'objectId',
      ref: 'organization',
      contextKey: 'organizationId',
      required: true,
    });
  });
});
