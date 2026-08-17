const axios = require('axios');
const config = require('../../config/config');
const logger = require('../utils/Logger');
const RateLimiter = require('../utils/RateLimiter');
const { TIME } = require('../constants');

class IntervalsAPI {
  constructor() {
    this.baseURL = config.intervals.baseUrl;

    // intervals.icu API-key limits are 2500/15min and 5000/day — using 80% as safety margin
    const limits = {
      short: {
        requests: 2000,
        window: 15 * TIME.MS_PER_MINUTE
      },
      daily: {
        requests: 4000,
        window: TIME.MS_PER_DAY
      }
    };

    this.rateLimiter = new RateLimiter(limits, logger.intervals);
  }

  // Basic auth header — intervals.icu uses the literal username "API_KEY"
  // and the member's personal API key as the password.
  _authHeaders(apiKey) {
    return {
      Authorization: 'Basic ' + Buffer.from(`API_KEY:${apiKey}`).toString('base64')
    };
  }

  // Get athlete information for the athlete owning this API key (id 0)
  async getAthlete(apiKey) {
    logger.intervals.debug('Fetching intervals.icu athlete information');

    return this.rateLimiter.executeRequest(async () => {
      try {
        const response = await axios.get(`${this.baseURL}/api/v1/athlete/0`, {
          headers: this._authHeaders(apiKey)
        });

        return response.data;
      } catch (error) {
        logger.intervals.error('Error fetching intervals.icu athlete', {
          error: error.message,
          response: error.response?.data,
          status: error.response?.status
        });
        throw new Error('Failed to fetch intervals.icu athlete', { cause: error });
      }
    }, { operation: 'getAthlete' });
  }

  // intervals.icu expects local ISO date-times WITHOUT a zone designator —
  // milliseconds or a trailing 'Z' make the API reject the request with a 422.
  _formatDateParam(value) {
    const iso = value instanceof Date ? value.toISOString() : String(value);
    return iso.slice(0, 19);
  }

  // Get athlete activities, optionally bounded by an ISO-8601 oldest/newest window
  async getAthleteActivities(apiKey, oldest = null, newest = null) {
    logger.intervals.debug('Fetching intervals.icu athlete activities', { oldest, newest });

    return this.rateLimiter.executeRequest(async () => {
      try {
        const params = {};
        if (oldest !== null) params.oldest = this._formatDateParam(oldest);
        if (newest !== null) params.newest = this._formatDateParam(newest);

        const response = await axios.get(`${this.baseURL}/api/v1/athlete/0/activities`, {
          headers: this._authHeaders(apiKey),
          params
        });

        return response.data;
      } catch (error) {
        logger.intervals.error('Error fetching intervals.icu activities', {
          error: error.message,
          response: error.response?.data,
          status: error.response?.status,
          params: { oldest, newest }
        });
        throw new Error('Failed to fetch intervals.icu athlete activities', { cause: error });
      }
    }, { operation: 'getAthleteActivities', oldest, newest });
  }

  // Get detailed activity by ID
  async getActivity(activityId, apiKey) {
    logger.intervals.debug('Fetching intervals.icu activity', { activityId });

    return this.rateLimiter.executeRequest(async () => {
      try {
        const response = await axios.get(`${this.baseURL}/api/v1/activity/${activityId}`, {
          headers: this._authHeaders(apiKey)
        });

        return response.data;
      } catch (error) {
        logger.intervals.error('Error fetching intervals.icu activity', {
          activityId,
          error: error.message,
          response: error.response?.data,
          status: error.response?.status
        });
        throw new Error(`Failed to fetch intervals.icu activity ${activityId}`, { cause: error });
      }
    }, { operation: 'getActivity', activityId });
  }

  // Map an intervals.icu athlete payload to the shape used across the bot
  mapAthlete(intervalsAthlete) {
    const id = Number.parseInt(String(intervalsAthlete.id).replace(/^i/i, ''), 10);
    const nameParts = (intervalsAthlete.name || '').trim().split(/\s+/).filter(Boolean);
    const firstname = nameParts[0] || '';
    const lastname = nameParts.slice(1).join(' ');

    return {
      id,
      firstname,
      lastname,
      profile_medium: intervalsAthlete.profile_medium || null
    };
  }

