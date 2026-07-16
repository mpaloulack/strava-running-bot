require('dotenv').config();
const { ENCRYPTION } = require('../src/constants');

const config = {
  discord: {
    token: process.env.DISCORD_TOKEN,
    channelId: process.env.DISCORD_CHANNEL_ID,
  },
  strava: {
    clientId: process.env.STRAVA_CLIENT_ID,
    clientSecret: process.env.STRAVA_CLIENT_SECRET,
    webhookVerifyToken: process.env.STRAVA_WEBHOOK_VERIFY_TOKEN,
    baseUrl: 'https://www.strava.com/api/v3',
    authUrl: 'https://www.strava.com/oauth/authorize',
    tokenUrl: 'https://www.strava.com/oauth/token',
  },
  server: {
    port: process.env.PORT || 3000,
    nodeEnv: process.env.NODE_ENV || 'development',
    baseUrl: process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`,
  },
  logging: {
    level: process.env.LOG_LEVEL || 'INFO',
  },
  posting: {
    delayMinutes: parseInt(process.env.POST_DELAY_MINUTES) || 15,
  },
  security: {
    encryptionKey: process.env.ENCRYPTION_KEY,
  },
  app: {
    name: 'Strava Running Bot',
    version: '1.0.0',
  },
  database: {
    path: process.env.DATABASE_PATH || '/app/data/bot.db',
  },
  scheduler: {
    // Enable/disable scheduled race announcements
    weeklyEnabled: process.env.WEEKLY_RACE_ANNOUNCEMENTS !== 'false', // Default: enabled
    monthlyEnabled: process.env.MONTHLY_RACE_ANNOUNCEMENTS !== 'false', // Default: enabled
    leaderboardEnabled: process.env.MONTHLY_LEADERBOARD !== 'false', // Default: enabled

    // Cron schedule patterns
    weeklySchedule: process.env.WEEKLY_SCHEDULE || '0 8 * * 1', // Every Monday at 8:00 AM
    monthlySchedule: process.env.MONTHLY_SCHEDULE || '0 8 1 * *', // First day of month at 8:00 AM
    // 9 AM (after the 8 AM race announcement) on day 1 of every month — posts the previous month's totals.
    leaderboardSchedule: process.env.LEADERBOARD_SCHEDULE || '0 9 1 * *',

    // Timezone for scheduling (important for proper timing)
    timezone: process.env.SCHEDULER_TIMEZONE || 'UTC',
  },
  healthCheck: {
    enabled: process.env.HEALTH_CHECK_ENABLED !== 'false', // Default: enabled
    schedule: process.env.HEALTH_CHECK_SCHEDULE || '*/5 * * * *', // Every 5 minutes
    timeoutMs: parseInt(process.env.HEALTH_CHECK_TIMEOUT_MS, 10) || 10000,
    discordNotify: process.env.HEALTH_CHECK_DISCORD_NOTIFY !== 'false', // Default: enabled
  }
};

// Validate required environment variables
const requiredEnvVars = [
  'DISCORD_TOKEN',
  'STRAVA_CLIENT_ID',
  'STRAVA_CLIENT_SECRET',
  'STRAVA_WEBHOOK_VERIFY_TOKEN',
  'ENCRYPTION_KEY'
];

// Note: DISCORD_CHANNEL_ID is now optional as it can be set via /settings command

// BASE_URL is not strictly required since it has a localhost fallback,
// but we'll warn if it's not set in production
if (process.env.NODE_ENV === 'production' && !process.env.BASE_URL) {
  console.warn('⚠️  BASE_URL not set in production environment. Using localhost fallback.');
  console.warn('   Set BASE_URL=https://yourdomain.com for production deployment.');
}

const missingEnvVars = requiredEnvVars.filter(envVar => !process.env[envVar]);

if (missingEnvVars.length > 0) {
  console.error('❌ Missing required environment variables:');
  missingEnvVars.forEach(envVar => console.error(`   - ${envVar}`));
  console.error('Please check your .env file and ensure all required variables are set.');
  process.exit(1);
}

// ENCRYPTION_KEY must be exactly KEY_LENGTH bytes, hex-encoded, for AES-256-GCM.
// A wrong-length key throws at encrypt/decrypt time deep in EncryptionUtils,
// which registerMember used to swallow silently — validate it up front instead.
const expectedKeyHexLength = ENCRYPTION.KEY_LENGTH * 2;
const encryptionKey = process.env.ENCRYPTION_KEY;
if (!/^[0-9a-fA-F]+$/.test(encryptionKey) || encryptionKey.length !== expectedKeyHexLength) {
  console.error(
    `❌ ENCRYPTION_KEY must be exactly ${expectedKeyHexLength} hex characters ` +
    `(${ENCRYPTION.KEY_LENGTH} bytes for AES-256-GCM), got ${encryptionKey.length}.`
  );
  console.error('   Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
  process.exit(1);
}

module.exports = config;