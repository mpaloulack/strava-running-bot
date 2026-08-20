const logger = require('./Logger');
const { TIME, HTTP } = require('../constants');

const MAX_RETRIES = 3;
const RETRY_BASE_MS = 1000;
const TRANSIENT_CODES = new Set(['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'EPIPE', 'ECONNABORTED']);
const WATCHDOG_CODE = 'ERR_QUEUE_WATCHDOG';
const NON_RETRIABLE_STATUSES = new Set([400, 401, 403, 404]);

function isTransientError(error) {
  if (error.code && TRANSIENT_CODES.has(error.code)) return true;
  if (error.message && (
    error.message.includes('Maximum number of redirects') ||
    error.message.includes('socket hang up') ||
    error.message.includes('network timeout')
  )) return true;
  return false;
}

/**
 * Sliding-window rate limiter for external API compliance.
 * Defaults to Strava's read limits; pass custom limits/log for other providers.
 */
class RateLimiter {
  constructor(limits = null, log = logger.strava, options = {}) {
    this.log = log;

    // Hard ceiling on how long one request may hold the serialized queue.
    // 0 disables it (tests that drive the queue manually).
    this.watchdogMs = options.watchdogMs ?? HTTP.QUEUE_WATCHDOG_MS;

    // Default: Strava read rate limits: 300/15min, 3000/day — using 80% as safety margin
    this.limits = limits || {
      short: {
        requests: 240,   // 80% of Strava's read limit (300/15min)
        window: 15 * TIME.MS_PER_MINUTE
      },
      daily: {
        requests: 2400,  // 80% of Strava's read daily limit (3000/day)
        window: TIME.MS_PER_DAY
      }
    };

    // Track requests with timestamps
    this.requests = {
      short: [], // Array of timestamps for 15-min window
      daily: []  // Array of timestamps for 24-hour window
    };

    // Queue for delayed requests when rate limited
    this.requestQueue = [];
    this.processing = false;
  }

  /**
   * Check if we can make a request now
   */
  canMakeRequest() {
    this.cleanupOldRequests();
    
    const shortTermOk = this.requests.short.length < this.limits.short.requests;
    const dailyOk = this.requests.daily.length < this.limits.daily.requests;
    
    return shortTermOk && dailyOk;
  }

  /**
   * Record a request being made
   */
  recordRequest() {
    const now = Date.now();
    this.requests.short.push(now);
    this.requests.daily.push(now);
    
    this.log.debug('API request recorded', {
      shortTermCount: this.requests.short.length,
      dailyCount: this.requests.daily.length,
      shortTermLimit: this.limits.short.requests,
      dailyLimit: this.limits.daily.requests
    });
  }

  /**
   * Clean up old requests outside the time windows
   */
  cleanupOldRequests() {
    const now = Date.now();
    
    // Clean up short-term window (15 minutes)
    this.requests.short = this.requests.short.filter(
      timestamp => now - timestamp < this.limits.short.window
    );
    
    // Clean up daily window (24 hours)
    this.requests.daily = this.requests.daily.filter(
      timestamp => now - timestamp < this.limits.daily.window
    );
  }

  /**
   * Get time until next available slot
   */
  getWaitTime() {
    this.cleanupOldRequests();
    
    if (this.canMakeRequest()) {
      return 0;
    }

    // Calculate wait time based on oldest request in the limiting window
    let waitTime = 0;
    
    if (this.requests.short.length >= this.limits.short.requests) {
      const oldestShort = Math.min(...this.requests.short);
      waitTime = Math.max(waitTime, oldestShort + this.limits.short.window - Date.now());
    }
    
    if (this.requests.daily.length >= this.limits.daily.requests) {
      const oldestDaily = Math.min(...this.requests.daily);
      waitTime = Math.max(waitTime, oldestDaily + this.limits.daily.window - Date.now());
    }
    
    return Math.max(waitTime, 0);
  }

  /**
   * Run one request under a hard deadline.
   *
   * processQueue is serialized behind `this.processing`, so a request that
   * never settles doesn't just lose itself — it wedges every subsequent call
   * to this provider for the life of the process, with no error logged
   * anywhere. Per-request timeouts in the API clients are the real defence;
   * this is the backstop for when those don't fire.
   */
  async _runWithWatchdog(requestFunction) {
    // Normalize a synchronous throw into a rejected promise so the watchdog
    // path and the happy path fail the same way.
    const inFlight = Promise.resolve().then(() => requestFunction());

    if (!this.watchdogMs) {
      return inFlight;
    }

    // If the watchdog wins the race, nothing is left awaiting `inFlight`.
    // Should it reject later, that would surface as an unhandledRejection and
    // take the process down, so absorb it here while we still have a handle.
    inFlight.catch(() => {});

    let timer;
    try {
      return await Promise.race([
        inFlight,
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            const error = new Error(`Request exceeded watchdog timeout of ${this.watchdogMs}ms`);
            error.code = WATCHDOG_CODE;
            reject(error);
          }, this.watchdogMs);
          // Never keep the event loop alive just for the watchdog.
          if (typeof timer.unref === 'function') timer.unref();
        })
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Execute a rate-limited request
   */
  async executeRequest(requestFunction, context = {}) {
    return new Promise((resolve, reject) => {
      this.requestQueue.push({
        requestFunction,
        context,
        resolve,
        reject
      });
      
      this.processQueue();
    });
  }

  /**
   * Process the request queue
   */
  async processQueue() {
    if (this.processing || this.requestQueue.length === 0) {
      return;
    }

    this.processing = true;

    try {
      while (this.requestQueue.length > 0) {
        if (!this.canMakeRequest()) {
          const waitTime = this.getWaitTime();
          
          this.log.warn('Rate limit reached, waiting before next request', {
            waitTimeMs: waitTime,
            waitTimeMin: Math.round(waitTime / 1000 / 60),
            queueLength: this.requestQueue.length,
            shortTermCount: this.requests.short.length,
            dailyCount: this.requests.daily.length
          });

          // Wait before trying again
          await new Promise(resolve => setTimeout(resolve, waitTime));
          continue;
        }

        const { requestFunction, context, resolve, reject } = this.requestQueue.shift();

        let attempt = 0;
        while (attempt <= MAX_RETRIES) {
          try {
            this.recordRequest();
            const result = await this._runWithWatchdog(requestFunction);
            resolve(result);
            break;
          } catch (error) {
            const status = error.response?.status;

            if (error.code === WATCHDOG_CODE) {
              this.log.error('Request exceeded watchdog timeout - abandoning to unblock queue', {
                error: error.message,
                context,
                queueLength: this.requestQueue.length
              });
              reject(error);
              break;
            }

            if (status && NON_RETRIABLE_STATUSES.has(status)) {
              this.log.error('Rate-limited request failed (non-retriable)', { error: error.message, context });
              reject(error);
              break;
            }

            const isRateLimit = status === 429;
            const isTransient = !isRateLimit && isTransientError(error);
            const canRetry = (isRateLimit || isTransient) && attempt < MAX_RETRIES;

            if (!canRetry) {
              this.log.error('Rate-limited request failed', { error: error.message, context, attempts: attempt + 1 });
              reject(error);
              break;
            }

            const retryAfterHeader = error.response?.headers?.['retry-after'];
            const waitMs = isRateLimit
              ? (retryAfterHeader ? parseInt(retryAfterHeader, 10) * 1000 : RETRY_BASE_MS * Math.pow(2, attempt))
              : RETRY_BASE_MS * Math.pow(2, attempt);

            this.log.warn('Request failed, retrying', {
              attempt: attempt + 1,
              maxRetries: MAX_RETRIES,
              waitMs,
              error: error.message,
              context,
            });

            await new Promise(r => setTimeout(r, waitMs));
            attempt++;
          }
        }

        // Small delay between requests to avoid overwhelming the API
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    } finally {
      this.processing = false;
    }
  }

  /**
   * Get current rate limit stats
   */
  getStats() {
    this.cleanupOldRequests();
    
    return {
      shortTerm: {
        used: this.requests.short.length,
        limit: this.limits.short.requests,
        window: '15 minutes'
      },
      daily: {
        used: this.requests.daily.length,
        limit: this.limits.daily.requests,
        window: '24 hours'
      },
      queueLength: this.requestQueue.length,
      canMakeRequest: this.canMakeRequest(),
      waitTime: this.getWaitTime()
    };
  }

  /**
   * Reset all counters (for testing or manual reset)
   */
  reset() {
    this.requests.short = [];
    this.requests.daily = [];
    this.requestQueue = [];
    this.processing = false;
    
    this.log.info('Rate limiter reset');
  }
}

module.exports = RateLimiter;