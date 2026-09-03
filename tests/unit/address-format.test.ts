/**
 * What this package must guarantee, and what it must NOT.
 *
 * The whole point is that a second country can be sold to without editing a
 * form. So the tests that matter are the ones that fail if the contract
 * quietly becomes Bangladesh-shaped again:
 *
 *   - a pack may not add a CANONICAL field. Inventing `thana` as a core key
 *     would make the shared value object country-dependent, which is the defect
 *     this contract exists to remove. Declaring it as an EXTENSION is the
 *     sanctioned route: the domain decides whether it earns a column or goes to
 *     `metadata`, and primitives never learns the word;
 *   - the international fallback must accept an address from a country with no
 *     subdivision and no postal code. A fallback that refuses valid addresses is
 *     worse than none;
 *   - an unknown country falls back rather than throwing or, worse, resolving to
 *     whichever pack happens to be first.
 */

import { describe, expect, it } from 'vitest';
import {
  INTERNATIONAL_ADDRESS_FORMAT,
  requiredKeys,
  fieldName,
  isExtensionField,
  resolveAddressFormat,
  supportedCountries,
  validateAddress,
  isAddressValid,
  describeAddressError,
  type AddressFieldKey,
  type AddressFormatRegistry,
  type Address,
} from '../../src/identity/address.js';
import { BD_ADDRESS_FORMAT } from '../../../bd-areas/src/address-format/index.js';

const REGISTRY: AddressFormatRegistry = { BD: BD_ADDRESS_FORMAT };

/** Exactly the keys `ContactAddress` (+ this package's allowed extras) stores. */
const STORABLE: AddressFieldKey[] = [
  'name',
  'phone',
  'email',
  'company',
  'line1',
  'line2',
  'city',
  'state',
  'postalCode',
  'country',
];

describe('every format is a VIEW over the canonical address', () => {
  for (const [label, format] of [
    ['international', INTERNATIONAL_ADDRESS_FORMAT],
    ['BD', BD_ADDRESS_FORMAT],
  ] as const) {
    it(`${label} uses only CANONICAL keys for its canonical fields`, () => {
      // An extension may be named anything — that is the point of it. A
      // canonical spec may not: a typo'd `key` would write to a field the
      // address does not have, and mongoose would strip it silently.
      for (const f of format.fields) {
        if (!isExtensionField(f)) expect(STORABLE).toContain(f.key);
      }
    });

    it(`${label} marks anything non-canonical as an EXTENSION, explicitly`, () => {
      // The discriminant is what stops a country-specific field from being
      // smuggled in as though the shared value object had it.
      for (const f of format.fields) {
        if (isExtensionField(f)) continue;
        expect(STORABLE).toContain(f.key);
      }
    });

    it(`${label} declares no duplicate field`, () => {
      const names = format.fields.map(fieldName);
      expect(new Set(names).size).toBe(names.length);
    });

    it(`${label} can produce a DELIVERABLE address (line1 + city + country required)`, () => {
      // The trio `Fulfillment` requires. A pack that forgot one would capture an
      // address the dispatch side then refuses, far from the form.
      for (const k of ['line1', 'city', 'country'] as const) {
        expect(requiredKeys(format)).toContain(k);
      }
    });

    it(`${label} orders dependent fields AFTER what they depend on`, () => {
      const seen: string[] = [];
      for (const f of format.fields) {
        if (f.dependsOn) expect(seen).toContain(f.dependsOn);
        seen.push(fieldName(f));
      }
    });

    it(`${label} gives every subdivision field a taxonomy to resolve against`, () => {
      // Without one the form has no way to ask the host port for options, and
      // the field would silently render as an empty picker.
      for (const f of format.fields) {
        if (f.input === 'subdivision') expect(f.taxonomy).toBeTruthy();
      }
    });
  }
});

describe('the international fallback does not assume a country like ours', () => {
  it('accepts an address with no subdivision and no postal code', () => {
    // Singapore, Hong Kong, UAE. Requiring either would make the DEFAULT refuse
    // perfectly valid addresses — the one thing a fallback must never do.
    expect(
      isAddressValid(
        { name: 'A Person', phone: '+65 0000 0000', line1: '1 Raffles Place', city: 'Singapore', country: 'SG' },
        INTERNATIONAL_ADDRESS_FORMAT,
      ),
    ).toBe(true);
  });

  it('declares no postal-code pattern', () => {
    // There is no pattern that fits every country; inventing one refuses valid
    // input in whichever countries it does not fit.
    expect(INTERNATIONAL_ADDRESS_FORMAT.postalCodePattern).toBeUndefined();
  });

  it('uses neutral vocabulary for the subdivision slot', () => {
    const state = INTERNATIONAL_ADDRESS_FORMAT.fields.find((f) => f.key === 'state');
    expect(state?.label).toMatch(/state|province|region/i);
    expect(state?.label).not.toMatch(/division|prefecture|county/i);
  });
});

