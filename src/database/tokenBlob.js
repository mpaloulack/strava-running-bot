/**
 * Shared helper for the encrypted per-member token blob format.
 *
 * Historically (before multi-provider support) a member's decrypted
 * `encrypted_tokens` blob stored a single provider's credentials flat at the
 * top level:
 *   - Strava OAuth tokens:      { access_token, refresh_token, expires_at, ... }
 *   - intervals.icu API keys:   { api_key }
 *
 * Blobs are namespaced by provider so a member can, in principle, hold
 * credentials for more than one provider at once:
 *   { strava?: { access_token, refresh_token, expires_at, ... }, intervals?: { api_key } }
 *
 * In practice only intervals.icu credentials are preserved across a provider
 * switch: its API keys aren't seat-limited, so keeping them around lets a
 * member switch back to intervals.icu without re-entering one (see
 * `_tryInstantIntervalsSwitch` in commands.js). Strava is the opposite —
 * switching a member away from Strava, or removing/deactivating them, revokes
 * their access at Strava and deletes their `strava` namespace via
 * `ActivityProcessor.revokeStravaAccess` / `DatabaseManager.clearProviderTokens`,
 * because the app's Strava athlete cap is only freed once those credentials
 * are gone. A member who switches back to Strava must re-run /register
 * through OAuth — there is no instant switch-back for Strava.
 *
 * Every read of a decrypted token blob must go through `normalizeTokenBlob`
 * so legacy flat blobs and new namespaced blobs are handled identically.
 */

/**
 * Normalize a decrypted token blob into the namespaced { strava?, intervals? } shape.
 *
 * @param {Object|null|undefined} blob - decrypted token data (already run through EncryptionUtils.decryptTokens)
 * @returns {{ strava?: Object, intervals?: Object }}
 */
function normalizeTokenBlob(blob) {
  if (!blob) return {};

  // Already namespaced (new format) - pass through as-is.
  if (blob.strava || blob.intervals) {
    return blob;
  }

  // Legacy flat Strava OAuth blob.
  if (blob.access_token) {
    return { strava: blob };
  }

  // Legacy flat intervals.icu API-key blob.
  if (blob.api_key) {
    return { intervals: blob };
  }

  return {};
}

module.exports = { normalizeTokenBlob };
