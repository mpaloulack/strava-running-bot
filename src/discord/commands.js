const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const ActivityEmbedBuilder = require('../utils/EmbedBuilder');
const DiscordUtils = require('../utils/DiscordUtils');
const ActivityFormatter = require('../utils/ActivityFormatter');
const RaceManager = require('../managers/RaceManager');
const PBManager = require('../managers/PBManager');
const LeaderboardManager = require('../managers/LeaderboardManager');
const logger = require('../utils/Logger');
const config = require('../../config/config');
const { TIME, DISCORD, CATEGORY_DISTANCES } = require('../constants');
const DateUtils = require('../utils/DateUtils');

function findClosestPBCategory(distanceM) {
  let closest = null;
  let minDiff = Infinity;
  for (const [category, dist] of Object.entries(CATEGORY_DISTANCES)) {
    const diff = Math.abs(dist - distanceM);
    if (diff < minDiff) {
      minDiff = diff;
      closest = category;
    }
  }
  return closest;
}

class DiscordCommands {
  constructor(activityProcessor) {
    this.activityProcessor = activityProcessor;
    this.raceManager = new RaceManager();
    this.pbManager = new PBManager();
    this.leaderboardManager = new LeaderboardManager();
    this.pbSyncInProgress = new Set();
    this.bulkSyncInProgress = false;
  }

