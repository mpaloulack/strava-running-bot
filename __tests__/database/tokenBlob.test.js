const { normalizeTokenBlob } = require('../../src/database/tokenBlob');

describe('normalizeTokenBlob', () => {
  it('should return an empty object for null', () => {
    expect(normalizeTokenBlob(null)).toEqual({});
  });

  it('should return an empty object for undefined', () => {
    expect(normalizeTokenBlob(undefined)).toEqual({});
  });

  it('should return an empty object for an unrecognized shape', () => {
    expect(normalizeTokenBlob({ foo: 'bar' })).toEqual({});
  });

  it('should wrap a legacy flat Strava blob under the strava namespace', () => {
    const legacy = { access_token: 'a', refresh_token: 'r', expires_at: 123 };
    expect(normalizeTokenBlob(legacy)).toEqual({ strava: legacy });
  });

  it('should wrap a legacy flat intervals.icu blob under the intervals namespace', () => {
    const legacy = { api_key: 'key123' };
    expect(normalizeTokenBlob(legacy)).toEqual({ intervals: legacy });
  });

  it('should pass through an already-namespaced blob with only strava', () => {
    const blob = { strava: { access_token: 'a' } };
    expect(normalizeTokenBlob(blob)).toBe(blob);
  });

  it('should pass through an already-namespaced blob with only intervals', () => {
    const blob = { intervals: { api_key: 'k' } };
    expect(normalizeTokenBlob(blob)).toBe(blob);
  });

  it('should pass through an already-namespaced blob with both providers', () => {
    const blob = { strava: { access_token: 'a' }, intervals: { api_key: 'k' } };
    expect(normalizeTokenBlob(blob)).toBe(blob);
  });
});
