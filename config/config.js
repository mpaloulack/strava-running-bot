require('dotenv').config();
const path = require('node:path');
const { ENCRYPTION } = require('../src/constants');

const databasePath = process.env.DATABASE_PATH || '/app/data/bot.db';

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
  intervals: {
    baseUrl: process.env.INTERVALS_BASE_URL || 'https://intervals.icu',
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
    path: databasePath,
  },
  // Self-hosted route maps: OpenStreetMap raster tiles composited locally.
  // No API key or external map service — see the OSM tile usage policy
  // (https://operations.osmfoundation.org/policies/tiles/), which is why the
  // User-Agent, the on-disk tile cache and the attribution are mandatory.
  map: {
    enabled: process.env.MAP_ENABLED !== 'false', // Default: enabled
    // Any {z}/{x}/{y} raster tile URL — e.g. OpenTopoMap or CyclOSM for trails.
    tileUrl: process.env.MAP_TILE_URL || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    // Defaults next to the database file so Docker deployments keep it in the data volume.
    tileCacheDir: process.env.MAP_TILE_CACHE_DIR || path.join(path.dirname(databasePath), 'tile-cache'),
    // OSM blocks generic User-Agents; identify the app and give a contact URL.
    userAgent: process.env.MAP_USER_AGENT
      || 'strava-running-bot/1.0 (+https://github.com/mpaloulack/strava-running-bot)',
    attribution: '© OpenStreetMap contributors',
    width: parseInt(process.env.MAP_WIDTH, 10) || 600,
    height: parseInt(process.env.MAP_HEIGHT, 10) || 400,
    maxTiles: parseInt(process.env.MAP_MAX_TILES, 10) || 20, // bound on the tile grid per render
    timeoutMs: parseInt(process.env.MAP_TIMEOUT_MS, 10) || 8000, // total budget for one render
    tileCacheTtlMs: 7 * 24 * 60 * 60 * 1000, // OSM policy minimum when cache headers can't be honored
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

    // intervals.icu has no per-user webhooks without an approved OAuth app,
    // so members registered with an API key are polled on this schedule.
    intervalsPollEnabled: process.env.INTERVALS_POLL !== 'false', // Default: enabled
    intervalsPollSchedule: process.env.INTERVALS_POLL_SCHEDULE || '*/5 * * * *', // Every 5 minutes

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