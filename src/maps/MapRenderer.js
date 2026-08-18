const sharp = require('sharp');
const config = require('../../config/config');
const logger = require('../utils/Logger');
const PolylineUtils = require('../utils/PolylineUtils');
const Projection = require('./projection');
const TileProvider = require('./TileProvider');

const { TILE_SIZE } = Projection;

// Route line styling.
const ROUTE_COLOR = '#FC4C02';
const ROUTE_CASING_COLOR = '#ffffff';
const ROUTE_WIDTH = 4;
const ROUTE_CASING_WIDTH = 7;

// Start/finish marker styling.
const START_COLOR = '#2ECC40';
const FINISH_COLOR = '#D32F2F';
const MARKER_RADIUS = 6;
const MARKER_STROKE_WIDTH = 2;
const MARKER_STROKE_COLOR = '#ffffff';

// Background shown where a tile could not be fetched/positioned.
const BACKGROUND_COLOR = '#e8e4e0';

/**
 * Renders a Strava/intervals.icu route polyline into a self-contained PNG:
 * OpenStreetMap raster tiles composited into a canvas, cropped to the
 * configured viewport, with the route line and start/finish markers drawn
 * on top as an SVG overlay.
 *
 * No external map service or API key — see `config.map` and the OSM tile
 * usage policy (https://operations.osmfoundation.org/policies/tiles/).
 */
class MapRenderer {
  /**
   * @param {TileProvider} [tileProvider] - injected for testing; defaults to
   *   a real network+cache-backed provider.
   */
  constructor(tileProvider = new TileProvider()) {
    this.tileProvider = tileProvider;
  }

  /**
   * Render a Google Encoded Polyline into a PNG route map image.
   *
   * Never throws — any failure (bad input, projection failure, tile fetch
   * failure, image compositing failure) is logged and results in `null` so
   * a map rendering bug can never break activity posting.
   *
   * @param {string} encodedPolyline - Strava `map.summary_polyline`
   * @returns {Promise<Buffer|null>} PNG buffer sized `config.map.width` x
   *   `config.map.height`, or `null` if the route couldn't be rendered.
   */
  async renderRoute(encodedPolyline) {
    try {
      if (!config.map.enabled || !encodedPolyline) return null;

      const decoded = PolylineUtils.decodePolyline(encodedPolyline);
      const points = PolylineUtils.filterAndDownsampleLatLng(decoded, 150);
      if (points.length < 2) {
        logger.map.warn('Not enough valid GPS points to render a route map', {
          pointCount: points.length,
        });
        return null;
      }

      const { width, height, maxTiles } = config.map;

      const fit = Projection.fitBounds(points, width, height, { padding: 24 });
      if (!fit) {
        logger.map.warn('Projection.fitBounds could not fit the route');
        return null;
      }
      const { zoom, centerLat, centerLon } = fit;

      // Pixel origin (top-left) of the viewport in the zoom's global pixel
      // space. Floored to an integer so tile-grid cropping and the SVG
      // overlay both key off the exact same reference point.
      const centerPxX = Projection.lonToTileX(centerLon, zoom) * TILE_SIZE;
      const centerPxY = Projection.latToTileY(centerLat, zoom) * TILE_SIZE;
      const originX = Math.floor(centerPxX - width / 2);
      const originY = Math.floor(centerPxY - height / 2);

      const maxTileIndex = 2 ** zoom - 1;
      const rawFirstTileX = Math.floor(originX / TILE_SIZE);
      const rawLastTileX = Math.floor((originX + width - 1) / TILE_SIZE);
      const rawFirstTileY = Math.floor(originY / TILE_SIZE);
      const rawLastTileY = Math.floor((originY + height - 1) / TILE_SIZE);

      const tileCoords = [];
      for (let ty = rawFirstTileY; ty <= rawLastTileY; ty++) {
        if (ty < 0 || ty > maxTileIndex) continue;
        for (let tx = rawFirstTileX; tx <= rawLastTileX; tx++) {
          if (tx < 0 || tx > maxTileIndex) continue;
          tileCoords.push({ z: zoom, x: tx, y: ty });
        }
      }

      if (tileCoords.length === 0) {
        logger.map.warn('No valid tiles fall within the viewport', { zoom });
        return null;
      }

      if (tileCoords.length > maxTiles) {
        logger.map.warn('Route viewport requires too many tiles, skipping render', {
          tileCount: tileCoords.length,
          maxTiles,
        });
        return null;
      }

      const tiles = await this.tileProvider.fetchTiles(tileCoords);

      const gridW = rawLastTileX - rawFirstTileX + 1;
      const gridH = rawLastTileY - rawFirstTileY + 1;

      const compositeOps = tiles.map((buffer, i) => ({
        input: buffer,
        left: (tileCoords[i].x - rawFirstTileX) * TILE_SIZE,
        top: (tileCoords[i].y - rawFirstTileY) * TILE_SIZE,
      }));

      const gridBuffer = await sharp({
        create: {
          width: gridW * TILE_SIZE,
          height: gridH * TILE_SIZE,
          channels: 4,
          background: BACKGROUND_COLOR,
        },
      })
        .composite(compositeOps)
        .png()
        .toBuffer();

      const extractLeft = originX - rawFirstTileX * TILE_SIZE;
      const extractTop = originY - rawFirstTileY * TILE_SIZE;

      const croppedBuffer = await sharp(gridBuffer)
        .extract({ left: extractLeft, top: extractTop, width, height })
        .png()
        .toBuffer();

      const overlaySvg = this._buildOverlaySvg(points, zoom, originX, originY, width, height);

      return await sharp(croppedBuffer)
        .composite([{ input: Buffer.from(overlaySvg), left: 0, top: 0 }])
        .png()
        .toBuffer();
    } catch (error) {
      logger.map.error('Failed to render route map', { error: error.message });
      return null;
    }
  }

