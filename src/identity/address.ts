/**
 * Postal address.
 *
 * Kept deliberately generic — international postal formats vary too much to
 * enforce per-country rules in a shared type. Consumers can extend or narrow
 * as needed (e.g. a BD-specific schema might add `district`, `upazila`).
 *
 * That still holds, and the CAPTURE FORMAT section below does not weaken it. A
 * format constrains no type and adds no field: it is opt-in DATA describing how
 * a country asks for the fields declared here. The type stays generic precisely
 * so one canonical shape can be captured many ways.
 */
export interface Address {
  line1: string;
  line2?: string;
  city: string;
  /** State / province / region. Optional for countries without subdivisions. */
  state?: string;
  postalCode?: string;
  /** ISO 3166-1 alpha-2 country code (e.g. 'BD', 'US', 'GB'). */
  country: string;
}

export interface ContactAddress extends Address {
  name?: string;
  phone?: string;
  email?: string;
}

/** WGS84 geographic coordinates. */
export interface GeoPoint {
  latitude: number;
  longitude: number;
}

/** A GeoJSON-flavoured point — convenient when storing in Mongo `2dsphere` indexes. */
export interface GeoJsonPoint {
  type: 'Point';
  /** [longitude, latitude] — note the GeoJSON ordering. */
  coordinates: readonly [number, number];
}

export function toGeoJsonPoint(p: GeoPoint): GeoJsonPoint {
  return { type: 'Point', coordinates: [p.longitude, p.latitude] };
}

export function fromGeoJsonPoint(g: GeoJsonPoint): GeoPoint {
  const [longitude, latitude] = g.coordinates;
  return { longitude, latitude };
}


// ═══════════════════════════════════════════════════════════════════════════
// CAPTURE FORMAT — how the address above is COLLECTED, per country
// ═══════════════════════════════════════════════════════════════════════════

/**
 * How a country's postal address is CAPTURED — labels, order, requiredness, and
 * which fields come from a subdivision taxonomy rather than free text.
 *
 * ## Why this lives HERE, beside the value object
 *
 * Storage was already standardised: an address is `ContactAddress` above. What
 * varied — and varied by being hardcoded — is CAPTURE. The checkout form asked
 * for "Division", "District" and "Delivery Area" because the deployment is
 * Bangladeshi, so selling in a second country meant editing the form. That is
 * the defect `@classytic/ledger` already solved for charts of accounts: the
 * ENGINE was generic and the BINDING was not.
 *
 * This first went into a separate `@classytic/address` package. Wrong, for the
 * reason this codebase has just paid for twice: a description of a shape that
 * lives away from the shape DRIFTS from it. `Order`'s Mongoose schema said
 * `addressLine1` while the type it declared said `line1`, and nothing could see
 * the contradiction because they were in different files. Every `key` below is
 * a field of `ContactAddress`; putting them in the same file is what makes a
 * mismatch obvious instead of invisible.
 *
 * The COUNTRY PACKS do not live here — they are localizations, and they follow
 * the `ledger` / `ledger-bd` precedent: Bangladesh's is
 * `@classytic/bd-areas/address-format`, beside the taxonomy it selects from.
 * Nothing in this file knows what a division is.
 *
 * ## What a format does NOT do
 *
 * It does not introduce new stored fields. Every descriptor's `key` is a field
 * of `ContactAddress`, so a format is a VIEW over one canonical shape:
 * Bangladesh labels `state` "Division", Japan labels it "Prefecture", the United
 * States labels it "State". Same column, same value object, different word.
 *
 * A country that genuinely needs an extra datum (a thana, an upazila, a landmark)
 * puts it in `metadata` — primitives' own guidance — never in a new top-level
 * field, because that would make the stored shape country-dependent again.
 */

/** The `ContactAddress` fields a format may lay out. */
export type AddressFieldKey =
  | 'name'
  | 'phone'
  | 'email'
  | 'company'
  | 'line1'
  | 'line2'
  | 'city'
  | 'state'
  | 'postalCode'
  | 'country';