  // Public activity URL on intervals.icu
  activityUrl(activityId) {
    return `${this.baseURL}/activities/${activityId}`;
  }

  // intervals.icu doesn't expose a streams API here, so fall back straight to
  // the simplified +3%-per-1%-grade estimation used by StravaAPI when it has
  // no streams data.
  calculateGradeAdjustedPace(activity) {
    if (!activity.distance || !activity.moving_time || !activity.total_elevation_gain) {
      return '-';
    }

    const distanceInKm = activity.distance / 1000;
    const elevationGainPercent = (activity.total_elevation_gain / activity.distance) * 100;

    const gradeAdjustment = elevationGainPercent * 0.03;
    const adjustedTime = activity.moving_time * (1 + gradeAdjustment);

    const gapInSecondsPerKm = adjustedTime / distanceInKm;
    const minutes = Math.floor(gapInSecondsPerKm / 60);
    const seconds = Math.round(gapInSecondsPerKm % 60);

    return `${minutes}:${seconds.toString().padStart(2, '0')}/km`;
  }

  // Process activity data for Discord display
  processActivityData(activity, athlete = null) {
    const processedActivity = {
      id: activity.id,
      name: activity.name,
      description: activity.description || '',
      type: activity.type,
      distance: activity.distance,
      moving_time: activity.moving_time,
      elapsed_time: activity.elapsed_time,
      total_elevation_gain: activity.total_elevation_gain,
      start_date: activity.start_date || activity.start_date_local,
      start_date_local: activity.start_date_local,
      timezone: activity.timezone,
      average_speed: activity.average_speed,
      max_speed: activity.max_speed,
      average_heartrate: activity.average_heartrate,
      max_heartrate: activity.max_heartrate,
      elev_high: activity.elev_high,
      elev_low: activity.elev_low,
      upload_id: activity.upload_id,
      external_id: activity.external_id,
      map: null,
      athlete: athlete || activity.athlete,
      provider: 'intervals',
      url: this.activityUrl(activity.id)
    };

    processedActivity.gap_pace = this.calculateGradeAdjustedPace(activity);
    processedActivity.isRace = false;

    return processedActivity;
  }

  /**
   * Determines if an intervals.icu activity should be posted to Discord.
   * intervals.icu has no per-activity private/hide flags exposed here, so
   * this only applies age/length/distance filtering.
   *
   * @param {Object} activity - intervals.icu activity object
   * @param {Object} options - Filtering options
   * @param {boolean} options.skipAgeFilter - If true, don't filter activities older than 24 hours
   * @returns {boolean} - Whether the activity should be posted
   */
  shouldPostActivity(activity, options = {}) {
    const { skipAgeFilter = false } = options;

    if (!skipAgeFilter) {
      const startDate = activity.start_date || activity.start_date_local;
      const activityDate = new Date(startDate);
      const now = new Date();
      const hoursDiff = (now - activityDate) / (1000 * 60 * 60);

      if (hoursDiff > 24) {
        logger.intervals.debug('Skipping old activity', {
          name: activity.name,
          hoursOld: hoursDiff.toFixed(1),
          activityDate: startDate
        });
        return false;
      }
    }

    if (activity.moving_time < 60) {
      logger.intervals.debug('Skipping short activity', {
        name: activity.name,
        movingTime: activity.moving_time
      });
      return false;
    }

    if (!activity.distance || activity.distance < 100) {
      logger.intervals.debug('Skipping activity with no distance', {
        name: activity.name,
        distance: activity.distance
      });
      return false;
    }

    return true;
  }

  // Get rate limiter statistics
  getRateLimiterStats() {
    return this.rateLimiter.getStats();
  }

  // Reset rate limiter (for testing or manual reset)
  resetRateLimiter() {
    return this.rateLimiter.reset();
  }
}

module.exports = IntervalsAPI;
