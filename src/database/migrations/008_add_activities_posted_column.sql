-- Migration: record whether an activity was actually posted to Discord
-- Created: 2026-08-26
--
-- The activities table stores every activity that has been handled, including
-- ones deliberately not posted (private, hidden, too old, too short). Nothing
-- distinguished the two, so the intervals.icu poll - which short-circuits on
-- "is there already a row for this id?" - treated a filtered activity as
-- finished forever. A private run later made public could never post, and
-- unlike the Strava path that survived a restart, because the row persists.
--
-- Existing rows default to 1 (posted). Most of them were, and the ones that
-- were filtered are historical: leaving them alone avoids re-posting a backlog
-- of old private activities to the channel the first time this ships.

ALTER TABLE activities ADD COLUMN posted INTEGER NOT NULL DEFAULT 1;

-- The poll filters on this every cycle, per member.
CREATE INDEX IF NOT EXISTS activities_posted_idx ON activities(member_athlete_id, posted);
