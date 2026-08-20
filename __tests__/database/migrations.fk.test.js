const path = require('path');
const fs = require('fs').promises;
const os = require('os');

jest.mock('../../src/utils/Logger', () => ({
  database: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }
}));

jest.mock('../../config/config', () => ({
  database: { path: '' },
  security: { encryptionKey: null }
}));

const config = require('../../config/config');
const dbConnection = require('../../src/database/connection');

// 007 rebuilds races and personal_bests so their FKs carry the ON UPDATE
// CASCADE that schema.js always claimed. Rebuilding a table is the one
// migration shape that can silently lose columns, rows, indexes or ids, so
// assert each of those explicitly rather than trusting the SQL by eye.
describe('migration 007 - child FK alignment', () => {
  let testDataDir;
  let raw;

  beforeEach(async () => {
    testDataDir = path.join(os.tmpdir(), `db_fk_test_${Date.now()}_${Math.random().toString(36).slice(2)}`);
    await fs.mkdir(testDataDir, { recursive: true });
    config.database.path = path.join(testDataDir, 'test.db');

    await dbConnection.initialize();
    raw = dbConnection.getRawDb();
  });

  afterEach(async () => {
    await dbConnection.close();
    await fs.rm(testDataDir, { recursive: true, force: true });
  });

  const fkFor = (table) =>
    raw.pragma(`foreign_key_list(${table})`).find(f => f.table === 'members');

  it('should give every child table ON UPDATE CASCADE to members', () => {
    for (const child of ['races', 'personal_bests', 'activities']) {
      expect({ child, ...fkFor(child) }).toMatchObject({
        child,
        table: 'members',
        from: 'member_athlete_id',
        to: 'athlete_id',
        on_update: 'CASCADE',
        on_delete: 'CASCADE'
      });
    }
  });

  it('should keep the indexes the rebuilt tables had', () => {
    const indexNames = (table) =>
      raw.prepare('SELECT name FROM sqlite_master WHERE type = ? AND tbl_name = ?')
        .all('index', table).map(r => r.name);

    expect(indexNames('races')).toEqual(
      expect.arrayContaining(['race_member_idx', 'race_date_idx', 'race_type_idx'])
    );
    expect(indexNames('personal_bests')).toEqual(expect.arrayContaining(['pb_member_idx']));
  });

  it('should keep the UNIQUE(member_athlete_id, category) guard on personal_bests', () => {
    raw.prepare(`
      INSERT INTO members (athlete_id, discord_id, discord_user_id, is_active, athlete, provider)
      VALUES (1, 'd1', 'd1', 1, '{}', 'strava')
    `).run();

    const insertPB = () => raw.prepare(`
      INSERT INTO personal_bests (member_athlete_id, category, distance_m, elapsed_time, moving_time, strava_activity_id, activity_date)
      VALUES (1, '5K', 5000, 1200, 1200, '111', '2026-08-20T08:00:00Z')
    `).run();

    insertPB();
    expect(() => insertPB()).toThrow(/UNIQUE/);
  });

  it('should still reject a child row with no matching member', () => {
    expect(() => raw.prepare(`
      INSERT INTO races (member_athlete_id, name, race_date, race_type)
      VALUES (424242, 'Ghost Race', '2026-04-12', 'road')
    `).run()).toThrow(/FOREIGN KEY/);
  });

  it('should cascade a parent athlete_id change without any manual child update', () => {
    raw.prepare(`
      INSERT INTO members (athlete_id, discord_id, discord_user_id, is_active, athlete, provider)
      VALUES (1, 'd1', 'd1', 1, '{}', 'strava')
    `).run();
    raw.prepare(`
      INSERT INTO races (member_athlete_id, name, race_date, race_type)
      VALUES (1, 'Marathon de Paris', '2026-04-12', 'road')
    `).run();
    raw.prepare(`
      INSERT INTO personal_bests (member_athlete_id, category, distance_m, elapsed_time, moving_time, strava_activity_id, activity_date)
      VALUES (1, '5K', 5000, 1200, 1200, '111', '2026-08-20T08:00:00Z')
    `).run();

    raw.prepare('UPDATE members SET athlete_id = 2 WHERE athlete_id = 1').run();

    expect(raw.prepare('SELECT COUNT(*) c FROM races WHERE member_athlete_id = 2').get().c).toBe(1);
    expect(raw.prepare('SELECT COUNT(*) c FROM personal_bests WHERE member_athlete_id = 2').get().c).toBe(1);
    expect(raw.pragma('foreign_key_check')).toEqual([]);
  });

  it('should still cascade deletes', () => {
    raw.prepare(`
      INSERT INTO members (athlete_id, discord_id, discord_user_id, is_active, athlete, provider)
      VALUES (1, 'd1', 'd1', 1, '{}', 'strava')
    `).run();
    raw.prepare(`
      INSERT INTO races (member_athlete_id, name, race_date, race_type)
      VALUES (1, 'Marathon de Paris', '2026-04-12', 'road')
    `).run();

    raw.prepare('DELETE FROM members WHERE athlete_id = 1').run();

    expect(raw.prepare('SELECT COUNT(*) c FROM races').get().c).toBe(0);
  });

  it('should be recorded once and not re-run on a second startup', async () => {
    const applied = () => raw.prepare(
      'SELECT COUNT(*) c FROM migration_log WHERE migration_name = ? AND success = 1'
    ).get('007_align_child_fk_on_update').c;

    expect(applied()).toBe(1);

    await dbConnection.close();
    await dbConnection.initialize();
    raw = dbConnection.getRawDb();

    expect(applied()).toBe(1);
    expect(fkFor('races').on_update).toBe('CASCADE');
  });

  it('should leave no leftover _new scratch tables', () => {
    const leftovers = raw.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE '%\\_new' ESCAPE '\\'"
    ).all();

    expect(leftovers).toEqual([]);
  });
});
