-- Migration: Add personal_bests table for PB tracking per member
-- Created: 2026-03-18

CREATE TABLE IF NOT EXISTS personal_bests (
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
  FOREIGN KEY (member_athlete_id) REFERENCES members(athlete_id) ON DELETE CASCADE,
  UNIQUE (member_athlete_id, category)
);

CREATE INDEX IF NOT EXISTS pb_member_idx ON personal_bests(member_athlete_id);
