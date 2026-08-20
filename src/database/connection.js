const Database = require('better-sqlite3');
const { drizzle } = require('drizzle-orm/better-sqlite3');
const logger = require('../utils/Logger');
const config = require('../../config/config');
const path = require('node:path');
const fs = require('node:fs');

// How many pre-migration snapshots to keep. Migrations are rare and the
// database is small (single-digit MB), so a handful of restore points costs
// almost nothing and covers the window where a bad migration is noticed.
const BACKUP_RETENTION = 5;
const BACKUP_SUFFIX = '.bak';

class DatabaseConnection {
  db = null;
  drizzle = null;
  isInitialized = false;

  async initialize() {
    try {
      const dbPath = config.database.path || path.join(process.cwd(), 'data', 'data.db');
      let finalDbPath = dbPath;
      
      // Ensure the directory exists before creating the database
      const dbDir = path.dirname(dbPath);
      try {
        if (!fs.existsSync(dbDir)) {
          fs.mkdirSync(dbDir, { recursive: true });
          logger.database.info(`Created database directory: ${dbDir}`);
        }
      } catch (error) {
        // If we can't create the directory (permission denied), use local fallback
        logger.database.warn(`Cannot create directory ${dbDir}, using local fallback`, {
          error: error.message,
          code: error.code
        });
        const fallbackPath = path.join(process.cwd(), 'app', 'data');
        if (!fs.existsSync(fallbackPath)) {
          fs.mkdirSync(fallbackPath, { recursive: true });
        }
        finalDbPath = path.join(fallbackPath, 'bot.db');
        logger.database.info(`Using fallback database path: ${finalDbPath}`);
      }
      
      logger.database.info(`Connecting to database at: ${finalDbPath}`);
      
      this.db = new Database(finalDbPath);
      // DELETE journal mode: WAL depends on mmap-based shared memory (-shm),
      // which network/FUSE-backed volumes (the production data dir is a NAS
      // share) don't reliably support. DELETE uses plain file I/O only.
      this.db.exec('PRAGMA journal_mode = DELETE;');
      this.db.exec('PRAGMA synchronous = NORMAL;');
      const journalMode = this.db.pragma('journal_mode', { simple: true });
      logger.database.info(`SQLite journal mode: ${journalMode}`);
      
      // Run migrations first
      await this.runMigrations();
      
      this.drizzle = drizzle(this.db);
      this.isInitialized = true;
      logger.database.info('Database connection established successfully');
      
      return this.drizzle;
    } catch (error) {
      logger.database.error('Failed to initialize database', { error: error.message });
      throw error;
    }
  }

  getDb() {
    if (!this.isInitialized) {
      throw new Error('Database not initialized. Call initialize() first.');
    }
    return this.drizzle;
  }

  getRawDb() {
    if (!this.isInitialized) {
      throw new Error('Database not initialized. Call initialize() first.');
    }
    return this.db;
  }

  async close() {
    if (this.db) {
      this.db.close();
      this.isInitialized = false;
      logger.database.info('Database connection closed');
    }
  }

  /**
   * Snapshot the database to destPath using SQLite's online backup API, which
   * produces a consistent copy even with the connection open.
   */
  async backup(destPath) {
    if (!this.db) {
      throw new Error('Database not initialized. Call initialize() first.');
    }

    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    await this.db.backup(destPath);

    return destPath;
  }

  backupDir() {
    const dbPath = config.database.path || path.join(process.cwd(), 'data', 'data.db');
    return path.join(path.dirname(dbPath), 'backups');
  }

  /**
   * True once the database holds real tables. A brand-new install runs every
   * migration at once against an empty file, and there is nothing to restore
   * from, so snapshotting it would only add noise.
   */
  hasUserData() {
    const { count } = this.db.prepare(`
      SELECT COUNT(*) AS count FROM sqlite_master
      WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name != 'migration_log'
    `).get();

    return count > 0;
  }

