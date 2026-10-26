# Address, geo, and per-country address formats

Subpath: `/address`. Types are plain data; the format helpers drive forms and validation from a registry you supply.

## Shapes and geo
- `Address` is `{ line1, line2?, city, state?, postalCode?, country }`; `ContactAddress` adds `name`, `phone`, `email`. `GeoPoint` is `{ latitude, longitude }`.
- `toGeoJsonPoint(p)` -> `{ type: 'Point', coordinates: [longitude, latitude] }` (GeoJSON order); `fromGeoJsonPoint(g)` reverses it.
- `distanceMeters(a, b)` is haversine, about 0.5% accurate: fine for geofences, not surveying. A non-finite or out-of-range point throws `RangeError`.
- `isWithinRadius(point, center, radiusMeters, { accuracyMeters, mode })`: `mode: 'strict'` (default) needs the whole GPS uncertainty circle inside; `'lenient'` accepts any overlap.

```ts
import { distanceMeters, isWithinRadius, toGeoJsonPoint } from "@classytic/primitives/address";

const site = { latitude: 23.78, longitude: 90.4 };
const device = { latitude: 23.7801, longitude: 90.4 };
console.log(Math.round(distanceMeters(site, device)), isWithinRadius(device, site, 50, { accuracyMeters: 5 }), toGeoJsonPoint(site));
```

## Address formats
A format declares the fields a country needs; a registry maps ISO country codes to formats.
- `AddressFormat`: `{ country, countryLabel, fields, postalCodePattern? }`. A field is `{ key, label, input, required?, wide?, placeholder?, hint?, taxonomy?, dependsOn? }` with `key` one of `name`, `phone`, `email`, `company`, `line1`, `line2`, `city`, `state`, `postalCode`, `country`. An extension field is `{ extension: true, name, label, input, ... }`.
- `INTERNATIONAL_ADDRESS_FORMAT` is the neutral fallback (country `*`).
- `resolveAddressFormat(country, registry)` is case-insensitive and falls back to the international format; `supportedCountries(registry)` lists `{ code, label }` sorted by label.
- `fieldSpec(format, key)`, `requiredKeys(format)`, `requiredFieldNames(format)`, `fieldName(spec)`, `isExtensionField(spec)`.
- `validateAddress(address, format)` returns `AddressFieldError[]` (`code`: `required` or `postal_code_format`, plus `key` and `label`); a blank string counts as missing. `isAddressValid` is the boolean form; `describeAddressError(error)` gives default English text.
- `AddressTaxonomyPort.options(level, parentId?)` is the port a host implements for dependent dropdowns (division, district, area).

```ts
import { isAddressValid, resolveAddressFormat, supportedCountries, validateAddress, type AddressFormatRegistry } from "@classytic/primitives/address";

const registry: AddressFormatRegistry = {
  BD: {
    country: "BD",
    countryLabel: "Bangladesh",
    fields: [
      { key: "line1", label: "Address", input: "text", required: true },
      { key: "city", label: "City", input: "text", required: true },
      { key: "postalCode", label: "Postcode", input: "text", required: true },
    ],
    postalCodePattern: /^\d{4}$/,
  },
};
const format = resolveAddressFormat("bd", registry);
const address = { line1: "1 Main Road", city: "Dhaka", country: "BD", postalCode: "12" };
console.log(validateAddress(address, format), isAddressValid({ ...address, postalCode: "1205" }, format), supportedCountries(registry));
```
