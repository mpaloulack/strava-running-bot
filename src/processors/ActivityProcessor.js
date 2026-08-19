const StravaAPI = require('../strava/api');
const IntervalsAPI = require('../intervals/api');
const DiscordBot = require('../discord/bot');
const DatabaseMemberManager = require('../database/DatabaseMemberManager');
const ActivityQueue = require('../managers/ActivityQueue');
const Scheduler = require('../managers/Scheduler');
const RaceManager = require('../managers/RaceManager');
const PBManager = require('../managers/PBManager');
const LeaderboardManager = require('../managers/LeaderboardManager');
const BestEffortCalculator = require('../utils/BestEffortCalculator');
const config = require('../../config/config');
const dynamicConfig = require('../../config/dynamicConfig');
const logger = require('../utils/Logger');
const { TIME } = require('../constants');

class ActivityProcessor {
  constructor() {
    this.stravaAPI = new StravaAPI();
    this.intervalsAPI = new IntervalsAPI();
    this.memberManager = new DatabaseMemberManager();
    this.discordBot = new DiscordBot(this); // Pass this instance to Discord bot
    this.activityQueue = new ActivityQueue(this); // Activity queue for delayed posting
    this.processedActivities = new Set(); // Prevent duplicate processing
    
    // Initialize race management and scheduler
    this.raceManager = new RaceManager();
    this.leaderboardManager = new LeaderboardManager();
    this.scheduler = new Scheduler(this, this.raceManager, this.leaderboardManager);

    // Initialize PB manager
    this.pbManager = new PBManager();
  }

  async initialize() {
    logger.activity.info('Initializing Activity Processor...');
    
    try {
      // Initialize database and member manager
      logger.activity.info('Initializing member manager...');
      await this.memberManager.initialize();
      
      // Initialize dynamic config with settings manager
      if (this.memberManager.databaseManager.settingsManager) {
        dynamicConfig.setSettingsManager(this.memberManager.databaseManager.settingsManager);
      }
      
      logger.activity.info('Member manager initialized');
      
      // Start Discord bot
      logger.activity.info('Starting Discord bot...');
      await this.discordBot.start();
      logger.activity.info('Discord bot started');

      // Start activity queue processor
      logger.activity.info('Activity queue ready (no startup required)');
      // Note: ActivityQueue doesn't need to be started, it processes activities on-demand

      // Initialize race scheduler
      logger.activity.info('Initializing race scheduler...');
      await this.scheduler.initialize(config);
      logger.activity.info('Race scheduler initialized');

      logger.activity.info('Getting member count...');
      const memberCount = await this.memberManager.getMemberCount();
      logger.activity.info('Activity Processor initialized successfully', {
        memberCount: memberCount
      });
      
    } catch (error) {
      logger.activity.error('Failed to initialize Activity Processor', {
        message: error.message,
        stack: error.stack,
        error: error
      });
      throw error;
    }
  }

