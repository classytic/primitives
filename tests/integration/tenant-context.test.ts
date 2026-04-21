/**
 * Scenario — tenant config + operation context compose into a filter-injection
 * step, which is how every `@classytic/*` package threads branch scoping
 * through its queries.
 *
 * Models a fake repository call: given an OperationContext and a resolved
 * TenantConfig, build the Mongo filter the package would use and assert it
 * has the expected shape under various configurations.
 */

import { describe, expect, it } from 'vitest';
import type { OperationContext } from '../../src/context.js';
import type { TenantConfig } from '../../src/tenant.js';
import { resolveTenantConfig } from '../../src/tenant.js';
import { makeOperationContext, makeTenantConfig } from '../helpers/fixtures.js';

function injectTenantFilter(
  filter: Record<string, unknown>,
  config: TenantConfig | boolean | undefined,
  ctx: OperationContext,
): Record<string, unknown> {
  const resolved = resolveTenantConfig(config);
  if (!resolved.enabled) return filter;

  const key = resolved.contextKey as keyof OperationContext;
  const tenantValue = ctx[key];

  if (!tenantValue) {
    if (resolved.required) {
      throw new Error(`Tenant scoping enabled but ${key} missing on context`);
    }
    return filter;
  }
  return { ...filter, [resolved.tenantField]: tenantValue };
}

describe('tenant config + operation context injection', () => {
  it('scopes by organizationId under defaults', () => {
    const result = injectTenantFilter({ status: 'active' }, undefined, makeOperationContext());
    expect(result).toEqual({ status: 'active', organizationId: 'org_1' });
  });

  it('skips injection when tenant is disabled', () => {
    const result = injectTenantFilter({ status: 'active' }, false, makeOperationContext());
    expect(result).toEqual({ status: 'active' });
  });

  it('uses custom tenantField + contextKey', () => {
    const result = injectTenantFilter(
      {},
      makeTenantConfig({ tenantField: 'workspaceId', contextKey: 'workspaceId' }),
      { ...makeOperationContext(), workspaceId: 'ws_7' } as OperationContext & {
        workspaceId: string;
      },
    );
    expect(result).toEqual({ workspaceId: 'ws_7' });
  });

  it('throws when required tenant value is missing from context', () => {
    const ctx = { actorId: 'user_1' } as OperationContext;
    expect(() => injectTenantFilter({}, undefined, ctx)).toThrow(/organizationId missing/);
  });

  it('allows unscoped queries when required=false and context lacks tenant', () => {
    const ctx = { actorId: 'user_1' } as OperationContext;
    const result = injectTenantFilter({ status: 'active' }, { required: false }, ctx);
    expect(result).toEqual({ status: 'active' });
  });

  it('real-world shape matches what a mongokit repository would see', () => {
    const ctx = makeOperationContext({ organizationId: 'bdg_dhaka' });
    const filter = injectTenantFilter({ customerId: 'cust_7' }, undefined, ctx);
    // This is exactly what Repository.getAll({ filters: filter }) would pass
    // to Mongoose after the multiTenantPlugin fires.
    expect(filter).toEqual({
      customerId: 'cust_7',
      organizationId: 'bdg_dhaka',
    });
  });
});
