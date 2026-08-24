const logger = require('./Logger');
const { TIME, HTTP } = require('../constants');

const MAX_RETRIES = 3;
const RETRY_BASE_MS = 1000;
const TRANSIENT_CODES = new Set(['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'EPIPE', 'ECONNABORTED']);
const WATCHDOG_CODE = 'ERR_QUEUE_WATCHDOG';
// How often the supervisor checks whether the drain loop is still making
// progress. Cheap enough to run continuously; only ever touches counters.
const STALL_CHECK_INTERVAL_MS = 15 * 1000;
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

    // Stall supervision. The watchdog above bounds a request that was actually
    // dispatched; this bounds the drain loop itself. A loop that stops
    // advancing while work is queued is otherwise invisible - `processing`
    // stays true, nothing logs, and every later request waits forever.
    // The threshold has to clear the worst case a healthy request can take:
    // MAX_RETRIES + 1 attempts at the watchdog ceiling, plus the retry backoff.
    this.stallAfterMs = options.stallAfterMs
      ?? (this.watchdogMs * (MAX_RETRIES + 1) + 60 * 1000);
    this.stallCheckIntervalMs = options.stallCheckIntervalMs ?? STALL_CHECK_INTERVAL_MS;
    this.lastProgressAt = Date.now();
    this.stallTimer = null;

    // Only the newest drain loop may serve the queue. If a stalled loop ever
    // wakes up after recovery replaced it, its generation is stale and it
    // exits rather than dispatching alongside its replacement.
    this.generation = 0;
  }

  /**
   * Mark forward progress. Anything that proves the loop is alive counts:
   * queueing work, dispatching it, or settling it.
   */
  noteProgress() {
    this.lastProgressAt = Date.now();
  }

  /**
   * Work is queued, a loop claims to be running, and nothing has advanced for
   * longer than a healthy request could possibly take.
   */
  isStalled() {
    return this.processing
      && this.requestQueue.length > 0
      && (Date.now() - this.lastProgressAt) > this.stallAfterMs;
  }

  /**
   * Break a stuck drain loop and start a fresh one.
   *
   * The stuck loop is not cancellable - it is parked on a promise that will
   * never settle - so instead its generation is retired, releasing the
   * `processing` flag and letting a new loop take over. Should the old one
   * ever resume, its generation check stops it immediately.
   */
  recoverFromStall() {
    const stalledForMs = Date.now() - this.lastProgressAt;

    this.log.error('Request queue stalled - abandoning the stuck drain loop', {
      stalledForMs,
      stallAfterMs: this.stallAfterMs,
      queueLength: this.requestQueue.length,
      oldestQueuedMs: this.oldestQueuedMs(),
      contexts: this.requestQueue.slice(0, 5).map(entry => entry.context)
    });

    // Releasing the flag is enough to hand over: processQueue claims the next
    // generation itself, which is what retires the stuck loop.
    this.processing = false;
    this.noteProgress();
    this.processQueue();
  }

  oldestQueuedMs() {
    const oldest = this.requestQueue[0];
    return oldest ? Date.now() - oldest.queuedAt : 0;
  }

  startStallSupervisor() {
    if (this.stallTimer || !this.stallAfterMs) {
      return;
    }

    this.stallTimer = setInterval(() => {
      if (this.isStalled()) {
        this.recoverFromStall();
      }
    }, this.stallCheckIntervalMs);

    // Supervision must never be the reason the process stays alive.
    if (typeof this.stallTimer.unref === 'function') {
      this.stallTimer.unref();
    }
  }

  shutdown() {
    if (this.stallTimer) {
      clearInterval(this.stallTimer);
      this.stallTimer = null;
    }
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
        reject,
        queuedAt: Date.now()
      });

      this.noteProgress();
      this.startStallSupervisor();
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

    return this._drain(++this.generation);
  }

  /**
   * Serve the queue until it is empty. Scoped to the generation that owned the
   * queue when it started: if a stall recovery has since retired that
   * generation, this loop stops rather than competing with its replacement.
   */
  async _drain(generation) {
    try {
      while (this.requestQueue.length > 0 && generation === this.generation) {
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
        this.noteProgress();

        let attempt = 0;
        while (attempt <= MAX_RETRIES) {
          try {
            this.recordRequest();
            const result = await this._runWithWatchdog(requestFunction);
            this.noteProgress();
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

        this.noteProgress();

        // Small delay between requests to avoid overwhelming the API
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    } finally {
      // A retired loop must not clear the flag out from under the loop that
      // replaced it.
      if (generation === this.generation) {
        this.processing = false;
      }
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
      waitTime: this.getWaitTime(),
      // Queue health, so a stall is visible from /health and /botstatus rather
      // than only from reading container logs over SSH.
      processing: this.processing,
      msSinceProgress: Date.now() - this.lastProgressAt,
      oldestQueuedMs: this.oldestQueuedMs(),
      stalled: this.isStalled()
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

    // Clearing `processing` while a loop is still live would let a second
    // drainer start alongside it, so retire the current generation too.
    this.generation++;
    this.noteProgress();

    this.log.info('Rate limiter reset');
  }
}

module.exports = RateLimiter;