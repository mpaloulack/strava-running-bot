const sharp = require('sharp');

const DEFAULT_MAP_CONFIG = {
  enabled: true,
  tileUrl: 'https://tile.example.test/{z}/{x}/{y}.png',
  tileCacheDir: '/tmp/map-renderer-test-cache',
  userAgent: 'strava-running-bot-test/1.0 (+https://example.test)',
  attribution: '© OpenStreetMap contributors',
  width: 600,
  height: 400,
  maxTiles: 20,
  timeoutMs: 8000,
  tileCacheTtlMs: 7 * 24 * 60 * 60 * 1000,
};

/**
 * Fresh-require MapRenderer (and the real, pure Projection/PolylineUtils
 * modules it depends on) with a mocked config/Logger. `jest.resetModules()`
 * per call keeps each test's config mock isolated.
 */
function loadMapRenderer(configOverrides = {}) {
  jest.resetModules();

  jest.doMock('../../config/config', () => ({
    map: { ...DEFAULT_MAP_CONFIG, ...configOverrides },
  }));

  const logger = {
    map: {
      error: jest.fn(),
      warn: jest.fn(),
      info: jest.fn(),
      debug: jest.fn(),
    },
  };
  jest.doMock('../../src/utils/Logger', () => logger);

  const MapRenderer = require('../../src/maps/MapRenderer');
  // Real, pure modules — deliberately not mocked (see task brief).
  const Projection = require('../../src/maps/projection');
  const PolylineUtils = require('../../src/utils/PolylineUtils');

  return { MapRenderer, Projection, PolylineUtils, logger };
}

/** A solid-color 256x256 PNG, standing in for a real OSM raster tile. */
async function makeTilePng(background = '#3388ff') {
  return sharp({
    create: { width: 256, height: 256, channels: 4, background },
  })
    .png()
    .toBuffer();
}

function makeFetchTiles(tileFactory = makeTilePng) {
  return jest.fn(async (tiles) => Promise.all(tiles.map(() => tileFactory())));
}

// A short two-point route in central Paris, close enough together that it
// renders at a normal street-level zoom (small, in-range tile grid).
const PARIS_ROUTE = [
  [48.8566, 2.3522],
  [48.8606, 2.3376],
];

/**
 * Count pixels in a region that read as Strava orange (#FC4C02). The
 * "Powered by Strava" logo is the only orange artwork on a rendered map
 * besides the route line, so a corner crop that contains orange is proof
 * the brand overlay was composited.
 */
async function countOrangePixels(pngBuffer, region) {
  const { data, info } = await sharp(pngBuffer)
    .extract(region)
    .raw()
    .toBuffer({ resolveWithObject: true });

  let orange = 0;
  for (let i = 0; i < data.length; i += info.channels) {
    const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
    if (r > 200 && g < 130 && b < 90) orange += 1;
  }
  return orange;
}

/** Bottom-left corner of a default-sized map — where the brand overlay sits. */
const BRAND_REGION = { left: 0, top: 340, width: 200, height: 60 };

