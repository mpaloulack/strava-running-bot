const RateLimiter = require('../../src/utils/RateLimiter');
const logger = require('../../src/utils/Logger');
const { HTTP } = require('../../src/constants');

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
          requests: 240,
          window: 15 * 60 * 1000
        },
        daily: {
          requests: 2400,
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
        waitTime: 0,
        processing: false,
        msSinceProgress: expect.any(Number),
        oldestQueuedMs: 0,
        stalled: false
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

    it('should retire the running drain loop on reset', async () => {
      const limiter = new RateLimiter(null, logger.strava, { watchdogMs: 50 });
      const before = limiter.generation;
      const dispatched = [];

      limiter.reset();

      // A loop from the retired generation must not serve the queue.
      limiter.requestQueue.push({
        requestFunction: async () => dispatched.push('x'),
        context: {},
        resolve: () => {},
        reject: () => {},
        queuedAt: Date.now()
      });
      await limiter._drain(before);

      expect(limiter.generation).toBe(before + 1);
      expect(dispatched).toEqual([]);
    });
  });

  // Regression: a single hung request used to hold `processing = true`
  // forever, silently wedging every later Strava call in the process.
  // See src/utils/RateLimiter.js watchdog.
  describe('watchdog', () => {
    // processQueue pauses 100ms between requests, so the lock clears a beat
    // after a caller's promise settles - poll rather than assert instantly.
    const waitForIdle = async (limiter) => {
      for (let i = 0; i < 50 && limiter.processing; i++) {
        await new Promise(resolve => setTimeout(resolve, 20));
      }
    };
    it('should default the watchdog to the shared HTTP constant', () => {
      expect(new RateLimiter().watchdogMs).toBe(HTTP.QUEUE_WATCHDOG_MS);
    });

    it('should reject a request that never settles', async () => {
      const limiter = new RateLimiter(null, logger.strava, { watchdogMs: 50 });

      await expect(
        limiter.executeRequest(() => new Promise(() => {}), { operation: 'hang' })
      ).rejects.toThrow(/watchdog timeout/);
    });

    it('should release the queue so later requests still run', async () => {
      const limiter = new RateLimiter(null, logger.strava, { watchdogMs: 50 });

      const hung = limiter.executeRequest(() => new Promise(() => {}), { operation: 'hang' });
      const followUp = limiter.executeRequest(async () => 'ok', { operation: 'next' });

      await expect(hung).rejects.toThrow(/watchdog timeout/);
      await expect(followUp).resolves.toBe('ok');

      await waitForIdle(limiter);
      expect(limiter.processing).toBe(false);
      expect(limiter.requestQueue).toEqual([]);
    });

    it('should not retry a watchdog timeout', async () => {
      const limiter = new RateLimiter(null, logger.strava, { watchdogMs: 50 });
      const requestFunction = jest.fn(() => new Promise(() => {}));

      await expect(limiter.executeRequest(requestFunction)).rejects.toThrow(/watchdog timeout/);

      expect(requestFunction).toHaveBeenCalledTimes(1);
    });

    it('should swallow a late rejection from an abandoned request', async () => {
      const limiter = new RateLimiter(null, logger.strava, { watchdogMs: 50 });
      const unhandled = jest.fn();
      process.on('unhandledRejection', unhandled);

      await expect(
        limiter.executeRequest(() => new Promise((_, reject) => {
          setTimeout(() => reject(new Error('late failure')), 100);
        }))
      ).rejects.toThrow(/watchdog timeout/);

      await new Promise(resolve => setTimeout(resolve, 150));
      process.off('unhandledRejection', unhandled);

      expect(unhandled).not.toHaveBeenCalled();
    });

    it('should not fire for a request that completes in time', async () => {
      const limiter = new RateLimiter(null, logger.strava, { watchdogMs: 500 });

      await expect(limiter.executeRequest(async () => 'fast')).resolves.toBe('fast');
    });

    it('should handle a requestFunction that throws synchronously', async () => {
      const limiter = new RateLimiter(null, logger.strava, { watchdogMs: 500 });

      await expect(limiter.executeRequest(() => {
        throw new Error('sync boom');
      })).rejects.toThrow('sync boom');

      await waitForIdle(limiter);
      expect(limiter.processing).toBe(false);
    });

    it('should be disabled when watchdogMs is 0', async () => {
      const limiter = new RateLimiter(null, logger.strava, { watchdogMs: 0 });

      await expect(limiter.executeRequest(async () => 'no watchdog')).resolves.toBe('no watchdog');
    });
  });

  // Regression: axios surfaces its own `timeout` as ECONNABORTED, which was
  // absent from TRANSIENT_CODES and so rejected instantly instead of retrying.
  describe('transient error handling', () => {
    it('should retry an axios timeout (ECONNABORTED)', async () => {
      const limiter = new RateLimiter(null, logger.strava, { watchdogMs: 5000 });
      const timeoutError = new Error('timeout of 15000ms exceeded');
      timeoutError.code = 'ECONNABORTED';

      const requestFunction = jest.fn()
        .mockRejectedValueOnce(timeoutError)
        .mockResolvedValueOnce('recovered');

      await expect(limiter.executeRequest(requestFunction)).resolves.toBe('recovered');
      expect(requestFunction).toHaveBeenCalledTimes(2);
    });
  });


  // Production incident 2026-08-24: every Strava call stopped being served for
  // over two hours. The watchdog never fired, because it only guards a request
  // that was actually dispatched - nothing guarded the drain loop itself. With
  // `processing` stuck true, every later request sat in the queue forever with
  // no log, no timeout and no recovery.
  describe('stall recovery', () => {
    const stalledLimiter = () => new RateLimiter(null, logger.strava, {
      watchdogMs: 50,
      stallAfterMs: 40
    });

    it('should default stallAfterMs above the worst-case retry budget', () => {
      const limiter = new RateLimiter();

      // 4 attempts at the watchdog ceiling plus backoff must not look like a stall.
      expect(limiter.stallAfterMs).toBeGreaterThan(limiter.watchdogMs * 4);
    });

    it('should report a queue that is pending with no progress as stalled', async () => {
      const limiter = stalledLimiter();

      limiter.processing = true; // simulate a drain loop that never returns
      limiter.executeRequest(async () => 'never dispatched');
      limiter.lastProgressAt = Date.now() - 10000;

      expect(limiter.isStalled()).toBe(true);
    });

    it('should not report an idle queue as stalled', () => {
      const limiter = stalledLimiter();
      limiter.lastProgressAt = Date.now() - 10000;

      expect(limiter.isStalled()).toBe(false);
    });

    it('should not report a busy queue that is still making progress as stalled', async () => {
      const limiter = stalledLimiter();

      limiter.processing = true;
      limiter.executeRequest(async () => 'queued');
      limiter.lastProgressAt = Date.now();

      expect(limiter.isStalled()).toBe(false);
    });

    it('should serve a request that was stranded by a stuck drain loop', async () => {
      const limiter = stalledLimiter();

      limiter.processing = true; // nothing will ever drain this
      const stranded = limiter.executeRequest(async () => 'served after recovery');
      limiter.lastProgressAt = Date.now() - 10000;

      limiter.recoverFromStall();

      await expect(stranded).resolves.toBe('served after recovery');
    });

    it('should log the stall loudly rather than recovering silently', async () => {
      const limiter = stalledLimiter();

      limiter.processing = true;
      limiter.executeRequest(async () => 'x');
      limiter.lastProgressAt = Date.now() - 10000;

      limiter.recoverFromStall();

      expect(logger.strava.error).toHaveBeenCalledWith(
        expect.stringMatching(/stall/i),
        expect.objectContaining({ queueLength: expect.any(Number) })
      );
    });

    it('should stop a superseded drain loop instead of running two at once', async () => {
      const limiter = stalledLimiter();
      const calls = [];

      limiter.processing = true;
      limiter.executeRequest(async () => { calls.push('a'); return 'a'; });
      limiter.lastProgressAt = Date.now() - 10000;

      const stuckGeneration = limiter.generation;

      // Recovery starts a fresh loop; if the original ever woke up, both would
      // drain the same queue and dispatch twice.
      limiter.recoverFromStall();
      await new Promise(resolve => setTimeout(resolve, 150));

      expect(limiter.generation).toBeGreaterThan(stuckGeneration);
      await limiter._drain(stuckGeneration);

      expect(calls).toEqual(['a']);
    });

    it('should recover automatically once the supervisor tick runs', async () => {
      const limiter = new RateLimiter(null, logger.strava, {
        watchdogMs: 50,
        stallAfterMs: 40,
        stallCheckIntervalMs: 20
      });

      limiter.processing = true;
      const stranded = limiter.executeRequest(async () => 'auto-recovered');
      limiter.lastProgressAt = Date.now() - 10000;

      await expect(stranded).resolves.toBe('auto-recovered');

      limiter.shutdown();
    });

    it('should expose queue health in getStats for /health to surface', async () => {
      const limiter = stalledLimiter();

      limiter.processing = true;
      limiter.executeRequest(async () => 'x');
      limiter.lastProgressAt = Date.now() - 10000;

      expect(limiter.getStats()).toMatchObject({
        queueLength: 1,
        stalled: true,
        msSinceProgress: expect.any(Number)
      });
    });

    it('should stop the supervisor timer on shutdown', () => {
      const limiter = new RateLimiter(null, logger.strava, { stallCheckIntervalMs: 20 });
      limiter.executeRequest(async () => 'x');

      limiter.shutdown();

      expect(limiter.stallTimer).toBeNull();
    });
  });

});
