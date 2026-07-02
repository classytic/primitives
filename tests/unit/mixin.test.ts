import { describe, expect, it } from 'vitest';
import {
  getMixin,
  hasMixin,
  type Mixinable,
  withMixin,
  withoutMixin,
} from '../../src/composition/mixin.js';

interface Contact extends Mixinable {
  id: string;
  name: string;
}

interface CustomerFacts {
  lifetimeValue: number;
  firstOrderAt: Date;
}

interface LeadFit {
  score: number;
  icp: 'core' | 'edge';
}

describe('withMixin', () => {
  it('attaches a mixin payload on a fresh entity', () => {
    const base: Contact = { id: 'c1', name: 'Acme' };
    const enriched = withMixin<Contact, 'customer', CustomerFacts>(base, 'customer', {
      lifetimeValue: 9200,
      firstOrderAt: new Date('2024-09-12'),
    });
    expect(enriched.mixins.customer.lifetimeValue).toBe(9200);
    expect(enriched.id).toBe('c1');
  });

  it('does not mutate the base entity', () => {
    const base: Contact = { id: 'c1', name: 'Acme' };
    withMixin(base, 'customer', { lifetimeValue: 9200, firstOrderAt: new Date() });
    expect(base.mixins).toBeUndefined();
  });

  it('preserves prior mixins on the same entity', () => {
    const base: Contact = { id: 'c1', name: 'Acme' };
    const step1 = withMixin<Contact, 'customer', CustomerFacts>(base, 'customer', {
      lifetimeValue: 100,
      firstOrderAt: new Date('2024-01-01'),
    });
    const step2 = withMixin<typeof step1, 'leadFit', LeadFit>(step1, 'leadFit', {
      score: 88,
      icp: 'core',
    });
    expect(step2.mixins.customer.lifetimeValue).toBe(100);
    expect(step2.mixins.leadFit.score).toBe(88);
  });

  it('overwrites an existing mixin payload at the same key', () => {
    const base: Contact = { id: 'c1', name: 'Acme' };
    const step1 = withMixin<Contact, 'leadFit', LeadFit>(base, 'leadFit', {
      score: 50,
      icp: 'edge',
    });
    const step2 = withMixin<typeof step1, 'leadFit', LeadFit>(step1, 'leadFit', {
      score: 88,
      icp: 'core',
    });
    expect(step2.mixins.leadFit.score).toBe(88);
    expect(step2.mixins.leadFit.icp).toBe('core');
  });
});

describe('getMixin / hasMixin', () => {
  it('getMixin returns the payload when present', () => {
    const base: Contact = { id: 'c1', name: 'Acme' };
    const enriched = withMixin<Contact, 'customer', CustomerFacts>(base, 'customer', {
      lifetimeValue: 42,
      firstOrderAt: new Date('2024-01-01'),
    });
    expect(getMixin<CustomerFacts>(enriched, 'customer')?.lifetimeValue).toBe(42);
  });

  it('getMixin returns null when absent (not undefined)', () => {
    const base: Contact = { id: 'c1', name: 'Acme' };
    expect(getMixin(base, 'customer')).toBeNull();
  });

  it('getMixin returns null when the entity has no `mixins` field at all', () => {
    const bare = { id: 'c1', name: 'Acme' } as Contact;
    expect(getMixin(bare, 'customer')).toBeNull();
  });

  it('hasMixin tracks presence', () => {
    const base: Contact = { id: 'c1', name: 'Acme' };
    expect(hasMixin(base, 'customer')).toBe(false);
    const enriched = withMixin<Contact, 'customer', CustomerFacts>(base, 'customer', {
      lifetimeValue: 1,
      firstOrderAt: new Date(),
    });
    expect(hasMixin(enriched, 'customer')).toBe(true);
  });
});

describe('withoutMixin', () => {
  it('removes a mixin and leaves others intact', () => {
    const base: Contact = { id: 'c1', name: 'Acme' };
    let enriched: Contact = withMixin<Contact, 'customer', CustomerFacts>(base, 'customer', {
      lifetimeValue: 1,
      firstOrderAt: new Date(),
    });
    enriched = withMixin<typeof enriched, 'leadFit', LeadFit>(enriched, 'leadFit', {
      score: 50,
      icp: 'edge',
    });

    const stripped = withoutMixin(enriched, 'customer');
    expect(hasMixin(stripped, 'customer')).toBe(false);
    expect(hasMixin(stripped, 'leadFit')).toBe(true);
  });

  it('is a no-op when the mixin is absent', () => {
    const base: Contact = { id: 'c1', name: 'Acme' };
    const result = withoutMixin(base, 'customer');
    expect(result).toBe(base); // returns the same reference — no allocation
  });
});
