const { Client, GatewayIntentBits, REST, Routes } = require('discord.js');
const config = require('../../config/config');
const DiscordCommands = require('./commands');
const ActivityEmbedBuilder = require('../utils/EmbedBuilder');
const logger = require('../utils/Logger');

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
      logger.discord.info('Bot logged in', {
        tag: this.client.user.tag,
        id: this.client.user.id,
        guilds: this.client.guilds.cache.size,
        users: this.client.users.cache.size
      });
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
      logger.discord.error('Discord client error', error);
    });
  }

  async registerCommands() {
    try {
      logger.discord.info('Registering Discord slash commands...');
      
      const rest = new REST({ version: '10' }).setToken(config.discord.token);
      const commands = this.commands.getCommands().map(command => command.toJSON());

      // Register commands globally (takes up to 1 hour to appear)
      // For faster testing, you can register to a specific guild instead
      
      // Try guild registration first for immediate testing
      const guildId = process.env.DISCORD_GUILD_ID;
      let data;
      
      if (guildId) {
        logger.discord.info('Registering commands to guild for testing', { guildId });
        data = await rest.put(
          Routes.applicationGuildCommands(this.client.user.id, guildId),
          { body: commands }
        );
      } else {
        logger.discord.warn('No DISCORD_GUILD_ID set, registering globally (may take up to 1 hour)');
        data = await rest.put(
          Routes.applicationCommands(this.client.user.id),
          { body: commands }
        );
      }

      logger.discord.info('Successfully registered Discord slash commands', {
        count: data.length,
        commands: data.map(cmd => cmd.name)
      });
    } catch (error) {
      logger.discord.error('Error registering Discord commands', error);
    }
  }

  async start() {
    try {
      await this.client.login(config.discord.token);
    } catch (error) {
      logger.discord.error('Failed to start Discord bot', error);
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
      
      logger.discord.info('Posted activity to Discord', {
        activityName: activityData.name,
        activityType: activityData.type,
        distance: activityData.distance,
        athleteName: `${activityData.athlete.firstname} ${activityData.athlete.lastname}`,
        channelId: config.discord.channelId
      });
    } catch (error) {
      logger.discord.error('Failed to post activity to Discord', {
        activityData: {
          id: activityData.id,
          name: activityData.name,
          athlete: `${activityData.athlete.firstname} ${activityData.athlete.lastname}`
        },
        error: error.message
      });
      throw error;
    }
  }


  async stop() {
    if (this.client) {
      await this.client.destroy();
      logger.discord.info('Discord bot stopped');
    }
  }
}

module.exports = DiscordBot;