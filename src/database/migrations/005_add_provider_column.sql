-- Migration 005: Add provider column to members
-- 'strava'    → OAuth tokens in encrypted_tokens ({access_token, refresh_token, expires_at})
-- 'intervals' → intervals.icu API key in encrypted_tokens ({api_key})
ALTER TABLE members ADD COLUMN provider TEXT NOT NULL DEFAULT 'strava';
