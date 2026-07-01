const path = require('path');
const fs = require('fs').promises;
const os = require('os');

jest.mock('../../src/utils/Logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
}));

jest.mock('../../config/config', () => ({
  database: {
    path: ''
  }
}));

const config = require('../../config/config');
const dbConnection = require('../../src/database/connection');

describe('DatabaseConnection', () => {
  let testDataDir;

  beforeEach(async () => {
    testDataDir = path.join(os.tmpdir(), `db_connection_test_${Date.now()}`);
    await fs.mkdir(testDataDir, { recursive: true });
    config.database.path = path.join(testDataDir, 'test.db');
  });

  afterEach(async () => {
    await dbConnection.close();
    await fs.rm(testDataDir, { recursive: true, force: true });
  });

  // WAL mode depends on mmap-based shared-memory coordination between the
  // -wal/-shm files, which network/FUSE-backed volumes (the production NAS
  // deployment keeps its data dir on a network share) don't reliably
  // support. DELETE mode uses plain file I/O and has no such dependency.
  it('should use DELETE journal mode, not WAL', async () => {
    await dbConnection.initialize();

    const raw = dbConnection.getRawDb();
    const result = raw.pragma('journal_mode');

    expect(result[0].journal_mode.toLowerCase()).toBe('delete');
  });
});
