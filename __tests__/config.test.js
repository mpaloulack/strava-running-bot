const REQUIRED_ENV = {
  DISCORD_TOKEN: 'test-discord-token',
  STRAVA_CLIENT_ID: 'test-client-id',
  STRAVA_CLIENT_SECRET: 'test-client-secret',
  STRAVA_WEBHOOK_VERIFY_TOKEN: 'test-webhook-token',
  // 64 hex chars = 32 bytes, valid for AES-256-GCM
  ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
};

describe('config', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.resetModules();
    jest.spyOn(console, 'error').mockImplementation(() => {});
    for (const key of Object.keys(REQUIRED_ENV)) {
      delete process.env[key];
    }
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('loads successfully with a valid 64-character hex ENCRYPTION_KEY', () => {
    Object.assign(process.env, REQUIRED_ENV);

    let config;
    expect(() => {
      config = require('../config/config');
    }).not.toThrow();

    expect(config.security.encryptionKey).toBe(REQUIRED_ENV.ENCRYPTION_KEY);
  });

  it('exits the process when ENCRYPTION_KEY is the wrong length', () => {
    Object.assign(process.env, REQUIRED_ENV, { ENCRYPTION_KEY: 'tooshort' });

    expect(() => {
      require('../config/config');
    }).toThrow('Process exited with code: 1');

    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('ENCRYPTION_KEY'));
  });

  it('exits the process when ENCRYPTION_KEY is not valid hex', () => {
    Object.assign(process.env, REQUIRED_ENV, {
      ENCRYPTION_KEY: 'not-a-hex-string-at-all-not-a-hex-string-at-all-not-a-hex-strin'
    });

    expect(() => {
      require('../config/config');
    }).toThrow('Process exited with code: 1');

    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('ENCRYPTION_KEY'));
  });
});
