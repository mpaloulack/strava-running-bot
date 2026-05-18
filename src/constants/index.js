/**
 * Application Constants
 *
 * Centralizes all magic numbers and constants used throughout the application
 */

// Encryption Constants
const ENCRYPTION = {
  IV_LENGTH: 16,           // Length of initialization vector for AES-256-GCM
  KEY_LENGTH: 32,          // Length of encryption key (256 bits)
  ALGORITHM: 'aes-256-gcm' // Encryption algorithm
};

// Time Constants
const TIME = {
  MS_PER_DAY: 24 * 60 * 60 * 1000,  // Milliseconds in a day
  MS_PER_HOUR: 60 * 60 * 1000,       // Milliseconds in an hour
  MS_PER_MINUTE: 60 * 1000,          // Milliseconds in a minute
  SECONDS_PER_HOUR: 3600             // Seconds in an hour
};

// Validation Limits
const VALIDATION = {
  MAX_NAME_LENGTH: 100,       // Maximum race name length
  MAX_LOCATION_LENGTH: 100,   // Maximum location string length
  MAX_NOTES_LENGTH: 500,      // Maximum notes field length
  MAX_GOAL_TIME_LENGTH: 20,   // Maximum goal time string length
  MAX_ELEVATION_LENGTH: 50,   // Maximum elevation string length
  MAX_DISTANCE_STRING_LENGTH: 50, // Maximum distance string length (e.g., "Half Marathon (21.1K)")
  MIN_DISTANCE: 0,            // Minimum valid race distance (km)
  MAX_DISTANCE: 1000          // Maximum valid race distance (km)
};

// Discord Embed Limits
const DISCORD = {
  MAX_EMBED_FIELDS: 25,       // Discord's maximum fields per embed
  MAX_FIELD_VALUE_LENGTH: 1024, // Maximum characters per field value
  MAX_EMBED_DESCRIPTION: 4096,  // Maximum embed description length
  MAX_EMBED_TITLE: 256,         // Maximum embed title length
  ITEMS_PER_PAGE: 10,           // Default pagination size
  CHUNK_SIZE: 5                 // Size for chunking large lists
};

// Date/Week Calculations
const DATE = {
  SUNDAY: 0,
  MONDAY: 1,
  DAYS_IN_WEEK: 7,
  WEEK_ADJUSTMENT_SUNDAY: -6,  // Days to subtract when day is Sunday
  WEEK_ADJUSTMENT_OTHER: 1      // Days to add for other days
};

// Race Status Values
const RACE_STATUS = {
  REGISTERED: 'registered',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
  DNS: 'dns',  // Did Not Start
  DNF: 'dnf'   // Did Not Finish
};

// Race Type Values
const RACE_TYPE = {
  ROAD: 'road',
  TRAIL: 'trail'
};

// Race Status Emojis
const RACE_EMOJI = {
  [RACE_STATUS.REGISTERED]: '📝',
  [RACE_STATUS.COMPLETED]: '✅',
  [RACE_STATUS.CANCELLED]: '❌',
  [RACE_STATUS.DNS]: '🚫',
  [RACE_STATUS.DNF]: '⚠️',
  [RACE_TYPE.ROAD]: '🏃‍♂️',
  [RACE_TYPE.TRAIL]: '🥾'
};

// Discord Channel Types
const CHANNEL_TYPE = {
  GUILD_TEXT: 0,
  DM: 1,
  GUILD_VOICE: 2,
  GROUP_DM: 3,
  GUILD_CATEGORY: 4,
  GUILD_ANNOUNCEMENT: 5
};

// Personal Best - maps Strava best_effort names to normalized display labels
const PB_EFFORT_LABELS = {
  '400m':          '400m',
  '1/2 mile':      '½ Mile',
  '1K':            '1K',
  '1 mile':        '1 Mile',
  '2 mile':        '2 Miles',
  '5K':            '5K',
  '10K':           '10K',
  '15K':           '15K',
  '20K':           '20K',
  'Half-Marathon': 'Half Marathon',
  '20 mile':       '20 Miles',
  'Marathon':      'Marathon',
};

// Activity types that support PB tracking
const SUPPORTED_PB_TYPES = ['Run'];

// Activity types counted toward the monthly running leaderboard.
// Wider than SUPPORTED_PB_TYPES because the leaderboard just sums distance —
// trail and treadmill runs are still running, even though Strava only emits
// best_efforts (used for PBs) on the 'Run' type.
const LEADERBOARD_RUN_TYPES = ['Run', 'TrailRun', 'VirtualRun'];

// Maximum distance shortfall/excess (as a fraction) to still consider
// an activity distance as covering a PB category.
// 0.02 = 2%: covers typical GPS inaccuracy (consumer watches are 0.5-2% off).
// e.g. 4900m (2.0% short of 5K) → qualifies; 4899m (2.02% short) → does not
const PB_DISTANCE_TOLERANCE_PERCENT = 0.02;

// Maps each PB category label to its canonical distance in meters
// Used to resolve a user-specified distance to the nearest PB category
const CATEGORY_DISTANCES = {
  '400m':          400,
  '½ Mile':        805,
  '1K':            1000,
  '1 Mile':        1609,
  '2 Miles':       3219,
  '5K':            5000,
  '10K':           10000,
  '15K':           15000,
  '20K':           20000,
  'Half Marathon': 21097,
  '20 Miles':      32187,
  'Marathon':      42195,
};

// Maps Strava /athletes/{id}/prs record_type (distance in meters) → PB category labels
// NOTE: Uses an undocumented Strava web endpoint. Distances without elapsed_time are skipped.
const STRAVA_PR_RECORD_TYPE_MAP = {
  1609:  '1 Mile',
  3219:  '2 Miles',
  5000:  '5K',
  10000: '10K',
  15000: '15K',
  20000: '20K',
  21097: 'Half Marathon',
  42195: 'Marathon',
};

module.exports = {
  ENCRYPTION,
  TIME,
  VALIDATION,
  DISCORD,
  DATE,
  RACE_STATUS,
  RACE_TYPE,
  RACE_EMOJI,
  CHANNEL_TYPE,
  PB_EFFORT_LABELS,
  SUPPORTED_PB_TYPES,
  LEADERBOARD_RUN_TYPES,
  PB_DISTANCE_TOLERANCE_PERCENT,
  STRAVA_PR_RECORD_TYPE_MAP,
  CATEGORY_DISTANCES,
};
