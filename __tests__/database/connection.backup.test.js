const path = require('path');
const fsp = require('fs').promises;
const fs = require('fs');
const os = require('os');

jest.mock('../../src/utils/Logger', () => ({
  database: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }
}));

jest.mock('../../config/config', () => ({
  database: { path: '' }
}));

const config = require('../../config/config');
const dbConnection = require('../../src/database/connection');

describe('pre-migration database backups', () => {
  let testDataDir;

  const backupDir = () => path.join(testDataDir, 'backups');
  const backupFiles = () => (fs.existsSync(backupDir()) ? fs.readdirSync(backupDir()).sort() : []);

  beforeEach(async () => {
    testDataDir = path.join(os.tmpdir(), `db_backup_test_${Date.now()}_${Math.random().toString(36).slice(2)}`);
    await fsp.mkdir(testDataDir, { recursive: true });
    config.database.path = path.join(testDataDir, 'bot.db');
  });

  afterEach(async () => {
    await dbConnection.close();
    await fsp.rm(testDataDir, { recursive: true, force: true });
  });

  // A fresh install runs every migration at once against an empty file. There
  // is nothing to restore from, so a snapshot would be pure noise.
  it('should not snapshot a brand-new database', async () => {
    await dbConnection.initialize();

    expect(backupFiles()).toEqual([]);
  });

  it('should snapshot before applying migrations to a database that holds data', async () => {
    await dbConnection.initialize();
    const raw = dbConnection.getRawDb();
    raw.prepare(`
      INSERT INTO members (athlete_id, discord_id, discord_user_id, is_active, athlete, provider)
      VALUES (7, 'd7', 'd7', 1, '{}', 'strava')
    `).run();

    // Re-running migration 007 stands in for "a migration lands on a live database".
    raw.prepare('DELETE FROM migration_log WHERE migration_name = ?').run('007_align_child_fk_on_update');
    await dbConnection.close();

    await dbConnection.initialize();

    expect(backupFiles()).toHaveLength(1);
  });

  it('should write a snapshot that still contains the pre-migration rows', async () => {
    await dbConnection.initialize();
    const raw = dbConnection.getRawDb();
    raw.prepare(`
      INSERT INTO members (athlete_id, discord_id, discord_user_id, is_active, athlete, provider)
      VALUES (7, 'd7', 'd7', 1, '{}', 'strava')
    `).run();
    raw.prepare('DELETE FROM migration_log WHERE migration_name = ?').run('007_align_child_fk_on_update');
    await dbConnection.close();

    await dbConnection.initialize();

    const snapshot = require('better-sqlite3')(path.join(backupDir(), backupFiles()[0]), { readonly: true });
    try {
      expect(snapshot.prepare('SELECT athlete_id FROM members').all()).toEqual([{ athlete_id: 7 }]);
    } finally {
      snapshot.close();
    }
  });

  it('should not snapshot when every migration has already run', async () => {
    await dbConnection.initialize();
    await dbConnection.close();

    await dbConnection.initialize();

    expect(backupFiles()).toEqual([]);
  });

  it('should keep only the five newest snapshots', async () => {
    await dbConnection.initialize();
    fs.mkdirSync(backupDir(), { recursive: true });
    for (let i = 1; i <= 7; i++) {
      fs.writeFileSync(path.join(backupDir(), `bot.db.2026-01-0${i}${'.bak'}`), 'old');
    }

    dbConnection.pruneBackups();

    const remaining = backupFiles();
    expect(remaining).toHaveLength(5);
    expect(remaining[0]).toContain('2026-01-03');
    expect(remaining[4]).toContain('2026-01-07');
  });

  it('should leave files that are not snapshots alone when pruning', async () => {
    await dbConnection.initialize();
    fs.mkdirSync(backupDir(), { recursive: true });
    fs.writeFileSync(path.join(backupDir(), 'README.txt'), 'keep me');
    for (let i = 1; i <= 7; i++) {
      fs.writeFileSync(path.join(backupDir(), `bot.db.2026-01-0${i}.bak`), 'old');
    }

    dbConnection.pruneBackups();

    expect(backupFiles()).toContain('README.txt');
  });

  // Refusing to start is recoverable; an unrecoverable schema change is not.
  it('should refuse to migrate when the snapshot cannot be written', async () => {
    await dbConnection.initialize();
    const raw = dbConnection.getRawDb();
    raw.prepare(`
      INSERT INTO members (athlete_id, discord_id, discord_user_id, is_active, athlete, provider)
      VALUES (7, 'd7', 'd7', 1, '{}', 'strava')
    `).run();
    raw.prepare('DELETE FROM migration_log WHERE migration_name = ?').run('007_align_child_fk_on_update');
    await dbConnection.close();

    const backupSpy = jest.spyOn(dbConnection, 'backup').mockRejectedValue(new Error('disk full'));

    await expect(dbConnection.initialize()).rejects.toThrow(/Could not back up the database/);

    backupSpy.mockRestore();
  });

  it('should expose backup() for callers outside the migration path', async () => {
    await dbConnection.initialize();
    const destPath = path.join(testDataDir, 'manual', 'copy.db');

    await expect(dbConnection.backup(destPath)).resolves.toBe(destPath);
    expect(fs.existsSync(destPath)).toBe(true);
  });

  it('should skip the snapshot for an in-memory database', async () => {
    await dbConnection.initialize();
    config.database.path = ':memory:';

    await expect(dbConnection.backupBeforeMigrations(['007_align_child_fk_on_update'])).resolves.toBeNull();
  });

  it('should not throw when there is no backup directory to prune', async () => {
    await dbConnection.initialize();

    expect(() => dbConnection.pruneBackups()).not.toThrow();
  });
});
