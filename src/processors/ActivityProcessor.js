const StravaAPI = require('../strava/api');
const DiscordBot = require('../discord/bot');
const MemberManager = require('../managers/MemberManager');

class ActivityProcessor {
  constructor() {
    this.stravaAPI = new StravaAPI();
    this.memberManager = new MemberManager();
    this.discordBot = new DiscordBot(this); // Pass this instance to Discord bot
    this.processedActivities = new Set(); // Prevent duplicate processing
  }

  async initialize() {
    console.log('🚀 Initializing Activity Processor...');
    
    try {
      // Start Discord bot
      await this.discordBot.start();
      
      // Load existing members
      await this.memberManager.loadMembers();
      
      console.log('✅ Activity Processor initialized successfully');
    } catch (error) {
      console.error('❌ Failed to initialize Activity Processor:', error);
      throw error;
    }
  }

  async processNewActivity(activityId, athleteId) {
    const activityKey = `${athleteId}-${activityId}`;
    
    // Prevent duplicate processing
    if (this.processedActivities.has(activityKey)) {
      console.log(`⏭️ Activity ${activityId} already processed, skipping`);
      return;
    }

    try {
      console.log(`🔄 Processing activity ${activityId} from athlete ${athleteId}`);

      // Check if athlete is a registered member
      const member = await this.memberManager.getMemberByAthleteId(athleteId);
      if (!member) {
        console.log(`⏭️ Athlete ${athleteId} is not a registered member, skipping activity`);
        return;
      }

      console.log(`👤 Found member: ${member.athlete.firstname} ${member.athlete.lastname}`);

      // Get valid access token (refresh if needed)
      const accessToken = await this.memberManager.getValidAccessToken(member);
      if (!accessToken) {
        console.error(`❌ Unable to get valid access token for athlete ${athleteId}`);
        return;
      }

      // Fetch detailed activity data
      const activity = await this.stravaAPI.getActivity(activityId, accessToken);
      
      // Check if activity should be posted
      if (!this.stravaAPI.shouldPostActivity(activity)) {
        console.log(`⏭️ Activity ${activityId} filtered out, not posting`);
        this.processedActivities.add(activityKey);
        return;
      }

      // Process activity data for Discord
      const processedActivity = this.stravaAPI.processActivityData(activity, member.athlete);

      // Post to Discord
      await this.discordBot.postActivity(processedActivity);

      // Mark as processed
      this.processedActivities.add(activityKey);
      
      console.log(`✅ Successfully processed and posted activity: ${activity.name}`);

    } catch (error) {
      console.error(`❌ Error processing activity ${activityId}:`, error);
      
      // If it's an authentication error, try to refresh the token
      if (error.response && error.response.status === 401) {
        console.log(`🔄 Attempting to refresh token for athlete ${athleteId}`);
        try {
          const member = await this.memberManager.getMemberByAthleteId(athleteId);
          if (member) {
            await this.memberManager.refreshMemberToken(member);
            console.log(`✅ Token refreshed for athlete ${athleteId}, retrying activity processing`);
            
            // Retry processing once with new token
            setTimeout(() => this.processNewActivity(activityId, athleteId), 1000);
          }
        } catch (refreshError) {
          console.error(`❌ Failed to refresh token for athlete ${athleteId}:`, refreshError);
        }
      }
    }
  }

  // Process recent activities for all members (useful for initial sync or recovery)
  async processRecentActivities(hoursBack = 24) {
    console.log(`🔄 Processing recent activities from last ${hoursBack} hours...`);
    
    const members = await this.memberManager.getAllMembers();
    const after = Math.floor((Date.now() - (hoursBack * 60 * 60 * 1000)) / 1000);

    for (const member of members) {
      try {
        console.log(`👤 Processing recent activities for ${member.athlete.firstname} ${member.athlete.lastname}`);
        
        const accessToken = await this.memberManager.getValidAccessToken(member);
        if (!accessToken) {
          console.error(`❌ Unable to get valid access token for ${member.athlete.firstname}`);
          continue;
        }

        const activities = await this.stravaAPI.getAthleteActivities(
          accessToken,
          1, // page
          30, // per_page
          null, // before
          after // after
        );

        console.log(`📊 Found ${activities.length} recent activities for ${member.athlete.firstname}`);

        for (const activity of activities) {
          // Process each activity with a small delay to avoid rate limiting
          await new Promise(resolve => setTimeout(resolve, 200));
          await this.processNewActivity(activity.id, member.athlete.id);
        }

      } catch (error) {
        console.error(`❌ Error processing recent activities for ${member.athlete.firstname}:`, error);
      }
    }

    console.log('✅ Finished processing recent activities');
  }

  // Cleanup old processed activity records to prevent memory buildup
  cleanupProcessedActivities() {
    const maxSize = 10000; // Keep track of last 10k activities
    
    if (this.processedActivities.size > maxSize) {
      const activitiesArray = Array.from(this.processedActivities);
      const toKeep = activitiesArray.slice(-Math.floor(maxSize * 0.8)); // Keep 80% of max
      
      this.processedActivities.clear();
      toKeep.forEach(activity => this.processedActivities.add(activity));
      
      console.log(`🧹 Cleaned up processed activities cache, kept ${toKeep.length} entries`);
    }
  }

  // Get activity statistics
  getStats() {
    return {
      processedActivities: this.processedActivities.size,
      registeredMembers: this.memberManager.getMemberCount(),
      uptime: process.uptime(),
      memoryUsage: process.memoryUsage(),
    };
  }

  async shutdown() {
    console.log('🔄 Shutting down Activity Processor...');
    
    try {
      await this.discordBot.stop();
      await this.memberManager.saveMembers();
      console.log('✅ Activity Processor shutdown complete');
    } catch (error) {
      console.error('❌ Error during Activity Processor shutdown:', error);
    }
  }
}

module.exports = ActivityProcessor;