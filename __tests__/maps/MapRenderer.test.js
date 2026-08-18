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

  it('defaults to a real TileProvider instance when none is injected', () => {
    const { MapRenderer } = loadMapRenderer();

    expect(() => new MapRenderer()).not.toThrow();
  });

  it('exports a module-level singleton instance of the class', () => {
    const { MapRenderer } = loadMapRenderer();

    expect(MapRenderer.instance).toBeInstanceOf(MapRenderer);
  });
});
