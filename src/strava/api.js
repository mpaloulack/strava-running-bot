const axios = require('axios');
const config = require('../../config/config');

class StravaAPI {
  constructor() {
    this.baseURL = config.strava.baseUrl;
    this.clientId = config.strava.clientId;
    this.clientSecret = config.strava.clientSecret;
  }

  // Generate OAuth authorization URL
  getAuthorizationUrl(state = '') {
    const scopes = 'read,activity:read_all,profile:read_all';
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.getRedirectUri(),
      response_type: 'code',
      scope: scopes,
      state: state,
    });

    return `${config.strava.authUrl}?${params.toString()}`;
  }

  getRedirectUri() {
    // This should match your webhook endpoint domain
    return `http://localhost:${config.server.port}/auth/strava/callback`;
  }

  // Exchange authorization code for access token
  async exchangeCodeForToken(authCode) {
    try {
      const response = await axios.post(config.strava.tokenUrl, {
        client_id: this.clientId,
        client_secret: this.clientSecret,
        code: authCode,
        grant_type: 'authorization_code',
      });

      return response.data;
    } catch (error) {
      console.error('❌ Error exchanging code for token:', error.response?.data || error.message);
      throw new Error('Failed to exchange authorization code for token');
    }
  }

  // Refresh access token using refresh token
  async refreshAccessToken(refreshToken) {
    try {
      const response = await axios.post(config.strava.tokenUrl, {
        client_id: this.clientId,
        client_secret: this.clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      });

      return response.data;
    } catch (error) {
      console.error('❌ Error refreshing token:', error.response?.data || error.message);
      throw new Error('Failed to refresh access token');
    }
  }

  // Get athlete information
  async getAthlete(accessToken) {
    try {
      const response = await axios.get(`${this.baseURL}/athlete`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      return response.data;
    } catch (error) {
      console.error('❌ Error fetching athlete:', error.response?.data || error.message);
      throw new Error('Failed to fetch athlete information');
    }
  }

  // Get athlete activities
  async getAthleteActivities(accessToken, page = 1, perPage = 30, before = null, after = null) {
    try {
      const params = {
        page: page,
        per_page: perPage,
      };

      if (before) params.before = before;
      if (after) params.after = after;

      const response = await axios.get(`${this.baseURL}/athlete/activities`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        params: params,
      });

      return response.data;
    } catch (error) {
      console.error('❌ Error fetching activities:', error.response?.data || error.message);
      throw new Error('Failed to fetch athlete activities');
    }
  }

  // Get detailed activity by ID
  async getActivity(activityId, accessToken) {
    try {
      const response = await axios.get(`${this.baseURL}/activities/${activityId}`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      return response.data;
    } catch (error) {
      console.error(`❌ Error fetching activity ${activityId}:`, error.response?.data || error.message);
      throw new Error(`Failed to fetch activity ${activityId}`);
    }
  }

  // Calculate Grade Adjusted Pace (GAP) - simplified estimation
  calculateGradeAdjustedPace(activity) {
    if (!activity.distance || !activity.moving_time || !activity.total_elevation_gain) {
      return null;
    }

    const distanceInKm = activity.distance / 1000;
    const elevationGainPercent = (activity.total_elevation_gain / activity.distance) * 100;
    
    // Simplified GAP calculation: for every 1% grade, add ~3% to pace
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
      start_date: activity.start_date,
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
      map: activity.map,
      athlete: athlete || activity.athlete,
    };

    // Add calculated Grade Adjusted Pace
    processedActivity.gap_pace = this.calculateGradeAdjustedPace(activity);

    return processedActivity;
  }

  // Validate webhook signature
  validateWebhookSignature(signature, body) {
    // Strava doesn't send HMAC signatures for webhooks, but we can verify the token
    // This is a placeholder for additional security measures if needed
    return true;
  }

  // Check if activity should be posted (filters)
  shouldPostActivity(activity) {
    // Skip if activity is too old (more than 24 hours)
    const activityDate = new Date(activity.start_date);
    const now = new Date();
    const hoursDiff = (now - activityDate) / (1000 * 60 * 60);
    
    if (hoursDiff > 24) {
      console.log(`⏭️ Skipping old activity: ${activity.name} (${hoursDiff.toFixed(1)}h old)`);
      return false;
    }

    // Skip if activity is too short (less than 1 minute)
    if (activity.moving_time < 60) {
      console.log(`⏭️ Skipping short activity: ${activity.name} (${activity.moving_time}s)`);
      return false;
    }

    // Skip if activity has no distance (manual entries)
    if (!activity.distance || activity.distance < 100) {
      console.log(`⏭️ Skipping activity with no distance: ${activity.name}`);
      return false;
    }

    return true;
  }
}

module.exports = StravaAPI;