  async processNewActivity(activityId, athleteId) {
    const activityKey = `${athleteId}-${activityId}`;
    
    // Prevent duplicate processing
    if (this.processedActivities.has(activityKey)) {
      logger.activityProcessing(activityId, athleteId, 'DUPLICATE', 'SKIPPED', {
        reason: 'Already processed'
      });
      return;
    }

    try {
      logger.activityProcessing(activityId, athleteId, 'PROCESSING', 'STARTED');

      // Check if athlete is a registered member
      const member = await this.memberManager.getMemberByAthleteId(athleteId);
      if (!member) {
        logger.activityProcessing(activityId, athleteId, 'NOT_MEMBER', 'SKIPPED', {
          reason: 'Athlete not registered as member'
        });
        return;
      }

      // A member's athlete_id can keep routing Strava webhooks to them even
      // after they've switched to another provider (the old id stays valid
      // until they switch back). Ignore those events rather than calling the
      // Strava API with credentials that no longer make sense for this member.
      if ((member.provider || 'strava') !== 'strava') {
        logger.activityProcessing(activityId, athleteId, 'NON_STRAVA_MEMBER', 'SKIPPED', {
          provider: member.provider
        });
        return;
      }

      const memberName = member.discordUser ? member.discordUser.displayName : `${member.athlete.firstname} ${member.athlete.lastname}`;
      logger.activity.debug('Found registered member for activity', {
        activityId,
        athleteId,
        memberName,
        discordUserId: member.discordUserId
      });

      // Get valid access token (refresh if needed)
      const accessToken = await this.memberManager.getValidAccessToken(member);
      if (!accessToken) {
        logger.activityProcessing(activityId, athleteId, memberName, 'FAILED', {
          reason: 'Unable to get valid access token'
        });
        return;
      }

      // Fetch detailed activity data
      const activity = await this.stravaAPI.getActivity(activityId, accessToken);

      // Run PB detection BEFORE the post-filter so private / hidden / old
      // activities still update the athlete's PB records. PB tracking is a
      // member-private record; whether to broadcast it to Discord is a
      // separate concern handled by shouldPostActivity below.
      let pbResults = [];
      try {
        pbResults = await this.pbManager.checkAndUpdatePBs(athleteId, activity);
      } catch (pbError) {
        logger.activity.error('PB check failed (non-blocking)', {
          activityId,
          athleteId,
          error: pbError.message,
        });
      }

      // Cross-provider duplicate check: if this same physical run already has
      // an activities row under a different id (e.g. posted once via the
      // intervals.icu poll before/after this member's provider switch), skip
      // saving/posting it again so it doesn't double-count on the leaderboard.
      // PB detection above still runs — best_efforts are worth recording even
      // for a duplicate.
      const duplicate = await this.memberManager.databaseManager.findDuplicateActivity(
        athleteId, activity?.start_date_local, activityId, 'strava'
      );
      if (duplicate) {
        logger.activityProcessing(activityId, athleteId, 'CROSS_PROVIDER_DUPLICATE', 'SKIPPED', {
          duplicateOf: duplicate.strava_activity_id
        });
        this.processedActivities.add(activityKey);
        return;
      }

      // Save activity to DB (non-blocking) — also independent of the post filter
      // so we have a complete cached record for /sync, /pb, and stats.
      try {
        await this.memberManager.databaseManager.upsertActivity(athleteId, activity, 'strava');
      } catch (saveError) {
        logger.activity.error('Failed to save activity to DB', {
          activityId,
          error: saveError.message,
        });
      }

      // Now decide whether to broadcast the activity to Discord. PBs above
      // were already recorded regardless of this decision.
      if (!this.stravaAPI.shouldPostActivity(activity)) {
        logger.activityProcessing(activityId, athleteId, activity.name, 'FILTERED', {
          reason: 'Activity filtered by posting rules',
          pbsRecorded: pbResults.filter(r => r.isNewPB).length,
        });
        this.processedActivities.add(activityKey);
        return;
      }

      // Process activity data for Discord with member info including Discord user data
      const athleteWithDiscordInfo = {
        ...member.athlete,
        discordUser: member.discordUser
      };
      const processedActivity = await this.stravaAPI.processActivityWithStreams(activity, athleteWithDiscordInfo, accessToken);
      processedActivity.pbResults = pbResults;

      // Post to Discord
      await this.discordBot.postActivity(processedActivity);

      // Mark as processed
      this.processedActivities.add(activityKey);
      
      logger.activityProcessing(activityId, athleteId, activity.name, 'COMPLETED', {
        memberName,
        activityType: activity.type,
        distance: activity.distance
      });

    } catch (error) {
      logger.activityProcessing(activityId, athleteId, 'UNKNOWN', 'FAILED', {
        error: error.message,
        stack: error.stack,
        responseStatus: error.response?.status
      });
      
      // If it's an authentication error, try to refresh the token
      if (error.response && error.response.status === 401) {
        logger.activity.info('Attempting token refresh for authentication error', {
          activityId,
          athleteId,
          errorStatus: error.response?.status
        });
        try {
          const member = await this.memberManager.getMemberByAthleteId(athleteId);
          if (member) {
            await this.memberManager.refreshMemberToken(member);
            logger.activity.info('Token refreshed, retrying activity processing', {
              activityId,
              athleteId
            });
            
            // Retry processing once with new token
            setTimeout(() => this.processNewActivity(activityId, athleteId), 1000);
          }
        } catch (refreshError) {
          logger.activity.error('Failed to refresh token during activity processing', {
            activityId,
            athleteId,
            error: refreshError.message
          });
        }
      }
    }
  }

