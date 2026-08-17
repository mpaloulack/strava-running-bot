-- Migration 006: Add provider column to activities
-- Scopes cross-provider duplicate detection: the fuzzy start-time match only
-- compares rows from the OTHER provider, so two legitimate same-provider
-- activities started close together can never falsely dedupe each other.
-- Backfill from the id shape: intervals.icu activity ids are 'i'-prefixed.
ALTER TABLE activities ADD COLUMN provider TEXT NOT NULL DEFAULT 'strava';
UPDATE activities SET provider = 'intervals' WHERE strava_activity_id LIKE 'i%';
