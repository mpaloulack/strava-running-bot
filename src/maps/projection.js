/**
 * Pure Web-Mercator / slippy-map tile math. No I/O, no config — every
 * function here is a deterministic function of its arguments so it can be
 * unit-tested and reused by both the tile fetcher and the renderer.
 *
 * Tile scheme: https://wiki.openstreetmap.org/wiki/Slippy_map_tilenames
 */

/** Pixel size (width and height) of a single raster tile. */
const TILE_SIZE = 256;

// Web Mercator is undefined at the poles; this is the standard clamp used
// by OSM/Google/Bing so the projection stays finite (y in [0, 2**zoom]).
const MAX_LATITUDE = 85.05112878;

function clampLatitude(lat) {
  return Math.max(-MAX_LATITUDE, Math.min(MAX_LATITUDE, lat));
}

class Projection {
  /**
   * Longitude to floating-point slippy-map tile X at a given zoom.
   *
   * @param {number} lon - longitude in degrees
   * @param {number} zoom - integer zoom level
   * @returns {number} fractional tile X
   */
  static lonToTileX(lon, zoom) {
    return ((lon + 180) / 360) * 2 ** zoom;
  }

  /**
   * Latitude to floating-point slippy-map tile Y at a given zoom, using the
   * standard spherical Web Mercator formula. Latitude is clamped to
   * ±85.05112878° first since the projection is undefined at the poles.
   *
   * @param {number} lat - latitude in degrees
   * @param {number} zoom - integer zoom level
   * @returns {number} fractional tile Y
   */
  static latToTileY(lat, zoom) {
    const clamped = clampLatitude(lat);
    const latRad = (clamped * Math.PI) / 180;
    return (
      (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) /
      2
    ) * 2 ** zoom;
  }

  /**
   * Inverse of {@link Projection.lonToTileX}.
   *
   * @param {number} x - fractional tile X
   * @param {number} zoom - integer zoom level
   * @returns {number} longitude in degrees
   */
  static tileXToLon(x, zoom) {
    return (x / 2 ** zoom) * 360 - 180;
  }

  /**
   * Inverse of {@link Projection.latToTileY}.
   *
   * @param {number} y - fractional tile Y
   * @param {number} zoom - integer zoom level
   * @returns {number} latitude in degrees
   */
  static tileYToLat(y, zoom) {
    const n = Math.PI - (2 * Math.PI * y) / 2 ** zoom;
    return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
  }

  /**
   * Compute the tightest integer zoom level and projected center that fits
   * a set of [lat, lng] points inside a `width` x `height` canvas (minus
   * `padding` on every side), plus the center to render around.
   *
   * The center is computed in projected (Mercator tile) space and converted
   * back to lat/lng, so the visual midpoint of the route is centered on the
   * canvas — not the naive average of latitudes/longitudes, which would be
   * skewed away from true center at higher latitudes.
   *
   * @param {Array<[number, number]>} points - [lat, lng] pairs
   * @param {number} width - canvas width in px
   * @param {number} height - canvas height in px
   * @param {{padding?: number, minZoom?: number, maxZoom?: number}} [options]
   * @returns {{zoom: number, centerLat: number, centerLon: number}|null} null for empty/invalid input
   */
  static fitBounds(points, width, height, options = {}) {
    if (!Array.isArray(points) || points.length === 0) return null;

    const valid = points.filter(
      p => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])
    );
    if (valid.length === 0) return null;

    const { padding = 20, minZoom = 1, maxZoom = 18 } = options;

    let minLat = Infinity;
    let maxLat = -Infinity;
    let minLon = Infinity;
    let maxLon = -Infinity;

    for (const [lat, lon] of valid) {
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
    }

    // Degenerate box (single point, or every point identical): center on it
    // at the highest allowed zoom — there's no span to fit.
    if (minLat === maxLat && minLon === maxLon) {
      return {
        zoom: Math.max(minZoom, maxZoom),
        centerLat: minLat,
        centerLon: minLon,
      };
    }

    const availableWidth = Math.max(1, width - 2 * padding);
    const availableHeight = Math.max(1, height - 2 * padding);

    // Search from maxZoom down to minZoom for the highest zoom whose
    // projected pixel span still fits the padded canvas.
    let chosenZoom = minZoom;
    for (let zoom = maxZoom; zoom >= minZoom; zoom--) {
      const x1 = Projection.lonToTileX(minLon, zoom) * TILE_SIZE;
      const x2 = Projection.lonToTileX(maxLon, zoom) * TILE_SIZE;
      // Mercator Y is inverted relative to latitude (north = smaller y).
      const y1 = Projection.latToTileY(maxLat, zoom) * TILE_SIZE;
      const y2 = Projection.latToTileY(minLat, zoom) * TILE_SIZE;

      const spanWidth = Math.abs(x2 - x1);
      const spanHeight = Math.abs(y2 - y1);

      if (spanWidth <= availableWidth && spanHeight <= availableHeight) {
        chosenZoom = zoom;
        break;
      }
      chosenZoom = minZoom;
    }

    // Center in projected space at the chosen zoom, then convert back.
    const centerTileX =
      (Projection.lonToTileX(minLon, chosenZoom) + Projection.lonToTileX(maxLon, chosenZoom)) / 2;
    const centerTileY =
      (Projection.latToTileY(minLat, chosenZoom) + Projection.latToTileY(maxLat, chosenZoom)) / 2;

    return {
      zoom: chosenZoom,
      centerLat: Projection.tileYToLat(centerTileY, chosenZoom),
      centerLon: Projection.tileXToLon(centerTileX, chosenZoom),
    };
  }
}

module.exports = Projection;
module.exports.TILE_SIZE = TILE_SIZE;
