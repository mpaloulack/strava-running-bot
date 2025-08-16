const { Client, GatewayIntentBits, EmbedBuilder, REST, Routes } = require('discord.js');
const config = require('../../config/config');
const DiscordCommands = require('./commands');

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
      const data = await rest.put(
        Routes.applicationCommands(this.client.user.id),
        { body: commands }
      );

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

      const embed = this.createActivityEmbed(activityData);
      await channel.send({ embeds: [embed] });
      
      console.log(`✅ Posted activity: ${activityData.name}`);
    } catch (error) {
      console.error('❌ Failed to post activity to Discord:', error);
      throw error;
    }
  }

  createActivityEmbed(activity) {
    const embed = new EmbedBuilder()
      .setTitle(`🏃 ${activity.name}`)
      .setColor(this.getActivityColor(activity.type))
      .setAuthor({
        name: `${activity.athlete.firstname} ${activity.athlete.lastname}`,
        iconURL: activity.athlete.profile_medium,
      })
      .setTimestamp(new Date(activity.start_date))
      .setFooter({
        text: 'Strava Activity',
        iconURL: 'https://cdn.worldvectorlogo.com/logos/strava-1.svg',
      });

    // Add description if available
    if (activity.description) {
      embed.setDescription(activity.description);
    }

    // Add activity fields
    embed.addFields([
      {
        name: '📏 Distance',
        value: this.formatDistance(activity.distance),
        inline: true,
      },
      {
        name: '⏱️ Time',
        value: this.formatTime(activity.moving_time),
        inline: true,
      },
      {
        name: '🏃 Pace',
        value: this.formatPace(activity.distance, activity.moving_time),
        inline: true,
      },
    ]);

    // Add Grade Adjusted Pace if available
    if (activity.gap_pace) {
      embed.addFields([{
        name: '📈 Grade Adjusted Pace',
        value: activity.gap_pace,
        inline: true,
      }]);
    }

    // Add Average Heart Rate if available
    if (activity.average_heartrate) {
      embed.addFields([{
        name: '❤️ Avg Heart Rate',
        value: `${Math.round(activity.average_heartrate)} bpm`,
        inline: true,
      }]);
    }

    // Add elevation gain if significant
    if (activity.total_elevation_gain > 10) {
      embed.addFields([{
        name: '⛰️ Elevation Gain',
        value: `${Math.round(activity.total_elevation_gain)}m`,
        inline: true,
      }]);
    }

    // Add map image if polyline is available
    if (activity.map && activity.map.summary_polyline) {
      const mapUrl = this.generateStaticMapUrl(activity.map.summary_polyline);
      embed.setImage(mapUrl);
    }

    // Add link to Strava activity
    embed.setURL(`https://www.strava.com/activities/${activity.id}`);

    return embed;
  }

  getActivityColor(activityType) {
    const colors = {
      'Run': '#FC4C02',      // Strava orange
      'Ride': '#0074D9',     // Blue
      'Swim': '#39CCCC',     // Aqua
      'Walk': '#2ECC40',     // Green
      'Hike': '#8B4513',     // Brown
      'Workout': '#B10DC9',  // Purple
      'default': '#FC4C02'   // Default Strava orange
    };
    
    return colors[activityType] || colors.default;
  }

  formatDistance(distanceInMeters) {
    const km = distanceInMeters / 1000;
    return `${km.toFixed(2)} km`;
  }

  formatTime(timeInSeconds) {
    const hours = Math.floor(timeInSeconds / 3600);
    const minutes = Math.floor((timeInSeconds % 3600) / 60);
    const seconds = timeInSeconds % 60;

    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    } else {
      return `${minutes}:${seconds.toString().padStart(2, '0')}`;
    }
  }

  formatPace(distanceInMeters, timeInSeconds) {
    if (distanceInMeters === 0) return 'N/A';
    
    const kmDistance = distanceInMeters / 1000;
    const paceInSecondsPerKm = timeInSeconds / kmDistance;
    
    const minutes = Math.floor(paceInSecondsPerKm / 60);
    const seconds = Math.round(paceInSecondsPerKm % 60);
    
    return `${minutes}:${seconds.toString().padStart(2, '0')}/km`;
  }

  generateStaticMapUrl(polyline) {
    // Google Static Maps API URL with polyline
    const baseUrl = 'https://maps.googleapis.com/maps/api/staticmap';
    const params = new URLSearchParams({
      size: '600x400',
      path: `enc:${polyline}`,
      key: process.env.GOOGLE_MAPS_API_KEY || '', // Optional: add Google Maps API key
    });

    // If no Google Maps API key, return Strava's map image (if available)
    if (!process.env.GOOGLE_MAPS_API_KEY) {
      return null; // Will skip the map image
    }

    return `${baseUrl}?${params.toString()}`;
  }

  async stop() {
    if (this.client) {
      await this.client.destroy();
      console.log('🔴 Discord bot stopped');
    }
  }
}

module.exports = DiscordBot;