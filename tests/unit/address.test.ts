import { describe, expect, it } from 'vitest';
import { fromGeoJsonPoint, toGeoJsonPoint } from '../../src/address.js';
import { makeGeoPoint } from '../helpers/fixtures.js';

describe('toGeoJsonPoint', () => {
  it('produces [longitude, latitude] coordinates (GeoJSON order, not GeoPoint order)', () => {
    const p = makeGeoPoint({ latitude: 23.7808, longitude: 90.2792 });
    const g = toGeoJsonPoint(p);
    expect(g.type).toBe('Point');
    expect(g.coordinates).toEqual([90.2792, 23.7808]);
  });
});

describe('fromGeoJsonPoint', () => {
  it('round-trips with toGeoJsonPoint', () => {
    const original = makeGeoPoint({ latitude: 40.7128, longitude: -74.006 });
    expect(fromGeoJsonPoint(toGeoJsonPoint(original))).toEqual(original);
  });

  it('unpacks the lng/lat convention correctly', () => {
    const g = { type: 'Point' as const, coordinates: [90.2792, 23.7808] as const };
    expect(fromGeoJsonPoint(g)).toEqual({ latitude: 23.7808, longitude: 90.2792 });
  });
});