/**
 * How a field is entered.
 *
 * `subdivision` is the interesting one: the value is still a plain string on the
 * stored address, but it is CHOSEN from a taxonomy rather than typed. Bangladesh
 * picks a division then a district; India picks a state; the US picks a state.
 * The taxonomy itself is supplied by the host through `AddressTaxonomyPort` —
 * this package ships no place names, so it stays country-agnostic and small.
 */
export type AddressFieldInput = 'text' | 'tel' | 'email' | 'subdivision';

export interface AddressFieldSpec {
  /** The canonical `ContactAddress` field this captures. */
  key: AddressFieldKey;
  /** Label in the deployment's language. */
  label: string;
  input: AddressFieldInput;
  required?: boolean;
  /** Spans the full row in a two-column form. */
  wide?: boolean;
  placeholder?: string;
  /** Help text under the field. */
  hint?: string;
  /**
   * For `input: 'subdivision'` — the taxonomy level this field selects, resolved
   * through `AddressTaxonomyPort`. Opaque to this package: `'division'`,
   * `'district'`, `'area'`, `'state'`, `'prefecture'` are all just strings.
   */
  taxonomy?: string;
  /**
   * The field whose value narrows this one's options — Bangladesh's district
   * list depends on the chosen division. Must appear EARLIER in `fields`.
   */
  dependsOn?: string;
}

/**
 * A field a country needs that `ContactAddress` does not model.
 *
 * ## Why this exists rather than growing the value object
 *
 * Bangladesh's checkout captures a **Delivery Area** — the locality couriers
 * actually route and price on, finer than a district. It is required there and
 * meaningless in most countries.
 *
 * The two obvious answers are both wrong. Adding `areaName` to `ContactAddress`
 * puts one market's concept in the base type every country pays for; leaving it
 * out entirely means the country that most needs a format cannot express its
 * most important field, which is how the form ends up hardcoded again.
 *
 * So an extension field is DECLARED like any other — same labels, same
 * requiredness, same taxonomy machinery — but its `name` is free-form and the
 * consuming DOMAIN decides where the value lands. `@classytic/order` promotes
 * `areaId` / `areaName` / `zoneId` to real columns because its carrier adapters
 * read them; anything it does not recognise goes to `metadata`. Neither
 * decision belongs in this package, and neither requires a release of it.
 *
 * Values live FLAT alongside the canonical ones, not in a nested bag — which is
 * how `areaName` is already stored, and it means a form produces one object
 * rather than two that can disagree.
 */
export interface AddressExtensionFieldSpec {
  /** Discriminant. */
  extension: true;
  /**
   * Free-form key. Not validated against `ContactAddress` — that is the point.
   * The domain maps it to a column or to `metadata`.
   */
  name: string;
  label: string;
  input: AddressFieldInput;
  required?: boolean;
  wide?: boolean;
  placeholder?: string;
  hint?: string;
  taxonomy?: string;
  /** May name a canonical key OR another extension. Must appear EARLIER. */
  dependsOn?: string;
}

export type AnyAddressFieldSpec = AddressFieldSpec | AddressExtensionFieldSpec;

/** The key a spec writes to, canonical or extension. */
export function fieldName(spec: AnyAddressFieldSpec): string {
  return 'extension' in spec ? spec.name : spec.key;
}

/** Narrowing helper — `true` when the spec is an extension. */
export function isExtensionField(spec: AnyAddressFieldSpec): spec is AddressExtensionFieldSpec {
  return 'extension' in spec;
}

export interface AddressFormat {
  /** ISO 3166-1 alpha-2, or `'*'` for the international fallback. */
  country: string;
  /** Display name of the country, for a read-only country field. */
  countryLabel: string;
  /** Ordered — this is the form layout. Canonical and extension fields interleave. */
  fields: AnyAddressFieldSpec[];
  /**
   * Validate `postalCode` when present. Omit for countries where the code is
   * free-form or absent; a wrong pattern is worse than none, because it refuses
   * addresses that are perfectly valid.
   */
  postalCodePattern?: RegExp;
}