  /**
   * Project a [lat, lng] point to viewport-relative pixel coordinates,
   * rounded to 1 decimal place to keep the resulting SVG small.
   *
   * @param {number} lat
   * @param {number} lng
   * @param {number} zoom
   * @param {number} originX - viewport pixel origin X (global pixel space)
   * @param {number} originY - viewport pixel origin Y (global pixel space)
   * @returns {[number, number]}
   */
  _projectToViewport(lat, lng, zoom, originX, originY) {
    const px = Projection.lonToTileX(lng, zoom) * TILE_SIZE - originX;
    const py = Projection.latToTileY(lat, zoom) * TILE_SIZE - originY;
    return [Math.round(px * 10) / 10, Math.round(py * 10) / 10];
  }

  /**
   * Build the SVG overlay: the route line (with a white casing so it reads
   * on busy tiles), start/finish markers, and the OSM attribution notice.
   *
   * The attribution is required by the OSM tile usage policy
   * (https://operations.osmfoundation.org/policies/tiles/#attribution) —
   * it must never be dropped from a rendered tile image.
   *
   * @param {Array<[number, number]>} points
   * @param {number} zoom
   * @param {number} originX
   * @param {number} originY
   * @param {number} width
   * @param {number} height
   * @returns {string}
   */
  _buildOverlaySvg(points, zoom, originX, originY, width, height) {
    const projected = points.map(([lat, lng]) => this._projectToViewport(lat, lng, zoom, originX, originY));
    const pointsAttr = projected.map(([x, y]) => `${x},${y}`).join(' ');

    const [startX, startY] = projected[0];
    const [endX, endY] = projected[projected.length - 1];

    const attributionText = MapRenderer._escapeXml(config.map.attribution);
    const attrBoxWidth = Math.min(width - 8, attributionText.length * 5.2 + 12);
    const attrBoxHeight = 16;
    const attrBoxX = width - attrBoxWidth - 4;
    const attrBoxY = height - attrBoxHeight - 4;

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <polyline points="${pointsAttr}" fill="none" stroke="${ROUTE_CASING_COLOR}" stroke-width="${ROUTE_CASING_WIDTH}" stroke-linejoin="round" stroke-linecap="round" opacity="0.85" />
  <polyline points="${pointsAttr}" fill="none" stroke="${ROUTE_COLOR}" stroke-width="${ROUTE_WIDTH}" stroke-linejoin="round" stroke-linecap="round" />
  <circle cx="${startX}" cy="${startY}" r="${MARKER_RADIUS}" fill="${START_COLOR}" stroke="${MARKER_STROKE_COLOR}" stroke-width="${MARKER_STROKE_WIDTH}" />
  <circle cx="${endX}" cy="${endY}" r="${MARKER_RADIUS}" fill="${FINISH_COLOR}" stroke="${MARKER_STROKE_COLOR}" stroke-width="${MARKER_STROKE_WIDTH}" />
  <rect x="${attrBoxX}" y="${attrBoxY}" width="${attrBoxWidth}" height="${attrBoxHeight}" rx="3" fill="rgba(255,255,255,0.75)" />
  <text x="${width - 8}" y="${height - 8}" font-size="10" font-family="sans-serif" fill="#333333" text-anchor="end">${attributionText}</text>
</svg>`;
  }

  /**
   * Escape a string for safe inclusion as SVG text content.
   *
   * @param {string} text
   * @returns {string}
   */
  static _escapeXml(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }
}

module.exports = MapRenderer;

// Lazy module-level singleton for call sites (e.g. EmbedBuilder) that don't
// need per-call injection. Deliberately lazy: constructing eagerly at
// `require()` time would build a `TileProvider` (which reads `config.map.*`)
// as a side effect of merely importing this file — breaking any caller/test
// that requires this module transitively without a full `config.map` mock.
let singleton = null;
Object.defineProperty(MapRenderer, 'instance', {
  configurable: true,
  enumerable: true,
  get() {
    if (!singleton) {
      singleton = new MapRenderer();
    }
    return singleton;
  },
});
