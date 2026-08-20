const path = require('path');
const fs = require('fs').promises;
const os = require('os');

jest.mock('../../src/utils/Logger', () => ({
  database: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  memberAction: jest.fn()
}));

jest.mock('../../config/config', () => ({
  database: { path: '' },
  security: { encryptionKey: 'a'.repeat(64) }
}));

const config = require('../../config/config');
const dbConnection = require('../../src/database/connection');
const databaseManager = require('../../src/database/DatabaseManager');

// Exercises relinkMember against a REAL migrated SQLite database rather than a
// mock. The provider-switch renumbering is pure SQL-constraint behaviour, so a
// mocked db can't catch what actually broke here: races and personal_bests
// declare their FK as ON UPDATE NO ACTION, which aborts the parent UPDATE
// before the explicit child renumbering ever runs.
describe('DatabaseManager transactions (real SQLite)', () => {
  let testDataDir;
  let raw;

  const STRAVA_ID = 1094565;
  const INTERVALS_ID = 987654;

  beforeEach(async () => {
    testDataDir = path.join(os.tmpdir(), `db_relink_test_${Date.now()}_${Math.random().toString(36).slice(2)}`);
    await fs.mkdir(testDataDir, { recursive: true });
    config.database.path = path.join(testDataDir, 'test.db');

    databaseManager.isInitialized = false;
    await databaseManager.initialize();
    raw = dbConnection.getRawDb();

    raw.prepare(`
      INSERT INTO members (athlete_id, discord_id, discord_user_id, is_active, athlete, provider)
      VALUES (?, ?, ?, 1, ?, 'strava')
    `).run(STRAVA_ID, 'discord-fred', 'discord-fred', JSON.stringify({
      id: STRAVA_ID, firstname: 'Fred', lastname: 'B.'
    }));
  });

  afterEach(async () => {
    await dbConnection.close();
    databaseManager.isInitialized = false;
    await fs.rm(testDataDir, { recursive: true, force: true });
  });

  const seedPersonalBest = () => raw.prepare(`
    INSERT INTO personal_bests (member_athlete_id, category, distance_m, elapsed_time, moving_time, strava_activity_id, activity_date)
    VALUES (?, '5K', 5000, 1200, 1200, '111', '2026-08-20T08:00:00Z')
  `).run(STRAVA_ID);

  const seedActivity = () => raw.prepare(`
    INSERT INTO activities (strava_activity_id, member_athlete_id, name, type, provider)
    VALUES ('111', ?, 'Morning Run', 'Run', 'strava')
  `).run(STRAVA_ID);

  const seedRace = () => raw.prepare(`
    INSERT INTO races (member_athlete_id, name, race_date, race_type)
    VALUES (?, 'Marathon de Paris', '2026-04-12', 'road')
  `).run(STRAVA_ID);

  const relinkToIntervals = () => databaseManager.relinkMember(
    STRAVA_ID,
    { id: INTERVALS_ID, firstname: 'Fred', lastname: 'B.' },
    { api_key: 'test-key' },
    { username: 'bikounou', globalName: 'Fred B.' },
    'intervals'
  );

  describe('relinkMember', () => {
      it('should switch a member who has personal bests and activities', async () => {
      seedActivity();
      seedPersonalBest();
      seedRace();

      await expect(relinkToIntervals()).resolves.toMatchObject({
        athleteId: INTERVALS_ID,
        provider: 'intervals'
      });
    });

    it('should carry every child row over to the new athlete id', async () => {
      seedActivity();
      seedPersonalBest();
      seedRace();

      await relinkToIntervals();

      for (const table of ['races', 'personal_bests', 'activities']) {
        const moved = raw.prepare(`SELECT COUNT(*) c FROM ${table} WHERE member_athlete_id = ?`).get(INTERVALS_ID).c;
        const orphaned = raw.prepare(`SELECT COUNT(*) c FROM ${table} WHERE member_athlete_id = ?`).get(STRAVA_ID).c;

        expect({ table, moved, orphaned }).toEqual({ table, moved: 1, orphaned: 0 });
      }
    });

    it('should leave no dangling foreign keys behind', async () => {
      seedActivity();
      seedPersonalBest();
      seedRace();

      await relinkToIntervals();

      expect(raw.pragma('foreign_key_check')).toEqual([]);
    });

    it('should re-enforce foreign keys after the relink commits', async () => {
      seedActivity();

      await relinkToIntervals();

      // defer_foreign_keys is scoped to one transaction; a bad write afterwards
      // must still be rejected immediately.
      expect(() => raw.prepare(`
        INSERT INTO activities (strava_activity_id, member_athlete_id, name, provider)
        VALUES ('999', 424242, 'Orphan', 'strava')
      `).run()).toThrow(/FOREIGN KEY/);
    });

    it('should still switch a member with no child rows at all', async () => {
      await expect(relinkToIntervals()).resolves.toMatchObject({ athleteId: INTERVALS_ID });
    });

    it('should refuse to relink onto an athlete id already taken', () => {
      raw.prepare(`
        INSERT INTO members (athlete_id, discord_id, discord_user_id, is_active, athlete, provider)
        VALUES (?, 'discord-other', 'discord-other', 1, '{}', 'strava')
      `).run(INTERVALS_ID);

      return expect(relinkToIntervals()).rejects.toThrow(/already registered to a different member/);
    });
  });

  // removeMember uses the same drizzle transaction API as relinkMember, and had
  // the same misuse: drizzle runs the callback and returns its result, so
  // invoking that result as a function threw after the deletes had committed.
  describe('removeMember', () => {
    it('should return the removed member rather than throwing', async () => {
      seedActivity();
      seedRace();

      await expect(databaseManager.removeMember(STRAVA_ID)).resolves.toMatchObject({
        athleteId: STRAVA_ID
      });
    });

    it('should delete the member and its child rows', async () => {
      seedActivity();
      seedPersonalBest();
      seedRace();

      await databaseManager.removeMember(STRAVA_ID);

      expect(raw.prepare('SELECT COUNT(*) c FROM members WHERE athlete_id = ?').get(STRAVA_ID).c).toBe(0);
      for (const table of ['races', 'personal_bests', 'activities']) {
        expect(raw.prepare(`SELECT COUNT(*) c FROM ${table} WHERE member_athlete_id = ?`).get(STRAVA_ID).c).toBe(0);
      }
      expect(raw.pragma('foreign_key_check')).toEqual([]);
    });

    it('should return null for an unknown member', async () => {
      await expect(databaseManager.removeMember(4242424)).resolves.toBeNull();
    });
  });
});
