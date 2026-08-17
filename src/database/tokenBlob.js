/**
 * Shared helper for the encrypted per-member token blob format.
 *
 * Historically (before multi-provider support) a member's decrypted
 * `encrypted_tokens` blob stored a single provider's credentials flat at the
 * top level:
 *   - Strava OAuth tokens:      { access_token, refresh_token, expires_at, ... }
 *   - intervals.icu API keys:   { api_key }
 *
 * Members can now hold credentials for more than one provider at once (e.g.
 * after switching provider and back, without needing to re-authenticate), so
 * blobs are namespaced by provider:
 *   { strava?: { access_token, refresh_token, expires_at, ... }, intervals?: { api_key } }
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
