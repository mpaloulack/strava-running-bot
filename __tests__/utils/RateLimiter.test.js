const RateLimiter = require('../../src/utils/RateLimiter');
const logger = require('../../src/utils/Logger');

// Mock logger
jest.mock('../../src/utils/Logger');

describe('RateLimiter', () => {
  let rateLimiter;
  
  beforeEach(() => {
    jest.clearAllMocks();
    rateLimiter = new RateLimiter();
  });

  describe('initialization', () => {
    it('should initialize with correct limits', () => {
      expect(rateLimiter.limits).toEqual({
        short: {
          requests: 80,
          window: 15 * 60 * 1000
        },
        daily: {
          requests: 900,
          window: 24 * 60 * 60 * 1000
        }
      });
    });

    it('should initialize with empty request arrays', () => {
      expect(rateLimiter.requests.short).toEqual([]);
      expect(rateLimiter.requests.daily).toEqual([]);
      expect(rateLimiter.requestQueue).toEqual([]);
      expect(rateLimiter.processing).toBe(false);
    });
  });

  describe('request management', () => {
    it('should allow requests when under limits', () => {
      expect(rateLimiter.canMakeRequest()).toBe(true);
      rateLimiter.recordRequest();
      expect(rateLimiter.requests.short.length).toBe(1);
      expect(rateLimiter.requests.daily.length).toBe(1);
    });

    it('should clean up old requests', () => {
      const now = Date.now();
      jest.spyOn(Date, 'now').mockImplementation(() => now);

      // Add some old requests
      rateLimiter.requests.short.push(now - 16 * 60 * 1000); // 16 minutes ago
      rateLimiter.requests.daily.push(now - 25 * 60 * 60 * 1000); // 25 hours ago

      // Add some recent requests
      rateLimiter.requests.short.push(now - 5 * 60 * 1000); // 5 minutes ago
      rateLimiter.requests.daily.push(now - 12 * 60 * 60 * 1000); // 12 hours ago

      rateLimiter.cleanupOldRequests();

      expect(rateLimiter.requests.short.length).toBe(1); // Only the 5-minute-old request
      expect(rateLimiter.requests.daily.length).toBe(1); // Only the 12-hour-old request
    });
  });

  describe('rate limiting', () => {
    it('should block requests when short-term limit is reached', () => {
      const now = Date.now();
      jest.spyOn(Date, 'now').mockImplementation(() => now);

      // Fill up to short-term limit
      for (let i = 0; i < rateLimiter.limits.short.requests; i++) {
        rateLimiter.recordRequest();
      }

      expect(rateLimiter.canMakeRequest()).toBe(false);
      expect(rateLimiter.getWaitTime()).toBeGreaterThan(0);
    });

    it('should block requests when daily limit is reached', () => {
      const now = Date.now();
      jest.spyOn(Date, 'now').mockImplementation(() => now);

      // Fill up to daily limit
      for (let i = 0; i < rateLimiter.limits.daily.requests; i++) {
        rateLimiter.recordRequest();
      }

      expect(rateLimiter.canMakeRequest()).toBe(false);
      expect(rateLimiter.getWaitTime()).toBeGreaterThan(0);
    });
  });

  describe('executeRequest', () => {
    it('should execute requests immediately when under limits', async () => {
      const mockRequest = jest.fn().mockResolvedValue('success');
      
      const result = await rateLimiter.executeRequest(mockRequest);
      
      expect(result).toBe('success');
      expect(mockRequest).toHaveBeenCalledTimes(1);
      expect(rateLimiter.requests.short.length).toBe(1);
      expect(rateLimiter.requests.daily.length).toBe(1);
    });

    it('should queue and delay requests when rate limited', async () => {
      jest.useFakeTimers();
      
      // Fill up the short-term limit
      for (let i = 0; i < rateLimiter.limits.short.requests; i++) {
        rateLimiter.recordRequest();
      }

      const mockRequest = jest.fn().mockResolvedValue('success');
      const requestPromise = rateLimiter.executeRequest(mockRequest);

      // Request should be queued
      expect(rateLimiter.requestQueue.length).toBe(1);
      expect(mockRequest).not.toHaveBeenCalled();

      // Fast-forward time past the rate limit window
      jest.advanceTimersByTime(rateLimiter.limits.short.window);
      
      // Let the queued promises resolve
      await Promise.resolve();
      
      const result = await requestPromise;
      expect(result).toBe('success');
      expect(mockRequest).toHaveBeenCalledTimes(1);

      jest.useRealTimers();
    });

    it('should handle request failures', async () => {
      const mockError = new Error('API error');
      const mockRequest = jest.fn().mockRejectedValue(mockError);

      await expect(rateLimiter.executeRequest(mockRequest)).rejects.toThrow(mockError);
      expect(mockRequest).toHaveBeenCalledTimes(1);
      expect(logger.strava.error).toHaveBeenCalledWith(
        'Rate-limited request failed',
        expect.objectContaining({
          error: mockError.message,
          context: {}
        })
      );
    });
  });

  describe('stats and reset', () => {
    it('should return correct stats', () => {
      rateLimiter.recordRequest();
      
      const stats = rateLimiter.getStats();
      
      expect(stats).toEqual({
        shortTerm: {
          used: 1,
          limit: rateLimiter.limits.short.requests,
          window: '15 minutes'
        },
        daily: {
          used: 1,
          limit: rateLimiter.limits.daily.requests,
          window: '24 hours'
        },
        queueLength: 0,
        canMakeRequest: true,
        waitTime: 0
      });
    });

    it('should reset all counters', () => {
      // Add some requests and queue items
      rateLimiter.recordRequest();
      rateLimiter.requestQueue.push({ requestFunction: jest.fn() });
      rateLimiter.processing = true;

      rateLimiter.reset();

      expect(rateLimiter.requests.short).toEqual([]);
      expect(rateLimiter.requests.daily).toEqual([]);
      expect(rateLimiter.requestQueue).toEqual([]);
      expect(rateLimiter.processing).toBe(false);
      expect(logger.strava.info).toHaveBeenCalledWith('Rate limiter reset');
    });
  });
});
