const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, InteractionResponseFlags } = require('discord.js');

class DiscordCommands {
  constructor(activityProcessor) {
    this.activityProcessor = activityProcessor;
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
        )
    ];
  }

  // Handle slash command interactions
  async handleCommand(interaction) {
    const { commandName, options } = interaction;

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
        default:
          await interaction.reply({ 
            content: '❌ Unknown command', 
            ephemeral: true 
          });
      }
    } catch (error) {
      console.error('❌ Error handling command:', error);
      
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
      const memberStats = this.activityProcessor.memberManager.getStats();

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
      const memberChunks = this.chunkArray(members, 10);
      
      memberChunks[0].forEach((member, index) => {
        const user = interaction.guild?.members.cache.get(member.discordUserId);
        const displayName = user ? `<@${member.discordUserId}>` : `User ID: ${member.discordUserId}`;
        const memberName = member.discordUser ? member.discordUser.displayName : `${member.athlete.firstname} ${member.athlete.lastname}`;
        
        embed.addFields([{
          name: memberName,
          value: `Discord: ${displayName}\nRegistered: ${new Date(member.registeredAt).toLocaleDateString()}\nStatus: ${member.isActive ? '🟢 Active' : '🔴 Inactive'}`,
          inline: true
        }]);
      });

      if (memberChunks.length > 1) {
        embed.setFooter({ text: `Showing first 10 of ${members.length} members` });
      }

      await interaction.editReply({ embeds: [embed] });

    } catch (error) {
      console.error('❌ Error listing members:', error);
      await interaction.editReply({
        content: '❌ Failed to retrieve member list.',
        ephemeral: true
      });
    }
  }

  // Remove a member
  async removeMember(interaction, options) {
    await interaction.deferReply({ ephemeral: true });

    try {
      const userInput = options.getString('user');
      const userId = this.extractUserId(userInput);

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
      console.error('❌ Error removing member:', error);
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
      const userId = this.extractUserId(userInput);

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

      const success = await this.activityProcessor.memberManager.deactivateMember(member.athlete.id);

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
      console.error('❌ Error deactivating member:', error);
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
      const userId = this.extractUserId(userInput);

      if (!userId) {
        await interaction.editReply({
          content: '❌ Invalid user. Please use @mention or a valid user ID.',
          ephemeral: true
        });
        return;
      }

      // Get member even if inactive
      const athleteId = this.activityProcessor.memberManager.discordToStrava.get(userId);
      const member = athleteId ? this.activityProcessor.memberManager.members.get(athleteId) : null;
      
      if (!member) {
        await interaction.editReply({
          content: '❌ User not found in team members.',
          ephemeral: true
        });
        return;
      }

      const success = await this.activityProcessor.memberManager.reactivateMember(member.athlete.id);

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
      console.error('❌ Error reactivating member:', error);
      await interaction.editReply({
        content: '❌ Failed to reactivate member.',
        ephemeral: true
      });
    }
  }

  // Handle register command
  async handleRegisterCommand(interaction) {
    const userId = interaction.user.id;
    const existingMember = await this.activityProcessor.memberManager.getMemberByDiscordId(userId);

    if (existingMember) {
      const memberName = existingMember.discordUser ? existingMember.discordUser.displayName : `${existingMember.athlete.firstname} ${existingMember.athlete.lastname}`;
      await interaction.reply({
        content: `✅ You're already registered as **${memberName}**.`,
        ephemeral: true
      });
      return;
    }

    const registerUrl = `http://localhost:3000/auth/strava?user_id=${userId}`;

    const embed = new EmbedBuilder()
      .setTitle('🔗 Register with Strava')
      .setColor('#FC4C02')
      .setDescription('Click the link below to connect your Strava account and join the team!')
      .addFields([{
        name: 'Registration Link',
        value: `[Click here to register](${registerUrl})`,
        inline: false
      }])
      .setFooter({ text: 'This link is personalized for your Discord account' })
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  }


  // Handle bot status command
  async handleBotStatusCommand(interaction) {
    await interaction.deferReply({ ephemeral: true });

    try {
      const stats = this.activityProcessor.getStats();
      const memberStats = this.activityProcessor.memberManager.getStats();

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
            value: `${Math.floor(stats.uptime / 3600)}h ${Math.floor((stats.uptime % 3600) / 60)}m`,
            inline: true
          },
          {
            name: '💾 Memory Usage',
            value: `${Math.round(stats.memoryUsage.heapUsed / 1024 / 1024)}MB`,
            inline: true
          }
        ])
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });

    } catch (error) {
      console.error('❌ Error getting bot status:', error);
      await interaction.editReply({
        content: '❌ Failed to retrieve bot status.',
        ephemeral: true
      });
    }
  }

  // Handle last activity command
  async handleLastActivityCommand(interaction, options) {
    await interaction.deferReply();

    try {
      const memberInput = options.getString('member');
      const member = await this.findMemberByInput(memberInput);

      if (!member) {
        await interaction.editReply({
          content: '❌ Team member not found. Use `/members list` to see all registered members.',
        });
        return;
      }

      // Get valid access token for the member
      const accessToken = await this.activityProcessor.memberManager.getValidAccessToken(member);
      if (!accessToken) {
        const memberName = member.discordUser ? member.discordUser.displayName : `${member.athlete.firstname} ${member.athlete.lastname}`;
        await interaction.editReply({
          content: `❌ Unable to access activities for **${memberName}**. They may need to re-authorize.`,
        });
        return;
      }

      // Fetch their latest activities
      const activities = await this.activityProcessor.stravaAPI.getAthleteActivities(
        accessToken,
        1, // page
        1  // just get the latest one
      );

      if (!activities || activities.length === 0) {
        const memberName = member.discordUser ? member.discordUser.displayName : `${member.athlete.firstname} ${member.athlete.lastname}`;
        await interaction.editReply({
          content: `📭 No recent activities found for **${memberName}**.`,
        });
        return;
      }

      const latestActivity = activities[0];

      // Get detailed activity data
      const detailedActivity = await this.activityProcessor.stravaAPI.getActivity(
        latestActivity.id,
        accessToken
      );

      // Process the activity data for display
      const processedActivity = this.activityProcessor.stravaAPI.processActivityData(
        detailedActivity,
        member.athlete
      );

      // Create the same embed as used for posting activities
      const embed = this.createLastActivityEmbed(processedActivity);

      await interaction.editReply({ embeds: [embed] });

    } catch (error) {
      console.error('❌ Error fetching last activity:', error);
      await interaction.editReply({
        content: '❌ Failed to fetch the last activity. Please try again later.',
      });
    }
  }

  // Create embed for last activity (similar to bot's activity posting)
  createLastActivityEmbed(activity) {
    const embed = new EmbedBuilder()
      .setTitle(`🏃 ${activity.name}`)
      .setColor(this.getActivityColor(activity.type))
      .setAuthor({
        name: `${activity.athlete.discordUser ? activity.athlete.discordUser.displayName : `${activity.athlete.firstname} ${activity.athlete.lastname}`} - Last Activity`,
        iconURL: activity.athlete.discordUser && activity.athlete.discordUser.avatarURL ? activity.athlete.discordUser.avatarURL : activity.athlete.profile_medium,
      })
      .setTimestamp(new Date(activity.start_date))
      .setFooter({
        text: 'Latest Strava Activity',
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
      if (mapUrl) {
        embed.setImage(mapUrl);
      }
    }

    // Add link to Strava activity
    embed.setURL(`https://www.strava.com/activities/${activity.id}`);

    return embed;
  }

  // Find member by various input types (name, mention, etc.)
  async findMemberByInput(input) {
    const members = await this.activityProcessor.memberManager.getAllMembers();

    // Try to extract Discord user ID from mention
    const userId = this.extractUserId(input);
    if (userId) {
      return await this.activityProcessor.memberManager.getMemberByDiscordId(userId);
    }

    // Search by name (Discord name, first name, last name, or full name)
    const searchTerm = input.toLowerCase().trim();
    
    return members.find(member => {
      const discordName = member.discordUser ? member.discordUser.displayName.toLowerCase() : '';
      const firstName = member.athlete.firstname.toLowerCase();
      const lastName = member.athlete.lastname.toLowerCase();
      const fullName = `${firstName} ${lastName}`;
      
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
        const searchTerm = focusedOption.value.toLowerCase();
        
        const choices = members
          .filter(member => {
            const memberName = member.discordUser ? member.discordUser.displayName.toLowerCase() : `${member.athlete.firstname} ${member.athlete.lastname}`.toLowerCase();
            const fullName = `${member.athlete.firstname} ${member.athlete.lastname}`.toLowerCase();
            return memberName.includes(searchTerm) || 
                   fullName.includes(searchTerm) || 
                   member.athlete.firstname.toLowerCase().includes(searchTerm) ||
                   member.athlete.lastname.toLowerCase().includes(searchTerm);
          })
          .slice(0, 25) // Discord limits to 25 choices
          .map(member => ({
            name: member.discordUser ? member.discordUser.displayName : `${member.athlete.firstname} ${member.athlete.lastname}`,
            value: member.discordUser ? member.discordUser.displayName : `${member.athlete.firstname} ${member.athlete.lastname}`
          }));

        await interaction.respond(choices);
      } catch (error) {
        console.error('❌ Error in autocomplete:', error);
        await interaction.respond([]);
      }
    }
  }

  // Helper methods (borrowed from DiscordBot)
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

  // Utility functions
  extractUserId(userInput) {
    // Extract user ID from mention (<@123456>) or return as-is if it's already an ID
    const mentionMatch = userInput.match(/^<@!?(\d+)>$/);
    if (mentionMatch) {
      return mentionMatch[1];
    }
    
    // Check if it's a valid snowflake ID (Discord user ID)
    if (/^\d{17,19}$/.test(userInput)) {
      return userInput;
    }
    
    return null;
  }

  chunkArray(array, size) {
    const chunks = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }

  generateStaticMapUrl(polyline) {
    if (!process.env.GOOGLE_MAPS_API_KEY) {
      return null;
    }

    // Google Static Maps API URL with polyline
    const baseUrl = 'https://maps.googleapis.com/maps/api/staticmap';
    const params = new URLSearchParams({
      size: '600x400',
      maptype: 'roadmap',
      path: `enc:${polyline}`,
      key: process.env.GOOGLE_MAPS_API_KEY,
    });

    return `${baseUrl}?${params.toString()}`;
  }
}

module.exports = DiscordCommands;