/**
 * A taxonomy level's options, narrowed by the parent selection.
 *
 * A HOST PORT, not data in this package: Bangladesh's divisions live in
 * `@classytic/bd-areas`, and a kernel that imported them would be a
 * country-agnostic package with one country's place names compiled into it.
 */
export interface AddressTaxonomyPort {
  /**
   * @param level    the `taxonomy` string from the field spec
   * @param parentId the selected value of `dependsOn`, when the field has one
   */
  options(level: string, parentId?: string): Array<{ id: string; label: string; hint?: string }>;
}

/**
 * The generic international format — the FALLBACK, and the proof the contract is
 * not BD-shaped.
 *
 * Deliberately conservative. `state` is present but optional because many
 * countries have no meaningful subdivision in a postal address (Singapore,
 * Vatican City), and `postalCode` is optional because several have no postal
 * code at all (Ireland pre-Eircode, Hong Kong, UAE). Requiring either would make
 * the DEFAULT refuse valid addresses — the failure mode a fallback must not have.
 *
 * The required set is exactly what `Fulfillment` needs to be deliverable:
 * `line1`, `city`, `country`.
 */
export const INTERNATIONAL_ADDRESS_FORMAT: AddressFormat = {
  country: '*',
  countryLabel: 'Country',
  fields: [
    { key: 'name', label: 'Recipient Name', input: 'text', required: true },
    { key: 'phone', label: 'Phone', input: 'tel', required: true },
    { key: 'line1', label: 'Address Line 1', input: 'text', required: true, wide: true },
    { key: 'line2', label: 'Address Line 2', input: 'text', wide: true },
    { key: 'city', label: 'City', input: 'text', required: true },
    { key: 'state', label: 'State / Province / Region', input: 'text' },
    { key: 'postalCode', label: 'Postal Code', input: 'text' },
    { key: 'country', label: 'Country', input: 'text', required: true },
  ],
};

/** Look a CANONICAL field up by its key. Extension fields have no `key`. */
export function fieldSpec(format: AddressFormat, key: AddressFieldKey): AddressFieldSpec | undefined {
  return format.fields.find((f) => !isExtensionField(f) && f.key === key) as
    | AddressFieldSpec
    | undefined;
}

/**
 * The CANONICAL keys a format marks required.
 *
 * Canonical only, deliberately: callers use this to check that a format can
 * produce a deliverable address (`line1` + `city` + `country`), and an extension
 * name has no meaning in that question. Use `requiredFieldNames` for everything
 * a form must collect.
 */
export function requiredKeys(format: AddressFormat): AddressFieldKey[] {
  return format.fields
    .filter((f): f is AddressFieldSpec => !isExtensionField(f) && !!f.required)
    .map((f) => f.key);
}

/** Every field name a format requires, canonical and extension alike. */
export function requiredFieldNames(format: AddressFormat): string[] {
  return format.fields.filter((f) => f.required).map(fieldName);
}

/**
 * A capture in progress.
 *
 * Extension values sit FLAT beside the canonical ones — `areaName` alongside
 * `city` — because that is how the order kernel already stores them, and a
 * nested bag would be a second place for the same address to disagree with
 * itself. The index signature is what lets a format declare a field this
 * package has never heard of.
 */
export type PartialAddress = Partial<Record<AddressFieldKey, string>> &
  Partial<Pick<ContactAddress, 'line1' | 'city' | 'country'>> & { [extension: string]: unknown };



/**
 * Country code → capture format. The host builds this, exactly as it builds the
 * ledger's `REGISTRY` (`be-prod/.../accounting/country-pack.ts`).
 */
export type AddressFormatRegistry = Readonly<Record<string, AddressFormat>>;

/**
 * Resolve the format for a country, falling back to the international one.
 *
 * ## Falling back is the point, not a concession
 *
 * A deployment that has not authored a pack for Norway must still be able to
 * ship to Norway. The fallback captures the deliverable minimum with neutral
 * labels, which is strictly better than either refusing the address or showing
 * a Bangladeshi form to a Norwegian.
 *
 * The lookup is case-insensitive because `country` reaches this from three
 * directions — a form, a stored order, an API payload — and ISO codes get
 * written `bd` about as often as `BD`. Normalising here beats a `?.toUpperCase()`
 * at every call site, one of which will be forgotten and will silently fall back
 * to international for its own home country.
 */
