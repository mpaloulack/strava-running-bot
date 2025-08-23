const ActivityProcessor = require('./processors/ActivityProcessor');
const WebhookServer = require('./server/webhook');
const config = require('../config/config');
const logger = require('./utils/Logger');

class HFRRunningBot {
  constructor() {
    this.activityProcessor = new ActivityProcessor();
    this.webhookServer = new WebhookServer(this.activityProcessor);
    this.isRunning = false;
  }

  async start() {
    try {
      logger.system('🚀 Starting HFR Running Bot...');
      logger.system(`📊 Environment: ${config.server.nodeEnv}`);
      logger.system(`🤖 Bot Name: ${config.app.name} v${config.app.version}`);
      logger.system(`🔧 Log Level: ${config.logging.level}`);

      // Initialize activity processor
      await this.activityProcessor.initialize();

      // Start webhook server
      await this.webhookServer.start();

      // Set up graceful shutdown handlers
      this.setupGracefulShutdown();

      this.isRunning = true;
      
      logger.system('✅ HFR Running Bot started successfully!');
      logger.info('SYSTEM', '🔗 Member registration URL:', {
        url: `http://localhost:${config.server.port}/auth/strava?user_id=THEIR_DISCORD_USER_ID`
      });
      logger.info('SYSTEM', '📡 Webhook endpoint ready for Strava events');
      
      // Optionally process recent activities on startup
      if (config.server.nodeEnv === 'production') {
        logger.info('SYSTEM', '🔄 Processing recent activities from last 6 hours...');
        setTimeout(() => {
          this.activityProcessor.processRecentActivities(6);
        }, 5000); // Wait 5 seconds after startup
      }

    } catch (error) {
      logger.error('SYSTEM', '❌ Failed to start HFR Running Bot', error);
      await this.stop();
      process.exit(1);
    }
  }

  async stop() {
    if (!this.isRunning) return;

    logger.info('SYSTEM', '🔄 Stopping HFR Running Bot...');
    this.isRunning = false;

    try {
      await this.webhookServer.stop();
      await this.activityProcessor.shutdown();
      logger.info('SYSTEM', '✅ HFR Running Bot stopped successfully');
    } catch (error) {
      logger.error('SYSTEM', '❌ Error during shutdown', error);
    }
  }

  setupGracefulShutdown() {
    const shutdown = async (signal) => {
      logger.info('SYSTEM', `📡 Received ${signal}, initiating graceful shutdown...`);
      await this.stop();
      process.exit(0);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
    
    process.on('uncaughtException', (error) => {
      logger.error('SYSTEM', '❌ Uncaught Exception', error);
      this.stop().finally(() => process.exit(1));
    });

    process.on('unhandledRejection', (reason, promise) => {
      logger.error('SYSTEM', '❌ Unhandled Rejection', { promise, reason });
      this.stop().finally(() => process.exit(1));
    });
  }

  // Get bot status and statistics
  getStatus() {
    const stats = this.activityProcessor.getStats();
    const memberStats = this.activityProcessor.memberManager.getStats();
    
    return {
      isRunning: this.isRunning,
      uptime: process.uptime(),
      memoryUsage: process.memoryUsage(),
      nodeEnv: config.server.nodeEnv,
      version: config.app.version,
      activityStats: stats,
      memberStats: memberStats,
      timestamp: new Date().toISOString()
    };
  }
}

// Create and start the bot
const bot = new HFRRunningBot();

// Handle command line arguments
const args = process.argv.slice(2);

if (args.includes('--status')) {
  // Just print status and exit
  console.log(JSON.stringify(bot.getStatus(), null, 2));
  process.exit(0);
} else if (args.includes('--help')) {
  console.log(`
${config.app.name} v${config.app.version}

Usage: node src/index.js [options]

Options:
  --help     Show this help message
  --status   Show bot status
  
Environment Variables:
  DISCORD_TOKEN              Discord bot token
  DISCORD_CHANNEL_ID         Discord channel ID for posting activities
  STRAVA_CLIENT_ID           Strava API client ID
  STRAVA_CLIENT_SECRET       Strava API client secret
  STRAVA_WEBHOOK_VERIFY_TOKEN Strava webhook verification token
  ENCRYPTION_KEY             32-character hex key for encrypting member data
  PORT                       Server port (default: 3000)
  NODE_ENV                   Environment (development/production)

Setup Instructions:
1. Copy .env.example to .env and fill in your API credentials
2. Create Discord bot and get token
3. Create Strava API application and get credentials
4. Set up Strava webhook pointing to your server
5. Run the bot and register team members

For more information, visit: https://github.com/your-repo/hfr-running-bot
  `);
  process.exit(0);
} else {
  // Start the bot normally
  bot.start().catch(error => {
    logger.error('SYSTEM', '❌ Fatal error', error);
    process.exit(1);
  });
}

module.exports = HFRRunningBot;