  // Queue activity for delayed posting (used by webhook handler)
  async queueActivity(activityId, athleteId, webhookData = {}) {
    logger.activity.info('Queueing activity for delayed posting', {
      activityId,
      athleteId,
      delayMinutes: config.posting.delayMinutes
    });
    
    return this.activityQueue.queueActivity(activityId, athleteId, webhookData);
  }

  // Handle activity updates during delay period
  async updateQueuedActivity(activityId, athleteId, webhookData = {}) {
    const wasUpdated = this.activityQueue.updateQueuedActivity(activityId, athleteId, webhookData);
    
    if (wasUpdated) {
      logger.activity.info('Updated queued activity with new data', {
        activityId,
        athleteId
      });
    } else {
      // Activity not in queue, might need to process immediately or queue it
      logger.activity.debug('Activity update received for non-queued activity', {
        activityId,
        athleteId
      });
      
      // Check if already processed
      const activityKey = `${athleteId}-${activityId}`;
      if (this.processedActivities.has(activityKey)) {
        logger.activity.debug('Activity already processed, ignoring update', {
          activityId,
          athleteId
        });
        return;
      }
      
      // Queue the updated activity
      return this.queueActivity(activityId, athleteId, webhookData);
    }
  }

  // Handle activity deletions during delay period
  async removeQueuedActivity(activityId, athleteId) {
    const wasRemoved = this.activityQueue.removeFromQueue(activityId);
    
    if (wasRemoved) {
      logger.activity.info('Removed deleted activity from queue', {
        activityId,
        athleteId
      });
    } else {
      logger.activity.debug('Activity deletion received for non-queued activity', {
        activityId,
        athleteId
      });
    }
  }

  // Process recent activities for all members (useful for initial sync or recovery)
  // Strava-only: intervals.icu members are recovered via pollIntervalsActivities'
  // own dedup-backed lookback, not this Strava-API-based sync path.
  async processRecentActivities(hoursBack = 24) {
    const members = (await this.memberManager.getAllMembers()).filter(m => (m.provider || 'strava') === 'strava');
    const after = Math.floor((Date.now() - (hoursBack * TIME.MS_PER_HOUR)) / 1000);
    
    logger.activity.info('Processing recent activities', {
      hoursBack,
      afterTimestamp: after,
      memberCount: members.length
    });

    for (const member of members) {
      const memberName = member.discordUser ? member.discordUser.displayName : `${member.athlete.firstname} ${member.athlete.lastname}`;
      
      try {
        logger.activity.debug('Processing recent activities for member', {
          memberName,
          athleteId: member.athlete.id,
          discordUserId: member.discordUserId
        });
        
        const accessToken = await this.memberManager.getValidAccessToken(member);
        if (!accessToken) {
          logger.activity.warn('Unable to get valid access token for recent activities', {
            memberName,
            athleteId: member.athlete.id
          });
          continue;
        }

        const activities = await this.stravaAPI.getAthleteActivities(
          accessToken,
          1, // page
          30, // per_page
          null, // before
          after // after
        );

        logger.activity.info('Found recent activities', {
          memberName,
          activityCount: activities.length,
          timeRange: `${hoursBack} hours`
        });

        for (const activity of activities) {
          // Process each activity with a small delay to avoid rate limiting
          await new Promise(resolve => setTimeout(resolve, 200));
          await this.processNewActivity(activity.id, member.athlete.id);
        }

      } catch (error) {
        logger.activity.error('Error processing recent activities for member', {
          memberName,
          athleteId: member.athlete.id,
          error: error.message
        });
      }
    }

    logger.activity.info('Finished processing recent activities');
  }

