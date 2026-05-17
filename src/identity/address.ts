/**
 * Postal address.
 *
 * Kept deliberately generic — international postal formats vary too much to
 * enforce per-country rules in a shared type. Consumers can extend or narrow
 * as needed (e.g. a BD-specific schema might add `district`, `upazila`).
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