  // Define all slash commands
  getCommands() {
    return [
      // Members list command
      new SlashCommandBuilder()
        .setName('members')
        .setDescription('Manage team members')
        .addSubcommand(subcommand =>
          subcommand
            .setName('list')
            .setDescription('List all registered team members')
        )
        .addSubcommand(subcommand =>
          subcommand
            .setName('inactive')
            .setDescription('List inactive members and notify them to reconnect')
            .addStringOption(option =>
              option
                .setName('notify')
                .setDescription('How to notify inactive members')
                .addChoices(
                  { name: 'No notification', value: 'none' },
                  { name: 'Send DM (private message)', value: 'dm' },
                  { name: 'Mention in channel', value: 'channel' }
                )
                .setRequired(false)
            )
        )
        .addSubcommand(subcommand =>
          subcommand
            .setName('remove')
            .setDescription('Remove a team member')
            .addStringOption(option =>
              option
                .setName('user')
                .setDescription('Discord user to remove (@mention or user ID)')
                .setRequired(true)
            )
        )
        .addSubcommand(subcommand =>
          subcommand
            .setName('deactivate')
            .setDescription('Temporarily deactivate a team member')
            .addStringOption(option =>
              option
                .setName('user')
                .setDescription('Discord user to deactivate (@mention or user ID)')
                .setRequired(true)
            )
        )
        .addSubcommand(subcommand =>
          subcommand
            .setName('reactivate')
            .setDescription('Reactivate a team member')
            .addStringOption(option =>
              option
                .setName('user')
                .setDescription('Discord user to reactivate (@mention or user ID)')
                .setRequired(true)
            )
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

      // Register command
      new SlashCommandBuilder()
        .setName('register')
        .setDescription('Register yourself with Strava to join the team'),

      // Bot status command
      new SlashCommandBuilder()
        .setName('botstatus')
        .setDescription('Show bot status and statistics')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),


      // Last activity command
      new SlashCommandBuilder()
        .setName('last')
        .setDescription('Show the last activity from a team member')
        .addStringOption(option =>
          option
            .setName('member')
            .setDescription('Team member name (first name, last name, or @mention)')
            .setRequired(true)
            .setAutocomplete(true)
        ),

      // Race management commands
      new SlashCommandBuilder()
        .setName('my-races')
        .setDescription('Manage your upcoming races')
        .addSubcommand(subcommand =>
          subcommand
            .setName('add')
            .setDescription('Add an upcoming race')
            .addStringOption(option =>
              option
                .setName('name')
                .setDescription('Race name')
                .setRequired(true)
                .setMaxLength(100)
            )
            .addStringOption(option =>
              option
                .setName('date')
                .setDescription('Race date (DD-MM-YYYY format, e.g. 21-04-2025)')
                .setRequired(true)
            )
            .addStringOption(option =>
              option
                .setName('race_type')
                .setDescription('Type of race')
                .setRequired(true)
                .addChoices(
                  { name: 'Road Race', value: 'road' },
                  { name: 'Trail Race', value: 'trail' }
                )
            )
            .addStringOption(option =>
              option
                .setName('distance_preset')
                .setDescription('Distance (for road races)')
                .setRequired(false)
                .addChoices(
                  { name: '5K', value: '5' },
                  { name: '10K', value: '10' },
                  { name: 'Half Marathon (21.1K)', value: '21.1' },
                  { name: 'Marathon (42.2K)', value: '42.2' },
                  { name: 'Other (specify custom distance)', value: 'other' }
                )
            )
            .addStringOption(option =>
              option
                .setName('custom_distance')
                .setDescription('Custom distance (km) - use when distance_preset is "Other" or for trail races')
                .setRequired(false)
                .setMaxLength(10)
            )
            .addStringOption(option =>
              option
                .setName('location')
                .setDescription('Race location')
                .setRequired(false)
                .setMaxLength(100)
            )
            .addStringOption(option =>
              option
                .setName('goal')
                .setDescription('Goal time (e.g. 1:45:00)')
                .setRequired(false)
                .setMaxLength(20)
            )
            .addStringOption(option =>
              option
                .setName('elevation')
                .setDescription('Elevation gain/loss (e.g. 5400D+/3600D-)')
                .setRequired(false)
                .setMaxLength(50)
            )
            .addStringOption(option =>
              option
                .setName('notes')
                .setDescription('Additional notes')
                .setRequired(false)
                .setMaxLength(500)
            )
        )
        .addSubcommand(subcommand =>
          subcommand
            .setName('list')
            .setDescription('List your races')
            .addStringOption(option =>
              option
                .setName('status')
                .setDescription('Filter by status')
                .setRequired(false)
                .addChoices(
                  { name: 'Registered', value: 'registered' },
                  { name: 'Completed', value: 'completed' },
                  { name: 'Cancelled', value: 'cancelled' }
                )
            )
        )
        .addSubcommand(subcommand =>
          subcommand
            .setName('remove')
            .setDescription('Remove a race')
            .addIntegerOption(option =>
              option
                .setName('race_id')
                .setDescription('Race ID (from race list)')
                .setRequired(true)
            )
        )
        .addSubcommand(subcommand =>
          subcommand
            .setName('update')
            .setDescription('Update race details')
            .addIntegerOption(option =>
              option
                .setName('race_id')
                .setDescription('Race ID (from race list)')
                .setRequired(true)
            )
            .addStringOption(option =>
              option
                .setName('name')
                .setDescription('New race name')
                .setRequired(false)
                .setMaxLength(100)
            )
            .addStringOption(option =>
              option
                .setName('date')
                .setDescription('New race date (DD-MM-YYYY)')
                .setRequired(false)
            )
            .addStringOption(option =>
              option
                .setName('distance')
                .setDescription('New distance')
                .setRequired(false)
                .setMaxLength(20)
            )
            .addStringOption(option =>
              option
                .setName('location')
                .setDescription('New location')
                .setRequired(false)
                .setMaxLength(100)
            )
            .addStringOption(option =>
              option
                .setName('goal')
                .setDescription('New goal time')
                .setRequired(false)
                .setMaxLength(20)
            )
            .addStringOption(option =>
              option
                .setName('elevation')
                .setDescription('New elevation (e.g. 5400D+/3600D-)')
                .setRequired(false)
                .setMaxLength(50)
            )
            .addStringOption(option =>
              option
                .setName('status')
                .setDescription('Update status')
                .setRequired(false)
                .addChoices(
                  { name: 'Registered', value: 'registered' },
                  { name: 'Completed', value: 'completed' },
                  { name: 'Cancelled', value: 'cancelled' },
                  { name: 'DNS (Did Not Start)', value: 'dns' },
                  { name: 'DNF (Did Not Finish)', value: 'dnf' }
                )
            )
        )
        .addSubcommand(subcommand =>
          subcommand
            .setName('upcoming')
            .setDescription('Show upcoming races for all team members')
            .addIntegerOption(option =>
              option
                .setName('days')
                .setDescription('Number of days ahead to show (default: 30)')
                .setRequired(false)
                .setMinValue(1)
                .setMaxValue(365)
            )
        ),

      // Team races command (admin only)
      new SlashCommandBuilder()
        .setName('all-races')
        .setDescription('View all team races (admin only)')
        .addSubcommand(subcommand =>
          subcommand
            .setName('list')
            .setDescription('List all team races')
            .addStringOption(option =>
              option
                .setName('status')
                .setDescription('Filter by status')
                .setRequired(false)
                .addChoices(
                  { name: 'Registered', value: 'registered' },
                  { name: 'Completed', value: 'completed' },
                  { name: 'Cancelled', value: 'cancelled' }
                )
            )
        )
        .addSubcommand(subcommand =>
          subcommand
            .setName('upcoming')
            .setDescription('Show upcoming races for all members')
            .addIntegerOption(option =>
              option
                .setName('days')
                .setDescription('Number of days ahead to show (default: 30)')
                .setRequired(false)
                .setMinValue(1)
                .setMaxValue(365)
            )
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

      // Bot settings command (admin only)
      new SlashCommandBuilder()
        .setName('settings')
        .setDescription('Manage bot settings')
        .addSubcommand(subcommand =>
          subcommand
            .setName('channel')
            .setDescription('Set the Discord channel for bot activities')
            .addChannelOption(option =>
              option
                .setName('channel')
                .setDescription('Discord channel to use (leave empty to use current channel)')
                .setRequired(false)
            )
        )
        .addSubcommand(subcommand =>
          subcommand
            .setName('view')
            .setDescription('View current bot settings')
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

      // Scheduler test commands (admin only)
      new SlashCommandBuilder()
        .setName('scheduler')
        .setDescription('Test race scheduler functionality')
        .addSubcommand(subcommand =>
          subcommand
            .setName('weekly')
            .setDescription('Manually trigger weekly race announcement')
        )
        .addSubcommand(subcommand =>
          subcommand
            .setName('monthly')
            .setDescription('Manually trigger monthly race announcement')
        )
        .addSubcommand(subcommand =>
          subcommand
            .setName('status')
            .setDescription('Show scheduler status')
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

      // Personal Best command
      new SlashCommandBuilder()
        .setName('pb')
        .setDescription('Personal Best tracking')
        .addSubcommand(subcommand =>
          subcommand
            .setName('check')
            .setDescription('View your Personal Bests (or another member\'s)')
            .addUserOption(option =>
              option
                .setName('member')
                .setDescription('View another member\'s PBs')
                .setRequired(false)
            )
        )
        .addSubcommand(subcommand =>
          subcommand
            .setName('add')
            .setDescription('Manually add PBs from a Strava activity (for races older than 1 year)')
            .addStringOption(option =>
              option
                .setName('activity_url')
                .setDescription('Strava activity URL (e.g. https://www.strava.com/activities/123456)')
                .setRequired(true)
            )
            .addIntegerOption(option =>
              option
                .setName('distance_m')
                .setDescription('Official race distance in meters (e.g. 5000 for 5K, 10000 for 10K, 21097 for Half Marathon)')
                .setRequired(false)
                .setMinValue(100)
            )
        )
        .addSubcommand(subcommand =>
          subcommand
            .setName('status')
            .setDescription('Show PB sync status and stored PBs per member (admin only)')
        ),

      // Sync command — gated to admins because it can fully consume the Strava
      // rate budget for the whole bot for several minutes per invocation.
      new SlashCommandBuilder()
        .setName('help')
        .setDescription('Comment utiliser ce bot Strava'),

      new SlashCommandBuilder()
        .setName('sync')
        .setDescription('Sync your Strava activities and update your Personal Bests')
        .addStringOption(option =>
          option
            .setName('period')
            .setDescription('Time period to sync')
            .setRequired(true)
            .addChoices(
              { name: 'Current year (Jan 1 → today)', value: 'current_year' },
              { name: 'Last 365 days', value: 'last_365_days' },
              { name: 'Current month (1st → today)', value: 'current_month' },
              { name: 'Previous month (full last month)', value: 'previous_month' }
            )
        )
        .addStringOption(option =>
          option
            .setName('month')
            .setDescription('Specific calendar month in YYYY-MM (overrides period when set)')
            .setRequired(false)
        )
        .addBooleanOption(option =>
          option
            .setName('all_members')
            .setDescription('Run the sync for every registered member (admin only)')
            .setRequired(false)
        ),

      // Monthly running leaderboard (km per team member)
      new SlashCommandBuilder()
        .setName('leaderboard')
        .setDescription('Show running kilometres ranking for a month')
        .addStringOption(option =>
          option
            .setName('month')
            .setDescription('Which month to show (defaults to current)')
            .setRequired(false)
            .addChoices(
              { name: 'Current month', value: 'current' },
              { name: 'Previous month', value: 'previous' }
            )
        ),
    ];
  }

  // Handle slash command interactions
  async handleCommand(interaction) {
    const { commandName, options } = interaction;

    logger.discord.info('Command received', {
      command: commandName,
      user: interaction.user.tag,
      userId: interaction.user.id,
      guild: interaction.guild?.name,
      channel: interaction.channel?.name,
      interactionId: interaction.id,
      createdTimestamp: interaction.createdTimestamp,
      currentTimestamp: Date.now(),
      ageMs: Date.now() - interaction.createdTimestamp
    });

    try {
      switch (commandName) {
      case 'members':
        await this.handleMembersCommand(interaction, options);
        break;
      case 'register':
        await this.handleRegisterCommand(interaction);
        break;
      case 'botstatus':
        await this.handleBotStatusCommand(interaction);
        break;
      case 'last':
        await this.handleLastActivityCommand(interaction, options);
        break;
      case 'my-races':
        await this.handleRaceCommand(interaction, options);
        break;
      case 'all-races':
        await this.handleTeamRacesCommand(interaction, options);
        break;
      case 'settings':
        await this.handleSettingsCommand(interaction, options);
        break;
      case 'scheduler':
        await this.handleSchedulerCommand(interaction, options);
        break;
      case 'pb':
        await this.handlePBCommand(interaction, options);
        break;
      case 'sync':
        await this.handleSyncCommand(interaction, options);
        break;
      case 'leaderboard':
        await this.handleLeaderboardCommand(interaction, options);
        break;
      case 'help':
        await this.handleHelpCommand(interaction);
        break;
      default:
        await interaction.reply({ 
          content: '❌ Unknown command', 
          ephemeral: true 
        });
      }
    } catch (error) {
      logger.discord.error('Error handling command', {
        command: commandName,
        user: interaction.user.tag,
        guild: interaction.guild?.name,
        error: error.message,
        stack: error.stack
      });
      
      const errorMessage = '❌ An error occurred while processing your command.';
      
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({ content: errorMessage, ephemeral: true });
      } else {
        await interaction.reply({ content: errorMessage, ephemeral: true });
      }
    }
  }

  // Handle members subcommands
  async handleMembersCommand(interaction, options) {
    const subcommand = options.getSubcommand();

    switch (subcommand) {
    case 'list':
      await this.listMembers(interaction);
      break;
    case 'inactive':
      await this.listInactiveMembers(interaction, options);
      break;
    case 'remove':
      await this.removeMember(interaction, options);
      break;
    case 'deactivate':
      await this.deactivateMember(interaction, options);
      break;
    case 'reactivate':
      await this.reactivateMember(interaction, options);
      break;
    }
  }

  // List all members
  async listMembers(interaction) {
    await interaction.deferReply({ ephemeral: true });

    try {
      const members = await this.activityProcessor.memberManager.getAllMembers();
      const memberStats = await this.activityProcessor.memberManager.getStats();
      
      // Load Discord user data from JSON fallback for missing guild cache
      const jsonMemberData = {};
      try {
        const fs = require('node:fs').promises;
        const path = require('node:path');
        const jsonPath = path.join(__dirname, '../../data/members.json');
        const jsonData = await fs.readFile(jsonPath, 'utf8');
        const memberDataJson = JSON.parse(jsonData);
        
        // Create lookup by discordUserId
        for (const jsonMember of memberDataJson.members) {
          jsonMemberData[jsonMember.discordUserId] = jsonMember.discordUser;
        }
      } catch (error) {
        logger.discord.debug('Could not load JSON member data for fallback', { error: error.message });
      }

      if (members.length === 0) {
        await interaction.editReply({
          content: '📭 No team members registered yet.',
          ephemeral: true
        });
        return;
      }

      const embed = new EmbedBuilder()
        .setTitle('🏃 Team Members')
        .setColor('#FC4C02')
        .setDescription(`Total: ${memberStats.active} active, ${memberStats.inactive} inactive`)
        .setTimestamp();

      // Group members into chunks of 10 for better display
      const memberChunks = DiscordUtils.chunkArray(members, 10);
      
      for (const member of memberChunks[0]) {
        const user = interaction.guild?.members.cache.get(member.discordUserId);
        const displayName = user ? `<@${member.discordUserId}>` : `User ID: ${member.discordUserId}`;
        
        // Get Discord name with multiple fallbacks
        let discordName;
        if (user?.displayName) {
          // First: Try guild member cache
          discordName = user.displayName;
        } else if (jsonMemberData[member.discordUserId]) {
          // Second: Try JSON fallback data
          discordName = jsonMemberData[member.discordUserId].displayName || jsonMemberData[member.discordUserId].username;
        } else if (member.discordUser) {
          // Third: Try stored database data (usually null)
          discordName = member.discordUser.displayName;
        } else {
          // Last: Use truncated user ID
          discordName = `User ${member.discordUserId.slice(-4)}`;
        }
        
        // Show Strava name in the details (field value)
        const stravaName = member.athlete ? `${member.athlete.firstname} ${member.athlete.lastname}` : 'Unknown';
        
        embed.addFields([{
          name: `👤 ${discordName}`,
          value: `Strava: ${stravaName}\nDiscord: ${displayName}\nRegistered: ${new Date(member.registeredAt).toLocaleDateString()}\nStatus: ${member.isActive ? '🟢 Active' : '🔴 Inactive'}`,
          inline: true
        }]);
      }

      if (memberChunks.length > 1) {
        embed.setFooter({ text: `Showing first 10 of ${members.length} members` });
      }

      await interaction.editReply({ embeds: [embed] });

    } catch (error) {
      logger.discord.error('Error listing members', {
        user: interaction.user.tag,
        error: error.message
      });
      await interaction.editReply({
        content: '❌ Failed to retrieve member list.',
        ephemeral: true
      });
    }
  }

  // List inactive members and optionally notify them
  async listInactiveMembers(interaction, options) {
    await interaction.deferReply({ ephemeral: true });

    try {
      const notifyOption = options.getString('notify') || 'none';
      const inactiveMembers = await this.activityProcessor.memberManager.getInactiveMembers();

      if (inactiveMembers.length === 0) {
        await interaction.editReply({
          content: '✅ All team members are active!',
          ephemeral: true
        });
        return;
      }

      // Display the list of inactive members
      await this._displayInactiveMembersList(interaction, inactiveMembers);

      // Handle notifications based on option
      if (notifyOption === 'dm') {
        await this._sendDMNotifications(interaction, inactiveMembers);
      } else if (notifyOption === 'channel') {
        await this._sendChannelNotification(interaction, inactiveMembers);
      }

    } catch (error) {
      logger.discord.error('Error listing inactive members', {
        user: interaction.user.tag,
        error: error.message
      });
      await interaction.editReply({
        content: '❌ Failed to retrieve inactive member list.',
        ephemeral: true
      });
    }
  }

  /**
   * Display the list of inactive members as an embed
   * @private
   */
  async _displayInactiveMembersList(interaction, inactiveMembers) {
    const embed = new EmbedBuilder()
      .setTitle('🔴 Inactive Members')
      .setColor('#FF4444')
      .setDescription(`Found ${inactiveMembers.length} inactive member(s) who need to reconnect`)
      .setTimestamp();

    for (const member of inactiveMembers) {
      const user = interaction.guild?.members.cache.get(member.discordUserId);
      const displayName = user ? `<@${member.discordUserId}>` : `User ID: ${member.discordUserId}`;
      const memberName = member.discordUser ? member.discordUser.displayName : `${member.athlete.firstname} ${member.athlete.lastname}`;
      const tokenErrorDate = member.tokenError ? new Date(member.tokenError.timestamp).toLocaleDateString() : 'Unknown';
      
      embed.addFields([{
        name: memberName,
        value: `Discord: ${displayName}\nInactive since: ${tokenErrorDate}\nReason: ${member.tokenError?.message || 'Token expired'}`,
        inline: false
      }]);
    }

    embed.addFields([{
      name: '📝 How to reconnect',
      value: 'Use the `/register` command to reconnect your Strava account with fresh authentication.',
      inline: false
    }]);

    await interaction.editReply({ embeds: [embed] });
  }

  /**
   * Send DM notifications to inactive members
   * @private
   */
  async _sendDMNotifications(interaction, inactiveMembers) {
    let successCount = 0;
    let failCount = 0;

    for (const member of inactiveMembers) {
      try {
        const user = await interaction.client.users.fetch(member.discordUserId);
        if (user) {
          const dmEmbed = this._createReconnectionEmbed();
          await user.send({ embeds: [dmEmbed] });
          successCount++;
          logger.discord.info('Sent reconnection DM to inactive member', {
            discordUserId: member.discordUserId,
            memberName: member.discordUser?.displayName || member.athlete.firstname
          });
        }
      } catch (dmError) {
        failCount++;
        logger.discord.warn('Failed to send DM to inactive member', {
          discordUserId: member.discordUserId,
          error: dmError.message
        });
      }
    }

    // Send follow-up message about DM results
    const notifyMessage = `📨 DM Notification Results:\n✅ Sent: ${successCount}\n❌ Failed: ${failCount}${failCount > 0 ? ' (user may have DMs disabled)' : ''}`;
    await interaction.followUp({ content: notifyMessage, ephemeral: true });
  }

  /**
   * Send channel notification mentioning inactive members
   * @private
   */
  async _sendChannelNotification(interaction, inactiveMembers) {
    const mentions = inactiveMembers.map(m => `<@${m.discordUserId}>`).join(' ');
    
    const channelEmbed = new EmbedBuilder()
      .setTitle('🔄 Action Required: Reconnect Your Strava Account')
      .setColor('#FC4C02')
      .setDescription(`${mentions}\n\nYour Strava connection has expired and needs to be refreshed.`)
      .addFields([
        {
          name: '❓ Why did this happen?',
          value: 'Your Strava authentication token has expired or was revoked. This is normal and happens automatically for security reasons.',
          inline: false
        },
        {
          name: '✅ How to fix it (takes 1 minute)',
          value: 'Simply use the `/register` command to reconnect your Strava account. This will restore your activity posting!',
          inline: false
        }
      ])
      .setFooter({ text: 'Strava Running Bot' })
      .setTimestamp();

    // Post in the same channel
    await interaction.channel.send({ embeds: [channelEmbed] });
    await interaction.followUp({ 
      content: `✅ Posted notification in channel mentioning ${inactiveMembers.length} inactive member(s).`, 
      ephemeral: true 
    });
    
    logger.discord.info('Posted channel notification for inactive members', {
      channel: interaction.channel.id,
      inactiveMemberCount: inactiveMembers.length
    });
  }

  /**
   * Create the reconnection embed for DMs or channel notifications
   * @private
   */
  _createReconnectionEmbed() {
    return new EmbedBuilder()
      .setTitle('🔄 Reconnect Your Strava Account')
      .setColor('#FC4C02')
      .setDescription('Your Strava connection has expired and needs to be refreshed.')
      .addFields([
        {
          name: '❓ Why did this happen?',
          value: 'Your Strava authentication token has expired or was revoked. This happens automatically after a period of time for security reasons.',
          inline: false
        },
        {
          name: '✅ How to fix it',
          value: 'Go to the Discord server and use the `/register` command to reconnect your Strava account.\n\nThis will only take a minute and will restore your activity posting!',
          inline: false
        }
      ])
      .setFooter({ text: 'Strava Running Bot' })
      .setTimestamp();
  }

  // Remove a member
  async removeMember(interaction, options) {
    await interaction.deferReply({ ephemeral: true });

    try {
      const userInput = options.getString('user');
      const userId = DiscordUtils.extractUserId(userInput);

      if (!userId) {
        await interaction.editReply({
          content: '❌ Invalid user. Please use @mention or a valid user ID.',
          ephemeral: true
        });
        return;
      }

      const removedMember = await this.activityProcessor.memberManager.removeMemberByDiscordId(userId);

      if (removedMember) {
        const memberName = removedMember.discordUser ? removedMember.discordUser.displayName : `${removedMember.athlete.firstname} ${removedMember.athlete.lastname}`;
        const embed = new EmbedBuilder()
          .setTitle('🗑️ Member Removed')
          .setColor('#FF4444')
          .setDescription(`Successfully removed **${memberName}** from the team.`)
          .addFields([{
            name: 'Discord User',
            value: `<@${userId}>`,
            inline: true
          }])
          .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
      } else {
        await interaction.editReply({
          content: '❌ User not found in team members.',
          ephemeral: true
        });
      }

    } catch (error) {
      logger.discord.error('Error removing member', {
        user: interaction.user.tag,
        targetUser: options.getString('user'),
        error: error.message
      });
      await interaction.editReply({
        content: '❌ Failed to remove member.',
        ephemeral: true
      });
    }
  }

  // Deactivate a member
  async deactivateMember(interaction, options) {
    await interaction.deferReply({ ephemeral: true });

    try {
      const userInput = options.getString('user');
      const userId = DiscordUtils.extractUserId(userInput);

      if (!userId) {
        await interaction.editReply({
          content: '❌ Invalid user. Please use @mention or a valid user ID.',
          ephemeral: true
        });
        return;
      }

      const member = await this.activityProcessor.memberManager.getMemberByDiscordId(userId);

      if (!member) {
        await interaction.editReply({
          content: '❌ User not found in team members.',
          ephemeral: true
        });
        return;
      }

      const success = await this.activityProcessor.memberManager.deactivateMember(member.athleteId);

      if (success) {
        const memberName = member.discordUser ? member.discordUser.displayName : `${member.athlete.firstname} ${member.athlete.lastname}`;
        const embed = new EmbedBuilder()
          .setTitle('🔴 Member Deactivated')
          .setColor('#FF8800')
          .setDescription(`**${memberName}** has been deactivated. Their activities will no longer be posted.`)
          .addFields([{
            name: 'Discord User',
            value: `<@${userId}>`,
            inline: true
          }])
          .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
      } else {
        await interaction.editReply({
          content: '❌ Failed to deactivate member.',
          ephemeral: true
        });
      }

    } catch (error) {
      logger.discord.error('Error deactivating member', {
        user: interaction.user.tag,
        targetUser: options.getString('user'),
        error: error.message
      });
      await interaction.editReply({
        content: '❌ Failed to deactivate member.',
        ephemeral: true
      });
    }
  }

  // Reactivate a member
  async reactivateMember(interaction, options) {
    await interaction.deferReply({ ephemeral: true });

    try {
      const userInput = options.getString('user');
      const userId = DiscordUtils.extractUserId(userInput);

      if (!userId) {
        await interaction.editReply({
          content: '❌ Invalid user. Please use @mention or a valid user ID.',
          ephemeral: true
        });
        return;
      }

      // Get member even if inactive (getMemberByDiscordId doesn't filter by is_active)
      const member = await this.activityProcessor.memberManager.getMemberByDiscordId(userId);

      if (!member) {
        await interaction.editReply({
          content: '❌ User not found in team members.',
          ephemeral: true
        });
        return;
      }

      const success = await this.activityProcessor.memberManager.reactivateMember(member.athleteId);

      if (success) {
        const memberName = member.discordUser ? member.discordUser.displayName : `${member.athlete.firstname} ${member.athlete.lastname}`;
        const embed = new EmbedBuilder()
          .setTitle('🟢 Member Reactivated')
          .setColor('#44FF44')
          .setDescription(`**${memberName}** has been reactivated. Their activities will now be posted again.`)
          .addFields([{
            name: 'Discord User',
            value: `<@${userId}>`,
            inline: true
          }])
          .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
      } else {
        await interaction.editReply({
          content: '❌ Failed to reactivate member.',
          ephemeral: true
        });
      }

    } catch (error) {
      logger.discord.error('Error reactivating member', {
        user: interaction.user.tag,
        targetUser: options.getString('user'),
        error: error.message
      });
      await interaction.editReply({
        content: '❌ Failed to reactivate member.',
        ephemeral: true
      });
    }
  }

  // Handle register command
  async handleRegisterCommand(interaction) {
    // Acknowledge immediately to prevent timeout
    await interaction.deferReply({ ephemeral: true });

    const userId = interaction.user.id;
    const existingMember = await this.activityProcessor.memberManager.getMemberByDiscordId(userId);

    if (existingMember) {
      const memberName = existingMember.discordUser ? existingMember.discordUser.displayName : `${existingMember.athlete.firstname} ${existingMember.athlete.lastname}`;

      // Deactivated members stay blocked (needs admin /reactivate first). Active members
      // only stay blocked if their stored tokens actually still work — otherwise (e.g. after
      // an ENCRYPTION_KEY rotation, or the user revoking access on Strava) fall through and
      // offer a fresh OAuth link so they can relink instead of being stuck.
      const hasValidToken = existingMember.isActive
        ? await this.activityProcessor.memberManager.getValidAccessToken(existingMember)
        : null;

      if (!existingMember.isActive || hasValidToken) {
        await interaction.editReply({
          content: `✅ You're already registered as **${memberName}**.`
        });
        return;
      }
    }

    const registerUrl = `${config.server.baseUrl}/auth/strava?user_id=${userId}`;

    const embed = new EmbedBuilder()
      .setTitle('🔗 Register with Strava')
      .setColor('#FC4C02')
      .setDescription('Click the link below to connect your Strava account and join the team!\n\n**Data Usage:** This app will access your public Strava activities to post them to this Discord channel. We only process public activities and respect your privacy settings.\n\n**By registering, you authorize this app to access your public Strava activities.**')
      .addFields([{
        name: '📝 Registration Steps',
        value: `1. [Click here to register](${registerUrl})\n2. Authorize the app on Strava\n3. Return to Discord when complete`,
        inline: false
      }])
      .setFooter({ 
        text: 'Powered by Strava • This link is personalized for your Discord account',
        iconURL: 'https://cdn.worldvectorlogo.com/logos/strava-1.svg'
      })
      .setTimestamp();

    await interaction.editReply({
      embeds: [embed]
    });
  }


  async handleHelpCommand(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const isAdmin = interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) ?? false;

    const fields = [
      {
        name: '🔗 1. Se connecter',
        value:
          '`/register` — Connecte ton compte Strava pour rejoindre l\'équipe. Tu recevras un lien personnel pour autoriser l\'accès à tes activités publiques.',
        inline: false,
      },
      {
        name: '🏃 2. Activités',
        value:
          '`/last member:<nom>` — Affiche la dernière activité d\'un membre.\n\nUne fois inscrit, tes nouvelles courses sont publiées automatiquement dans le salon dédié.',
        inline: false,
      },
      {
        name: '🏆 3. Records personnels (PB)',
        value:
          '`/pb check` — Affiche tes records personnels (5K, 10K, semi, marathon…).\n`/pb check member:<nom>` — Affiche les records d\'un autre membre.\n`/pb add activity_url:<lien> distance_m:<mètres>` — Ajoute manuellement un PB depuis une activité Strava (utile pour les courses de plus d\'un an).\n`/sync period:<période> [month:YYYY-MM]` — Synchronise ton historique Strava et met à jour tes PB (année en cours, 365 derniers jours, mois en cours, mois précédent, ou un mois précis via `month:`).\n`/sync period:<période> all_members:True` — Synchronise tous les membres de l\'équipe (admin uniquement).',
        inline: false,
      },
      {
        name: '📅 4. Courses à venir',
        value:
          '`/my-races add` — Ajouter une course (date, distance, objectif, lieu…).\n`/my-races list` — Voir tes courses.\n`/my-races update race_id:<id>` — Modifier une course.\n`/my-races remove race_id:<id>` — Supprimer une course.\n`/my-races upcoming days:<n>` — Voir les courses à venir de toute l\'équipe.',
        inline: false,
      },
      {
        name: '🏆 5. Classement mensuel',
        value:
          '`/leaderboard` — Classement de l\'équipe par kilomètres courus ce mois-ci.\n`/leaderboard month:previous` — Classement du mois précédent.\n\nLe bot publie automatiquement le classement du mois écoulé le 1er de chaque mois.',
        inline: false,
      },
    ];

    if (isAdmin) {
      fields.push({
        name: '⚙️ 6. Commandes admin',
        value:
          '`/members list` · `/members inactive` · `/members remove` · `/members deactivate` · `/members reactivate`\n`/all-races list` · `/all-races upcoming`\n`/settings channel` · `/settings view`\n`/scheduler weekly` · `/scheduler monthly` · `/scheduler status`\n`/pb status`',
        inline: false,
      });
    }

    fields.push({
      name: '💡 Astuces',
      value:
        '• Les réponses du bot sont souvent **éphémères** : visibles uniquement par toi.\n• Format de date : `JJ-MM-AAAA` (ex. `21-04-2026`).\n• Si ta connexion Strava expire, utilise `/register` à nouveau.',
      inline: false,
    });

    const embed = new EmbedBuilder()
      .setTitle('🏃 Guide d\'utilisation du bot')
      .setColor('#FC4C02')
      .setDescription(
        'Ce bot relie ton compte **Strava** à Discord : tes activités de course sont publiées automatiquement, tes records personnels sont suivis, et tu peux gérer tes courses à venir.'
      )
      .addFields(fields)
      .setFooter({
        text: 'Propulsé par Strava • Bonne course ! 🏁',
        iconURL: 'https://cdn.worldvectorlogo.com/logos/strava-1.svg',
      })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  }


  // Handle bot status command
  async handleBotStatusCommand(interaction) {
    await interaction.deferReply({ ephemeral: true });

    try {
      const stats = await this.activityProcessor.getStats();
      const memberStats = await this.activityProcessor.memberManager.getStats();
      const rateLimitStats = this.activityProcessor.stravaAPI.getRateLimiterStats();

      const embed = new EmbedBuilder()
        .setTitle('🤖 Bot Status')
        .setColor('#00FF88')
        .addFields([
          {
            name: '👥 Members',
            value: `Active: ${memberStats.active}\nInactive: ${memberStats.inactive}\nTotal: ${memberStats.total}`,
            inline: true
          },
          {
            name: '📊 Activities',
            value: `Processed: ${stats.processedActivities}`,
            inline: true
          },
          {
            name: '⏰ Uptime',
            value: `${Math.floor(stats.uptime / TIME.SECONDS_PER_HOUR)}h ${Math.floor((stats.uptime % TIME.SECONDS_PER_HOUR) / 60)}m`,
            inline: true
          },
          {
            name: '💾 Memory Usage',
            value: `${Math.round(stats.memoryUsage.heapUsed / 1024 / 1024)}MB`,
            inline: true
          },
          {
            name: '📬 Activity Queue',
            value: `Queued: ${stats.activityQueue?.totalQueued || 0}\nDelay: ${stats.activityQueue?.delayMinutes || 0}min`,
            inline: true
          },
          {
            name: '🚦 API Rate Limits',
            value: `15min: ${rateLimitStats.shortTerm.used}/${rateLimitStats.shortTerm.limit}\nDaily: ${rateLimitStats.daily.used}/${rateLimitStats.daily.limit}\nQueue: ${rateLimitStats.queueLength}`,
            inline: true
          }
        ])
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });

    } catch (error) {
      logger.discord.error('Error getting bot status', {
        user: interaction.user.tag,
        error: error.message
      });
      await interaction.editReply({
        content: '❌ Failed to retrieve bot status.',
        ephemeral: true
      });
    }
  }

  // Handle last activity command
  async handleLastActivityCommand(interaction, options) {
    const startTime = Date.now();
    logger.discord.info('handleLastActivityCommand: START', {
      interactionId: interaction.id,
      replied: interaction.replied,
      deferred: interaction.deferred,
      createdTimestamp: interaction.createdTimestamp,
      currentTimestamp: Date.now(),
      ageMs: Date.now() - interaction.createdTimestamp
    });

    try {
      logger.discord.info('handleLastActivityCommand: Calling deferReply()');
      await interaction.deferReply();
      logger.discord.info('handleLastActivityCommand: deferReply() completed', {
        durationMs: Date.now() - startTime
      });
    } catch (error) {
      logger.discord.error('handleLastActivityCommand: deferReply() FAILED', {
        error: error.message,
        code: error.code,
        ageMs: Date.now() - interaction.createdTimestamp,
        durationMs: Date.now() - startTime
      });
      throw error;
    }

    try {
      const memberInput = options.getString('member');
      logger.discord.info('Processing /last command', {
        user: interaction.user.tag,
        memberInput: memberInput
      });
      const member = await this.findMemberByInput(memberInput);
      logger.discord.info('Member lookup result', {
        memberInput: memberInput,
        memberFound: !!member,
        memberId: member?.discordUserId
      });

      if (!member) {
        await interaction.editReply({
          content: '❌ Team member not found. Use `/members list` to see all registered members.',
        });
        return;
      }

      // Load JSON member data for Discord name fallback
      const jsonMemberData = {};
      try {
        const fs = require('node:fs').promises;
        const path = require('node:path');
        const jsonPath = path.join(__dirname, '../../data/members.json');
        const jsonData = await fs.readFile(jsonPath, 'utf8');
        const memberDataJson = JSON.parse(jsonData);
        
        // Create lookup by discordUserId
        for (const jsonMember of memberDataJson.members) {
          jsonMemberData[jsonMember.discordUserId] = jsonMember.discordUser;
        }
      } catch (error) {
        logger.discord.debug('Could not load JSON member data for fallback', { error: error.message });
      }

      // Helper function to get Discord name with fallbacks
      const getDiscordName = (member) => {
        const user = interaction.guild?.members.cache.get(member.discordUserId);
        if (user?.displayName) {
          return user.displayName;
        } else if (jsonMemberData[member.discordUserId]) {
          return jsonMemberData[member.discordUserId].displayName || jsonMemberData[member.discordUserId].username;
        } else if (member.discordUser) {
          return member.discordUser.displayName;
        } else if (member.athlete) {
          return `${member.athlete.firstname} ${member.athlete.lastname}`;
        } else {
          return `User ${member.discordUserId.slice(-4)}`;
        }
      };

      // Get valid access token for the member
      const accessToken = await this.activityProcessor.memberManager.getValidAccessToken(member);
      logger.discord.info('Access token check result', {
        memberInput: memberInput,
        hasAccessToken: !!accessToken
      });
      
      if (!accessToken) {
        const memberName = getDiscordName(member);
        await interaction.editReply({
          content: `❌ **${memberName}** needs to re-authorize with Strava to view their activities.\n` +
                   'Please use the `/register` command to reconnect your Strava account.',
        });
        return;
      }

      // Fetch their latest activities (get more to find latest public one)
      const activities = await this.activityProcessor.stravaAPI.getAthleteActivities(
        accessToken,
        1, // page
        10  // get up to 10 to find latest public activity
      );

      if (!activities || activities.length === 0) {
        const memberName = getDiscordName(member);
        await interaction.editReply({
          content: `📭 No recent activities found for **${memberName}**.`,
        });
        return;
      }

      // Find the latest public activity
      let publicActivity = null;
      for (const activity of activities) {
        // Get detailed activity data to check privacy settings
        const detailedActivity = await this.activityProcessor.stravaAPI.getActivity(
          activity.id,
          accessToken
        );

        // Check if this activity can be displayed (respects privacy settings, skip age filter for /last command)
        if (this.activityProcessor.stravaAPI.shouldPostActivity(detailedActivity, { skipAgeFilter: true })) {
          publicActivity = detailedActivity;
          break; // Found the latest public activity
        }
      }

      if (!publicActivity) {
        const memberName = getDiscordName(member);
        await interaction.editReply({
          content: `🔒 **${memberName}** has no recent public activities to display.`,
        });
        return;
      }

      // Process the activity data for display with streams data for accurate GAP
      const processedActivity = await this.activityProcessor.stravaAPI.processActivityWithStreams(
        publicActivity,
        member.athlete,
        accessToken
      );

      // Create the same embed as used for posting activities
      const embed = ActivityEmbedBuilder.createActivityEmbed(processedActivity, { type: 'latest' });

      await interaction.editReply({ embeds: [embed] });

    } catch (error) {
      logger.discord.error('Error fetching last activity', {
        user: interaction.user.tag,
        memberInput: options.getString('member'),
        error: error.message,
        stack: error.stack
      });
      await interaction.editReply({
        content: '❌ Failed to fetch the last activity. Please try again later.',
      });
    }
  }


  // Find member by various input types (name, mention, etc.)
  async findMemberByInput(input) {
    const members = await this.activityProcessor.memberManager.getAllMembers();

    // Try to extract Discord user ID from mention
    const userId = DiscordUtils.extractUserId(input);
    if (userId) {
      return await this.activityProcessor.memberManager.getMemberByDiscordId(userId);
    }

    // Search by name (Discord name, first name, last name, or full name)
    const searchTerm = input.toLowerCase().trim();
    
    return members.find(member => {
      const discordName = member.discordUser ? member.discordUser.displayName.toLowerCase() : '';
      const firstName = member.athlete ? member.athlete.firstname.toLowerCase() : '';
      const lastName = member.athlete ? member.athlete.lastname.toLowerCase() : '';
      const fullName = `${firstName} ${lastName}`.trim();
      
      return discordName.includes(searchTerm) || 
             discordName === searchTerm ||
             firstName.includes(searchTerm) || 
             lastName.includes(searchTerm) || 
             fullName.includes(searchTerm) ||
             firstName === searchTerm ||
             lastName === searchTerm ||
             fullName === searchTerm;
    });
  }

  // Autocomplete for member names
  async handleAutocomplete(interaction) {
    if (interaction.commandName !== 'last') return;

    const focusedOption = interaction.options.getFocused(true);
    
    if (focusedOption.name === 'member') {
      try {
        const members = await this.activityProcessor.memberManager.getAllMembers();
        const searchTerm = (focusedOption.value || '').toLowerCase();
        
        const choices = members
          .filter(member => member.athlete && member.athlete.firstname && member.athlete.lastname)
          .filter(member => {
            const firstName = member.athlete.firstname?.toLowerCase() || '';
            const lastName = member.athlete.lastname?.toLowerCase() || '';
            const memberName = member.discordUser?.displayName?.toLowerCase() || `${firstName} ${lastName}`;
            const fullName = `${firstName} ${lastName}`.trim();

            return memberName.includes(searchTerm) ||
                   fullName.includes(searchTerm) ||
                   firstName.includes(searchTerm) ||
                   lastName.includes(searchTerm);
          })
          .slice(0, DISCORD.MAX_EMBED_FIELDS) // Discord limits to 25 choices
          .map(member => ({
            name: member.discordUser?.displayName || `${member.athlete.firstname} ${member.athlete.lastname}`,
            value: member.discordUser?.displayName || `${member.athlete.firstname} ${member.athlete.lastname}`
          }));

        await interaction.respond(choices);
      } catch (error) {
        logger.discord.error('Error in autocomplete', {
          user: interaction.user.tag,
          focusedValue: focusedOption.value,
          error: error.message
        });
        await interaction.respond([]);
      }
    }
  }

  // === RACE COMMAND HANDLERS ===

  // Handle race subcommands
  async handleRaceCommand(interaction, options) {
    const subcommand = options.getSubcommand();

    switch (subcommand) {
    case 'add':
      await this.addRace(interaction, options);
      break;
    case 'list':
      await this.listUserRaces(interaction, options);
      break;
    case 'remove':
      await this.removeRace(interaction, options);
      break;
    case 'update':
      await this.updateRace(interaction, options);
      break;
    case 'upcoming':
      await this.showUpcomingRaces(interaction, options, true);
      break;
    }
  }

  // Handle team races subcommands (admin only)
  async handleTeamRacesCommand(interaction, options) {
    const subcommand = options.getSubcommand();

    switch (subcommand) {
    case 'list':
      await this.listAllTeamRaces(interaction, options);
      break;
    case 'upcoming':
      await this.showUpcomingRaces(interaction, options, true);
      break;
    }
  }

  // Helper: Process distance for race based on type and user input
  _processRaceDistance(raceType, distancePreset, customDistance) {
    let finalDistance = null;
    let distanceKm = null;
    
    if (raceType === 'road') {
      if (distancePreset && distancePreset !== 'other') {
        // Use preset distance
        const km = Number.parseFloat(distancePreset);
        finalDistance = this.formatDistanceDisplay(km);
        distanceKm = km.toString();
      } else if (distancePreset === 'other' && customDistance) {
        // Use custom distance for "other" road race
        const km = Number.parseFloat(customDistance.replaceAll(/[^\d.]/g, ''));
        if (Number.isNaN(km) || km <= 0) {
          throw new Error('Custom distance must be a valid positive number');
        }
        finalDistance = `${km}km`;
        distanceKm = km.toString();
      }
    } else if (raceType === 'trail' && customDistance) {
      // Trail races always use custom distance
      const km = Number.parseFloat(customDistance.replaceAll(/[^\d.]/g, ''));
      if (Number.isNaN(km) || km <= 0) {
        throw new Error('Distance must be a valid positive number for trail races');
      }
      finalDistance = `${km}km`;
      distanceKm = km.toString();
    }
    
    return { finalDistance, distanceKm };
  }

  // Add a new race
  async addRace(interaction, options) {
    await interaction.deferReply({ ephemeral: false });

    try {
      const raceType = options.getString('race_type');
      const distancePreset = options.getString('distance_preset');
      const customDistance = options.getString('custom_distance');
      
      // Process distance based on race type and user input
      const { finalDistance, distanceKm } = this._processRaceDistance(raceType, distancePreset, customDistance);

      const raceData = {
        name: options.getString('name'),
        raceDate: options.getString('date'),
        raceType: raceType,
        distance: finalDistance,
        distanceKm: distanceKm,
        location: options.getString('location'),
        goalTime: options.getString('goal'),
        elevation: options.getString('elevation'),
        notes: options.getString('notes')
      };

      const race = await this.raceManager.addRace(interaction.user.id, raceData);

      const embed = new EmbedBuilder()
        .setTitle(`🏃 ${raceType === 'road' ? '🛣️' : '🏔️'} Race Added!`)
        .setColor(raceType === 'road' ? '#00FF88' : '#8B4513')
        .setDescription(this.raceManager.formatRaceDisplay(race, false))
        .addFields([{
          name: 'Race ID',
          value: `#${race.id}`,
          inline: true
        }])
        .setFooter({ text: 'Use /my-races list to see all your races' })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });

    } catch (error) {
      logger.discord.error('Error adding race', {
        user: interaction.user.tag,
        error: error.message
      });
      
      await interaction.editReply({
        content: `❌ Failed to add race: ${error.message}`,
        ephemeral: false
      });
    }
  }

  // Helper function to format distance display for standard race distances
  formatDistanceDisplay(km) {
    if (km === 5) return '5K';
    if (km === 10) return '10K';
    if (km === 21.1) return 'Half Marathon (21.1K)';
    if (km === 42.2) return 'Marathon (42.2K)';
    return `${km}km`;
  }

  // List user's races
  async listUserRaces(interaction, options) {
    await interaction.deferReply({ ephemeral: true });

    try {
      const status = options.getString('status');
      const filterOptions = status ? { status } : {};
      
      const races = await this.raceManager.getMemberRaces(interaction.user.id, filterOptions);

      if (races.length === 0) {
        const statusText = status ? ` with status "${status}"` : '';
        await interaction.editReply({
          content: `📭 No races found${statusText}. Use \`/my-races add\` to add your first race!`,
          ephemeral: true
        });
        return;
      }

      const statusSuffix = status ? ` (${status})` : '';
      const embed = new EmbedBuilder()
        .setTitle(`🏃 Your Races${statusSuffix}`)
        .setColor('#FC4C02')
        .setDescription(`Found ${races.length} race${races.length === 1 ? '' : 's'}`)
        .setTimestamp();

      // Group races into chunks of 5 for better display
      const raceChunks = DiscordUtils.chunkArray(races, 5);
      
      for (const race of raceChunks[0]) {
        embed.addFields([{
          name: `#${race.id} - ${race.name}`,
          value: this.raceManager.formatRaceDisplay(race),
          inline: false
        }]);
      }

      if (raceChunks.length > 1) {
        embed.setFooter({ text: `Showing first 5 of ${races.length} races` });
      }

      await interaction.editReply({ embeds: [embed] });

    } catch (error) {
      logger.discord.error('Error listing user races', {
        user: interaction.user.tag,
        error: error.message
      });
      
      await interaction.editReply({
        content: '❌ Failed to retrieve your races.',
        ephemeral: true
      });
    }
  }

  // Remove a race
  async removeRace(interaction, options) {
    await interaction.deferReply({ ephemeral: true });

    try {
      const raceId = options.getInteger('race_id');
      
      const removedRace = await this.raceManager.removeRace(raceId, interaction.user.id);

      const embed = new EmbedBuilder()
        .setTitle('🗑️ Race Removed')
        .setColor('#FF4444')
        .setDescription(`Successfully removed **${removedRace.name}**`)
        .addFields([
          {
            name: 'Race Date',
            value: DateUtils.formatForDisplay(removedRace.raceDate),
            inline: true
          },
          {
            name: 'Distance',
            value: removedRace.distance || 'N/A',
            inline: true
          }
        ])
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });

    } catch (error) {
      logger.discord.error('Error removing race', {
        user: interaction.user.tag,
        raceId: options.getInteger('race_id'),
        error: error.message
      });
      
      await interaction.editReply({
        content: `❌ Failed to remove race: ${error.message}`,
        ephemeral: true
      });
    }
  }

  // Update a race
  async updateRace(interaction, options) {
    await interaction.deferReply({ ephemeral: true });

    try {
      const raceId = options.getInteger('race_id');
      
      const updates = {};
      if (options.getString('name')) updates.name = options.getString('name');
      if (options.getString('date')) updates.raceDate = options.getString('date');
      if (options.getString('distance')) updates.distance = options.getString('distance');
      if (options.getString('location')) updates.location = options.getString('location');
      if (options.getString('goal')) updates.goalTime = options.getString('goal');
      if (options.getString('elevation')) updates.elevation = options.getString('elevation');
      if (options.getString('status')) updates.status = options.getString('status');

      if (Object.keys(updates).length === 0) {
        await interaction.editReply({
          content: '❌ No updates provided. Please specify at least one field to update.',
          ephemeral: true
        });
        return;
      }

      const updatedRace = await this.raceManager.updateRace(raceId, interaction.user.id, updates);

      const embed = new EmbedBuilder()
        .setTitle('✏️ Race Updated')
        .setColor('#00AAFF')
        .setDescription(this.raceManager.formatRaceDisplay(updatedRace))
        .addFields([{
          name: 'Updated Fields',
          value: Object.keys(updates).map(key => `• ${key}`).join('\n'),
          inline: true
        }])
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });

    } catch (error) {
      logger.discord.error('Error updating race', {
        user: interaction.user.tag,
        raceId: options.getInteger('race_id'),
        error: error.message
      });
      
      await interaction.editReply({
        content: `❌ Failed to update race: ${error.message}`,
        ephemeral: true
      });
    }
  }

  // Show upcoming races
  async showUpcomingRaces(interaction, options, isTeamCommand = false) {
    await interaction.deferReply({ ephemeral: !isTeamCommand });

    try {
      const days = options.getInteger('days') || 30;
      const upcomingRaces = await this.raceManager.getUpcomingRaces(days);

      if (upcomingRaces.length === 0) {
        await interaction.editReply({
          content: `📭 No upcoming races found in the next ${days} days.`,
          ephemeral: !isTeamCommand
        });
        return;
      }

      // Get member data for each race
      const racesWithMembers = await Promise.all(
        upcomingRaces.map(async (race) => {
          const member = await this.activityProcessor.memberManager.getMemberByAthleteId(race.member_athlete_id);
          return {
            ...race,
            memberName: member?.discordUser?.displayName || `${member?.athlete?.firstname} ${member?.athlete?.lastname}` || 'Unknown'
          };
        })
      );

      const embed = new EmbedBuilder()
        .setTitle('🏃‍♀️ Upcoming Team Races')
        .setColor('#FFA500')
        .setDescription(`${upcomingRaces.length} upcoming race${upcomingRaces.length === 1 ? '' : 's'} in the next ${days} days`)
        .setTimestamp();

      // Group by date and show races
      const racesByDate = {};
      for (const race of racesWithMembers) {
        const date = race.race_date;
        if (!racesByDate[date]) racesByDate[date] = [];
        racesByDate[date].push(race);
      }

      // Sort dates and add fields
      const sortedDates = Object.keys(racesByDate).sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
      let fieldCount = 0;

      for (const date of sortedDates) {
        if (fieldCount >= 10) break; // Discord embed limit

        const dayRaces = racesByDate[date];
        const raceDate = new Date(date + 'T00:00:00');
        const daysUntil = this.raceManager.getDaysUntilRace(date);
        
        let dayText = `**${raceDate.toLocaleDateString('en-US', { 
          weekday: 'long', 
          month: 'long', 
          day: 'numeric' 
        })}**`;
        
        if (daysUntil === 0) dayText += ' (Today!)';
        else if (daysUntil === 1) dayText += ' (Tomorrow)';
        else if (daysUntil > 0) dayText += ` (${daysUntil} days)`;

        const raceList = dayRaces.map(race => {
          let raceText = `• **${race.name}** - ${race.memberName}`;
          if (race.distance) raceText += ` (${race.distance})`;
          if (race.location) raceText += ` at ${race.location}`;
          return raceText;
        }).join('\n');

        embed.addFields([{
          name: dayText,
          value: raceList,
          inline: false
        }]);

        fieldCount++;
      }

      if (sortedDates.length > 10) {
        embed.setFooter({ text: `Showing first 10 dates (${upcomingRaces.length} total races)` });
      }

      await interaction.editReply({ embeds: [embed] });

    } catch (error) {
      logger.discord.error('Error showing upcoming races', {
        user: interaction.user.tag,
        isTeamCommand,
        error: error.message
      });
      
      await interaction.editReply({
        content: '❌ Failed to retrieve upcoming races.',
        ephemeral: !isTeamCommand
      });
    }
  }

  // List all team races (admin only)
  async listAllTeamRaces(interaction, options) {
    await interaction.deferReply({ ephemeral: false });

    try {
      const status = options.getString('status');
      const filterOptions = status ? { status } : {};
      
      const races = await this.raceManager.getAllRaces(filterOptions);

      if (races.length === 0) {
        const statusText = status ? ` with status "${status}"` : '';
        await interaction.editReply({
          content: `📭 No team races found${statusText}.`,
          ephemeral: true
        });
        return;
      }

      // Get member data for each race
      const racesWithMembers = await Promise.all(
        races.map(async (race) => {
          const member = await this.activityProcessor.memberManager.getMemberByAthleteId(race.member_athlete_id);
          return {
            ...race,
            memberName: member?.discordUser?.displayName || `${member?.athlete?.firstname} ${member?.athlete?.lastname}` || 'Unknown'
          };
        })
      );

      const statusSuffix = status ? ` (${status})` : '';
      const embed = new EmbedBuilder()
        .setTitle(`🏃 Team Races${statusSuffix}`)
        .setColor('#FC4C02')
        .setDescription(`Found ${races.length} race${races.length === 1 ? '' : 's'}`)
        .setTimestamp();

      // Group races into chunks of 10 for better display
      const raceChunks = DiscordUtils.chunkArray(racesWithMembers, 10);
      
      for (const race of raceChunks[0]) {
        const raceDate = DateUtils.formatForDisplay(race.race_date);
        const distanceInfo = race.distance ? ` • 📏 ${race.distance}` : '';
        const locationInfo = race.location ? ` • 📍 ${race.location}` : '';
        const statusEmoji = this.raceManager.getStatusEmoji(race.status);
        const statusText = race.status.toUpperCase();
        
        embed.addFields([{
          name: `#${race.id} - ${race.name} (${race.memberName})`,
          value: `📅 ${raceDate}${distanceInfo}${locationInfo}\n${statusEmoji} ${statusText}`,
          inline: true
        }]);
      }

      if (raceChunks.length > 1) {
        embed.setFooter({ text: `Showing first 10 of ${races.length} races` });
      }

      await interaction.editReply({ embeds: [embed] });

    } catch (error) {
      logger.discord.error('Error listing all team races', {
        user: interaction.user.tag,
        error: error.message
      });
      
      await interaction.editReply({
        content: '❌ Failed to retrieve team races.',
        ephemeral: true
      });
    }
  }

  // === LEADERBOARD COMMAND HANDLER ===

  async handleLeaderboardCommand(interaction, options) {
    await interaction.deferReply();

    try {
      const choice = options.getString('month') ?? 'current';
      const period = choice === 'previous'
        ? LeaderboardManager.getPreviousMonth()
        : LeaderboardManager.getCurrentMonth();

      const result = await this.leaderboardManager.getMonthlyLeaderboard({
        year: period.year,
        month: period.month,
        memberManager: this.activityProcessor.memberManager,
      });

      const embed = ActivityEmbedBuilder.buildMonthlyLeaderboardEmbed(result);
      await interaction.editReply({ embeds: [embed] });

      logger.discord.info('Leaderboard rendered', {
        user: interaction.user.tag,
        year: result.year,
        month: result.month,
        runners: result.entries.length,
      });
    } catch (error) {
      logger.discord.error('Error rendering leaderboard', {
        user: interaction.user.tag,
        error: error.message,
        stack: error.stack
      });
      await interaction.editReply({ content: '❌ Failed to render leaderboard.' });
    }
  }

  // === SCHEDULER COMMAND HANDLERS (ADMIN TESTING) ===

  // Handle scheduler subcommands (admin only)
  async handleSchedulerCommand(interaction, options) {
    const subcommand = options.getSubcommand();

    switch (subcommand) {
    case 'weekly':
      await this.triggerWeeklyAnnouncement(interaction);
      break;
    case 'monthly':
      await this.triggerMonthlyAnnouncement(interaction);
      break;
    case 'status':
      await this.showSchedulerStatus(interaction);
      break;
    }
  }

  // Manually trigger weekly race announcement
  async triggerWeeklyAnnouncement(interaction) {
    await interaction.deferReply({ ephemeral: false });

    try {
      logger.discord.info('Manually triggering weekly race announcement', {
        user: interaction.user.tag
      });

      // Get the scheduler from the activity processor
      const scheduler = this.activityProcessor.scheduler;
      
      if (!scheduler) {
        await interaction.editReply({
          content: '❌ Scheduler not available.',
          ephemeral: false
        });
        return;
      }

      await scheduler.triggerWeeklyAnnouncement();

      await interaction.editReply({
        content: '✅ Weekly race announcement triggered successfully! Check the channel for the announcement.',
        ephemeral: false
      });

    } catch (error) {
      logger.discord.error('Error triggering weekly race announcement', {
        user: interaction.user.tag,
        error: error.message
      });
      
      await interaction.editReply({
        content: `❌ Failed to trigger weekly race announcement: ${error.message}`,
        ephemeral: false
      });
    }
  }

  // Manually trigger monthly race announcement
  async triggerMonthlyAnnouncement(interaction) {
    await interaction.deferReply({ ephemeral: false });

    try {
      logger.discord.info('Manually triggering monthly race announcement', {
        user: interaction.user.tag
      });

      // Get the scheduler from the activity processor
      const scheduler = this.activityProcessor.scheduler;
      
      if (!scheduler) {
        await interaction.editReply({
          content: '❌ Scheduler not available.',
          ephemeral: false
        });
        return;
      }

      await scheduler.triggerMonthlyAnnouncement();

      await interaction.editReply({
        content: '✅ Monthly race announcement triggered successfully! Check the channel for the announcement.',
        ephemeral: false
      });

    } catch (error) {
      logger.discord.error('Error triggering monthly race announcement', {
        user: interaction.user.tag,
        error: error.message
      });
      
      await interaction.editReply({
        content: `❌ Failed to trigger monthly race announcement: ${error.message}`,
        ephemeral: false
      });
    }
  }

  // Show scheduler status
  async showSchedulerStatus(interaction) {
    await interaction.deferReply({ ephemeral: true });

    try {
      const scheduler = this.activityProcessor.scheduler;
      
      if (!scheduler) {
        await interaction.editReply({
          content: '❌ Scheduler not available.',
          ephemeral: true
        });
        return;
      }

      const status = scheduler.getStatus();
      const weeklyRaces = await this.activityProcessor.raceManager.getWeeklyRaces();
      const monthlyRaces = await this.activityProcessor.raceManager.getMonthlyRaces();

      const embed = new EmbedBuilder()
        .setTitle('📅 Race Scheduler Status')
        .setColor('#4169E1')
        .addFields([
          {
            name: 'Scheduler Status',
            value: status.initialized ? '✅ Running' : '❌ Not initialized',
            inline: true
          },
          {
            name: 'Active Jobs',
            value: `${status.jobCount} jobs (${status.activeJobs.join(', ')})`,
            inline: true
          },
          {
            name: 'This Week\'s Races',
            value: `${weeklyRaces.length} race${weeklyRaces.length === 1 ? '' : 's'}`,
            inline: true
          },
          {
            name: 'This Month\'s Races',
            value: `${monthlyRaces.length} race${monthlyRaces.length === 1 ? '' : 's'}`,
            inline: true
          },
          {
            name: 'Weekly Schedule',
            value: 'Every Monday at 8:00 AM UTC',
            inline: false
          },
          {
            name: 'Monthly Schedule',
            value: 'First day of month at 8:00 AM UTC',
            inline: false
          }
        ])
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });

    } catch (error) {
      logger.discord.error('Error getting scheduler status', {
        user: interaction.user.tag,
        error: error.message
      });
      
      await interaction.editReply({
        content: `❌ Failed to get scheduler status: ${error.message}`,
        ephemeral: true
      });
    }
  }

  // === SETTINGS COMMAND HANDLERS (ADMIN ONLY) ===

  // Handle settings subcommands (admin only)
  async handleSettingsCommand(interaction, options) {
    const subcommand = options.getSubcommand();

    switch (subcommand) {
    case 'channel':
      await this.setDiscordChannel(interaction, options);
      break;
    case 'view':
      await this.viewSettings(interaction);
      break;
    }
  }

  // Set Discord channel for bot activities
  async setDiscordChannel(interaction, options) {
    await interaction.deferReply({ ephemeral: true });

    try {
      const channelOption = options.getChannel('channel');
      const targetChannel = channelOption || interaction.channel;

      // Validate that it's a text channel
      if (targetChannel.type !== 0) { // 0 = GUILD_TEXT
        await interaction.editReply({
          content: '❌ Please select a text channel.',
          ephemeral: true
        });
        return;
      }

      // Check if bot has permissions to send messages in the channel
      const permissions = targetChannel.permissionsFor(interaction.guild.members.me);
      if (!permissions.has(['SendMessages', 'EmbedLinks'])) {
        await interaction.editReply({
          content: `❌ I don't have permission to send messages in ${targetChannel}. Please ensure I have "Send Messages" and "Embed Links" permissions.`,
          ephemeral: true
        });
        return;
      }

      // Save to database
      const success = await this.activityProcessor.memberManager.databaseManager.settingsManager.setDiscordChannelId(targetChannel.id);

      if (success) {
        const embed = new EmbedBuilder()
          .setTitle('⚙️ Settings Updated')
          .setColor('#00AA00')
          .setDescription(`Successfully set Discord channel to ${targetChannel}`)
          .addFields([
            {
              name: 'Channel Name',
              value: `#${targetChannel.name}`,
              inline: true
            },
            {
              name: 'Channel ID',
              value: targetChannel.id,
              inline: true
            }
          ])
          .setFooter({ text: 'Activities and race announcements will now be posted to this channel' })
          .setTimestamp();

        await interaction.editReply({ embeds: [embed] });

        // Send a test message to the new channel
        if (targetChannel.id !== interaction.channel.id) {
          try {
            const testEmbed = new EmbedBuilder()
              .setTitle('🤖 Bot Channel Updated')
              .setColor('#FC4C02')
              .setDescription('This channel has been set as the new bot channel for Strava activities and race announcements!')
              .setTimestamp();

            await targetChannel.send({ embeds: [testEmbed] });
          } catch (error) {
            logger.discord.warn('Could not send test message to new channel', {
              channelId: targetChannel.id,
              error: error.message
            });
          }
        }

        logger.discord.info('Discord channel updated via command', {
          user: interaction.user.tag,
          oldChannel: process.env.DISCORD_CHANNEL_ID,
          newChannel: targetChannel.id,
          channelName: targetChannel.name
        });

      } else {
        await interaction.editReply({
          content: '❌ Failed to update channel settings. Please try again.',
          ephemeral: true
        });
      }

    } catch (error) {
      logger.discord.error('Error setting Discord channel', {
        user: interaction.user.tag,
        error: error.message
      });
      
      await interaction.editReply({
        content: `❌ Failed to update channel: ${error.message}`,
        ephemeral: true
      });
    }
  }

  // View current bot settings
  async viewSettings(interaction) {
    await interaction.deferReply({ ephemeral: true });

    try {
      const settingsManager = this.activityProcessor.memberManager.databaseManager.settingsManager;
      const allSettings = await settingsManager.getAllSettings();
      const channelId = await settingsManager.getDiscordChannelId();

      const embed = new EmbedBuilder()
        .setTitle('⚙️ Bot Settings')
        .setColor('#0099FF')
        .setTimestamp();

      // Discord Channel
      let channelText = 'Not configured';
      if (channelId) {
        try {
          const channel = await interaction.client.channels.fetch(channelId);
          channelText = `${channel} (#${channel.name})`;
        } catch {
          channelText = `${channelId} (Channel not found)`;
        }
      }

      embed.addFields([
        {
          name: '📺 Discord Channel',
          value: channelText,
          inline: false
        }
      ]);

      // Other settings
      const otherSettings = Object.entries(allSettings)
        .filter(([key]) => key !== 'discord_channel_id')
        .slice(0, DISCORD.ITEMS_PER_PAGE); // Limit to prevent embed overflow

      if (otherSettings.length > 0) {
        const settingsText = otherSettings
          .map(([key, setting]) => `**${key}**: ${setting.value || 'Not set'}`)
          .join('\n');

        embed.addFields([
          {
            name: '🔧 Other Settings',
            value: settingsText,
            inline: false
          }
        ]);
      }

      embed.setFooter({ text: 'Use /settings channel to update the Discord channel' });

      await interaction.editReply({ embeds: [embed] });

    } catch (error) {
      logger.discord.error('Error viewing settings', {
        user: interaction.user.tag,
        error: error.message
      });
      
      await interaction.editReply({
        content: '❌ Failed to load settings.',
        ephemeral: true
      });
    }
  }

  // ─── /pb command ──────────────────────────────────────────────────────────

  async handlePBCommand(interaction, options) {
    const subcommand = options.getSubcommand();
    switch (subcommand) {
    case 'check':
      await this.handlePBCheck(interaction, options);
      break;
    case 'add':
      await this.handlePBAdd(interaction, options);
      break;
    case 'status':
      await this.handlePBStatus(interaction, options);
      break;
    }
  }

  async handlePBCheck(interaction, options) {
    await interaction.deferReply();

    try {
      const targetUser = options.getUser('member');
      const targetDiscordId = targetUser ? targetUser.id : interaction.user.id;
      const targetName = targetUser ? (targetUser.globalName || targetUser.username) : (interaction.member?.displayName || interaction.user.globalName || interaction.user.username);

      const pbs = await this.pbManager.getMemberPBsByDiscordId(targetDiscordId);

      if (!pbs.length) {
        await interaction.editReply({
          content: `📭 No Personal Bests recorded yet for **${targetName}**.\nUse \`/sync\` to import from Strava history.`,
        });
        return;
      }

      const fields = this.pbManager.formatPBsForEmbed(pbs, targetName);

      const embed = new EmbedBuilder()
        .setColor('#D4AF37')
        .setTimestamp()
        .addFields(fields);

      await interaction.editReply({ embeds: [embed] });

    } catch (error) {
      logger.discord.error('Error checking PBs', {
        user: interaction.user.tag,
        error: error.message,
        code: error.code,
        status: error.status,
        rawError: error.rawError,
      });
      await interaction.editReply({
        content: '❌ Failed to retrieve Personal Bests.',
      });
    }
  }

  // Resolve the sync window from the `period` choice and the optional
  // `month:YYYY-MM` override. Returns { afterTs, beforeTs, periodLabel } or
  // { error } when the month input is malformed or in the future. `beforeTs`
  // is null for open-ended windows (current_year, last_365_days, current_month).
  resolveSyncWindow(period, monthInput) {
    if (monthInput) {
      const match = /^(\d{4})-(\d{2})$/.exec(monthInput.trim());
      if (!match) {
        return { error: '❌ Invalid `month` format. Use `YYYY-MM` (e.g. `2024-03`).' };
      }
      const year = parseInt(match[1], 10);
      const month = parseInt(match[2], 10);
      if (month < 1 || month > 12) {
        return { error: '❌ Invalid `month` value: month must be between 01 and 12.' };
      }
      const startMs = Date.UTC(year, month - 1, 1);
      if (startMs > Date.now()) {
        return { error: '❌ `month` cannot be in the future.' };
      }
      const endMs = Date.UTC(year, month, 1);
      const monthLabel = new Date(startMs).toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
      return {
        afterTs: Math.floor(startMs / 1000),
        beforeTs: Math.floor(endMs / 1000),
        periodLabel: monthLabel,
      };
    }

    const now = new Date();
    if (period === 'last_365_days') {
      return {
        afterTs: Math.floor((Date.now() - 365 * 24 * 60 * 60 * 1000) / 1000),
        beforeTs: null,
        periodLabel: 'Last 365 days',
      };
    }
    if (period === 'current_month') {
      const startMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
      const monthLabel = new Date(startMs).toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
      return {
        afterTs: Math.floor(startMs / 1000),
        beforeTs: null,
        periodLabel: `Current month (${monthLabel})`,
      };
    }
    if (period === 'previous_month') {
      const startMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1);
      const endMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
      const monthLabel = new Date(startMs).toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
      return {
        afterTs: Math.floor(startMs / 1000),
        beforeTs: Math.floor(endMs / 1000),
        periodLabel: `Previous month (${monthLabel})`,
      };
    }
    const year = now.getUTCFullYear();
    return {
      afterTs: Math.floor(Date.UTC(year, 0, 1) / 1000),
      beforeTs: null,
      periodLabel: `Current year (${year})`,
    };
  }

  async handleSyncCommand(interaction, options) {
    await interaction.deferReply({ ephemeral: true });

    if (options.getBoolean('all_members')) {
      await this.handleSyncAllMembers(interaction, options);
      return;
    }

    if (this.pbSyncInProgress.has(interaction.user.id)) {
      await interaction.editReply({
        content: '⏳ A sync is already in progress for your account. Please wait for it to finish.',
      });
      return;
    }

    this.pbSyncInProgress.add(interaction.user.id);

    try {
      const member = await this.activityProcessor.memberManager.getMemberByDiscordId(interaction.user.id);

      if (!member?.isActive) {
        await interaction.editReply({
          content: '❌ You are not registered. Use `/register` first.',
        });
        return;
      }

      const period = options.getString('period');
      const monthInput = options.getString('month');

      const window = this.resolveSyncWindow(period, monthInput);
      if (window.error) {
        await interaction.editReply({ content: window.error });
        return;
      }
      const { afterTs, beforeTs, periodLabel } = window;

      await interaction.editReply({ content: `⏳ Syncing your **${periodLabel} Strava activities**… this may take several minutes. The sync continues even if this message stops updating.` });

      const accessToken = await this.activityProcessor.memberManager.getValidAccessToken(member);
      if (!accessToken) {
        await interaction.editReply({
          content: '❌ Could not retrieve your Strava access token. Please re-register.',
        });
        return;
      }

      const progressCb = async (page) => {
        try {
          await interaction.editReply({ content: `⏳ Syncing… processed page ${page}` });
        } catch {
          // Ignore edit errors after Discord's 15-min interaction window
        }
      };

      const summary = await this.pbManager.syncFromHistory(
        interaction.user.id,
        accessToken,
        this.activityProcessor.stravaAPI,
        progressCb,
        afterTs,
        beforeTs
      );

      const embed = new EmbedBuilder()
        .setTitle(`🔄 Sync Complete — ${periodLabel}`)
        .setColor('#D4AF37')
        .addFields([
          { name: 'Activities scanned', value: String(summary.processed), inline: true },
          { name: 'PBs updated', value: String(summary.updated), inline: true },
          { name: 'Errors', value: String(summary.errors), inline: true },
        ])
        .setTimestamp();

      await this._deliverSyncSummary(
        interaction,
        `🔄 **${periodLabel} sync complete** — ${summary.processed} scanned, ${summary.updated} PBs updated, ${summary.errors} errors.`,
        embed
      );

    } catch (error) {
      logger.discord.error('Error syncing PBs', {
        user: interaction.user.tag,
        error: error.message,
      });
      await interaction.editReply({
        content: '❌ Failed to sync Personal Bests from Strava.',
      });
    } finally {
      this.pbSyncInProgress.delete(interaction.user.id);
    }
  }

  // Team-wide sync: runs the same windowed sync for every registered member.
  // Admin-gated and sequential on purpose — the whole bot shares one Strava
  // rate budget, so members' syncs must not run concurrently.
  async handleSyncAllMembers(interaction, options) {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      await interaction.editReply({
        content: '❌ You need "Manage Server" permissions to sync all members.',
      });
      return;
    }

    if (this.bulkSyncInProgress) {
      await interaction.editReply({
        content: '⏳ A team-wide sync is already in progress. Please wait for it to finish.',
      });
      return;
    }

    const window = this.resolveSyncWindow(options.getString('period'), options.getString('month'));
    if (window.error) {
      await interaction.editReply({ content: window.error });
      return;
    }
    const { afterTs, beforeTs, periodLabel } = window;

    this.bulkSyncInProgress = true;
    try {
      const members = await this.activityProcessor.memberManager.getAllMembers();
      const totals = { processed: 0, updated: 0, errors: 0 };
      const skipped = [];
      const failed = [];

      for (const [index, member] of members.entries()) {
        const memberName = member.discordUser?.displayName
          || `${member.athlete.firstname} ${member.athlete.lastname}`.trim();

        await this._editReplySafe(interaction, {
          content: `⏳ Syncing **${periodLabel}** — **${memberName}** (${index + 1}/${members.length})…`,
        });

        const accessToken = await this.activityProcessor.memberManager.getValidAccessToken(member);
        if (!accessToken) {
          skipped.push(memberName);
          continue;
        }

        try {
          const summary = await this.pbManager.syncFromHistory(
            member.discordUserId,
            accessToken,
            this.activityProcessor.stravaAPI,
            null,
            afterTs,
            beforeTs
          );
          totals.processed += summary.processed;
          totals.updated += summary.updated;
          totals.errors += summary.errors;
        } catch (memberError) {
          failed.push(memberName);
          logger.discord.error('Team-wide sync failed for member', {
            memberName,
            athleteId: member.athleteId,
            error: memberError.message,
          });
        }
      }

      const embed = new EmbedBuilder()
        .setTitle(`🔄 Team Sync Complete — ${periodLabel}`)
        .setColor('#D4AF37')
        .addFields([
          { name: 'Members synced', value: String(members.length - skipped.length - failed.length), inline: true },
          { name: 'Activities scanned', value: String(totals.processed), inline: true },
          { name: 'PBs updated', value: String(totals.updated), inline: true },
        ])
        .setTimestamp();
      if (skipped.length > 0) {
        embed.addFields([{ name: '⚠️ Skipped (no valid token)', value: skipped.join(', ') }]);
      }
      if (failed.length > 0) {
        embed.addFields([{ name: '❌ Failed', value: failed.join(', ') }]);
      }

      const syncedCount = members.length - skipped.length - failed.length;
      await this._deliverSyncSummary(
        interaction,
        `🔄 **Team sync complete — ${periodLabel}** — ${syncedCount} members synced, ${totals.processed} activities scanned, ${totals.updated} PBs updated.`,
        embed
      );
    } catch (error) {
      logger.discord.error('Error running team-wide sync', {
        user: interaction.user.tag,
        error: error.message,
      });
      await this._editReplySafe(interaction, {
        content: '❌ Failed to run the team-wide sync.',
      });
    } finally {
      this.bulkSyncInProgress = false;
    }
  }

  // A team-wide sync can outlive Discord's 15-minute interaction window, after
  // which editReply throws — don't let a progress update kill the sync loop.
  async _editReplySafe(interaction, payload) {
    try {
      await interaction.editReply(payload);
    } catch (editErr) {
      logger.discord.warn('editReply failed (likely past 15-min interaction window)', {
        user: interaction.user.tag,
        error: editErr.message,
      });
    }
  }

  // Deliver a sync summary through the interaction reply first. If we've
  // crossed Discord's 15-min interaction window, editReply throws — fall back
  // to DMing the user and, if that also fails, posting in the originating
  // channel so the user actually sees that the sync finished.
  async _deliverSyncSummary(interaction, fallbackContent, embed) {
    try {
      await interaction.editReply({ content: '', embeds: [embed] });
    } catch (editErr) {
      logger.discord.warn('Sync editReply failed (likely past 15-min interaction window), falling back', {
        user: interaction.user.tag,
        error: editErr.message,
      });
      try {
        await interaction.user.send({ content: fallbackContent, embeds: [embed] });
      } catch (dmErr) {
        logger.discord.warn('Sync fallback DM failed, posting in channel', {
          user: interaction.user.tag,
          error: dmErr.message,
        });
        try {
          await interaction.channel?.send({
            content: `<@${interaction.user.id}> ${fallbackContent}`,
            embeds: [embed],
          });
        } catch (chErr) {
          logger.discord.error('Sync fallback channel post failed; summary not delivered to user', {
            user: interaction.user.tag,
            error: chErr.message,
          });
        }
      }
    }
  }

  async handlePBAdd(interaction, options) {
    await interaction.deferReply({ ephemeral: true });

    const activityUrl = options.getString('activity_url');

    // Extract activity ID from URL: https://www.strava.com/activities/12345678
    const match = activityUrl.match(/\/activities\/(\d+)/);
    if (!match) {
      await interaction.editReply({
        content: '❌ Invalid Strava activity URL. Use the format: `https://www.strava.com/activities/12345678`',
      });
      return;
    }
    const activityId = match[1];

    try {
      const member = await this.activityProcessor.memberManager.getMemberByDiscordId(interaction.user.id);
      if (!member?.isActive) {
        await interaction.editReply({ content: '❌ You are not registered. Use `/register` first.' });
        return;
      }

      const accessToken = await this.activityProcessor.memberManager.getValidAccessToken(member);
      if (!accessToken) {
        await interaction.editReply({ content: '❌ Could not retrieve your Strava access token. Please re-register.' });
        return;
      }

      const distanceOverrideM = options.getInteger('distance_m');
      const activity = await this.activityProcessor.stravaAPI.getActivity(activityId, accessToken);

      let distanceWarning = null;
      let results;

      if (distanceOverrideM !== null) {
        const efforts = this.pbManager.extractBestEfforts(activity);

        const MATCH_THRESHOLD = 0.15;
        const target = efforts.length > 0
          ? efforts.reduce((prev, curr) =>
            Math.abs(curr.distanceM - distanceOverrideM) < Math.abs(prev.distanceM - distanceOverrideM) ? curr : prev
          )
          : null;
        const isClose = target !== null &&
          Math.abs(target.distanceM - distanceOverrideM) / distanceOverrideM <= MATCH_THRESHOLD;

        if (isClose) {
          const diffPercent = Math.abs(target.distanceM - distanceOverrideM) / target.distanceM * 100;
          if (diffPercent >= 5) {
            distanceWarning = `⚠️ Large distance gap: official **${distanceOverrideM}m** vs GPS **${target.distanceM}m** (${diffPercent.toFixed(1)}% difference)\n`;
          }
          target.distanceM = distanceOverrideM;
        } else {
          const category = findClosestPBCategory(distanceOverrideM);
          const syntheticEffort = {
            category,
            distanceM: distanceOverrideM,
            elapsedTime: activity.elapsed_time,
            movingTime: activity.moving_time ?? activity.elapsed_time,
            activityId: activity.id,
            activityName: activity.name || null,
            activityDate: activity.start_date
              ? activity.start_date.substring(0, 10)
              : new Date().toISOString().substring(0, 10),
          };
          efforts.push(syntheticEffort);
          distanceWarning = `📝 No matching best effort found — using total activity time for **${category}** (GPS: ${activity.distance ? Math.round(activity.distance) : '?'}m)\n`;
        }

        results = await this.pbManager.checkAndUpdatePBsFromEfforts(member.athleteId, efforts);
      } else {
        results = await this.pbManager.checkAndUpdatePBs(member.athleteId, activity);
      }

      const newPBs = results.filter(r => r.isNewPB);
      if (!newPBs.length) {
        await interaction.editReply({
          content: `${distanceWarning || ''}✅ Activity imported — no new Personal Bests found (existing records are faster).`,
        });
        return;
      }

      const lines = newPBs.map(r => `🏆 **${r.category}** — ${ActivityFormatter.formatTime(r.newPB.elapsedTime)}`);
      await interaction.editReply({
        content: `${distanceWarning || ''}✅ **${newPBs.length} new Personal Best(s) recorded!**\n${lines.join('\n')}`,
      });

    } catch (error) {
      logger.discord.error('Error adding manual PB', {
        user: interaction.user.tag,
        error: error.message,
      });
      await interaction.editReply({
        content: '❌ Failed to import activity. Make sure the URL is correct and the activity belongs to your Strava account.',
      });
    }
  }

  async handlePBStatus(interaction, _options) {
    await interaction.deferReply({ ephemeral: true });

    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      await interaction.editReply({ content: '❌ This command requires the Manage Server permission.' });
      return;
    }

    try {
      const activeSyncIds = [...this.pbSyncInProgress];
      const pendingCursors = await this.pbManager.databaseManager.getPBSyncCursors();
      const interrupted = pendingCursors.filter(c => !this.pbSyncInProgress.has(c.discordUserId));

      const activeSyncLines = activeSyncIds.length
        ? activeSyncIds.map(id => `<@${id}> — sync currently running`)
        : ['None'];

      const pendingLines = interrupted.length
        ? await Promise.all(interrupted.map(async c => {
          const member = await this.activityProcessor.memberManager.getMemberByDiscordId(c.discordUserId);
          const name = member?.athlete
            ? `${member.athlete.firstname} ${member.athlete.lastname}`
            : `<@${c.discordUserId}>`;
          const resumeDate = new Date(parseInt(c.cursor, 10) * 1000).toLocaleDateString('en-GB');
          return `${name} — cursor at ${resumeDate}`;
        }))
        : ['None'];

      const allMembers = await this.activityProcessor.memberManager.getAllMembers();
      const memberLines = await Promise.all(
        allMembers.slice(0, 10).map(async m => {
          const count = await this.pbManager.databaseManager.getPBCountByAthleteId(m.athleteId);
          const name = m.athlete ? `${m.athlete.firstname} ${m.athlete.lastname}` : `<@${m.discordUserId}>`;
          return `${name}: ${count} PBs`;
        })
      );
      if (allMembers.length > 10) memberLines.push(`… and ${allMembers.length - 10} more`);

      const embed = new EmbedBuilder()
        .setTitle('🏆 PB Sync Status')
        .setColor('#D4AF37')
        .addFields([
          { name: `Active Syncs (${activeSyncIds.length})`, value: activeSyncLines.join('\n').slice(0, 1024) },
          { name: `Interrupted Syncs (${interrupted.length})`, value: pendingLines.join('\n').slice(0, 1024) },
          { name: `PBs per Member (${allMembers.length} active)`, value: memberLines.join('\n').slice(0, 1024) || 'No members' },
        ])
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      logger.discord.error('Error retrieving PB sync status', {
        user: interaction.user.tag,
        error: error.message,
      });
      await interaction.editReply({ content: '❌ Failed to retrieve PB sync status.' });
    }
  }

}

module.exports = DiscordCommands;