  /**
   * Take a restore point before applying pending migrations.
   *
   * A migration that rebuilds a table (007) cannot be undone by re-running
   * anything, so the only real rollback is a copy of the file as it was. This
   * fails closed: if the snapshot can't be written, the migrations don't run.
   * Refusing to start is recoverable; an unrecoverable schema change is not.
   */
  async backupBeforeMigrations(pendingNames) {
    const dbPath = config.database.path;

    if (!dbPath || dbPath === ':memory:') {
      return null;
    }

    if (!this.hasUserData()) {
      logger.database.info('Fresh database - skipping pre-migration backup', {
        pending: pendingNames
      });
      return null;
    }

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const destPath = path.join(this.backupDir(), `${path.basename(dbPath)}.${stamp}${BACKUP_SUFFIX}`);

    try {
      await this.backup(destPath);
      logger.database.info('Pre-migration backup written', {
        path: destPath,
        sizeBytes: fs.statSync(destPath).size,
        pending: pendingNames
      });
    } catch (error) {
      logger.database.error('Pre-migration backup failed - refusing to run migrations', {
        path: destPath,
        error: error.message
      });
      throw new Error(`Could not back up the database before migrating: ${error.message}`, { cause: error });
    }

    this.pruneBackups();

    return destPath;
  }

  /**
   * Keep the newest BACKUP_RETENTION snapshots. Pruning must never take the
   * process down - losing an old restore point is not worth failing a startup
   * that has already been made safe by the snapshot above.
   */
  pruneBackups() {
    const dir = this.backupDir();

    try {
      const stale = fs.readdirSync(dir)
        .filter(name => name.endsWith(BACKUP_SUFFIX))
        .sort()
        .slice(0, -BACKUP_RETENTION);

      for (const name of stale) {
        fs.unlinkSync(path.join(dir, name));
        logger.database.info('Pruned old database backup', { path: path.join(dir, name) });
      }
    } catch (error) {
      logger.database.warn('Could not prune old database backups', { dir, error: error.message });
    }
  }

  async runMigrations() {
    try {
      const migrationsDir = path.join(__dirname, 'migrations');
      
      // Check if migrations directory exists
      if (!fs.existsSync(migrationsDir)) {
        logger.database.info('No migrations directory found, skipping migrations');
        return;
      }

      // Create migration_log table if it doesn't exist
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS migration_log (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          migration_name TEXT UNIQUE NOT NULL,
          executed_at TEXT DEFAULT CURRENT_TIMESTAMP,
          success INTEGER NOT NULL,
          error_message TEXT,
          data_backup TEXT
        );
      `);

      // Get all SQL migration files
      const files = fs.readdirSync(migrationsDir)
        .filter(file => file.endsWith('.sql'))
        .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));

      const pending = [];
      for (const file of files) {
        const migrationName = path.basename(file, '.sql');

        // Check if migration already executed
        const existingMigration = this.db.prepare(
          'SELECT * FROM migration_log WHERE migration_name = ?'
        ).get(migrationName);

        if (existingMigration?.success) {
          logger.database.info(`Migration ${migrationName} already executed, skipping`);
          continue;
        }

        pending.push(file);
      }

      if (pending.length === 0) {
        logger.database.info('No pending migrations');
        return;
      }

      // Restore point first - a migration that rebuilds a table can't be undone
      // by re-running anything, so the file as it was is the only way back.
      await this.backupBeforeMigrations(pending.map(file => path.basename(file, '.sql')));

      for (const file of pending) {
        const migrationName = path.basename(file, '.sql');

        logger.database.info(`Running migration: ${migrationName}`);
        
        try {
          const migrationSql = fs.readFileSync(
            path.join(migrationsDir, file), 
            'utf-8'
          );
          
          // Execute migration
          this.db.exec(migrationSql);
          
          // Log successful migration
          this.db.prepare(`
            INSERT OR REPLACE INTO migration_log (migration_name, success) 
            VALUES (?, 1)
          `).run(migrationName);
          
          logger.database.info(`Migration ${migrationName} completed successfully`);
          
        } catch (error) {
          // Log failed migration
          this.db.prepare(`
            INSERT OR REPLACE INTO migration_log (migration_name, success, error_message) 
            VALUES (?, 0, ?)
          `).run(migrationName, error.message);
          
          logger.database.error(`Migration ${migrationName} failed`, { error: error.message });
          throw error;
        }
      }
      
      logger.database.info('All migrations completed successfully');
      
    } catch (error) {
      logger.database.error('Migration failed', { error: error.message });
      throw error;
    }
  }
}

const dbConnection = new DatabaseConnection();
module.exports = dbConnection;