  // Poll intervals.icu for new activities for all intervals.icu members.
  // There are no webhooks for intervals.icu, so this is called on a schedule.
  //
  // No stored watermark: intervals.icu activities upload well after they
  // start (a long run started hours ago, or a watch that syncs late), so a
  // window based on "time since last poll" can miss activities that started
  // before the watermark but only just synced. Instead we always look back
  // a fixed 40 hours and rely on the DB + in-memory dedup in
  // processIntervalsActivity to skip anything already handled. 40h = the 24h
  // posting age-filter window plus margin for intervals.icu interpreting the
  // `oldest` param in the athlete's local time (a negative UTC offset would
  // otherwise shave up to 12h off the effective window).
  async pollIntervalsActivities() {
    try {
      const members = (await this.memberManager.getAllMembers()).filter(m => m.provider === 'intervals');
      if (members.length === 0) {
        return;
      }

      const oldest = new Date(Date.now() - 40 * TIME.MS_PER_HOUR).toISOString();

      logger.activity.info('Polling intervals.icu activities', {
        memberCount: members.length,
        oldest
      });

      for (const member of members) {
        const memberName = member.discordUser ? member.discordUser.displayName : `${member.athlete.firstname} ${member.athlete.lastname}`;

        try {
          const apiKey = await this.memberManager.getValidAccessToken(member);
          if (!apiKey) {
            logger.activity.warn('Unable to get valid API key for intervals.icu poll', {
              memberName,
              athleteId: member.athleteId
            });
            continue;
          }

          const activities = await this.intervalsAPI.getAthleteActivities(apiKey, oldest);

          logger.activity.info('Found intervals.icu activities', {
            memberName,
            activityCount: activities.length
          });

          for (const activity of activities) {
            await new Promise(resolve => setTimeout(resolve, 200));
            await this.processIntervalsActivity(activity, member, apiKey);
          }
        } catch (error) {
          logger.activity.error('Error polling intervals.icu activities for member', {
            memberName,
            athleteId: member.athleteId,
            error: error.message
          });
        }
      }
    } catch (error) {
      logger.activity.error('Failed to poll intervals.icu activities', {
        error: error.message,
        stack: error.stack
      });
    }
  }

  async processIntervalsActivity(activity, member, apiKey) {
    const athleteId = member.athleteId;
    const activityKey = `${athleteId}-${activity.id}`;

    if (this.processedActivities.has(activityKey)) {
      logger.activityProcessing(activity.id, athleteId, 'DUPLICATE', 'SKIPPED', {
        reason: 'Already processed'
      });
      return;
    }

    try {
      // Restart-safe dedup: intervals.icu ids are 'i'-prefixed strings so they
      // can never collide with Strava's numeric activity ids in this table.
      // A DB row is only ever written once an activity is fully handled
      // (filtered-out or successfully posted) — see below — so its presence
      // here reliably means "nothing left to do."
      if (await this.memberManager.databaseManager.getActivityById(activity.id)) {
        this.processedActivities.add(activityKey);
        return;
      }

      // Cross-provider duplicate check: this same physical run may already
      // have a row under its Strava id (e.g. posted before this member
      // switched to intervals.icu, or vice versa on a later switch-back).
      // Skip entirely — no upsert — so the leaderboard doesn't double-count it.
      const duplicate = await this.memberManager.databaseManager.findDuplicateActivity(
        athleteId, activity.start_date_local, activity.id, 'intervals'
      );
      if (duplicate) {
        this.processedActivities.add(activityKey);
        logger.activityProcessing(activity.id, athleteId, 'CROSS_PROVIDER_DUPLICATE', 'SKIPPED', {
          duplicateOf: duplicate.strava_activity_id
        });
        return;
      }

      // Fetch streams once, best-effort. intervals.icu has no per-activity
      // best_efforts like Strava, so we synthesize them from the raw
      // time/distance/altitude/latlng streams instead. Streams also feed the
      // embed's map/elevation rendering downstream in processActivityData.
      let streams = null;
      if (apiKey) {
        try {
          streams = await this.intervalsAPI.getActivityStreams(activity.id, apiKey);
        } catch (streamsError) {
          logger.activity.debug('Failed to fetch intervals.icu activity streams (non-blocking)', {
            activityId: activity.id,
            athleteId,
            error: streamsError.message
          });
        }
      }

      // Run PB detection BEFORE the post-filter, mirroring the Strava path:
      // private/hidden/old activities still update the athlete's PB records.
      let pbResults = [];
      const efforts = streams ? BestEffortCalculator.synthesizeBestEfforts(streams) : [];
      if (efforts.length > 0) {
        try {
          pbResults = await this.pbManager.checkAndUpdatePBs(athleteId, { ...activity, best_efforts: efforts });
        } catch (pbError) {
          logger.activity.error('PB check failed (non-blocking)', {
            activityId: activity.id,
            athleteId,
            error: pbError.message,
          });
        }
      }

      if (!this.intervalsAPI.shouldPostActivity(activity)) {
        await this.memberManager.databaseManager.upsertActivity(athleteId, activity, 'intervals');
        this.processedActivities.add(activityKey);
        logger.activityProcessing(activity.id, athleteId, activity.name, 'FILTERED', {
          reason: 'Activity filtered by posting rules',
          pbsRecorded: pbResults.filter(r => r.isNewPB).length,
        });
        return;
      }

      const processedActivity = this.intervalsAPI.processActivityData(activity, {
        ...member.athlete,
        discordUser: member.discordUser
      }, streams);
      processedActivity.pbResults = pbResults;

      // Post before persisting: if postActivity throws, we must NOT upsert
      // or mark as processed, so the next poll retries it instead of
      // silently dropping it forever.
      await this.discordBot.postActivity(processedActivity);

      try {
        await this.memberManager.databaseManager.upsertActivity(athleteId, activity, 'intervals');
      } catch (saveError) {
        logger.activity.error('Failed to save intervals.icu activity to DB', {
          activityId: activity.id,
          error: saveError.message,
        });
      }

      this.processedActivities.add(activityKey);

      logger.activityProcessing(activity.id, athleteId, activity.name, 'COMPLETED', {
        activityType: activity.type,
        distance: activity.distance
      });
    } catch (error) {
      logger.activityProcessing(activity.id, athleteId, 'UNKNOWN', 'FAILED', {
        error: error.message,
        stack: error.stack
      });
    }
  }

