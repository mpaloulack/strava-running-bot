const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs/promises');
const nock = require('nock');

const TEST_USER_AGENT = 'strava-running-bot-test/1.0 (+https://example.test)';
const TEST_TILE_URL = 'https://tile.example.test/{z}/{x}/{y}.png';
const TEST_TTL_MS = 7 * 24 * 60 * 60 * 1000;

let tileCacheDir;

describe('TileProvider', () => {
  let TileProvider;
  let provider;
  let logger;

  beforeEach(async () => {
    tileCacheDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tile-cache-'));

    jest.resetModules();
    nock.disableNetConnect();

    // Mock config/Logger fresh each test (after resetModules) so the config
    // mock closes over this test's own temp cache dir.
    jest.doMock('../../config/config', () => ({
      map: {
        enabled: true,
        tileUrl: TEST_TILE_URL,
        tileCacheDir,
        userAgent: TEST_USER_AGENT,
        attribution: '© OpenStreetMap contributors',
        width: 600,
        height: 400,
        maxTiles: 20,
        timeoutMs: 8000,
        tileCacheTtlMs: TEST_TTL_MS,
      },
    }));
    jest.doMock('../../src/utils/Logger', () => ({
      map: {
        error: jest.fn(),
        warn: jest.fn(),
        info: jest.fn(),
        debug: jest.fn(),
      },
    }));

    TileProvider = require('../../src/maps/TileProvider');
    logger = require('../../src/utils/Logger');
    provider = new TileProvider();
  });

  afterEach(async () => {
    nock.cleanAll();
    nock.enableNetConnect();
    await fs.rm(tileCacheDir, { recursive: true, force: true });
  });

  describe('tileUrlFor', () => {
    it('should substitute {z}/{x}/{y} placeholders', () => {
      expect(provider.tileUrlFor(12, 2200, 1343)).toBe('https://tile.example.test/12/2200/1343.png');
    });
  });

  describe('fetchTile', () => {
    it('should send the exact configured User-Agent header', async () => {
      const scope = nock('https://tile.example.test', {
        reqheaders: { 'user-agent': TEST_USER_AGENT },
      })
        .get('/1/2/3.png')
        .reply(200, Buffer.from('fake-png-bytes'));

      const buffer = await provider.fetchTile(1, 2, 3);

      expect(scope.isDone()).toBe(true);
      expect(Buffer.isBuffer(buffer)).toBe(true);
      expect(buffer.toString()).toBe('fake-png-bytes');
    });

    it('should write the fetched tile to the on-disk cache', async () => {
      nock('https://tile.example.test')
        .get('/5/10/15.png')
        .reply(200, Buffer.from('tile-data'));

      await provider.fetchTile(5, 10, 15);

      const cachePath = provider._cachePathFor(5, 10, 15);
      const cached = await fs.readFile(cachePath);
      expect(cached.toString()).toBe('tile-data');
    });

    it('should serve a cached tile with no network call on second fetch', async () => {
      const scope = nock('https://tile.example.test')
        .get('/5/10/15.png')
        .reply(200, Buffer.from('tile-data'));

      const first = await provider.fetchTile(5, 10, 15);
      expect(scope.isDone()).toBe(true);

      // No interceptor registered now — any HTTP call would throw via nock.
      nock.cleanAll();
      nock.disableNetConnect();

      const second = await provider.fetchTile(5, 10, 15);
      expect(second.toString()).toBe(first.toString());
    });

    it('should refetch when the cached tile has expired (stale mtime)', async () => {
      const first = nock('https://tile.example.test')
        .get('/5/10/15.png')
        .reply(200, Buffer.from('old-data'));

      await provider.fetchTile(5, 10, 15);
      expect(first.isDone()).toBe(true);

      const cachePath = provider._cachePathFor(5, 10, 15);
      const staleTime = new Date(Date.now() - TEST_TTL_MS - 1000);
      await fs.utimes(cachePath, staleTime, staleTime);

      const second = nock('https://tile.example.test')
        .get('/5/10/15.png')
        .reply(200, Buffer.from('new-data'));

      const buffer = await provider.fetchTile(5, 10, 15);

      expect(second.isDone()).toBe(true);
      expect(buffer.toString()).toBe('new-data');
    });

    it('should reject with a wrapped error on HTTP failure (404)', async () => {
      nock('https://tile.example.test').get('/9/1/1.png').reply(404, 'not found');

      await expect(provider.fetchTile(9, 1, 1)).rejects.toThrow('Failed to fetch tile 9/1/1');
    });

    it('should reject with a wrapped error on HTTP failure (500) and log a warning', async () => {
      nock('https://tile.example.test').get('/9/1/2.png').reply(500, 'server error');

      await expect(provider.fetchTile(9, 1, 2)).rejects.toThrow('Failed to fetch tile 9/1/2');
      expect(logger.map.warn).toHaveBeenCalled();
    });

    it('should include the original error as `cause` on the wrapped error', async () => {
      nock('https://tile.example.test').get('/9/1/3.png').reply(500, 'server error');

      let caught;
      try {
        await provider.fetchTile(9, 1, 3);
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeDefined();
      expect(caught.cause).toBeDefined();
    });

    it('should still return the buffer even if writing to the cache fails', async () => {
      nock('https://tile.example.test')
        .get('/5/10/15.png')
        .reply(200, Buffer.from('tile-data'));

      // Make the cache dir path collide with a file instead of a directory,
      // so mkdir(recursive) fails when TileProvider tries to write through.
      const conflictPath = path.join(tileCacheDir, '5');
      await fs.writeFile(conflictPath, 'not-a-directory');

      const buffer = await provider.fetchTile(5, 10, 15);

      expect(buffer.toString()).toBe('tile-data');
      expect(logger.map.warn).toHaveBeenCalled();
    });
  });

  describe('fetchTiles', () => {
    it('should fetch multiple tiles with bounded concurrency and preserve order', async () => {
      const tiles = [
        { z: 1, x: 0, y: 0 },
        { z: 1, x: 1, y: 0 },
        { z: 1, x: 0, y: 1 },
        { z: 1, x: 1, y: 1 },
        { z: 1, x: 2, y: 1 },
      ];

      tiles.forEach(({ z, x, y }) => {
        nock('https://tile.example.test')
          .get(`/${z}/${x}/${y}.png`)
          .reply(200, Buffer.from(`${z}-${x}-${y}`));
      });

      const buffers = await provider.fetchTiles(tiles);

      expect(buffers).toHaveLength(tiles.length);
      buffers.forEach((buffer, i) => {
        const { z, x, y } = tiles[i];
        expect(buffer.toString()).toBe(`${z}-${x}-${y}`);
      });
    });

    it('should reject the whole call if any tile fails', async () => {
      const tiles = [
        { z: 2, x: 0, y: 0 },
        { z: 2, x: 1, y: 0 },
        { z: 2, x: 2, y: 0 },
      ];

      nock('https://tile.example.test').get('/2/0/0.png').reply(200, Buffer.from('ok'));
      nock('https://tile.example.test').get('/2/1/0.png').reply(500, 'boom');
      nock('https://tile.example.test').get('/2/2/0.png').reply(200, Buffer.from('ok'));

      await expect(provider.fetchTiles(tiles)).rejects.toThrow('Failed to fetch tile 2/1/0');
    });
  });
});
