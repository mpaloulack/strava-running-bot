const databaseManager = require('../database/DatabaseManager');
const logger = require('../utils/Logger');
const ActivityFormatter = require('../utils/ActivityFormatter');
const { PB_EFFORT_LABELS, SUPPORTED_PB_TYPES, CATEGORY_DISTANCES, PB_DISTANCE_TOLERANCE_PERCENT } = require('../constants');

class PBManager {
  constructor() {
    this.databaseManager = databaseManager;
  }

  async initialize() {
    // Database manager is initialized by the main application
  }

  /**
   * Extract and normalize best_efforts from a Strava activity detail response.
   * Only processes Run activities. Returns [] for all other types or missing data.
   * @param {Object} activity - Full Strava activity object
   * @returns {Array} Normalized effort objects
   */
  extractBestEfforts(activity) {
    if (!activity) return [];
    if (!SUPPORTED_PB_TYPES.includes(activity.type)) return [];

    const activityDate = activity.start_date
      ? activity.start_date.substring(0, 10)
      : new Date().toISOString().substring(0, 10);

    // Phase 1: real Strava best_efforts
    const foundCategories = new Set();
    const results = [];

    for (const effort of (activity.best_efforts ?? [])) {
      const category = PB_EFFORT_LABELS[effort.name];
      if (!category) continue;
      foundCategories.add(category);
      results.push({
        category,
        distanceM: effort.distance,
        elapsedTime: effort.elapsed_time,
        movingTime: effort.moving_time,
        activityId: activity.id,
        activityName: activity.name || null,
        activityDate,
      });
    }

    // Phase 2: near-miss synthesis — synthesize a PB category entry when
    // the activity total distance is within tolerance of a standard distance
    // that Strava did not report (e.g. 4.99km run → synthesize "5K" entry)
    if (activity.distance > 0) {
      for (const [category, canonicalMeters] of Object.entries(CATEGORY_DISTANCES)) {
        if (foundCategories.has(category)) continue;
        const diff = Math.abs(activity.distance - canonicalMeters) / canonicalMeters;
        if (diff <= PB_DISTANCE_TOLERANCE_PERCENT) {
          results.push({
            category,
            distanceM: activity.distance,
            elapsedTime: activity.elapsed_time,
            movingTime: activity.moving_time,
            activityId: activity.id,
            activityName: activity.name || null,
            activityDate,
            isSynthetic: true,
          });
        }
      }
    }

    return results;
  }

  /**
   * Check each best_effort in the activity and update DB if it's a new PB.
   * @param {number} athleteId - Strava athlete ID
   * @param {Object} activity - Full Strava activity object
   * @returns {Array} Results array: [{isNewPB, category, previousPB, newPB}]
   */
  async checkAndUpdatePBs(athleteId, activity) {
    const efforts = this.extractBestEfforts(activity);
    if (efforts.length === 0) return [];
    return this.checkAndUpdatePBsFromEfforts(athleteId, efforts);
  }

  async checkAndUpdatePBsFromEfforts(athleteId, efforts) {
    if (efforts.length === 0) return [];

    const results = [];

    for (const effort of efforts) {
      try {
        const existing = await this.databaseManager.getPersonalBest(athleteId, effort.category);

        if (existing && effort.elapsedTime >= existing.elapsed_time) {
          results.push({ isNewPB: false, category: effort.category, previousPB: existing, newPB: null });
          continue;
        }

        await this.databaseManager.upsertPersonalBest(athleteId, effort);

        results.push({
          isNewPB: true,
          category: effort.category,
          previousPB: existing || null,
          newPB: effort,
        });

        logger.database.info('New personal best recorded', {
          athleteId,
          category: effort.category,
          elapsedTime: effort.elapsedTime,
          improvement: existing ? this.formatTimeImprovement(existing.elapsed_time, effort.elapsedTime) : 'first',
        });
      } catch (error) {
        logger.database.error('Failed to process PB for effort', {
          athleteId,
          category: effort.category,
          error: error.message,
        });
      }
    }

    return results;
  }

  /**
   * Get all PBs for a member by athlete ID, ordered by distance ascending.
   * @param {number} athleteId
   * @returns {Array}
   */
  async getMemberPBs(athleteId) {
    return await this.databaseManager.getPersonalBestsByAthleteId(athleteId);
  }

