-- Migration 004: Add activities table
-- Stores full activity data from Strava for use in future analytics features

CREATE TABLE IF NOT EXISTS activities (
  strava_activity_id   TEXT PRIMARY KEY,
  member_athlete_id    INTEGER NOT NULL REFERENCES members(athlete_id) ON DELETE CASCADE ON UPDATE CASCADE,
  name                 TEXT,
  type                 TEXT,
  sport_type           TEXT,
  distance             REAL,
  moving_time          INTEGER,
  elapsed_time         INTEGER,
  total_elevation_gain REAL,
  average_speed        REAL,
  max_speed            REAL,
  average_heartrate    REAL,
  max_heartrate        REAL,
  start_date           TEXT,
  start_date_local     TEXT,
  timezone             TEXT,
  map_summary_polyline TEXT,
  pr_categories        TEXT,
  has_heartrate        INTEGER DEFAULT 0,
  created_at           TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at           TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS activities_athlete_idx ON activities(member_athlete_id);
CREATE INDEX IF NOT EXISTS activities_start_date_idx ON activities(start_date);
