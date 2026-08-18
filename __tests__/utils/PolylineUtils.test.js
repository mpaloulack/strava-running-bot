const PolylineUtils = require('../../src/utils/PolylineUtils');

describe('PolylineUtils', () => {
  describe('encodePolyline', () => {
    it('should match Google\'s documented test vector', () => {
      const points = [[38.5, -120.2], [40.7, -120.95], [43.252, -126.453]];

      const encoded = PolylineUtils.encodePolyline(points);

      expect(encoded).toBe('_p~iF~ps|U_ulLnnqC_mqNvxq`@');
    });

    it('should return an empty string for an empty array', () => {
      expect(PolylineUtils.encodePolyline([])).toBe('');
    });

    it('should return an empty string for non-array input', () => {
      expect(PolylineUtils.encodePolyline(null)).toBe('');
      expect(PolylineUtils.encodePolyline(undefined)).toBe('');
    });

    it('should encode a single point relative to origin', () => {
      const encoded = PolylineUtils.encodePolyline([[0, 0]]);
      expect(encoded).toBe('??');
    });

    it('should handle negative deltas between consecutive points', () => {
      const points = [[10, 10], [5, 5]];
      const encoded = PolylineUtils.encodePolyline(points);
      // Decoding is out of scope here, but re-encoding the delta manually should round-trip
      expect(typeof encoded).toBe('string');
      expect(encoded.length).toBeGreaterThan(0);
    });
  });

  describe('filterAndDownsampleLatLng', () => {
    it('should return [] for non-array input', () => {
      expect(PolylineUtils.filterAndDownsampleLatLng(null)).toEqual([]);
      expect(PolylineUtils.filterAndDownsampleLatLng(undefined)).toEqual([]);
    });

    it('should return [] when fewer than 2 valid points remain', () => {
      expect(PolylineUtils.filterAndDownsampleLatLng([])).toEqual([]);
      expect(PolylineUtils.filterAndDownsampleLatLng([[1, 2]])).toEqual([]);
      expect(PolylineUtils.filterAndDownsampleLatLng([null, [1, 2]])).toEqual([]);
    });

    it('should drop null entries (pre satellite-fix samples)', () => {
      const data = [null, null, [1, 2], [3, 4]];
      expect(PolylineUtils.filterAndDownsampleLatLng(data)).toEqual([[1, 2], [3, 4]]);
    });

    it('should drop malformed entries: wrong length, non-array, non-finite numbers', () => {
      const data = [
        [1, 2],
        [1, 2, 3],        // wrong length
        'not-an-array',   // not an array
        [NaN, 2],         // non-finite lat
        [1, Infinity],    // non-finite lng
        [undefined, 2],   // undefined lat
        [3, 4]
      ];
      expect(PolylineUtils.filterAndDownsampleLatLng(data)).toEqual([[1, 2], [3, 4]]);
    });

    it('should return all points unchanged when at or under maxPoints', () => {
      const data = [[1, 1], [2, 2], [3, 3]];
      expect(PolylineUtils.filterAndDownsampleLatLng(data, 150)).toEqual(data);
      expect(PolylineUtils.filterAndDownsampleLatLng(data, 3)).toEqual(data);
    });

    it('should downsample uniformly while always keeping the first and last valid points', () => {
      const data = Array.from({ length: 20 }, (_, i) => [i, i * 2]);

      const result = PolylineUtils.filterAndDownsampleLatLng(data, 5);

      expect(result).toHaveLength(5);
      expect(result[0]).toEqual(data[0]);
      expect(result[result.length - 1]).toEqual(data[data.length - 1]);
    });

    it('should respect maxPoints exactly', () => {
      const data = Array.from({ length: 500 }, (_, i) => [i * 0.001, i * 0.002]);

      const result = PolylineUtils.filterAndDownsampleLatLng(data, 150);

      expect(result).toHaveLength(150);
      expect(result[0]).toEqual(data[0]);
      expect(result[149]).toEqual(data[499]);
    });

    it('should filter invalid entries before downsampling', () => {
      const raw = Array.from({ length: 300 }, (_, i) => (i % 3 === 0 ? null : [i, i]));

      const result = PolylineUtils.filterAndDownsampleLatLng(raw, 100);

      expect(result.length).toBeLessThanOrEqual(100);
      result.forEach(([lat, lng]) => {
        expect(Number.isFinite(lat)).toBe(true);
        expect(Number.isFinite(lng)).toBe(true);
      });
    });
  });

  describe('decodePolyline', () => {
    it('should match Google\'s documented test vector', () => {
      const decoded = PolylineUtils.decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@');

      expect(decoded).toHaveLength(3);
      expect(decoded[0][0]).toBeCloseTo(38.5, 5);
      expect(decoded[0][1]).toBeCloseTo(-120.2, 5);
      expect(decoded[1][0]).toBeCloseTo(40.7, 5);
      expect(decoded[1][1]).toBeCloseTo(-120.95, 5);
      expect(decoded[2][0]).toBeCloseTo(43.252, 5);
      expect(decoded[2][1]).toBeCloseTo(-126.453, 5);
    });

    it('should return [] for null, undefined, empty string, and non-string input', () => {
      expect(PolylineUtils.decodePolyline(null)).toEqual([]);
      expect(PolylineUtils.decodePolyline(undefined)).toEqual([]);
      expect(PolylineUtils.decodePolyline('')).toEqual([]);
      expect(PolylineUtils.decodePolyline(42)).toEqual([]);
      expect(PolylineUtils.decodePolyline([])).toEqual([]);
      expect(PolylineUtils.decodePolyline({})).toEqual([]);
    });

    it('should never throw on garbage/truncated input and return whatever decoded fully', () => {
      expect(() => PolylineUtils.decodePolyline('!!!!!')).not.toThrow();
      expect(() => PolylineUtils.decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`')).not.toThrow();
      // Dropping the final byte truncates mid-chunk for the 3rd point: only
      // the 2 fully-decodable points are returned, never a throw.
      const decoded = PolylineUtils.decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`');
      expect(decoded).toHaveLength(2);
      expect(decoded[0][0]).toBeCloseTo(38.5, 5);
      expect(decoded[0][1]).toBeCloseTo(-120.2, 5);
      expect(decoded[1][0]).toBeCloseTo(40.7, 5);
      expect(decoded[1][1]).toBeCloseTo(-120.95, 5);

      // Truncated after exactly one full point: only that point is returned.
      const oneFullPoint = PolylineUtils.decodePolyline('_p~iF~ps|U');
      expect(oneFullPoint).toHaveLength(1);
      expect(oneFullPoint[0][0]).toBeCloseTo(38.5, 5);
      expect(oneFullPoint[0][1]).toBeCloseTo(-120.2, 5);
    });

    it('should be the exact inverse of encodePolyline (round-trip)', () => {
      const points = [[38.5, -120.2], [40.7, -120.95], [43.252, -126.453], [0, 0], [-33.8688, 151.2093]];

      const encoded = PolylineUtils.encodePolyline(points);
      const decoded = PolylineUtils.decodePolyline(encoded);

      expect(decoded).toHaveLength(points.length);
      decoded.forEach(([lat, lng], i) => {
        expect(lat).toBeCloseTo(points[i][0], 5);
        expect(lng).toBeCloseTo(points[i][1], 5);
      });
    });

    it('should round-trip negative and near-zero coordinates', () => {
      const points = [[-0.00001, 0.00001], [-89.99999, -179.99999], [0.00002, -0.00002]];

      const encoded = PolylineUtils.encodePolyline(points);
      const decoded = PolylineUtils.decodePolyline(encoded);

      expect(decoded).toHaveLength(points.length);
      decoded.forEach(([lat, lng], i) => {
        expect(lat).toBeCloseTo(points[i][0], 5);
        expect(lng).toBeCloseTo(points[i][1], 5);
      });
    });

    it('should round-trip a single point', () => {
      const points = [[12.34567, -76.54321]];

      const encoded = PolylineUtils.encodePolyline(points);
      const decoded = PolylineUtils.decodePolyline(encoded);

      expect(decoded).toHaveLength(1);
      expect(decoded[0][0]).toBeCloseTo(points[0][0], 5);
      expect(decoded[0][1]).toBeCloseTo(points[0][1], 5);
    });
  });
});
