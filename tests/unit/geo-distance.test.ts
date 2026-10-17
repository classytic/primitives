import { describe, expect, it } from 'vitest';
import { distanceMeters, isWithinRadius } from '../../src/identity/address.js';

const origin = { latitude: 0, longitude: 0 };
const station = { latitude: 24.6311, longitude: 46.7124 };

describe('distanceMeters', () => {
  it('measures one degree of latitude as ~111.195 km', () => {
    expect(distanceMeters(origin, { latitude: 1, longitude: 0 })).toBeCloseTo(111_195.08, 0);
  });

  it('is symmetric and zero for the same point', () => {
    const p = { latitude: 24.7672, longitude: 46.6406 };
    expect(distanceMeters(station, station)).toBe(0);
    expect(distanceMeters(station, p)).toBeCloseTo(distanceMeters(p, station), 6);
  });

  it('handles the antimeridian', () => {
    const d = distanceMeters(
      { latitude: 0, longitude: 179.999 },
      { latitude: 0, longitude: -179.999 },
    );
    expect(d).toBeCloseTo(222.39, 1);
  });

  it('rejects invalid coordinates', () => {
    expect(() => distanceMeters({ latitude: 91, longitude: 0 }, origin)).toThrow(RangeError);
    expect(() => distanceMeters(origin, { latitude: 0, longitude: Number.NaN })).toThrow(
      RangeError,
    );
  });
});

describe('isWithinRadius', () => {
  // ~111.2 m north of the station
  const north111 = { latitude: station.latitude + 0.001, longitude: station.longitude };

  it('compares the plain distance when no accuracy is given', () => {
    expect(isWithinRadius(north111, station, 120)).toBe(true);
    expect(isWithinRadius(north111, station, 100)).toBe(false);
  });

  it('strict mode requires the whole uncertainty circle inside (default)', () => {
    expect(isWithinRadius(north111, station, 150, { accuracyMeters: 30 })).toBe(true);
    expect(isWithinRadius(north111, station, 150, { accuracyMeters: 50 })).toBe(false);
  });

  it('lenient mode accepts any overlap', () => {
    expect(isWithinRadius(north111, station, 100, { accuracyMeters: 20, mode: 'lenient' })).toBe(
      true,
    );
    expect(isWithinRadius(north111, station, 80, { accuracyMeters: 20, mode: 'lenient' })).toBe(
      false,
    );
  });

  it('rejects negative or non-finite radius and accuracy', () => {
    expect(() => isWithinRadius(north111, station, -1)).toThrow(RangeError);
    expect(() => isWithinRadius(north111, station, 100, { accuracyMeters: -5 })).toThrow(
      RangeError,
    );
  });
});
