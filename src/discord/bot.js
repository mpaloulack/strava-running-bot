const { Client, GatewayIntentBits, REST, Routes } = require('discord.js');
const config = require('../../config/config');
const DiscordCommands = require('./commands');
const ActivityEmbedBuilder = require('../utils/EmbedBuilder');

class DiscordBot {
  constructor(activityProcessor) {
    this.activityProcessor = activityProcessor;
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
      ],
    });

    this.commands = new DiscordCommands(activityProcessor);
    this.setupEventHandlers();
  }

  setupEventHandlers() {
    this.client.once('ready', async () => {
      console.log(`✅ Discord bot logged in as ${this.client.user.tag}`);
      await this.registerCommands();
    });

    this.client.on('interactionCreate', async (interaction) => {
      if (interaction.isChatInputCommand()) {
        await this.commands.handleCommand(interaction);
      } else if (interaction.isAutocomplete()) {
        await this.commands.handleAutocomplete(interaction);
      }
    });

    this.client.on('error', (error) => {
      console.error('❌ Discord client error:', error);
    });
  }

  async registerCommands() {
    try {
      console.log('🔄 Registering Discord slash commands...');
      
      const rest = new REST({ version: '10' }).setToken(config.discord.token);
      const commands = this.commands.getCommands().map(command => command.toJSON());

      // Register commands globally (takes up to 1 hour to appear)
      // For faster testing, you can register to a specific guild instead
      
      // Try guild registration first for immediate testing
      const guildId = process.env.DISCORD_GUILD_ID;
      let data;
      
      if (guildId) {
        console.log(`🔄 Registering commands to guild ${guildId} for immediate testing...`);
        data = await rest.put(
          Routes.applicationGuildCommands(this.client.user.id, guildId),
          { body: commands }
        );
      } else {
        console.log('🔄 No DISCORD_GUILD_ID set, registering globally (may take up to 1 hour)...');
        data = await rest.put(
          Routes.applicationCommands(this.client.user.id),
          { body: commands }
        );
      }

      console.log(`✅ Successfully registered ${data.length} Discord slash commands`);
    } catch (error) {
      console.error('❌ Error registering Discord commands:', error);
    }
  }

  async start() {
    try {
      await this.client.login(config.discord.token);
    } catch (error) {
      console.error('❌ Failed to start Discord bot:', error);
      throw error;
    }
  }

  async postActivity(activityData) {
    try {
      const channel = await this.client.channels.fetch(config.discord.channelId);
      
      if (!channel) {
        throw new Error('Discord channel not found');
      }

      const embed = ActivityEmbedBuilder.createActivityEmbed(activityData, { type: 'posted' });
      await channel.send({ embeds: [embed] });
      
      console.log(`✅ Posted activity: ${activityData.name}`);
    } catch (error) {
      console.error('❌ Failed to post activity to Discord:', error);
      throw error;
    }
  }


  async stop() {
    if (this.client) {
      await this.client.destroy();
      console.log('🔴 Discord bot stopped');
    }
  }
}

module.exports = DiscordBot;