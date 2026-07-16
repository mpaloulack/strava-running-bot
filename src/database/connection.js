const Database = require('better-sqlite3');
const { drizzle } = require('drizzle-orm/better-sqlite3');
const logger = require('../utils/Logger');
const config = require('../../config/config');
const path = require('node:path');
const fs = require('node:fs');

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
