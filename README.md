# Strava Running Bot 🏃‍♂️

A comprehensive bot that automatically posts Strava activities from your running team members to a dedicated Discord channel. Built with real-time webhooks, rich activity displays, complete team management functionality, and an advanced race management system for tracking your team's upcoming events.

![Discord Bot](https://img.shields.io/badge/Discord-Bot-5865F2?style=for-the-badge&logo=discord&logoColor=white)
![Strava](https://img.shields.io/badge/Strava-API-FC4C02?style=for-the-badge&logo=strava&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-24-339933?style=for-the-badge&logo=node.js&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-Ready-2496ED?style=for-the-badge&logo=docker&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-Database-003B57?style=for-the-badge&logo=sqlite&logoColor=white)

[![CI](https://github.com/mpaloulack/strava-running-bot/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/mpaloulack/strava-running-bot/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/mpaloulack/strava-running-bot/branch/main/graph/badge.svg)](https://codecov.io/gh/mpaloulack/strava-running-bot)

## 🎯 Features

### 🏃 **Real-time Activity Posting**

- Automatically posts new activities from team members via Strava webhooks
- Rich Discord embeds with comprehensive activity information
- Supports all activity types (running, cycling, swimming, etc.)
- Posts both public and private activities from registered members

### 📊 **Comprehensive Activity Display**

- **Activity name and description**
- **Distance, time, and pace**
- **Grade Adjusted Pace (GAP)** for hill-adjusted performance
- **Average heart rate** and elevation gain
- **Route map visualization** (with optional Google Maps integration)
- **Direct links to Strava activities**
- **Activity type-specific styling and icons**

### 👥 **Team Management**

- Support for 40+ team members with secure token management
- OAuth2 authentication flow with encrypted token storage
- Member registration, deactivation, and removal
- Discord slash commands for easy team management
- Web-based registration system

### 🏆 **Race Management System**

- **Enhanced Race Planning**: Add upcoming races with road/trail categorization
- **Smart Distance Presets**: Quick selection for 5K, 10K, Half Marathon, Marathon
- **Custom Distances**: Flexible distance input for trail races and non-standard events
- **Race Tracking**: Monitor race status (registered, completed, cancelled, DNS, DNF)
- **Team Calendar**: View upcoming races for all team members
- **Public Announcements**: Race additions are shared with the entire team

### 🎮 **Discord Integration**

- **Slash Commands**: `/members`, `/register`, `/last`, `/sync`, `/pb`, `/botstatus`, `/my-races`, `/all-races`, `/settings`, `/scheduler`
- **Member Management**: Add, remove, activate/deactivate members
- **Activity Lookup**: View any member's latest activity on-demand
- **Race Management**: Complete race lifecycle management with team visibility
- **Admin Controls**: Permission-based management commands
- **Autocomplete**: Smart member name suggestions

### 🏆 **Personal Best Tracking**

- **Automatic PB Detection**: Detects new personal bests from every synced Strava activity
- **History Sync**: Scan the last 12 months of Strava history to populate PBs
- **Resumable Sync**: Checkpoint-based sync that can resume after interruption
- **All-time PRs**: Import all-time PRs from Strava's PR endpoint (1 Mile to Marathon)
- **Manual Import**: Add PBs from specific activities (useful for races older than 1 year)
- **Team Visibility**: View any member's personal bests with formatted embed display
- **Admin Status**: Admin command to inspect active/interrupted syncs and PB counts per member

### 🔒 **Security & Reliability**

- Encrypted token storage with AES-256 encryption
- Non-blocking asynchronous operations
- Graceful error handling and token refresh
- Health monitoring and status endpoints
- Docker-ready with security best practices

## 🚀 Quick Start

### Prerequisites

- Node.js 24 or higher (check package.json for the exact version as it's subject to change in the future)
- Discord bot token and server permissions
- Strava API application credentials
- Public domain/server for webhooks (production only)

### Installation

1. **Clone and Setup**

   ```bash
   git clone https://github.com/mpaloulack/strava-running-bot.git
   cd strava-running-bot
   npm install
   ```

2. **Configure Environment**

   ```bash
   cp .env.example .env
   # Edit .env with your API credentials (see detailed setup guide below)
   ```

3. **Start Development**

   ```bash
   npm run dev
   ```

4. **Deploy with Docker** (Optional)

   ```bash
   docker compose -f docker-compose.yml up -d
   ```

> **💡 Need help getting credentials?** Follow the [Complete Setup Guide](#-complete-setup-guide) below for detailed instructions.

## 📋 Complete Setup Guide

**Need detailed instructions?** Follow these step-by-step guides to get all required credentials and configure your bot.

### 1. Discord Bot Setup

#### Step 1: Create a Discord Application

1. Visit [Discord Developer Portal](https://discord.com/developers/applications)
2. Click **"New Application"** button (top right)
3. Enter a name for your bot (e.g., "Strava Running Bot")
4. Click **"Create"**

#### Step 2: Create and Configure the Bot

1. In the left sidebar, click **"Bot"**
2. Click **"Add Bot"** (if not already created)
3. Under **"Token"** section:
   - Click **"Copy"** to get your bot token
   - **⚠️ IMPORTANT**: Keep this token secret! It gives full access to your bot
   - Paste this token in your `.env` file as `DISCORD_TOKEN`

#### Step 3: Configure Bot Permissions

1. Still in the Bot section, scroll down to **"Privileged Gateway Intents"**
2. Enable **"Message Content Intent"** (required for some features)

#### Step 4: Generate Bot Invite Link

1. In the left sidebar, click **"OAuth2"** → **"URL Generator"**
2. Under **"Scopes"**, select:
   - ✅ `bot`
   - ✅ `applications.commands`
3. Under **"Bot Permissions"**, select:
   - ✅ `Send Messages`
   - ✅ `Use Slash Commands`
   - ✅ `Embed Links`
   - ✅ `Attach Files`
   - ✅ `Read Message History`
   - ✅ `Use External Emojis`
4. Copy the generated URL at the bottom

#### Step 5: Add Bot to Your Server

1. Open the invite link in your browser
2. Select your Discord server from the dropdown
3. Click **"Authorize"**
4. Complete the CAPTCHA if prompted

#### Step 6: Get Channel ID

1. In Discord, go to **User Settings** (gear icon ⚙️)
2. Go to **"Advanced"** and enable **"Developer Mode"**
3. Navigate to the channel where you want the bot to post activities
4. Right-click on the channel name
5. Select **"Copy Channel ID"**
6. Paste this ID in your `.env` file as `DISCORD_CHANNEL_ID`

### 2. Strava API Setup

#### Step 1: Create Strava API Application

1. Go to [Strava API Settings](https://www.strava.com/settings/api)
2. Log in with your Strava account (create one if you don't have it)
3. Click **"Create App"** button

#### Step 2: Fill Application Details

1. **Application Name**: Enter your bot name (e.g., "Strava Running Bot")
2. **Category**: Select **"Other"**
3. **Club**: Leave blank (unless you have a specific Strava club)
4. **Website**: Enter your website URL or GitHub repository URL
5. **Application Description**: Brief description of your bot
6. **Authorization Callback Domain**:
   - For **development**: `localhost` or `127.0.0.1`
   - For **production**: Your actual domain (e.g., `yourdomain.com`)
   - ⚠️ **Important**: Don't include `http://` or `https://`, just the domain

#### Step 3: Get API Credentials

1. After creating the app, you'll see your application details
2. Copy the **"Client ID"** and paste it in your `.env` file as `STRAVA_CLIENT_ID`
3. Copy the **"Client Secret"** and paste it in your `.env` file as `STRAVA_CLIENT_SECRET`
4. **⚠️ IMPORTANT**: Keep the Client Secret confidential!

#### Step 4: Generate Webhook Verification Token

1. Generate a secure random token for webhook verification:

   ```bash
   node -e "console.log(require('crypto').randomBytes(16).toString('hex'))"
   ```

2. Copy the generated token to your `.env` file as `STRAVA_WEBHOOK_VERIFY_TOKEN`
3. This token ensures that webhook requests are actually coming from Strava

#### Step 5: Note Your Rate Limits

- Strava API has rate limits: **100 requests per 15 minutes**, **1000 requests per day**
- The bot automatically handles these limits with a 20%/10% safety margin and proper throttling

### 3. Environment Configuration

#### Setup Your Environment File

```bash
cp .env.example .env
```

Edit your `.env` file with the credentials obtained from the previous steps. The `.env.example` file contains detailed comments for each variable.

#### Generate Required Keys

```bash
# Generate encryption key (required)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Generate webhook verification token (if not done already)
node -e "console.log(require('crypto').randomBytes(16).toString('hex'))"
```

> **⚠️ Security**: Never commit your `.env` file to version control. Keep all tokens and keys secure.

### 4. Webhook Setup (Production Only)

**⚠️ Note**: Webhooks are only needed for production deployment. For development, you can test the bot without webhooks.

#### Prerequisites for Webhook Setup

- A **public domain** or server accessible from the internet
- **HTTPS enabled** (Strava requires HTTPS for webhooks)
- Your bot running on that server

#### Step 1: Verify Your Server is Accessible

1. Deploy your bot to your production server
2. Ensure it's running on a public domain with HTTPS
3. Test that `https://yourdomain.com/health` returns a health check response

#### Step 2: Create Webhook Subscription

```bash
# Create webhook subscription (replace with your actual domain)
node utils/setup.js create-webhook https://yourdomain.com/webhook/strava

# This will register your server to receive activity updates from Strava
```

#### Step 3: Verify Webhook Setup

```bash
# List existing webhooks to confirm creation
node utils/setup.js list-webhooks

# You should see your webhook listed with the callback URL
```

#### Step 4: Test Webhook (Optional)

1. Post a new activity on Strava (or use an existing member's activity)
2. Check your bot's logs to see if the webhook is received
3. Verify the activity appears in your Discord channel

#### Webhook Management Commands

```bash
# List all webhook subscriptions
node utils/setup.js list-webhooks

# Delete a specific webhook (get ID from list command)
node utils/setup.js delete-webhook SUBSCRIPTION_ID

# Validate webhook configuration
node utils/setup.js validate-webhook
```

## 🎮 Discord Commands

### User Commands

| Command | Description | Usage |
|---------|-------------|-------|
| `/register` | Register yourself with Strava | `/register` |
| `/last` | Show last activity from a member | `/last member: John` |
| `/sync` | Sync recent Strava activities and update Personal Bests | `/sync` or `/sync from: 2025-01-01` |
| `/pb check` | View your personal bests (or another member's) | `/pb check` or `/pb check member: @user` |
| `/pb add` | Manually add PBs from a specific Strava activity | `/pb add activity_url: https://www.strava.com/activities/123456` |

### Race Management Commands

| Command | Description | Usage |
|---------|-------------|-------|
| `/my-races add` | Add an upcoming race | `/my-races add name: "Marathon" date: 21-04-2025 race_type: road distance_preset: Marathon` |
| `/my-races list` | List your races | `/my-races list` or `/my-races list status: registered` |
| `/my-races remove` | Remove a race | `/my-races remove race_id: 5` |
| `/my-races update` | Update race details | `/my-races update race_id: 5 status: completed` |
| `/my-races upcoming` | Show upcoming races for all members | `/my-races upcoming days: 30` |

### Admin Commands (Manage Server Permission Required)

| Command | Description | Usage |
|---------|-------------|-------|
| `/members list` | List all registered team members | `/members list` |
| `/members inactive` | List inactive members and optionally notify them | `/members inactive notify: dm` |
| `/members remove` | Remove a team member | `/members remove user: @user` |
| `/members deactivate` | Temporarily deactivate a member | `/members deactivate user: @user` |
| `/members reactivate` | Reactivate a deactivated member | `/members reactivate user: @user` |
| `/botstatus` | Show bot statistics and health | `/botstatus` |
| `/pb status` | Show PB sync status and stored PBs per member | `/pb status` |
| `/all-races list` | List all team races | `/all-races list` or `/all-races list status: upcoming` |
| `/all-races upcoming` | Show upcoming races for all members | `/all-races upcoming days: 60` |
| `/settings channel` | Set the Discord channel used for bot posts | `/settings channel channel: #running` |
| `/settings view` | View current bot settings | `/settings view` |
| `/scheduler weekly` | Manually trigger weekly race announcement | `/scheduler weekly` |
| `/scheduler monthly` | Manually trigger monthly race announcement | `/scheduler monthly` |
| `/scheduler status` | Show scheduler status and upcoming races | `/scheduler status` |

### Race Management Features

#### **Race Types**
- **Road Race**: Traditional road running events with standard distance presets
- **Trail Race**: Off-road events with custom distance input

#### **Distance Presets (Road Races)**
- **5K**: 5 kilometers
- **10K**: 10 kilometers  
- **Half Marathon**: 21.1 kilometers
- **Marathon**: 42.2 kilometers
- **Other**: Custom distance input

#### **Race Status Tracking**
- **Registered**: Signed up for the race
- **Completed**: Race finished successfully
- **Cancelled**: Race was cancelled
- **DNS**: Did Not Start
- **DNF**: Did Not Finish

### **Automated Scheduling Features**

#### **Weekly Race Announcements**
- **Schedule**: Every Monday at 8:00 AM UTC
- **Content**: All registered races for the current week (Monday-Sunday)
- **Format**: Grouped by date with race details and participant names
- **Smart Display**: Shows "Today", "Tomorrow", or days remaining

#### **Monthly Race Announcements**  
- **Schedule**: First day of each month at 8:00 AM UTC
- **Content**: All registered races for the current month
- **Format**: Organized by week with comprehensive race information
- **Statistics**: Total races and participating members count

#### **Configuration Options**
- **Enable/Disable**: Toggle weekly and monthly announcements independently
- **Custom Scheduling**: Modify timing using cron expressions
- **Timezone Support**: Configure announcements for your local timezone
- **Manual Testing**: Admin commands to trigger announcements on-demand

## 🌐 API Endpoints

### Health & Status

- `GET /health` - Health check endpoint
- `GET /members` - List all registered members (JSON)

### Member Management

- `POST /members/:athleteId/delete` - Remove member by athlete ID
- `POST /members/discord/:discordId/delete` - Remove member by Discord ID
- `POST /members/:athleteId/deactivate` - Deactivate member
- `POST /members/:athleteId/reactivate` - Reactivate member

### Strava Integration

- `GET /webhook/strava` - Webhook verification endpoint
- `POST /webhook/strava` - Webhook event receiver
- `GET /auth/strava` - Start OAuth flow
- `GET /auth/strava/callback` - OAuth callback handler

### Example Usage

```bash
# List all members
curl http://localhost:3000/members

# Remove a member
curl -X POST http://localhost:3000/members/12345678/delete

# Check bot health
curl http://localhost:3000/health
```

## 🏗️ Project Architecture

```text
strava-running-bot/
├── src/
│   ├── constants/
│   │   └── index.js                  # Shared constants
│   ├── database/
│   │   ├── connection.js             # SQLite connection
│   │   ├── DatabaseManager.js        # Drizzle-backed DB operations
│   │   ├── DatabaseMemberManager.js  # Member persistence layer
│   │   ├── migrate.js                # Migration runner
│   │   ├── native-sqlite-adapter.js  # better-sqlite3 adapter
│   │   ├── schema.js                 # Drizzle schema definitions
│   │   └── migrations/               # Generated SQL migrations
│   │       ├── 001_complete_initial_schema.sql
│   │       ├── 002_add_elevation_field.sql
│   │       ├── 003_add_personal_bests_table.sql
│   │       └── 004_add_activities_table.sql
│   ├── discord/
│   │   ├── bot.js                    # Discord client + command registration
│   │   └── commands.js               # Slash command handlers
│   ├── managers/
│   │   ├── ActivityQueue.js          # Delayed activity post queue
│   │   ├── LeaderboardManager.js     # Monthly running-km leaderboard
│   │   ├── MemberManager.js          # Team member management
│   │   ├── PBManager.js              # Personal Best tracking & sync
│   │   ├── RaceManager.js            # Race management system
│   │   ├── Scheduler.js              # Cron jobs for race announcements
│   │   └── SettingsManager.js        # Runtime-mutable settings
│   ├── processors/
│   │   └── ActivityProcessor.js      # Webhook → fetch → format → post
│   ├── server/
│   │   └── webhook.js                # Express webhook + OAuth callback
│   ├── strava/
│   │   └── api.js                    # Strava API wrapper + OAuth + refresh
│   ├── utils/
│   │   ├── ActivityFormatter.js      # Activity data formatting
│   │   ├── DateUtils.js              # Date/time helpers
│   │   ├── DiscordUtils.js           # Discord helpers
│   │   ├── EmbedBuilder.js           # Discord embed creation
│   │   ├── EncryptionUtils.js        # AES-256 token encryption
│   │   ├── Logger.js                 # Logging utilities
│   │   └── RateLimiter.js            # Strava API rate limiting
│   └── index.js                      # Application entry point
├── config/
│   ├── config.js                     # env → config object
│   └── dynamicConfig.js              # DB-backed runtime config
├── utils/
│   └── setup.js                      # Setup & webhook-management CLI
├── scripts/
│   └── refresh-expired-tokens.js     # Maintenance script
├── public/                           # Static assets served by webhook server
├── __tests__/                        # Jest test suites (mirrors src/)
├── docs/                             # API, deployment, troubleshooting, etc.
├── .github/workflows/
│   ├── ci.yml                        # Lint + tests + Codecov upload
│   └── build-and-push.yml            # Docker image build & push
├── .env.example                      # Environment variables template
├── Dockerfile                        # Container image definition
├── docker-compose.yml                # Local Docker deployment
├── docker-compose.prod.yml           # Production Docker deployment
└── README.md                         # This documentation
```

## 🗄️ Database Schema

The bot uses SQLite with automatic migrations. Below are the key tables:

### `members`
Stores registered team members with encrypted Strava OAuth tokens, Discord user info, and activation status.

### `activities`
Caches processed Strava activities to avoid duplicate Discord posts.

| Column | Type | Description |
|--------|------|-------------|
| `pr_categories` | TEXT | JSON array of PR category names achieved in this activity (e.g. `["5K","10K"]`). `NULL` if no PRs. |

### `personal_bests`
One row per athlete per distance category — always holds the current best time for that category.

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER | Auto-increment primary key |
| `member_athlete_id` | INTEGER | Foreign key → `members.athlete_id` (cascade delete) |
| `category` | TEXT | Normalized label: `5K`, `Half Marathon`, `Marathon`, etc. |
| `distance_m` | REAL | Actual distance in metres from the Strava best effort |
| `elapsed_time` | INTEGER | Best elapsed time in seconds |
| `moving_time` | INTEGER | Best moving time in seconds |
| `strava_activity_id` | TEXT | ID of the Strava activity where the PB was set |
| `activity_name` | TEXT | Name of that activity |
| `activity_date` | TEXT | ISO date string of the activity |
| `created_at` / `updated_at` | TEXT | Timestamps |

> **Unique constraint**: `(member_athlete_id, category)` — only one record per athlete per distance. An `UPDATE` replaces the previous best in-place.

### `races`
Tracks upcoming and past races entered by team members with status, distance, and race type.

### `settings`
Key/value store used internally for sync checkpoints (e.g. cursor timestamps for resumable PB history syncs).

---

### Key Components

#### **ActivityProcessor**

- Central orchestrator for all bot operations
- Handles activity processing pipeline with queuing system
- Manages Discord and Strava integrations
- Coordinates member management and activity filtering
- Processes webhook events with delayed posting

#### **DiscordBot**

- Discord.js v14 client wrapper with full intent support
- Slash command registration and autocomplete handling
- Rich embed generation using modular EmbedBuilder
- Google Maps route visualization integration
- Error handling with graceful client destruction

#### **StravaAPI**

- Complete Strava API wrapper with OAuth2 flow
- Automatic rate limiting (80/15min, 900/day with safety margins)
- Activity data processing with GAP calculations
- Token refresh and authentication management
- Webhook signature verification for security

#### **MemberManager**

- Secure member data storage with SQLite database
- JSON-to-SQLite migration support for existing installations
- Token management with automatic refresh
- Member lifecycle operations (register/deactivate/remove)
- Discord user mapping and profile integration

#### **PBManager**

- Personal best detection from `best_efforts` data in Strava activity responses
- Supports 12 standard distances: 400m, ½ Mile, 1K, 1 Mile, 2 Miles, 5K, 10K, 15K, 20K, Half Marathon, 20 Miles, Marathon
- Checkpoint-based history sync (last 12 months) that resumes after interruption
- Manual import from specific Strava activities with optional distance override
- Formats PBs as Discord embed fields with time, pace, and direct Strava links

#### **RaceManager**

- Complete race lifecycle management system
- Road and trail race categorization with smart distance handling
- Standard distance presets (5K, 10K, Half Marathon, Marathon)
- Custom distance support for trail races and special events
- Race status tracking and team calendar functionality
- Public race announcements for team engagement

#### **Scheduler**

- **Automated Race Announcements**: Cron-based scheduling for weekly and monthly race summaries
- **Monthly Leaderboard**: Posts the previous month's running-kilometre ranking on day 1
- **Configurable Timing**: Customizable schedule patterns with timezone support
- **Smart Race Grouping**: Intelligent organization of races by date and week
- **Discord Integration**: Direct posting to team channel with rich embedded announcements
- **Manual Triggers**: Admin testing capabilities with instant announcement generation

#### **LeaderboardManager**

- Aggregates the cached `activities` table by member for a calendar month
- Filters to running types (`Run`, `TrailRun`, `VirtualRun`) and active members only
- Uses `start_date_local` so a 11pm March 31 run counts in March, not April UTC
- Surfaced via `/leaderboard` (current or previous month) and the monthly cron job
#### **DatabaseManager**

- SQLite database with automatic migrations
- Snake_case field naming for SQL compatibility
- Atomic operations with proper transaction handling
- Schema evolution support with migration tracking
- Data integrity and foreign key constraints

#### **WebhookServer**

- Express.js server with comprehensive middleware
- Strava webhook event processing with signature validation
- RESTful member management API endpoints
- OAuth callback handling with HTML responses
- Health monitoring and error handling with proper status codes

#### **Utility Components**

- **RateLimiter**: Strava API compliance with request queuing
- **ActivityFormatter**: Distance, time, and pace calculations
- **EmbedBuilder**: Modular Discord embed creation system
- **DiscordUtils**: User ID parsing and utility functions
- **Logger**: Structured logging with category-based output

## 🔧 Configuration Options

### Environment Variables

| Variable | Required | Description | Default |
|----------|----------|-------------|---------|
| `DISCORD_TOKEN` | ✅ | Discord bot token | - |
| `DISCORD_CHANNEL_ID` | ✅ | Target Discord channel ID | - |
| `STRAVA_CLIENT_ID` | ✅ | Strava API client ID | - |
| `STRAVA_CLIENT_SECRET` | ✅ | Strava API client secret | - |
| `STRAVA_WEBHOOK_VERIFY_TOKEN` | ✅ | Webhook verification token | - |
| `ENCRYPTION_KEY` | ✅ | 32-byte hex encryption key for member data | - |
| `BASE_URL` | ✅* | Public URL for webhooks (production only) | `http://localhost:3000` |
| `PORT` | ❌ | Server port | `3000` |
| `NODE_ENV` | ❌ | Environment mode | `development` |
| `LOG_LEVEL` | ❌ | Logging level (DEBUG, INFO, WARN, ERROR) | `INFO` |
| `POST_DELAY_MINUTES` | ❌ | Delay before posting activities (minutes) | `15` |
| `SCHEDULER_TIMEZONE` | ❌ | Timezone for race announcements | `UTC` |
| `WEEKLY_RACE_ANNOUNCEMENTS` | ❌ | Enable weekly race announcements | `true` |
| `MONTHLY_RACE_ANNOUNCEMENTS` | ❌ | Enable monthly race announcements | `true` |
| `WEEKLY_SCHEDULE` | ❌ | Cron pattern for weekly announcements | `0 8 * * 1` (Mon 8AM) |
| `MONTHLY_SCHEDULE` | ❌ | Cron pattern for monthly announcements | `0 8 1 * *` (1st 8AM) |

> **Note**: `BASE_URL` is required for production deployments but optional for local development.

### Scheduling Configuration

The race announcement scheduler can be customized through environment variables:

```env
# Enable/disable automated announcements
WEEKLY_RACE_ANNOUNCEMENTS=true
MONTHLY_RACE_ANNOUNCEMENTS=true

# Customize announcement timing (cron format)
WEEKLY_SCHEDULE="0 8 * * 1"     # Every Monday at 8:00 AM
MONTHLY_SCHEDULE="0 8 1 * *"    # 1st day of month at 8:00 AM

# Set timezone for announcements
SCHEDULER_TIMEZONE="America/New_York"  # Default: UTC
```

#### Cron Schedule Examples

| Schedule | Cron Expression | Description |
|----------|----------------|-------------|
| Every Monday 8 AM | `0 8 * * 1` | Weekly announcements |
| 1st of month 8 AM | `0 8 1 * *` | Monthly overview |
| Every Friday 5 PM | `0 17 * * 5` | Weekend race prep |
| Every Sunday 6 PM | `0 18 * * 0` | Week ahead preview |

### Application Settings

- **Activity Filters**: Automatically filters activities without distance (weight training, etc.) and processes recent activities
- **Rate Limiting**: Conservative Strava API limits (80 requests/15min, 900/day) with request queuing and 20%/10% safety margin
- **Posting Delay**: Configurable delay before posting activities (default: 15 minutes) to allow for activity completion
- **Route Visualization**: Google Maps integration for GPS route display in Discord embeds
- **Token Management**: Automatic OAuth2 token refresh with secure AES-256 encrypted storage
- **Data Persistence**: Atomic JSON file operations with backup and recovery mechanisms
- **Error Handling**: Comprehensive error recovery with graceful degradation and logging

## 🐳 Docker Deployment

### Quick Deploy

```bash
# Start with Docker Compose
docker compose -f docker-compose.yml up -d

# View logs
docker compose -f docker-compose.yml logs -f

# Check status
docker compose -f docker-compose.yml ps
```

### Production Deployment

For production deployment on a NAS or server:

1. **Configure Environment**: Set `NODE_ENV=production` in `.env`
2. **Resource Limits**: Adjust memory/CPU limits in `docker-compose.yml`
3. **Domain Setup**: Configure domain and HTTPS for webhooks
4. **Monitoring**: Set up log monitoring and alerting
5. **Backups**: Regular backup of member data volume

See [docs/DOCKER_DEPLOYMENT.md](./docs/DOCKER_DEPLOYMENT.md) for detailed Docker deployment instructions.

## 📊 Monitoring & Maintenance

### Health Checks

```bash
# Check application health
curl http://localhost:3000/health

# View bot statistics
curl http://localhost:3000/members

# Check Docker health
docker compose -f docker-compose.yml ps
```

### Logs

```bash
# Development
npm run dev

# Docker
docker compose -f docker-compose.yml logs -f

# Specific timeframe
docker compose -f docker-compose.yml logs --since="1h"
```

### Maintenance Tasks

- **Weekly**: Check member token status and activity
- **Monthly**: Update dependencies and security patches
- **Quarterly**: Review and rotate encryption keys
- **As needed**: Monitor Strava API quota usage

## 🛠 Development

### Project Scripts

```bash
npm start          # Start production server
npm run dev        # Start development server with nodemon
npm test           # Run tests (when implemented)
```

### Setup Utilities

```bash
# Validate configuration
node utils/setup.js validate

# Generate encryption key
node utils/setup.js generate-key

# Manage webhooks (production)
node utils/setup.js list-webhooks
```

### Key Dependencies

- **Node.js 24** - Latest LTS with improved performance and security
- **Discord.js** - Modern Discord API wrapper with slash commands
- **Express** - Web framework for webhook server and API endpoints
- **better-sqlite3** - High-performance SQLite database driver
- **chalk** - Enhanced terminal colors with ESM support
- **dotenv** - Improved environment variable management
- **node-cron** - Advanced task scheduling capabilities
- **axios** - HTTP client for API requests
- **nodemon** - Development auto-restart utility

### Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Commit changes: `git commit -m 'Add amazing feature'`
4. Push to branch: `git push origin feature/amazing-feature`
5. Open a Pull Request

## 🔐 Security Considerations

### Data Protection

- **Encryption**: All sensitive member data encrypted with AES-256
- **Token Security**: Secure storage and automatic rotation of API tokens
- **Access Control**: Permission-based Discord command access
- **Input Validation**: Comprehensive input validation and sanitization

### Network Security

- **HTTPS Required**: Production deployment requires HTTPS
- **Webhook Verification**: Strava webhook signature validation
- **Rate Limiting**: API rate limiting and abuse prevention
- **Container Security**: Non-root user and minimal container surface

### Best Practices

- Regular security updates and dependency management
- Secure environment variable management
- Audit logs for administrative actions
- Backup and recovery procedures

## 🐛 Troubleshooting

### Common Issues

#### Bot Not Responding

```bash
# Check bot status
curl http://localhost:3000/health

# View logs
docker compose -f docker-compose.yml logs -f

# Verify Discord permissions
# Check bot invite URL and server permissions
```

#### Member Registration Failing

```bash
# Verify Strava credentials
node utils/setup.js validate

# Check redirect URI configuration
# Ensure domain matches Strava app settings
```

#### Activities Not Posting

```bash
# Check webhook subscription
node utils/setup.js list-webhooks

# Verify member tokens
curl http://localhost:3000/members

# Check webhook logs
docker compose -f docker-compose.yml logs -f | grep webhook
```

#### Token Refresh Errors

```bash
# Check member status
curl http://localhost:3000/members

# Manually refresh if needed
# Members may need to re-authorize
```

#### Webhooks

- **403 Forbidden**: Check that your `STRAVA_WEBHOOK_VERIFY_TOKEN` matches
- **404 Not Found**: Verify your server is running and accessible
- **SSL Certificate Error**: Ensure your domain has valid HTTPS
- **No webhook events**: Check Strava API rate limits and webhook subscription status

### Debug Mode

Enable debug logging by setting `LOG_LEVEL=DEBUG` in your `.env` file.

### Support

For additional support:

1. Check the logs for detailed error messages
2. Verify all configuration settings
3. Test individual components (Discord, Strava, webhooks)
4. Review Strava API quota and rate limits
5. Check network connectivity and firewall settings

## 📚 Additional Resources

- [Strava API Documentation](https://developers.strava.com/docs/reference/)
- [Discord.js Guide](https://discordjs.guide/)
- [Docker Documentation](https://docs.docker.com/)
- [Node.js Best Practices](https://github.com/goldbergyoni/nodebestpractices)

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🏆 Acknowledgments

- **Strava API** for providing comprehensive fitness data access
- **Discord.js** for excellent Discord bot development framework
- **Node.js Community** for robust ecosystem and best practices
- **Running Community** for inspiration and testing

---
**Built with ❤️ for the running community**
For questions, issues, or contributions, please visit our [GitHub repository](https://github.com/your-repo/strava-running-bot).