describe('MapRenderer', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns null when config.map.enabled is false', async () => {
    const { MapRenderer, PolylineUtils } = loadMapRenderer({ enabled: false });
    const encoded = PolylineUtils.encodePolyline(PARIS_ROUTE);
    const fetchTiles = makeFetchTiles();
    const renderer = new MapRenderer({ fetchTiles });

    const result = await renderer.renderRoute(encoded);

    expect(result).toBeNull();
    expect(fetchTiles).not.toHaveBeenCalled();
  });

  it('returns null for a falsy polyline', async () => {
    const { MapRenderer } = loadMapRenderer();
    const renderer = new MapRenderer({ fetchTiles: makeFetchTiles() });

    expect(await renderer.renderRoute('')).toBeNull();
    expect(await renderer.renderRoute(null)).toBeNull();
    expect(await renderer.renderRoute(undefined)).toBeNull();
  });

  it('returns null when the polyline decodes to fewer than 2 points', async () => {
    const { MapRenderer, PolylineUtils } = loadMapRenderer();
    const encoded = PolylineUtils.encodePolyline([[48.8566, 2.3522]]); // single point
    const fetchTiles = makeFetchTiles();
    const renderer = new MapRenderer({ fetchTiles });

    const result = await renderer.renderRoute(encoded);

    expect(result).toBeNull();
    expect(fetchTiles).not.toHaveBeenCalled();
  });

  it('returns null when Projection.fitBounds cannot fit the route', async () => {
    const { MapRenderer, Projection, PolylineUtils } = loadMapRenderer();
    jest.spyOn(Projection, 'fitBounds').mockReturnValue(null);
    const encoded = PolylineUtils.encodePolyline(PARIS_ROUTE);
    const fetchTiles = makeFetchTiles();
    const renderer = new MapRenderer({ fetchTiles });

    const result = await renderer.renderRoute(encoded);

    expect(result).toBeNull();
    expect(fetchTiles).not.toHaveBeenCalled();
  });

  it('returns null when the tile provider rejects', async () => {
    const { MapRenderer, PolylineUtils } = loadMapRenderer();
    const encoded = PolylineUtils.encodePolyline(PARIS_ROUTE);
    const fetchTiles = jest.fn().mockRejectedValue(new Error('network down'));
    const renderer = new MapRenderer({ fetchTiles });

    await expect(renderer.renderRoute(encoded)).resolves.toBeNull();
  });

  it('returns null and skips fetching when the tile grid would exceed maxTiles', async () => {
    // A 600x400 viewport always needs more than one 256x256 tile, so
    // maxTiles: 1 is guaranteed to be exceeded regardless of chosen zoom.
    const { MapRenderer, PolylineUtils } = loadMapRenderer({ maxTiles: 1 });
    const encoded = PolylineUtils.encodePolyline(PARIS_ROUTE);
    const fetchTiles = makeFetchTiles();
    const renderer = new MapRenderer({ fetchTiles });

    const result = await renderer.renderRoute(encoded);

    expect(result).toBeNull();
    expect(fetchTiles).not.toHaveBeenCalled();
  });

  it('never throws and returns null when a fetched tile buffer is corrupt', async () => {
    const { MapRenderer, PolylineUtils } = loadMapRenderer();
    const encoded = PolylineUtils.encodePolyline(PARIS_ROUTE);
    const fetchTiles = jest.fn(async (tiles) => tiles.map(() => Buffer.from('not a real png')));
    const renderer = new MapRenderer({ fetchTiles });

    await expect(renderer.renderRoute(encoded)).resolves.toBeNull();
  });

  it('renders a valid PNG sized exactly config.map.width x config.map.height, requesting only in-range tiles', async () => {
    const { MapRenderer, PolylineUtils } = loadMapRenderer({ width: 400, height: 300 });
    const encoded = PolylineUtils.encodePolyline([
      [48.8566, 2.3522],
      [48.8606, 2.3376],
      [48.8738, 2.2950],
    ]);
    const fetchTiles = makeFetchTiles();
    const renderer = new MapRenderer({ fetchTiles });

    const result = await renderer.renderRoute(encoded);

    expect(result).toBeInstanceOf(Buffer);
    const metadata = await sharp(result).metadata();
    expect(metadata.format).toBe('png');
    expect(metadata.width).toBe(400);
    expect(metadata.height).toBe(300);

    expect(fetchTiles).toHaveBeenCalledTimes(1);
    const requestedTiles = fetchTiles.mock.calls[0][0];
    expect(requestedTiles.length).toBeGreaterThan(0);
    for (const { z, x, y } of requestedTiles) {
      const maxIndex = 2 ** z - 1;
      expect(Number.isInteger(z)).toBe(true);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(maxIndex);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(maxIndex);
    }
  });

  it('downsamples routes with more than 150 points before rendering', async () => {
    const { MapRenderer, PolylineUtils } = loadMapRenderer();
    const manyPoints = Array.from({ length: 300 }, (_, i) => [
      48.8566 + i * 0.0001,
      2.3522 + i * 0.0001,
    ]);
    const encoded = PolylineUtils.encodePolyline(manyPoints);
    const fetchTiles = makeFetchTiles();
    const renderer = new MapRenderer({ fetchTiles });

    const result = await renderer.renderRoute(encoded);

    expect(result).toBeInstanceOf(Buffer);
    const metadata = await sharp(result).metadata();
    expect(metadata.width).toBe(DEFAULT_MAP_CONFIG.width);
    expect(metadata.height).toBe(DEFAULT_MAP_CONFIG.height);
  });

  it('composites the Powered by Strava logo when poweredByStrava is set', async () => {
    const { MapRenderer, PolylineUtils } = loadMapRenderer();
    const encoded = PolylineUtils.encodePolyline(PARIS_ROUTE);
    // Grey tiles: nothing in the base map can be mistaken for Strava orange.
    const renderer = new MapRenderer({ fetchTiles: makeFetchTiles(() => makeTilePng('#888888')) });

    const result = await renderer.renderRoute(encoded, { poweredByStrava: true });

    expect(result).toBeInstanceOf(Buffer);
    const metadata = await sharp(result).metadata();
    expect(metadata.width).toBe(DEFAULT_MAP_CONFIG.width);
    expect(metadata.height).toBe(DEFAULT_MAP_CONFIG.height);
    expect(await countOrangePixels(result, BRAND_REGION)).toBeGreaterThan(50);
  });

  it('leaves the map unbranded when poweredByStrava is not requested', async () => {
    const { MapRenderer, PolylineUtils } = loadMapRenderer();
    const encoded = PolylineUtils.encodePolyline(PARIS_ROUTE);
    const renderer = new MapRenderer({ fetchTiles: makeFetchTiles(() => makeTilePng('#888888')) });

    const unbranded = await renderer.renderRoute(encoded);
    const explicitlyUnbranded = await renderer.renderRoute(encoded, { poweredByStrava: false });

    // The route line itself is orange, so only the corner crop is asserted on.
    expect(await countOrangePixels(unbranded, BRAND_REGION)).toBe(0);
    expect(await countOrangePixels(explicitlyUnbranded, BRAND_REGION)).toBe(0);
  });

  it('skips the brand overlay when the map is too small to hold it', async () => {
    const { MapRenderer, PolylineUtils, logger } = loadMapRenderer({ width: 80, height: 60 });
    const encoded = PolylineUtils.encodePolyline(PARIS_ROUTE);
    const renderer = new MapRenderer({ fetchTiles: makeFetchTiles(() => makeTilePng('#888888')) });

    const result = await renderer.renderRoute(encoded, { poweredByStrava: true });

    expect(result).toBeInstanceOf(Buffer);
    const metadata = await sharp(result).metadata();
    expect(metadata.width).toBe(80);
    expect(metadata.height).toBe(60);
    // No plate fits in an 80px-wide map, so nothing is composited. The route
    // line is itself orange at this size, so the decision is asserted at the
    // source rather than by counting pixels.
    await expect(renderer._buildStravaBrand(80, 60)).resolves.toBeNull();
    expect(logger.map.warn).not.toHaveBeenCalled();
  });

  it('still returns a map when the brand overlay cannot be built', async () => {
    const { MapRenderer, PolylineUtils, logger } = loadMapRenderer();
    const encoded = PolylineUtils.encodePolyline(PARIS_ROUTE);
    const renderer = new MapRenderer({ fetchTiles: makeFetchTiles(() => makeTilePng('#888888')) });
    jest.spyOn(renderer, '_loadStravaLogo').mockRejectedValue(new Error('logo asset missing'));

    const result = await renderer.renderRoute(encoded, { poweredByStrava: true });

    expect(result).toBeInstanceOf(Buffer);
    expect(await countOrangePixels(result, BRAND_REGION)).toBe(0);
    expect(logger.map.warn).toHaveBeenCalledWith(
      'Could not composite the Powered by Strava logo',
      { error: 'logo asset missing' }
    );
  });

  it('resizes the logo once and reuses it across renders', async () => {
    const { MapRenderer } = loadMapRenderer();
    const renderer = new MapRenderer({ fetchTiles: makeFetchTiles() });

    const first = await renderer._loadStravaLogo(120);
    const second = await renderer._loadStravaLogo(120);

    expect(first.width).toBe(120);
    expect(second.buffer).toBe(first.buffer);
  });

  it('does not cache a failed logo load', async () => {
    const { MapRenderer } = loadMapRenderer();
    const renderer = new MapRenderer({ fetchTiles: makeFetchTiles() });

    // 0 is not a valid resize width — sharp rejects.
    await expect(renderer._loadStravaLogo(0)).rejects.toThrow();
    // The rejection was evicted, so a later valid width is unaffected.
    await expect(renderer._loadStravaLogo(0)).rejects.toThrow();
    await expect(renderer._loadStravaLogo(140)).resolves.toMatchObject({ width: 140 });
  });

  it('names a concrete font family for the attribution text', () => {
    // A generic `sans-serif` alone resolves to nothing in a container with no
    // fonts installed, and librsvg then draws .notdef boxes over the mandatory
    // OSM attribution. The Dockerfile installs DejaVu to match.
    const { MapRenderer } = loadMapRenderer();
    const renderer = new MapRenderer({ fetchTiles: makeFetchTiles() });

    const svg = renderer._buildOverlaySvg([[10, 10], [20, 20]], 12, 0, 0, 600, 400);

    expect(svg).toContain('font-family="DejaVu Sans, sans-serif"');
  });

  it('defaults to a real TileProvider instance when none is injected', () => {
    const { MapRenderer } = loadMapRenderer();

    expect(() => new MapRenderer()).not.toThrow();
  });

  it('exports a module-level singleton instance of the class', () => {
    const { MapRenderer } = loadMapRenderer();

    expect(MapRenderer.instance).toBeInstanceOf(MapRenderer);
  });
});
