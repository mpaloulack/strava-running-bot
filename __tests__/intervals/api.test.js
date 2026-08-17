const axios = require('axios');
const IntervalsAPI = require('../../src/intervals/api');
const config = require('../../config/config');
const logger = require('../../src/utils/Logger');
const RateLimiter = require('../../src/utils/RateLimiter');

// Mock dependencies
jest.mock('axios');
jest.mock('../../config/config', () => ({
  intervals: {
    baseUrl: 'https://intervals.icu'
  }
}));
jest.mock('../../src/utils/Logger', () => ({
  intervals: {
    debug: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn()
  }
}));
jest.mock('../../src/utils/RateLimiter');

describe('IntervalsAPI', () => {
  let intervalsAPI;
  let mockRateLimiter;
  let mockAxios;

  beforeEach(() => {
    jest.clearAllMocks();
    mockAxios = axios;

    mockRateLimiter = {
      executeRequest: jest.fn(async (fn) => await fn()),
      getStats: jest.fn(),
      reset: jest.fn()
    };
    RateLimiter.mockImplementation(() => mockRateLimiter);

    intervalsAPI = new IntervalsAPI();
  });

  describe('constructor', () => {
    it('should initialize with config baseUrl and a rate limiter tuned for intervals.icu', () => {
      expect(intervalsAPI.baseURL).toBe(config.intervals.baseUrl);
      expect(intervalsAPI.rateLimiter).toBe(mockRateLimiter);
      expect(RateLimiter).toHaveBeenCalledWith(
        {
          short: { requests: 2000, window: 15 * 60 * 1000 },
          daily: { requests: 4000, window: 24 * 60 * 60 * 1000 }
        },
        logger.intervals
      );
    });
  });

  describe('getAthlete', () => {
    const mockAthleteResponse = {
      data: {
        id: 'i12345',
        name: 'John Doe',
        profile_medium: 'https://example.com/profile.jpg'
      }
    };

    beforeEach(() => {
      mockAxios.get.mockResolvedValue(mockAthleteResponse);
    });

    it('should fetch athlete information using athlete id 0 and Basic auth', async () => {
      const apiKey = 'test_api_key';

      const result = await intervalsAPI.getAthlete(apiKey);

      expect(mockAxios.get).toHaveBeenCalledWith(`${config.intervals.baseUrl}/api/v1/athlete/0`, {
        headers: {
          Authorization: 'Basic ' + Buffer.from(`API_KEY:${apiKey}`).toString('base64')
        }
      });
      expect(result).toEqual(mockAthleteResponse.data);
      expect(mockRateLimiter.executeRequest).toHaveBeenCalledWith(
        expect.any(Function),
        { operation: 'getAthlete' }
      );
    });

    it('should wrap and rethrow errors from the athlete endpoint', async () => {
      const error = new Error('Unauthorized');
      error.response = { status: 401, data: { message: 'invalid api key' } };
      mockAxios.get.mockRejectedValue(error);

      await expect(intervalsAPI.getAthlete('bad_key')).rejects.toThrow('Failed to fetch intervals.icu athlete');

      expect(logger.intervals.error).toHaveBeenCalledWith('Error fetching intervals.icu athlete', {
        error: error.message,
        response: error.response.data,
        status: error.response.status
      });
    });
  });

  describe('getAthleteActivities', () => {
    const mockActivitiesResponse = {
      data: [
        { id: 'i111', name: 'Morning Run', type: 'Run' },
        { id: 'i222', name: 'Evening Ride', type: 'Ride' }
      ]
    };

    beforeEach(() => {
      mockAxios.get.mockResolvedValue(mockActivitiesResponse);
    });

    it('should fetch activities for athlete 0 without date params by default', async () => {
      const apiKey = 'test_api_key';

      const result = await intervalsAPI.getAthleteActivities(apiKey);

      expect(mockAxios.get).toHaveBeenCalledWith(`${config.intervals.baseUrl}/api/v1/athlete/0/activities`, {
        headers: {
          Authorization: 'Basic ' + Buffer.from(`API_KEY:${apiKey}`).toString('base64')
        },
        params: {}
      });
      expect(result).toEqual(mockActivitiesResponse.data);
    });

    it('should include oldest/newest params when provided, stripped to zone-less local ISO', async () => {
      const apiKey = 'test_api_key';
      const oldest = '2024-01-01T00:00:00Z';
      const newest = '2024-01-31T23:59:59Z';

      await intervalsAPI.getAthleteActivities(apiKey, oldest, newest);

      expect(mockAxios.get).toHaveBeenCalledWith(`${config.intervals.baseUrl}/api/v1/athlete/0/activities`, {
        headers: {
          Authorization: 'Basic ' + Buffer.from(`API_KEY:${apiKey}`).toString('base64')
        },
        params: { oldest: '2024-01-01T00:00:00', newest: '2024-01-31T23:59:59' }
      });
    });

    it('should strip milliseconds and Z suffix — intervals.icu rejects them with a 422', async () => {
      await intervalsAPI.getAthleteActivities('key', '2026-08-16T20:55:00.017Z');

      expect(mockAxios.get).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ params: { oldest: '2026-08-16T20:55:00' } })
      );
    });

    it('should accept Date objects for oldest/newest', async () => {
      await intervalsAPI.getAthleteActivities('key', new Date('2026-08-16T20:55:00.017Z'));

      expect(mockAxios.get).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ params: { oldest: '2026-08-16T20:55:00' } })
      );
    });

    it('should omit null oldest/newest params', async () => {
      await intervalsAPI.getAthleteActivities('test_api_key', null, null);

      expect(mockAxios.get).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ params: {} })
      );
    });

    it('should wrap and rethrow errors', async () => {
      const error = new Error('Rate limited');
      error.response = { status: 429, data: { message: 'too many requests' } };
      mockAxios.get.mockRejectedValue(error);

      await expect(intervalsAPI.getAthleteActivities('key')).rejects.toThrow('Failed to fetch intervals.icu athlete activities');

      expect(logger.intervals.error).toHaveBeenCalled();
    });
  });

  describe('getActivity', () => {
    const mockActivityResponse = {
      data: {
        id: 'i98765',
        name: 'Morning Run',
        type: 'Run',
        distance: 5000,
        moving_time: 1800,
        total_elevation_gain: 100,
        start_date_local: '2024-01-01T06:00:00'
      }
    };

    beforeEach(() => {
      mockAxios.get.mockResolvedValue(mockActivityResponse);
    });

    it('should fetch a detailed activity by id', async () => {
      const activityId = 'i98765';
      const apiKey = 'test_api_key';

      const result = await intervalsAPI.getActivity(activityId, apiKey);

      expect(mockAxios.get).toHaveBeenCalledWith(`${config.intervals.baseUrl}/api/v1/activity/${activityId}`, {
        headers: {
          Authorization: 'Basic ' + Buffer.from(`API_KEY:${apiKey}`).toString('base64')
        }
      });
      expect(result).toEqual(mockActivityResponse.data);
    });

    it('should wrap and rethrow errors', async () => {
      const activityId = 'i98765';
      const error = new Error('Not found');
      error.response = { status: 404, data: { message: 'not found' } };
      mockAxios.get.mockRejectedValue(error);

      await expect(intervalsAPI.getActivity(activityId, 'key')).rejects.toThrow(`Failed to fetch intervals.icu activity ${activityId}`);

      expect(logger.intervals.error).toHaveBeenCalledWith('Error fetching intervals.icu activity', {
        activityId,
        error: error.message,
        response: error.response.data,
        status: error.response.status
      });
    });
  });

  describe('mapAthlete', () => {
    it('should map an intervals athlete with a two-part name and i-prefixed id', () => {
      const result = intervalsAPI.mapAthlete({ id: 'i12345', name: 'John Doe', profile_medium: 'https://example.com/p.jpg' });

      expect(result).toEqual({
        id: 12345,
        firstname: 'John',
        lastname: 'Doe',
        profile_medium: 'https://example.com/p.jpg'
      });
    });

    it('should map a single-word name with empty lastname', () => {
      const result = intervalsAPI.mapAthlete({ id: 'i555', name: 'Cher' });

      expect(result).toEqual({
        id: 555,
        firstname: 'Cher',
        lastname: '',
        profile_medium: null
      });
    });

    it('should map a multi-word name, joining everything after the first token', () => {
      const result = intervalsAPI.mapAthlete({ id: 'i9', name: 'Mary Jane Watson' });

      expect(result.firstname).toBe('Mary');
      expect(result.lastname).toBe('Jane Watson');
    });

    it('should parse an id without the i prefix', () => {
      const result = intervalsAPI.mapAthlete({ id: '4242', name: 'No Prefix' });

      expect(result.id).toBe(4242);
    });

    it('should default profile_medium to null when missing', () => {
      const result = intervalsAPI.mapAthlete({ id: 'i1', name: 'No Photo' });

      expect(result.profile_medium).toBeNull();
    });
  });

  describe('activityUrl', () => {
    it('should build the public activity URL', () => {
      expect(intervalsAPI.activityUrl('i98765')).toBe(`${config.intervals.baseUrl}/activities/i98765`);
    });
  });

  describe('calculateGradeAdjustedPace', () => {
    it('should return "-" when distance is missing', () => {
      expect(intervalsAPI.calculateGradeAdjustedPace({ moving_time: 1800, total_elevation_gain: 100 })).toBe('-');
    });

    it('should return "-" when moving_time is missing', () => {
      expect(intervalsAPI.calculateGradeAdjustedPace({ distance: 5000, total_elevation_gain: 100 })).toBe('-');
    });

    it('should return "-" when total_elevation_gain is missing', () => {
      expect(intervalsAPI.calculateGradeAdjustedPace({ distance: 5000, moving_time: 1800 })).toBe('-');
    });

    it('should compute a grade-adjusted estimate when all fields are present', () => {
      const activity = {
        distance: 5000, // 5km
        moving_time: 1800, // 30 min
        total_elevation_gain: 250
      };

      const gap = intervalsAPI.calculateGradeAdjustedPace(activity);

      expect(gap).toMatch(/^\d{1,2}:\d{2}\/km$/);
    });
  });

  describe('processActivityData', () => {
    const mockActivity = {
      id: 'i98765',
      name: 'Morning Run',
      description: 'Great run today!',
      type: 'Run',
      distance: 5000,
      moving_time: 1800,
      elapsed_time: 1900,
      total_elevation_gain: 100,
      start_date_local: '2024-01-01T06:00:00',
      timezone: 'America/New_York',
      average_speed: 2.78,
      max_speed: 4.2,
      average_heartrate: 150,
      max_heartrate: 175
    };

    const mockAthlete = { id: 12345, firstname: 'John', lastname: 'Doe' };

    it('should process activity data with provider/url metadata and no map', () => {
      const result = intervalsAPI.processActivityData(mockActivity, mockAthlete);

      expect(result).toMatchObject({
        id: mockActivity.id,
        name: mockActivity.name,
        description: mockActivity.description,
        type: mockActivity.type,
        distance: mockActivity.distance,
        moving_time: mockActivity.moving_time,
        athlete: mockAthlete,
        provider: 'intervals',
        url: `${config.intervals.baseUrl}/activities/${mockActivity.id}`,
        map: null,
        isRace: false
      });
    });

    it('should fall back to start_date_local when start_date is absent', () => {
      const result = intervalsAPI.processActivityData(mockActivity, mockAthlete);

      expect(result.start_date).toBe(mockActivity.start_date_local);
    });

    it('should prefer start_date when present', () => {
      const activityWithStartDate = { ...mockActivity, start_date: '2024-01-01T06:00:00Z' };

      const result = intervalsAPI.processActivityData(activityWithStartDate, mockAthlete);

      expect(result.start_date).toBe('2024-01-01T06:00:00Z');
    });

    it('should use activity athlete when none provided', () => {
      const activityWithAthlete = { ...mockActivity, athlete: { firstname: 'Fallback' } };

      const result = intervalsAPI.processActivityData(activityWithAthlete);

      expect(result.athlete).toBe(activityWithAthlete.athlete);
    });

    it('should default description to empty string', () => {
      const activityWithoutDescription = { ...mockActivity, description: null };

      const result = intervalsAPI.processActivityData(activityWithoutDescription, mockAthlete);

      expect(result.description).toBe('');
    });

    it('should compute gap_pace via calculateGradeAdjustedPace', () => {
      const spy = jest.spyOn(intervalsAPI, 'calculateGradeAdjustedPace').mockReturnValue('5:30/km');

      const result = intervalsAPI.processActivityData(mockActivity, mockAthlete);

      expect(spy).toHaveBeenCalledWith(mockActivity);
      expect(result.gap_pace).toBe('5:30/km');

      spy.mockRestore();
    });
  });

  describe('shouldPostActivity', () => {
    const baseActivity = {
      id: 'i98765',
      name: 'Test Activity',
      type: 'Run',
      distance: 5000,
      moving_time: 1800,
      start_date: new Date(Date.now() - 1000 * 60 * 60).toISOString() // 1 hour ago
    };

    it('should allow a fresh, long-enough, distant-enough activity', () => {
      expect(intervalsAPI.shouldPostActivity(baseActivity)).toBe(true);
    });

    it('should reject activities older than 24 hours', () => {
      const oldActivity = {
        ...baseActivity,
        start_date: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString()
      };

      expect(intervalsAPI.shouldPostActivity(oldActivity)).toBe(false);
      expect(logger.intervals.debug).toHaveBeenCalledWith('Skipping old activity', expect.any(Object));
    });

    it('should allow old activities when skipAgeFilter is true', () => {
      const oldActivity = {
        ...baseActivity,
        start_date: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString()
      };

      expect(intervalsAPI.shouldPostActivity(oldActivity, { skipAgeFilter: true })).toBe(true);
    });

    it('should use start_date_local when start_date is absent', () => {
      const activity = {
        ...baseActivity,
        start_date: undefined,
        start_date_local: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString()
      };

      expect(intervalsAPI.shouldPostActivity(activity)).toBe(false);
    });

    it('should reject activities under a minute', () => {
      const shortActivity = { ...baseActivity, moving_time: 30 };

      expect(intervalsAPI.shouldPostActivity(shortActivity)).toBe(false);
      expect(logger.intervals.debug).toHaveBeenCalledWith('Skipping short activity', expect.any(Object));
    });

    it('should reject activities with no distance', () => {
      const noDistanceActivity = { ...baseActivity, distance: 0 };

      expect(intervalsAPI.shouldPostActivity(noDistanceActivity)).toBe(false);
      expect(logger.intervals.debug).toHaveBeenCalledWith('Skipping activity with no distance', expect.any(Object));
    });

    it('should reject activities with very little distance', () => {
      const lowDistanceActivity = { ...baseActivity, distance: 50 };

      expect(intervalsAPI.shouldPostActivity(lowDistanceActivity)).toBe(false);
    });
  });

  describe('getRateLimiterStats', () => {
    it('should delegate to the rate limiter', () => {
      const mockStats = { shortTerm: { used: 1, limit: 2000 }, daily: { used: 1, limit: 4000 }, queueLength: 0 };
      mockRateLimiter.getStats.mockReturnValue(mockStats);

      expect(intervalsAPI.getRateLimiterStats()).toEqual(mockStats);
      expect(mockRateLimiter.getStats).toHaveBeenCalled();
    });
  });

  describe('resetRateLimiter', () => {
    it('should delegate to the rate limiter', () => {
      mockRateLimiter.reset.mockReturnValue(true);

      expect(intervalsAPI.resetRateLimiter()).toBe(true);
      expect(mockRateLimiter.reset).toHaveBeenCalled();
    });
  });
});
