const crypto = require('crypto');
const config = require('../config/config');

class SetupHelper {
  static generateEncryptionKey() {
    return crypto.randomBytes(32).toString('hex');
  }

  static validateConfig() {
    const issues = [];

    // Check Discord configuration
    if (!config.discord.token) {
      issues.push('❌ Missing DISCORD_TOKEN');
    }
    if (!config.discord.channelId) {
      issues.push('❌ Missing DISCORD_CHANNEL_ID');
    }

    // Check Strava configuration
    if (!config.strava.clientId) {
      issues.push('❌ Missing STRAVA_CLIENT_ID');
    }
    if (!config.strava.clientSecret) {
      issues.push('❌ Missing STRAVA_CLIENT_SECRET');
    }
    if (!config.strava.webhookVerifyToken) {
      issues.push('❌ Missing STRAVA_WEBHOOK_VERIFY_TOKEN');
    }

    // Check security
    if (!config.security.encryptionKey) {
      issues.push('❌ Missing ENCRYPTION_KEY');
    } else if (config.security.encryptionKey.length !== 64) {
      issues.push('❌ ENCRYPTION_KEY must be 64 characters (32 bytes in hex)');
    }

    return {
      isValid: issues.length === 0,
      issues: issues
    };
  }

  static printSetupInstructions() {
    console.log(`
🤖 ${config.app.name} Setup Instructions

1. Discord Bot Setup:
   • Go to https://discord.com/developers/applications
   • Create a new application and bot
   • Copy bot token to DISCORD_TOKEN in .env
   • Add bot to server with "Send Messages" permission
   • Get channel ID and set DISCORD_CHANNEL_ID in .env

2. Strava API Setup:
   • Go to https://www.strava.com/settings/api
   • Create new API application
   • Set authorization callback to your domain
   • Copy Client ID and Secret to .env
   • Generate webhook verify token

3. Generate Encryption Key:
   Run: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

4. Set up Webhook (Production):
   curl -X POST https://www.strava.com/api/v3/push_subscriptions \\
     -F client_id=YOUR_CLIENT_ID \\
     -F client_secret=YOUR_CLIENT_SECRET \\
     -F callback_url=https://your-domain.com/webhook/strava \\
     -F verify_token=YOUR_VERIFY_TOKEN

5. Register Team Members:
   Send them to: http://your-domain.com/auth/strava?user_id=THEIR_DISCORD_ID

For detailed instructions, see README.md
    `);
  }

  static async createWebhookSubscription(callbackUrl) {
    const axios = require('axios');
    
    try {
      const response = await axios.post('https://www.strava.com/api/v3/push_subscriptions', {
        client_id: config.strava.clientId,
        client_secret: config.strava.clientSecret,
        callback_url: callbackUrl,
        verify_token: config.strava.webhookVerifyToken
      });

      console.log('✅ Webhook subscription created successfully:');
      console.log(JSON.stringify(response.data, null, 2));
      return response.data;

    } catch (error) {
      console.error('❌ Failed to create webhook subscription:');
      console.error(error.response?.data || error.message);
      throw error;
    }
  }

  static async listWebhookSubscriptions() {
    const axios = require('axios');
    
    try {
      const response = await axios.get('https://www.strava.com/api/v3/push_subscriptions', {
        params: {
          client_id: config.strava.clientId,
          client_secret: config.strava.clientSecret
        }
      });

      console.log('📡 Current webhook subscriptions:');
      console.log(JSON.stringify(response.data, null, 2));
      return response.data;

    } catch (error) {
      console.error('❌ Failed to list webhook subscriptions:');
      console.error(error.response?.data || error.message);
      throw error;
    }
  }

  static async deleteWebhookSubscription(subscriptionId) {
    const axios = require('axios');
    
    try {
      await axios.delete(`https://www.strava.com/api/v3/push_subscriptions/${subscriptionId}`, {
        params: {
          client_id: config.strava.clientId,
          client_secret: config.strava.clientSecret
        }
      });

      console.log(`✅ Webhook subscription ${subscriptionId} deleted successfully`);

    } catch (error) {
      console.error('❌ Failed to delete webhook subscription:');
      console.error(error.response?.data || error.message);
      throw error;
    }
  }
}

// CLI interface
if (require.main === module) {
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case 'validate':
      const validation = SetupHelper.validateConfig();
      if (validation.isValid) {
        console.log('✅ Configuration is valid!');
      } else {
        console.log('❌ Configuration issues found:');
        validation.issues.forEach(issue => console.log(`   ${issue}`));
        process.exit(1);
      }
      break;

    case 'generate-key':
      console.log('Generated encryption key:');
      console.log(SetupHelper.generateEncryptionKey());
      break;

    case 'instructions':
      SetupHelper.printSetupInstructions();
      break;

    case 'create-webhook':
      const url = args[1];
      if (!url) {
        console.error('❌ Usage: node setup.js create-webhook <callback-url>');
        process.exit(1);
      }
      SetupHelper.createWebhookSubscription(url).catch(() => process.exit(1));
      break;

    case 'list-webhooks':
      SetupHelper.listWebhookSubscriptions().catch(() => process.exit(1));
      break;

    case 'delete-webhook':
      const id = args[1];
      if (!id) {
        console.error('❌ Usage: node setup.js delete-webhook <subscription-id>');
        process.exit(1);
      }
      SetupHelper.deleteWebhookSubscription(id).catch(() => process.exit(1));
      break;

    default:
      console.log(`
Setup Helper for ${config.app.name}

Commands:
  validate           Validate current configuration
  generate-key       Generate new encryption key
  instructions       Show setup instructions
  create-webhook     Create Strava webhook subscription
  list-webhooks      List current webhook subscriptions
  delete-webhook     Delete webhook subscription

Examples:
  node utils/setup.js validate
  node utils/setup.js generate-key
  node utils/setup.js create-webhook https://your-domain.com/webhook/strava
  node utils/setup.js list-webhooks
  node utils/setup.js delete-webhook 12345
      `);
  }
}

module.exports = SetupHelper;