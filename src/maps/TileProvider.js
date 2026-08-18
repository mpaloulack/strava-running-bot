const fs = require('node:fs/promises');
const path = require('node:path');
const axios = require('axios');
const config = require('../../config/config');
const logger = require('../utils/Logger');

// Be a polite client: fetch at most this many tiles concurrently so a single
// route render doesn't hammer the tile server.
const MAX_CONCURRENT_FETCHES = 4;

/**
 * Fetches OpenStreetMap-style raster tiles ({z}/{x}/{y}.png), with a
 * write-through on-disk cache so repeat renders of nearby routes don't
 * re-hit the tile server. Config-driven — see `config.map` in
 * config/config.js.
 */
class TileProvider {
  constructor() {
    this.tileUrl = config.map.tileUrl;
    this.cacheDir = config.map.tileCacheDir;
    this.userAgent = config.map.userAgent;
    this.timeoutMs = config.map.timeoutMs;
    this.cacheTtlMs = config.map.tileCacheTtlMs;
    // Memoized _resolveCacheDir() promise — a promise rather than a flag so
    // concurrent fetchTiles() workers all await the same resolution instead of
    // racing ahead with a stale directory.
    this._cacheDirPromise = null;
  }

  /**
   * Resolve a writable cache directory, once per instance.
   *
   * The default cache dir is derived from `config.database.path`, which is
   * `/app/data/...` for Docker. Outside a container that path isn't writable,
   * so mirror the fallback `src/database/connection.js` already applies to the
   * database file itself and drop back to `<cwd>/app/data/tile-cache` — without
   * it every render would silently re-download its tiles, which the OSM tile
   * usage policy explicitly asks clients not to do.
   *
   * @returns {Promise<string|null>} usable cache dir, or null if none is writable
   */
  async _ensureCacheDir() {
    if (!this._cacheDirPromise) {
      this._cacheDirPromise = this._resolveCacheDir();
    }
    return this._cacheDirPromise;
  }

  /**
   * Probe the configured cache directory once, falling back as described above.
   *
   * @returns {Promise<string|null>}
   */
  async _resolveCacheDir() {
    try {
      await fs.mkdir(this.cacheDir, { recursive: true });
      return this.cacheDir;
    } catch (error) {
      const fallback = path.join(process.cwd(), 'app', 'data', 'tile-cache');
      try {
        await fs.mkdir(fallback, { recursive: true });
        logger.map.warn(`Cannot use tile cache dir ${this.cacheDir}, using local fallback`, {
          error: error.message,
          code: error.code,
          fallback,
        });
        this.cacheDir = fallback;
        return this.cacheDir;
      } catch (fallbackError) {
        logger.map.warn('No writable tile cache directory, tiles will not be cached', {
          error: fallbackError.message,
        });
        this.cacheDir = null;
        return null;
      }
    }
  }

  /**
   * Build the tile URL for a given z/x/y by substituting placeholders in
   * `config.map.tileUrl`.
   *
   * @param {number} z - zoom level
   * @param {number} x - tile X
   * @param {number} y - tile Y
   * @returns {string}
   */
  tileUrlFor(z, x, y) {
    return this.tileUrl
      .replace('{z}', z)
      .replace('{x}', x)
      .replace('{y}', y);
  }

  /**
   * On-disk cache path for a given z/x/y tile.
   *
   * @param {number} z
   * @param {number} x
   * @param {number} y
   * @returns {string}
   */
  _cachePathFor(cacheDir, z, x, y) {
    if (!cacheDir) return null;
    return path.join(cacheDir, String(z), String(x), `${y}.png`);
  }

  /**
   * Fetch a single tile as a PNG Buffer, serving from the on-disk cache
   * when a fresh copy is present and falling back to the network otherwise.
   *
   * @param {number} z
   * @param {number} x
   * @param {number} y
   * @returns {Promise<Buffer>}
   */
  async fetchTile(z, x, y) {
    const cacheDir = await this._ensureCacheDir();
    const cachePath = this._cachePathFor(cacheDir, z, x, y);

    const cached = cachePath ? await this._readFromCache(cachePath, z, x, y) : null;
    if (cached) return cached;

    const url = this.tileUrlFor(z, x, y);

    let response;
    try {
      response = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout: this.timeoutMs,
        headers: {
          // Required by the OSM tile usage policy: generic/default User-Agents
          // (e.g. axios' default) are blocked. Identify the app and give a
          // contact URL — see https://operations.osmfoundation.org/policies/tiles/
          'User-Agent': this.userAgent,
        },
      });
    } catch (error) {
      logger.map.warn(`Failed to fetch tile ${z}/${x}/${y}`, { error: error.message });
      throw new Error(`Failed to fetch tile ${z}/${x}/${y}`, { cause: error });
    }

    const buffer = Buffer.from(response.data);
    if (cachePath) {
      await this._writeToCache(cachePath, buffer, z, x, y);
    }

    return buffer;
  }

  /**
   * Fetch multiple tiles, preserving input order, with bounded concurrency.
   * If any tile fails, the whole call rejects.
   *
   * @param {Array<{z: number, x: number, y: number}>} tiles
   * @returns {Promise<Buffer[]>}
   */
  async fetchTiles(tiles) {
    const results = new Array(tiles.length);
    let nextIndex = 0;

    const worker = async () => {
      while (nextIndex < tiles.length) {
        const i = nextIndex++;
        const { z, x, y } = tiles[i];
        results[i] = await this.fetchTile(z, x, y);
      }
    };

    const workerCount = Math.min(MAX_CONCURRENT_FETCHES, tiles.length);
    await Promise.all(Array.from({ length: workerCount }, () => worker()));

    return results;
  }

  async _readFromCache(cachePath, z, x, y) {
    try {
      const stats = await fs.stat(cachePath);
      if (Date.now() - stats.mtimeMs >= this.cacheTtlMs) {
        return null;
      }
      const buffer = await fs.readFile(cachePath);
      logger.map.debug(`Tile cache hit for ${z}/${x}/${y}`, { cachePath });
      return buffer;
    } catch (_error) {
      // Missing, unreadable, or stat/read failure — fall through to network.
      return null;
    }
  }

  async _writeToCache(cachePath, buffer, z, x, y) {
    try {
      await fs.mkdir(path.dirname(cachePath), { recursive: true });
      await fs.writeFile(cachePath, buffer);
    } catch (error) {
      // A cache-write failure must never fail the tile fetch itself.
      logger.map.warn(`Failed to write tile cache for ${z}/${x}/${y}`, { error: error.message });
    }
  }
}

module.exports = TileProvider;
