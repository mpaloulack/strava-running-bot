-- Migration: give races/personal_bests the ON UPDATE CASCADE their FKs always
-- claimed to have.
-- Created: 2026-08-20
--
-- schema.js declares onUpdate: 'cascade' on every child table that points at
-- members.athlete_id, but 001 (races) and 003 (personal_bests) wrote their
-- FOREIGN KEY clauses without an ON UPDATE action, which SQLite defaults to
-- NO ACTION. Only 004 (activities) got it right. better-sqlite3 enables the
-- foreign_keys pragma by default, so renumbering a member's athlete_id on a
-- provider switch orphaned these two tables' rows and aborted the transaction.
--
-- SQLite cannot ALTER a foreign key, so each table is rebuilt. Both are child
-- tables that nothing else references, so foreign_keys stays ON throughout:
-- the INSERT ... SELECT then validates every row against members as it copies,
-- and the migration fails loudly rather than carrying orphans forward.

BEGIN;

-- ---------------------------------------------------------------- races ----
CREATE TABLE races_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  member_athlete_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  race_date TEXT NOT NULL, -- ISO date string
  race_type TEXT NOT NULL DEFAULT 'road', -- 'road' or 'trail'
  distance TEXT, -- e.g. "42.2km", "10mi", "5K"
  distance_km TEXT, -- Standardized distance in km for sorting/filtering
  location TEXT,
  status TEXT DEFAULT 'registered', -- registered, completed, cancelled, dns, dnf
  notes TEXT,
  goal_time TEXT, -- e.g. "3:30:00"
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  elevation TEXT,
  FOREIGN KEY (member_athlete_id) REFERENCES members(athlete_id) ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO races_new (
  id, member_athlete_id, name, race_date, race_type, distance, distance_km,
  location, status, notes, goal_time, created_at, updated_at, elevation
)
SELECT
  id, member_athlete_id, name, race_date, race_type, distance, distance_km,
  location, status, notes, goal_time, created_at, updated_at, elevation
FROM races;

DROP TABLE races;
ALTER TABLE races_new RENAME TO races;

CREATE INDEX IF NOT EXISTS race_member_idx ON races(member_athlete_id);
CREATE INDEX IF NOT EXISTS race_date_idx ON races(race_date);
CREATE INDEX IF NOT EXISTS race_type_idx ON races(race_type);

-- ------------------------------------------------------- personal_bests ----
CREATE TABLE personal_bests_new (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  member_athlete_id    INTEGER NOT NULL,
  category             TEXT NOT NULL,
  distance_m           REAL NOT NULL,
  elapsed_time         INTEGER NOT NULL,
  moving_time          INTEGER NOT NULL,
  strava_activity_id   TEXT NOT NULL,
  activity_name        TEXT,
  activity_date        TEXT NOT NULL,
  created_at           TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at           TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (member_athlete_id) REFERENCES members(athlete_id) ON DELETE CASCADE ON UPDATE CASCADE,
  UNIQUE (member_athlete_id, category)
);

INSERT INTO personal_bests_new (
  id, member_athlete_id, category, distance_m, elapsed_time, moving_time,
  strava_activity_id, activity_name, activity_date, created_at, updated_at
)
SELECT
  id, member_athlete_id, category, distance_m, elapsed_time, moving_time,
  strava_activity_id, activity_name, activity_date, created_at, updated_at
FROM personal_bests;

DROP TABLE personal_bests;
ALTER TABLE personal_bests_new RENAME TO personal_bests;

CREATE INDEX IF NOT EXISTS pb_member_idx ON personal_bests(member_athlete_id);

COMMIT;