describe('resolveAddressFormat', () => {
  it('finds a registered pack', () => {
    expect(resolveAddressFormat('BD', REGISTRY)).toBe(BD_ADDRESS_FORMAT);
  });

  it('is case-insensitive — ISO codes arrive written both ways', () => {
    expect(resolveAddressFormat('bd', REGISTRY)).toBe(BD_ADDRESS_FORMAT);
    expect(resolveAddressFormat(' Bd ', REGISTRY)).toBe(BD_ADDRESS_FORMAT);
  });

  it('falls back for an unregistered country rather than throwing', () => {
    // A deployment with no Norway pack must still be able to ship to Norway.
    expect(resolveAddressFormat('NO', REGISTRY)).toBe(INTERNATIONAL_ADDRESS_FORMAT);
  });

  it('falls back for a missing country instead of picking an arbitrary pack', () => {
    expect(resolveAddressFormat(undefined, REGISTRY)).toBe(INTERNATIONAL_ADDRESS_FORMAT);
    expect(resolveAddressFormat('', REGISTRY)).toBe(INTERNATIONAL_ADDRESS_FORMAT);
  });

  it('lists the configured markets', () => {
    expect(supportedCountries(REGISTRY)).toEqual([{ code: 'BD', label: 'Bangladesh' }]);
  });
});

describe('validateAddress', () => {
  const BD_OK = {
    // `areaName` is BD's required Delivery Area — an EXTENSION field.
    areaName: 'Uttara Sector - 13',
    name: 'Sadman Ahmed',
    phone: '01309000993',
    line1: 'Uttara, Sector 12',
    city: 'Dhaka',
    state: 'Dhaka',
    country: 'BD',
  };

  it('passes a complete BD address', () => {
    expect(validateAddress(BD_OK, BD_ADDRESS_FORMAT)).toEqual([]);
  });

  it('accepts the canonical Address value object directly', () => {
    const address: Address = {
      line1: '1 Raffles Place',
      city: 'Singapore',
      country: 'SG',
    };
    expect(validateAddress(address, INTERNATIONAL_ADDRESS_FORMAT)).toEqual([
      { key: 'name', code: 'required', label: 'Recipient Name' },
      { key: 'phone', code: 'required', label: 'Phone' },
    ]);
  });

  it('reports EVERY missing field, not just the first', () => {
    // A form marks all its invalid fields at once; returning one at a time
    // makes the customer submit repeatedly to discover them.
    const errors = validateAddress({ country: 'BD' }, BD_ADDRESS_FORMAT);
    expect(errors.map((e) => e.key).sort()).toEqual(['areaName', 'city', 'line1', 'name', 'phone', 'state']);
  });

  it('treats whitespace as absent', () => {
    // `'   '` passes a truthiness check and then prints as a blank line on a
    // courier label.
    const errors = validateAddress({ ...BD_OK, name: '   ' }, BD_ADDRESS_FORMAT);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.key).toBe('name');
  });

  it('uses the COUNTRY’s own label in the message', () => {
    const [err] = validateAddress({ ...BD_OK, state: '' }, BD_ADDRESS_FORMAT);
    // Not "State" — Bangladesh calls this slot a Division, and a message
    // assembled from the field key alone would say the wrong word.
    expect(describeAddressError(err!)).toBe('Division is required');
  });

  it('checks a postal code only when one is given', () => {
    // Optional in BD: couriers route on area, and most customers do not know
    // their postcode. Requiring it would refuse deliverable addresses.
    expect(validateAddress(BD_OK, BD_ADDRESS_FORMAT)).toEqual([]);
    expect(validateAddress({ ...BD_OK, postalCode: '1230' }, BD_ADDRESS_FORMAT)).toEqual([]);
    const bad = validateAddress({ ...BD_OK, postalCode: '12' }, BD_ADDRESS_FORMAT);
    expect(bad.map((e) => e.code)).toEqual(['postal_code_format']);
  });

  it('never checks a pattern the format did not declare', () => {
    expect(
      validateAddress(
        { name: 'A', phone: 'B', line1: 'C', city: 'D', country: 'IE', postalCode: 'anything at all' },
        INTERNATIONAL_ADDRESS_FORMAT,
      ),
    ).toEqual([]);
  });

  it('does not mutate the input', () => {
    const input = { ...BD_OK, name: '  Sadman  ' };
    const copy = { ...input };
    validateAddress(input, BD_ADDRESS_FORMAT);
    expect(input).toEqual(copy);
  });
});

describe('the BD pack is a localization, not a second contract', () => {
  it('labels the subdivision slot Division while still storing `state`', () => {
    const state = BD_ADDRESS_FORMAT.fields.find((f) => f.key === 'state');
    expect(state?.label).toBe('Division');
    expect(state?.key).toBe('state');
  });

  it('labels the city slot District and narrows it by division', () => {
    const city = BD_ADDRESS_FORMAT.fields.find((f) => f.key === 'city');
    expect(city?.label).toBe('District');
    expect(city?.dependsOn).toBe('state');
  });

  it('introduces no CANONICAL field of its own — only an extension', () => {
    // A pack that added a canonical key would be changing the shared value
    // object for every country. Adding an EXTENSION is the sanctioned way.
    const intl = new Set(INTERNATIONAL_ADDRESS_FORMAT.fields.map(fieldName));
    for (const f of BD_ADDRESS_FORMAT.fields) {
      if (isExtensionField(f)) continue;
      expect(intl.has(fieldName(f))).toBe(true);
    }
  });

  it('expresses Delivery Area as an EXTENSION, not a new canonical key', () => {
    const area = BD_ADDRESS_FORMAT.fields.find((f) => fieldName(f) === 'areaName');
    expect(area).toBeDefined();
    expect(isExtensionField(area!)).toBe(true);
    expect(area!.required).toBe(true);
    // It hangs off the district, so it cannot contradict it.
    expect(area!.dependsOn).toBe('city');
  });
});