  // Cleanup old processed activity records to prevent memory buildup
  cleanupProcessedActivities() {
    const maxSize = 10000; // Keep track of last 10k activities
    
    if (this.processedActivities.size > maxSize) {
      const activitiesArray = Array.from(this.processedActivities);
      const toKeep = activitiesArray.slice(-Math.floor(maxSize * 0.8)); // Keep 80% of max
      
      this.processedActivities.clear();
      toKeep.forEach(activity => this.processedActivities.add(activity));
      
      logger.activity.debug('Cleaned up processed activities cache', {
        previousSize: maxSize,
        currentSize: toKeep.length,
        cleanupRatio: '80%'
      });
    }
  }

  // Revoke this member's Strava access at Strava (freeing the athlete seat
  // against the app's cap, see config.strava.athleteCap) and clear their
  // stored Strava credentials. Called from the provider-switch, remove and
  // deactivate paths in commands.js, plus the explicit /disconnect and
  // /members revoke commands. Revocation is best-effort cleanup — it must
  // never block or fail the user-facing operation that triggered it, so this
  // never throws.
  async revokeStravaAccess(member) {
    const athleteId = member.athleteId;

    try {
      const tokenData = await this.memberManager.getStoredProviderTokens(member, 'strava');
      if (!tokenData) {
        logger.member.info('No stored Strava credentials to revoke', { athleteId });
        return { revoked: false, reason: 'no_credentials' };
      }

      let accessToken = tokenData.access_token;
      const isExpired = tokenData.expires_at && tokenData.expires_at < Date.now() / 1000;

      if (isExpired) {
        // Deauthorize needs a live access token. No refresh token means the
        // stored access token can't be renewed, so treat it the same as an
        // already-dead token: nothing left to revoke.
        if (!tokenData.refresh_token) {
          logger.member.info('Stored Strava token expired with no refresh token - treating as already revoked', {
            athleteId
          });
          return { revoked: true, reason: 'already_revoked' };
        }

        try {
          const refreshed = await this.stravaAPI.refreshAccessToken(tokenData.refresh_token);
          accessToken = refreshed.access_token;
        } catch (refreshError) {
          // A failed refresh means the token is already dead at Strava's end.
          logger.member.info('Token refresh failed before Strava deauthorization - treating as already revoked', {
            athleteId,
            error: refreshError.message
          });
          return { revoked: true, reason: 'already_revoked' };
        }
      }

      const result = await this.stravaAPI.deauthorize(accessToken);

      if (result.revoked) {
        await this.memberManager.databaseManager.clearProviderTokens(athleteId, 'strava');
      }

      logger.member.info('Strava access revocation outcome', {
        athleteId,
        revoked: result.revoked,
        reason: result.reason
      });

      return result;
    } catch (error) {
      logger.member.error('Unexpected error revoking Strava access', {
        athleteId,
        error: error.message
      });
      return { revoked: false, reason: error.message };
    }
  }

