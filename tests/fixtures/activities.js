/**
 * Test fixtures for Strava activities
 */

const mockStravaActivity = {
  id: 123456789,
  name: "Morning Run in Central Park",
  description: "Beautiful weather for a run! Feeling strong 💪",
  distance: 5000, // 5km in meters
  moving_time: 1800, // 30 minutes in seconds
  elapsed_time: 2100,
  total_elevation_gain: 45,
  type: "Run",
  start_date: "2024-01-15T08:00:00Z",
  start_date_local: "2024-01-15T08:00:00",
  timezone: "America/New_York",
  average_speed: 2.78, // m/s
  max_speed: 4.5,
  average_heartrate: 165,
  max_heartrate: 185,
  private: false,
  visibility: "everyone",
  map: {
    id: "a123456789",
    polyline: "u{~vFvyys@fS]",
    summary_polyline: "u{~vFvyys@fS]",
  },
  athlete: {
    id: 987654321,
    firstname: "John",
    lastname: "Runner",
    profile_medium: "https://example.com/avatar.jpg",
    profile: "https://example.com/avatar_large.jpg",
  },
  gap_pace: "6:15/km"
};

const mockPrivateActivity = {
  ...mockStravaActivity,
  id: 123456790,
  name: "Private Training Run",
  private: true,
  visibility: "only_me",
  description: null
};

const mockFollowersOnlyActivity = {
  ...mockStravaActivity,
  id: 123456791,
  name: "Weekend Long Run",
  visibility: "followers_only",
  distance: 15000, // 15km
  moving_time: 5400, // 1.5 hours
  average_heartrate: 145
};

const mockCyclingActivity = {
  ...mockStravaActivity,
  id: 123456792,
  name: "Evening Bike Ride",
  type: "Ride",
  distance: 25000, // 25km
  moving_time: 3600, // 1 hour
  total_elevation_gain: 200,
  average_speed: 6.94, // m/s (25 km/h)
  average_heartrate: null
};

const mockProcessedActivity = {
  ...mockStravaActivity,
  gap_pace: "6:00/km",
  athlete: {
    ...mockStravaActivity.athlete,
    discordUser: {
      id: "123456789012345678",
      displayName: "JohnRunner#1234",
      avatarURL: "https://cdn.discordapp.com/avatars/123/avatar.png"
    }
  }
};

module.exports = {
  mockStravaActivity,
  mockPrivateActivity,
  mockFollowersOnlyActivity,
  mockCyclingActivity,
  mockProcessedActivity,
  
  // Activity lists for bulk testing
  mockActivityList: [
    mockStravaActivity,
    mockPrivateActivity,
    mockFollowersOnlyActivity,
    mockCyclingActivity
  ],
  
  // Edge cases
  mockActivityWithoutGPS: {
    ...mockStravaActivity,
    id: 123456793,
    name: "Treadmill Run",
    map: null,
    distance: 8000,
    moving_time: 2400
  },
  
  mockActivityNoHeartRate: {
    ...mockStravaActivity,
    id: 123456794,
    average_heartrate: null,
    max_heartrate: null
  }
};