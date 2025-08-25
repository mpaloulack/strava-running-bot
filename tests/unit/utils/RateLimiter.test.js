/**
 * Tests for RateLimiter utility class
 */

const { mockConsole } = require('../../helpers/testUtils');

// Mock Logger before importing RateLimiter
jest.mock('../../../src/utils/Logger', () => ({
  strava: {
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    info: jest.fn()
  }
}));

const RateLimiter = require('../../../src/utils/RateLimiter');

describe('RateLimiter', () => {
  let rateLimiter;
  let mockConsoleFunctions;
  
  beforeEach(() => {
    // Mock console functions
    mockConsoleFunctions = mockConsole();
    
    // Create fresh instance
    rateLimiter = new RateLimiter();
    
    // Clear all mocks
    jest.clearAllMocks();
  });
  
  afterEach(() => {
    // Restore console
    mockConsoleFunctions.restore();
  });
  
  describe('constructor and initialization', () => {
    test('should initialize with correct default limits', () => {
      expect(rateLimiter.limits).toEqual({
        short: {
          requests: 80,
          window: 15 * 60 * 1000  // 15 minutes
        },
        daily: {
          requests: 900,
          window: 24 * 60 * 60 * 1000  // 24 hours
        }
      });
    });
    
    test('should initialize with empty request arrays', () => {
      expect(rateLimiter.requests.short).toEqual([]);
      expect(rateLimiter.requests.daily).toEqual([]);
    });
    
    test('should initialize with empty queue and processing false', () => {
      expect(rateLimiter.requestQueue).toEqual([]);
      expect(rateLimiter.processing).toBe(false);
    });
  });
  
  describe('canMakeRequest', () => {
    test('should allow requests when under limits', () => {
      expect(rateLimiter.canMakeRequest()).toBe(true);
    });
    
    test('should block requests when short-term limit reached', () => {
      // Fill short-term requests to limit
      for (let i = 0; i < rateLimiter.limits.short.requests; i++) {
        rateLimiter.requests.short.push(Date.now());
      }
      
      expect(rateLimiter.canMakeRequest()).toBe(false);
    });
    
    test('should block requests when daily limit reached', () => {
      // Fill daily requests to limit
      for (let i = 0; i < rateLimiter.limits.daily.requests; i++) {
        rateLimiter.requests.daily.push(Date.now());
      }
      
      expect(rateLimiter.canMakeRequest()).toBe(false);
    });
    
    test('should call cleanup before checking limits', () => {
      const cleanupSpy = jest.spyOn(rateLimiter, 'cleanupOldRequests');
      
      rateLimiter.canMakeRequest();
      
      expect(cleanupSpy).toHaveBeenCalled();
    });
  });
  
  describe('recordRequest', () => {
    test('should record request in both short and daily arrays', () => {
      const initialShortCount = rateLimiter.requests.short.length;
      const initialDailyCount = rateLimiter.requests.daily.length;
      
      rateLimiter.recordRequest();
      
      expect(rateLimiter.requests.short).toHaveLength(initialShortCount + 1);
      expect(rateLimiter.requests.daily).toHaveLength(initialDailyCount + 1);
      expect(typeof rateLimiter.requests.short[0]).toBe('number');
      expect(typeof rateLimiter.requests.daily[0]).toBe('number');
    });
    
    test('should log debug information', () => {
      const Logger = require('../../../src/utils/Logger');
      
      rateLimiter.recordRequest();
      
      expect(Logger.strava.debug).toHaveBeenCalledWith('API request recorded', {
        shortTermCount: 1,
        dailyCount: 1,
        shortTermLimit: 80,
        dailyLimit: 900
      });
    });
  });
  
  describe('cleanupOldRequests', () => {
    test('should remove old timestamps from short-term array', () => {
      const now = Date.now();
      const oldTimestamp = now - (20 * 60 * 1000); // 20 minutes ago (outside 15-min window)
      const recentTimestamp = now - (5 * 60 * 1000); // 5 minutes ago (inside window)
      
      rateLimiter.requests.short = [oldTimestamp, recentTimestamp];
      rateLimiter.cleanupOldRequests();
      
      expect(rateLimiter.requests.short).toContain(recentTimestamp);
      expect(rateLimiter.requests.short).not.toContain(oldTimestamp);
    });
    
    test('should remove old timestamps from daily array', () => {
      const now = Date.now();
      const oldTimestamp = now - (30 * 60 * 60 * 1000); // 30 hours ago (outside 24-hour window)
      const recentTimestamp = now - (5 * 60 * 60 * 1000); // 5 hours ago (inside window)
      
      rateLimiter.requests.daily = [oldTimestamp, recentTimestamp];
      rateLimiter.cleanupOldRequests();
      
      expect(rateLimiter.requests.daily).toContain(recentTimestamp);
      expect(rateLimiter.requests.daily).not.toContain(oldTimestamp);
    });
    
    test('should handle empty arrays gracefully', () => {
      rateLimiter.requests.short = [];
      rateLimiter.requests.daily = [];
      
      expect(() => rateLimiter.cleanupOldRequests()).not.toThrow();
      expect(rateLimiter.requests.short).toEqual([]);
      expect(rateLimiter.requests.daily).toEqual([]);
    });
  });
  
  describe('getWaitTime', () => {
    test('should return 0 when requests are allowed', () => {
      expect(rateLimiter.getWaitTime()).toBe(0);
    });
    
    test('should return positive wait time when limits exceeded', () => {
      // Fill short-term requests to limit
      const now = Date.now();
      for (let i = 0; i < rateLimiter.limits.short.requests; i++) {
        rateLimiter.requests.short.push(now - (5 * 60 * 1000)); // 5 minutes ago
      }
      
      const waitTime = rateLimiter.getWaitTime();
      expect(waitTime).toBeGreaterThan(0);
    });
    
    test('should call cleanup before calculating wait time', () => {
      const cleanupSpy = jest.spyOn(rateLimiter, 'cleanupOldRequests');
      
      rateLimiter.getWaitTime();
      
      expect(cleanupSpy).toHaveBeenCalled();
    });
    
    test('should never return negative wait time', () => {
      // Add very old requests that should be cleaned up
      const veryOldTime = Date.now() - (60 * 60 * 1000); // 1 hour ago
      for (let i = 0; i < rateLimiter.limits.short.requests; i++) {
        rateLimiter.requests.short.push(veryOldTime);
      }
      
      const waitTime = rateLimiter.getWaitTime();
      expect(waitTime).toBeGreaterThanOrEqual(0);
    });
  });
  
  describe('executeRequest', () => {
    test('should add request to queue', async () => {
      const mockFunction = jest.fn().mockResolvedValue('success');
      
      // Spy on processQueue to prevent it from running immediately
      const processQueueSpy = jest.spyOn(rateLimiter, 'processQueue').mockImplementation(() => Promise.resolve());
      
      rateLimiter.executeRequest(mockFunction, { test: 'context' });
      
      expect(rateLimiter.requestQueue).toHaveLength(1);
      expect(rateLimiter.requestQueue[0].requestFunction).toBe(mockFunction);
      expect(rateLimiter.requestQueue[0].context).toEqual({ test: 'context' });
      
      processQueueSpy.mockRestore();
    });
    
    test('should return a promise', () => {
      const mockFunction = jest.fn().mockResolvedValue('success');
      
      const result = rateLimiter.executeRequest(mockFunction);
      
      expect(result).toBeInstanceOf(Promise);
    });
    
    test('should call processQueue', () => {
      const processQueueSpy = jest.spyOn(rateLimiter, 'processQueue');
      const mockFunction = jest.fn().mockResolvedValue('success');
      
      rateLimiter.executeRequest(mockFunction);
      
      expect(processQueueSpy).toHaveBeenCalled();
    });
  });
  
  describe('processQueue', () => {
    test('should not process when queue is empty', async () => {
      rateLimiter.processing = false;
      
      await rateLimiter.processQueue();
      
      expect(rateLimiter.processing).toBe(false);
    });
    
    test('should not process when already processing', async () => {
      const mockFunction = jest.fn().mockResolvedValue('test');
      rateLimiter.requestQueue.push({
        requestFunction: mockFunction,
        context: {},
        resolve: jest.fn(),
        reject: jest.fn()
      });
      rateLimiter.processing = true;
      
      await rateLimiter.processQueue();
      
      expect(mockFunction).not.toHaveBeenCalled();
    });
    
    test('should set processing flag', async () => {
      const mockFunction = jest.fn().mockResolvedValue('test');
      const mockResolve = jest.fn();
      
      rateLimiter.requestQueue.push({
        requestFunction: mockFunction,
        context: {},
        resolve: mockResolve,
        reject: jest.fn()
      });
      
      expect(rateLimiter.processing).toBe(false);
      
      // Start processing
      const processPromise = rateLimiter.processQueue();
      
      // Should be processing now
      expect(rateLimiter.processing).toBe(true);
      
      // Wait for completion
      await processPromise;
      
      // Should be done processing
      expect(rateLimiter.processing).toBe(false);
    });
    
    test('should record request when processing', async () => {
      const mockFunction = jest.fn().mockResolvedValue('test');
      const mockResolve = jest.fn();
      const recordSpy = jest.spyOn(rateLimiter, 'recordRequest');
      
      rateLimiter.requestQueue.push({
        requestFunction: mockFunction,
        context: {},
        resolve: mockResolve,
        reject: jest.fn()
      });
      
      await rateLimiter.processQueue();
      
      expect(recordSpy).toHaveBeenCalled();
      expect(mockFunction).toHaveBeenCalled();
      expect(mockResolve).toHaveBeenCalledWith('test');
    });
    
    test('should handle request errors', async () => {
      const mockError = new Error('Request failed');
      const mockFunction = jest.fn().mockRejectedValue(mockError);
      const mockReject = jest.fn();
      const Logger = require('../../../src/utils/Logger');
      
      rateLimiter.requestQueue.push({
        requestFunction: mockFunction,
        context: { test: 'error context' },
        resolve: jest.fn(),
        reject: mockReject
      });
      
      await rateLimiter.processQueue();
      
      expect(mockReject).toHaveBeenCalledWith(mockError);
      expect(Logger.strava.error).toHaveBeenCalledWith('Rate-limited request failed', {
        error: 'Request failed',
        context: { test: 'error context' }
      });
    });
  });
  
  describe('getStats', () => {
    test('should return correct stats when empty', () => {
      const stats = rateLimiter.getStats();
      
      expect(stats).toEqual({
        shortTerm: {
          used: 0,
          limit: 80,
          window: '15 minutes'
        },
        daily: {
          used: 0,
          limit: 900,
          window: '24 hours'
        },
        queueLength: 0,
        canMakeRequest: true,
        waitTime: 0
      });
    });
    
    test('should return correct stats with requests recorded', () => {
      // Record some requests
      rateLimiter.recordRequest();
      rateLimiter.recordRequest();
      
      // Add items to queue
      rateLimiter.requestQueue.push({}, {});
      
      const stats = rateLimiter.getStats();
      
      expect(stats.shortTerm.used).toBe(2);
      expect(stats.daily.used).toBe(2);
      expect(stats.queueLength).toBe(2);
    });
    
    test('should call cleanup before returning stats', () => {
      const cleanupSpy = jest.spyOn(rateLimiter, 'cleanupOldRequests');
      
      rateLimiter.getStats();
      
      expect(cleanupSpy).toHaveBeenCalled();
    });
  });
  
  describe('reset', () => {
    test('should clear all requests and queue', () => {
      const Logger = require('../../../src/utils/Logger');
      
      // Add some data
      rateLimiter.recordRequest();
      rateLimiter.requestQueue.push({});
      rateLimiter.processing = true;
      
      rateLimiter.reset();
      
      expect(rateLimiter.requests.short).toEqual([]);
      expect(rateLimiter.requests.daily).toEqual([]);
      expect(rateLimiter.requestQueue).toEqual([]);
      expect(rateLimiter.processing).toBe(false);
      
      expect(Logger.strava.info).toHaveBeenCalledWith('Rate limiter reset');
    });
  });
  
  describe('rate limiting behavior', () => {
    test('should block requests when short-term limit is reached', () => {
      // Fill up to the limit
      for (let i = 0; i < rateLimiter.limits.short.requests; i++) {
        rateLimiter.recordRequest();
      }
      
      expect(rateLimiter.canMakeRequest()).toBe(false);
      expect(rateLimiter.getWaitTime()).toBeGreaterThan(0);
    });
    
    test('should block requests when daily limit is reached', () => {
      // Fill up to the daily limit
      for (let i = 0; i < rateLimiter.limits.daily.requests; i++) {
        rateLimiter.recordRequest();
      }
      
      expect(rateLimiter.canMakeRequest()).toBe(false);
      expect(rateLimiter.getWaitTime()).toBeGreaterThan(0);
    });
    
    test('should track requests correctly', () => {
      const initialShort = rateLimiter.requests.short.length;
      const initialDaily = rateLimiter.requests.daily.length;
      
      rateLimiter.recordRequest();
      rateLimiter.recordRequest();
      rateLimiter.recordRequest();
      
      expect(rateLimiter.requests.short.length).toBe(initialShort + 3);
      expect(rateLimiter.requests.daily.length).toBe(initialDaily + 3);
    });
  });
  
  describe('edge cases and error handling', () => {
    test('should handle empty Math.min on empty arrays', () => {
      rateLimiter.requests.short = [];
      rateLimiter.requests.daily = [];
      
      expect(rateLimiter.getWaitTime()).toBe(0);
    });
    
    test('should handle arrays with one element', () => {
      rateLimiter.requests.short = [Date.now()];
      
      expect(() => rateLimiter.getWaitTime()).not.toThrow();
    });
    
    test('should maintain limits consistency', () => {
      // Verify that the limits are reasonable
      expect(rateLimiter.limits.short.requests).toBeLessThan(rateLimiter.limits.daily.requests);
      expect(rateLimiter.limits.short.window).toBeLessThan(rateLimiter.limits.daily.window);
    });
    
    test('should handle cleanup with mixed old and new timestamps', () => {
      const now = Date.now();
      const oldShort = now - (20 * 60 * 1000); // 20 minutes (outside short window)
      const oldDaily = now - (30 * 60 * 60 * 1000); // 30 hours (outside daily window)
      const recent = now - (5 * 60 * 1000); // 5 minutes (inside both windows)
      
      rateLimiter.requests.short = [oldShort, recent];
      rateLimiter.requests.daily = [oldDaily, recent];
      
      rateLimiter.cleanupOldRequests();
      
      expect(rateLimiter.requests.short).toEqual([recent]);
      expect(rateLimiter.requests.daily).toEqual([recent]);
    });
  });
});