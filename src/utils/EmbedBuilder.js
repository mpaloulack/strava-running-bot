const { EmbedBuilder } = require('discord.js');
const ActivityFormatter = require('./ActivityFormatter');

/**
 * Shared utility for creating Discord embeds for activities
 */
class ActivityEmbedBuilder {
  
  /**
   * Create a Discord embed for an activity
   * @param {Object} activity - Processed activity data
   * @param {Object} options - Embed options
   * @param {string} options.type - 'posted' or 'latest'
   * @returns {EmbedBuilder} Discord embed
   */
  static createActivityEmbed(activity, options = {}) {
    const { type = 'posted' } = options;
    
    const embed = new EmbedBuilder()
      .setTitle(`🏃 ${activity.name}`)
      .setColor(ActivityFormatter.getActivityColor(activity.type))
      .setTimestamp(new Date(activity.start_date))
      .setURL(`https://www.strava.com/activities/${activity.id}`);

    // Set author based on embed type
    if (type === 'latest') {
      embed.setAuthor({
        name: `${activity.athlete.discordUser ? activity.athlete.discordUser.displayName : `${activity.athlete.firstname} ${activity.athlete.lastname}`} - Last Activity`,
        iconURL: activity.athlete.discordUser && activity.athlete.discordUser.avatarURL ? activity.athlete.discordUser.avatarURL : activity.athlete.profile_medium,
      });
      embed.setFooter({
        text: 'Latest Strava Activity',
        iconURL: 'https://cdn.worldvectorlogo.com/logos/strava-1.svg',
      });
    } else {
      embed.setAuthor({
        name: activity.athlete.discordUser ? activity.athlete.discordUser.displayName : `${activity.athlete.firstname} ${activity.athlete.lastname}`,
        iconURL: activity.athlete.discordUser && activity.athlete.discordUser.avatarURL ? activity.athlete.discordUser.avatarURL : activity.athlete.profile_medium,
      });
      embed.setFooter({
        text: 'Strava Activity',
        iconURL: 'https://cdn.worldvectorlogo.com/logos/strava-1.svg',
      });
    }

    // Add description if available
    if (activity.description) {
      embed.setDescription(activity.description);
    }

    // Add core activity fields
    embed.addFields([
      {
        name: '📏 Distance',
        value: ActivityFormatter.formatDistance(activity.distance),
        inline: true,
      },
      {
        name: '⏱️ Time',
        value: ActivityFormatter.formatTime(activity.moving_time),
        inline: true,
      },
      {
        name: '🏃 Pace',
        value: ActivityFormatter.formatPace(activity.distance, activity.moving_time),
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
      const mapUrl = ActivityFormatter.generateStaticMapUrl(activity.map.summary_polyline);
      if (mapUrl) {
        embed.setImage(mapUrl);
      }
    }

    return embed;
  }
}

module.exports = ActivityEmbedBuilder;