  // A stored Strava credential occupies a real athlete seat regardless of the
  // member's current active state or provider - Strava's app-level cap only
  // cares whether the app still holds a live grant for that athlete. A member
  // is "reclaimable" when they hold Strava credentials they no longer need:
  // deactivated, or switched to another provider (both scenarios that predate
  // automatic revocation, or where revocation itself failed). Factored out so
  // countStravaSeats' `reclaimable` count and getReclaimableStravaMembers'
  // list are always in lockstep - a member can never be counted in one and
  // omitted from the other.
  _isReclaimableStravaMember(member) {
    return !(member.isActive && (member.provider || 'strava') === 'strava');
  }

  // Every member (active or not, any provider) currently holding a stored
  // Strava namespace - the real seat-occupying set. A corrupt/undecryptable
  // token blob must not blow up the whole scan, so a member whose lookup
  // throws is logged and skipped rather than propagating.
  async _getStravaCredentialHolders() {
    const members = await this.memberManager.getAllMembersIncludingInactive();
    const holders = [];

    for (const member of members) {
      let tokenData;
      try {
        tokenData = await this.memberManager.getStoredProviderTokens(member, 'strava');
      } catch (error) {
        logger.member.warn('Could not read stored Strava tokens for seat accounting - skipping member', {
          athleteId: member.athleteId,
          error: error.message
        });
        continue;
      }

      if (tokenData) {
        holders.push(member);
      }
    }

    return holders;
  }

  // Count real Strava seat usage against config.strava.athleteCap: `used` is
  // every member still holding a stored Strava credential, regardless of
  // active state or current provider; `reclaimable` is the subset of those
  // who no longer need it (deactivated, or switched provider) and so could be
  // freed by revoking. Used by /members revoke and the /members connections
  // footer.
  async countStravaSeats() {
    const holders = await this._getStravaCredentialHolders();
    const reclaimable = holders.filter(member => this._isReclaimableStravaMember(member));

    return {
      used: holders.length,
      cap: config.strava.athleteCap,
      reclaimable: reclaimable.length
    };
  }

  // The actual member objects behind countStravaSeats' `reclaimable` count,
  // in the same order getAllMembersIncludingInactive returns them. Used by
  // the bulk /members revoke all_reclaimable path in commands.js.
  async getReclaimableStravaMembers() {
    const holders = await this._getStravaCredentialHolders();
    return holders.filter(member => this._isReclaimableStravaMember(member));
  }

  // Get activity statistics
  async getStats() {
    const queueStats = this.activityQueue.getStats();
    
    return {
      processedActivities: this.processedActivities.size,
      registeredMembers: await this.memberManager.getMemberCount(),
      uptime: process.uptime(),
      memoryUsage: process.memoryUsage(),
      activityQueue: queueStats
    };
  }

  async shutdown() {
    logger.activity.info('Shutting down Activity Processor...');
    
    try {
      // Shutdown scheduler first to stop cron jobs
      await this.scheduler.shutdown();
      
      // Shutdown activity queue to stop any pending timers
      this.activityQueue.shutdown();
      
      await this.discordBot.stop();
      await this.memberManager.saveMembers();
      logger.activity.info('Activity Processor shutdown complete');
    } catch (error) {
      logger.activity.error('Error during Activity Processor shutdown', error);
    }
  }
}

module.exports = ActivityProcessor;