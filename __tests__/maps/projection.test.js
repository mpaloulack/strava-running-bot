const Projection = require('../../src/maps/projection');

describe('Projection', () => {
  describe('TILE_SIZE', () => {
    it('should be 256', () => {
      expect(Projection.TILE_SIZE).toBe(256);
    });
  });

  describe('lonToTileX / latToTileY', () => {
    it('should map lon 0 / lat 0 to tile (0.5, 0.5) at zoom 0', () => {
      expect(Projection.lonToTileX(0, 0)).toBeCloseTo(0.5, 10);
      expect(Projection.latToTileY(0, 0)).toBeCloseTo(0.5, 10);
    });

    it('should map lon -180/180 to tile x 0/2 at zoom 1', () => {
      expect(Projection.lonToTileX(-180, 1)).toBeCloseTo(0, 10);
      expect(Projection.lonToTileX(180, 1)).toBeCloseTo(2, 10);
    });

    it('should map Berlin (52.5200, 13.4050) to tile (2200, 1343) at zoom 12', () => {
      const x = Projection.lonToTileX(13.4050, 12);
      const y = Projection.latToTileY(52.5200, 12);

      expect(Math.floor(x)).toBe(2200);
      expect(Math.floor(y)).toBe(1343);
    });

    it('should clamp latitude to ±85.05112878 before projecting', () => {
      const north = Projection.latToTileY(90, 5);
      const clampedNorth = Projection.latToTileY(85.05112878, 5);
      expect(north).toBeCloseTo(clampedNorth, 10);

      const south = Projection.latToTileY(-90, 5);
      const clampedSouth = Projection.latToTileY(-85.05112878, 5);
      expect(south).toBeCloseTo(clampedSouth, 10);
    });
  });

  describe('tileXToLon / tileYToLat (round-trip)', () => {
    it('should invert lonToTileX', () => {
      for (const lon of [-180, -120.95, -0.0001, 0, 13.405, 151.2093, 179.999]) {
        for (const zoom of [0, 4, 12, 18]) {
          const x = Projection.lonToTileX(lon, zoom);
          expect(Projection.tileXToLon(x, zoom)).toBeCloseTo(lon, 6);
        }
      }
    });

    it('should invert latToTileY within the valid (non-clamped) latitude range', () => {
      for (const lat of [-85, -52.52, -0.0001, 0, 40.7, 52.52, 84.9]) {
        for (const zoom of [0, 4, 12, 18]) {
          const y = Projection.latToTileY(lat, zoom);
          expect(Projection.tileYToLat(y, zoom)).toBeCloseTo(lat, 5);
        }
      }
    });
  });

  describe('fitBounds', () => {
    it('should return null for empty points', () => {
      expect(Projection.fitBounds([], 600, 400)).toBeNull();
    });

    it('should return null for null/undefined/invalid points', () => {
      expect(Projection.fitBounds(null, 600, 400)).toBeNull();
      expect(Projection.fitBounds(undefined, 600, 400)).toBeNull();
      expect(Projection.fitBounds('not-an-array', 600, 400)).toBeNull();
      expect(Projection.fitBounds([[NaN, NaN]], 600, 400)).toBeNull();
    });

    it('should center on the single point at maxZoom for a single-point input', () => {
      const result = Projection.fitBounds([[52.52, 13.405]], 600, 400);

      expect(result.zoom).toBe(18);
      expect(result.centerLat).toBeCloseTo(52.52, 10);
      expect(result.centerLon).toBeCloseTo(13.405, 10);
    });

    it('should treat an all-identical-points box as degenerate (maxZoom)', () => {
      const result = Projection.fitBounds([[1, 1], [1, 1], [1, 1]], 600, 400);

      expect(result.zoom).toBe(18);
      expect(result.centerLat).toBeCloseTo(1, 10);
      expect(result.centerLon).toBeCloseTo(1, 10);
    });

    it('should respect a custom maxZoom for degenerate boxes', () => {
      const result = Projection.fitBounds([[52.52, 13.405]], 600, 400, { maxZoom: 10 });
      expect(result.zoom).toBe(10);
    });

    it('should pick a high zoom (>= 13) for a small ~2km box', () => {
      const points = [[52.5200, 13.4050], [52.5350, 13.4200]];

      const result = Projection.fitBounds(points, 600, 400);

      expect(result.zoom).toBeGreaterThanOrEqual(13);
    });

    it('should pick a low zoom for a country-sized box', () => {
      const points = [[41.0, -5.0], [51.0, 9.0]];

      const result = Projection.fitBounds(points, 600, 400);

      expect(result.zoom).toBeLessThanOrEqual(7);
    });

    it('should choose a zoom whose projected pixel span fits the padded canvas', () => {
      const width = 600;
      const height = 400;
      const padding = 20;
      const points = [[48.8566, 2.3522], [45.7640, 4.8357]]; // Paris -> Lyon

      const result = Projection.fitBounds(points, width, height, { padding });

      let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
      for (const [lat, lon] of points) {
        minLat = Math.min(minLat, lat);
        maxLat = Math.max(maxLat, lat);
        minLon = Math.min(minLon, lon);
        maxLon = Math.max(maxLon, lon);
      }

      const x1 = Projection.lonToTileX(minLon, result.zoom) * Projection.TILE_SIZE;
      const x2 = Projection.lonToTileX(maxLon, result.zoom) * Projection.TILE_SIZE;
      const y1 = Projection.latToTileY(minLat, result.zoom) * Projection.TILE_SIZE;
      const y2 = Projection.latToTileY(maxLat, result.zoom) * Projection.TILE_SIZE;

      expect(Math.abs(x2 - x1)).toBeLessThanOrEqual(width - 2 * padding);
      expect(Math.abs(y2 - y1)).toBeLessThanOrEqual(height - 2 * padding);
    });

    it('should center in projected (Mercator) space, not the naive lat/lng average', () => {
      // Asymmetric box spanning a wide latitude range: the Mercator-space
      // center should differ from the plain arithmetic mean of the latitudes.
      const points = [[10, 0], [70, 10]];
      const naiveAvgLat = (10 + 70) / 2; // 40

      const result = Projection.fitBounds(points, 600, 400);

      expect(result.centerLat).not.toBeCloseTo(naiveAvgLat, 2);
    });

    it('should respect minZoom/maxZoom bounds', () => {
      const points = [[41.0, -5.0], [51.0, 9.0]]; // country-sized, naturally low zoom
      const result = Projection.fitBounds(points, 600, 400, { minZoom: 6 });

      expect(result.zoom).toBeGreaterThanOrEqual(6);
    });
  });
});