  /**
   * Get all PBs for a member by Discord user ID.
   * @param {string} discordUserId
   * @returns {Array}
   */
  async getMemberPBsByDiscordId(discordUserId) {
    const member = await this.databaseManager.getMemberByDiscordId(discordUserId);
    if (!member?.isActive) return [];
    return this.getMemberPBs(member.athleteId);
  }

  /**
   * Sync PBs from the last 12 months of Strava history for a member.
   * @param {string} discordUserId
   * @param {string} accessToken
   * @param {Object} stravaAPI - StravaAPI instance with getAthleteActivities / getActivity
   * @param {Function} [progressCb] - Called with page number every 5 pages
   * @returns {{ processed: number, updated: number, errors: number }}
   */
  async syncFromHistory(discordUserId, accessToken, stravaAPI, progressCb, afterTs = null) {
    const member = await this.databaseManager.getMemberByDiscordId(discordUserId);
    if (!member?.isActive) {
      return { processed: 0, updated: 0, errors: 0 };
    }

    const now = new Date();
    const after = afterTs ?? Math.floor(new Date(now.getFullYear(), 0, 1).getTime() / 1000);
    const cursorKey = `pb_sync_cursor_${discordUserId}_${after}`;

    // Read checkpoint: resume from the last successfully processed batch's newest timestamp.
    // The cursor is a forward-moving `after` value — Strava returns activities ascending
    // (oldest-first) when only `after` is provided, so each page returns the next batch
    // of newer activities.
    let savedCursor = null;
    try {
      savedCursor = await this.databaseManager.settingsManager.getSetting(cursorKey, null);
    } catch (cursorReadErr) {
      logger.database.warn('Failed to read PB sync cursor, starting from beginning', { discordUserId, error: cursorReadErr.message });
    }
    let currentAfter = savedCursor ? parseInt(savedCursor, 10) : after;

    const startTime = Date.now();
    let page = 1;
    let processed = 0;
    let updated = 0;
    let errors = 0;

    logger.database.info('PB sync started', {
      discordUserId,
      athleteId: member.athleteId,
      after: new Date(after * 1000).toISOString(),
      resumingFromCursor: savedCursor ? new Date(currentAfter * 1000).toISOString() : null,
    });

    while (true) {
      // Always page=1, no `before`. Strava returns activities ascending (oldest-first)
      // when only `after` is set. Using `before` alongside `after` switches Strava to
      // descending order and causes the same activities to be re-fetched.
      const activities = await stravaAPI.getAthleteActivities(accessToken, 1, 100, null, currentAfter);
      if (!activities?.length) break;

      const runCount = activities.filter(a => SUPPORTED_PB_TYPES.includes(a.type)).length;
      logger.database.info('PB sync page fetched', { discordUserId, page, total: activities.length, runs: runCount });

      for (const summary of activities) {
        if (!SUPPORTED_PB_TYPES.includes(summary.type)) continue;

        logger.database.info('PB sync processing activity', {
          discordUserId,
          activityId: summary.id,
          name: summary.name,
          date: summary.start_date,
        });

        try {
          const detail = await stravaAPI.getActivity(summary.id, accessToken);
          const results = await this.checkAndUpdatePBs(member.athleteId, detail);
          if (results.length === 0) {
            logger.database.info('PB sync activity has no best efforts', { discordUserId, activityId: summary.id });
          }

          // Collect PR categories from best_efforts where pr_rank === 1
          const prCategories = (detail.best_efforts || [])
            .filter(e => e.pr_rank === 1 && PB_EFFORT_LABELS[e.name])
            .map(e => PB_EFFORT_LABELS[e.name]);
          const detailWithPR = {
            ...detail,
            pr_categories: prCategories.length > 0 ? JSON.stringify(prCategories) : null,
          };

          try {
            await this.databaseManager.upsertActivity(member.athleteId, detailWithPR);
          } catch (saveError) {
            logger.database.error('Failed to save activity to DB', {
              activityId: summary.id,
              error: saveError.message,
            });
          }
          processed++;
          updated += results.filter(r => r.isNewPB).length;
        } catch (error) {
          errors++;
          logger.database.error('Error syncing activity PBs', {
            activityId: summary.id,
            error: error.message,
          });
        }

        // Small delay between requests to respect rate limits
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      // Advance the cursor to the newest activity on this page so the next call
      // fetches the following batch. Since Strava returns ascending (oldest-first)
      // with only `after`, the last element is the newest.
      const newestDate = activities[activities.length - 1]?.start_date;
      if (newestDate) {
        const newestTs = Math.floor(new Date(newestDate).getTime() / 1000);
        currentAfter = newestTs;
        try {
          await this.databaseManager.settingsManager.setSetting(
            cursorKey,
            String(newestTs),
            'PB sync resume checkpoint'
          );
        } catch (cursorWriteErr) {
          logger.database.warn('Failed to save PB sync checkpoint', { discordUserId, error: cursorWriteErr.message });
        }
        logger.database.info('PB sync checkpoint saved', {
          discordUserId,
          page,
          checkpoint: new Date(newestTs * 1000).toISOString(),
        });
      }

      if (page % 5 === 0 && typeof progressCb === 'function') {
        progressCb(page);
      }

      page++;
    }

    // Clear checkpoint on successful completion
    try {
      await this.databaseManager.settingsManager.deleteSetting(cursorKey);
    } catch (cursorDeleteErr) {
      logger.database.warn('Failed to clear PB sync cursor', { discordUserId, error: cursorDeleteErr.message });
    }

    logger.database.info('PB sync complete', {
      discordUserId,
      athleteId: member.athleteId,
      pages: page - 1,
      processed,
      updated,
      errors,
      durationMs: Date.now() - startTime,
    });

    return { processed, updated, errors };
  }

  /**
   * Format PBs into Discord embed fields.
   * @param {Array} pbs - PB rows from DB
   * @param {string} athleteName
   * @returns {Array} Discord embed field objects
   */
  formatPBsForEmbed(pbs, athleteName) {
    if (!pbs?.length) return [];

    const MAX_FIELD_VALUE = 1024;

    const lines = pbs.map(pb => {
      const time = ActivityFormatter.formatTime(pb.elapsed_time);
      const pace = pb.distance_m > 0
        ? ActivityFormatter.formatPace(pb.distance_m, pb.elapsed_time)
        : null;
      const base = pace
        ? `**${pb.category}** — ${time} (${pace})`
        : `**${pb.category}** — ${time}`;
      const validId = pb.strava_activity_id && pb.strava_activity_id !== 'undefined';
      if (validId) {
        return `${base} · [↗](https://www.strava.com/activities/${pb.strava_activity_id})`;
      }
      return base;
    });

    // Split into multiple fields if the combined value would exceed Discord's limit
    const fields = [];
    let chunk = [];
    let chunkLength = 0;

    for (const line of lines) {
      const added = (chunk.length > 0 ? 1 : 0) + line.length;
      if (chunkLength + added > MAX_FIELD_VALUE && chunk.length > 0) {
        fields.push({
          name: fields.length === 0 ? `🏆 Personal Bests — ${athleteName}` : '\u200b',
          value: chunk.join('\n'),
          inline: false,
        });
        chunk = [];
        chunkLength = 0;
      }
      chunk.push(line);
      chunkLength += added;
    }

    if (chunk.length > 0) {
      fields.push({
        name: fields.length === 0 ? `🏆 Personal Bests — ${athleteName}` : '\u200b',
        value: chunk.join('\n'),
        inline: false,
      });
    }

    return fields;
  }

  /**
   * Format the time improvement between two elapsed times.
   * @param {number} prevTime - Previous elapsed time in seconds
   * @param {number} newTime - New elapsed time in seconds
   * @returns {string} e.g. "-1:23"
   */
  formatTimeImprovement(prevTime, newTime) {
    const diff = prevTime - newTime;
    const sign = diff >= 0 ? '-' : '+';
    const absDiff = Math.abs(diff);
    const minutes = Math.floor(absDiff / 60);
    const seconds = absDiff % 60;
    return `${sign}${minutes}:${seconds.toString().padStart(2, '0')}`;
  }
}

module.exports = PBManager;