export function resolveAddressFormat(
  country: string | null | undefined,
  registry: AddressFormatRegistry,
): AddressFormat {
  if (!country) return INTERNATIONAL_ADDRESS_FORMAT;
  const code = country.trim().toUpperCase();
  return registry[code] ?? INTERNATIONAL_ADDRESS_FORMAT;
}

/**
 * The countries a deployment has packs for — for a country picker.
 *
 * A deployment that ships internationally should offer every ISO country and let
 * unlisted ones resolve to the fallback; this is for the common case of an
 * operator choosing among the markets actually configured.
 */
export function supportedCountries(registry: AddressFormatRegistry): Array<{ code: string; label: string }> {
  return Object.entries(registry)
    .map(([code, format]) => ({ code, label: format.countryLabel }))
    .sort((a, b) => a.label.localeCompare(b.label));
}



export interface AddressFieldError {
  /**
   * The field's write key — a canonical `AddressFieldKey` or an extension name.
   * Typed `string` because a format may declare fields this package does not
   * know; a form matches it against `fieldName(spec)`.
   */
  key: string;
  /** A closed code — callers map it to their own copy. */
  code: 'required' | 'postal_code_format';
  /** The field's own label, so a default message reads correctly per country. */
  label: string;
}

/**
 * Validate a captured address against its country's format.
 *
 * ## Returns errors; does not throw, and does not "clean"
 *
 * A form needs every failure at once to mark every field, so this returns a
 * list. It also never mutates or drops anything: a validator that silently
 * repaired input would make the stored value differ from what the operator
 * typed, and they would have no way to see it.
 *
 * ## Codes, not sentences
 *
 * `code` is closed and stable so a host can translate. `label` rides along
 * because the same `state` field is "Division" in Bangladesh and "Prefecture"
 * in Japan, and a default message assembled from the code alone would say the
 * wrong word in one of them.
 *
 * ## Whitespace is absence
 *
 * `'   '` satisfies a naive truthiness check and then prints as a blank line on
 * a courier label. Required means a value, not a character.
 */
export function validateAddress(
  address: PartialAddress | null | undefined,
  format: AddressFormat,
): AddressFieldError[] {
  const errors: AddressFieldError[] = [];
  const value = (k: string): string => String(address?.[k] ?? '').trim();

  /**
   * Canonical and extension fields are checked IDENTICALLY, keyed by
   * `fieldName`. A required Delivery Area is enforced exactly as a required
   * city is — an extension that validated more weakly than a core field would
   * be an optional field wearing a required label.
   */
  for (const field of format.fields) {
    const name = fieldName(field);
    if (field.required && !value(name)) {
      errors.push({ key: name, code: 'required', label: field.label });
    }
  }

  /**
   * Only when a pattern is declared AND a value was given. An absent optional
   * postal code is not a format error, and a country with no declared pattern
   * must not have one invented for it — see `AddressFormat.postalCodePattern`.
   */
  const postal = value('postalCode');
  if (format.postalCodePattern && postal && !format.postalCodePattern.test(postal)) {
    errors.push({
      key: 'postalCode',
      code: 'postal_code_format',
      label: fieldSpec(format, 'postalCode')?.label ?? 'Postal Code',
    });
  }

  return errors;
}

/** Convenience for a submit gate. */
export function isAddressValid(
  address: PartialAddress | null | undefined,
  format: AddressFormat,
): boolean {
  return validateAddress(address, format).length === 0;
}

/** A readable default message, in the country's own vocabulary. */
export function describeAddressError(error: AddressFieldError): string {
  switch (error.code) {
    case 'required':
      return `${error.label} is required`;
    case 'postal_code_format':
      return `${error.label} is not in the expected format`;
  }
}
