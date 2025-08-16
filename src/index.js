const ActivityProcessor = require('./processors/ActivityProcessor');
const WebhookServer = require('./server/webhook');
const config = require('../config/config');

class HFRRunningBot {
  constructor() {
    this.activityProcessor = new ActivityProcessor();
    this.webhookServer = new WebhookServer(this.activityProcessor);
    this.isRunning = false;
  }

  async start() {
    try {
      console.log('🚀 Starting HFR Running Bot...');
      console.log(`📊 Environment: ${config.server.nodeEnv}`);
      console.log(`🤖 Bot Name: ${config.app.name} v${config.app.version}`);

      // Initialize activity processor
      await this.activityProcessor.initialize();

      // Start webhook server
      await this.webhookServer.start();

      // Set up graceful shutdown handlers
      this.setupGracefulShutdown();

      this.isRunning = true;
      
      console.log('✅ HFR Running Bot started successfully!');
      console.log('🔗 To register team members, have them visit:');
      console.log(`   http://localhost:${config.server.port}/auth/strava?user_id=THEIR_DISCORD_USER_ID`);
      console.log('📡 Webhook endpoint ready for Strava events');
      
      // Optionally process recent activities on startup
      if (config.server.nodeEnv === 'production') {
        console.log('🔄 Processing recent activities from last 6 hours...');
        setTimeout(() => {
          this.activityProcessor.processRecentActivities(6);
        }, 5000); // Wait 5 seconds after startup
      }

    } catch (error) {
      console.error('❌ Failed to start HFR Running Bot:', error);
      await this.stop();
      process.exit(1);
    }
  }

  async stop() {
    if (!this.isRunning) return;

    console.log('🔄 Stopping HFR Running Bot...');
    this.isRunning = false;

    try {
      await this.webhookServer.stop();
      await this.activityProcessor.shutdown();
      console.log('✅ HFR Running Bot stopped successfully');
    } catch (error) {
      console.error('❌ Error during shutdown:', error);
    }
  }

  setupGracefulShutdown() {
    const shutdown = async (signal) => {
      console.log(`\n📡 Received ${signal}, initiating graceful shutdown...`);
      await this.stop();
      process.exit(0);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
    
    process.on('uncaughtException', (error) => {
      console.error('❌ Uncaught Exception:', error);
      this.stop().finally(() => process.exit(1));
    });

    process.on('unhandledRejection', (reason, promise) => {
      console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
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
    console.error('❌ Fatal error:', error);
    process.exit(1);
  });
}

module.exports = HFRRunningBot;