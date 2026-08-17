const { STRAVA_PR_RECORD_TYPE_MAP, PB_EFFORT_LABELS } = require('../constants');

/**
 * Stateless helper that derives Strava-equivalent `best_efforts` entries
 * from raw time/distance streams — the "fastest N meters" a runner covered
 * anywhere within an activity. Used to give intervals.icu members the same
 * PB detection Strava provides natively via activity.best_efforts.
 */
class BestEffortCalculator {
  /**
   * Find the fastest contiguous window covering at least `targetMeters`
   * using a classic two-pointer sweep, O(n).
   *
   * The distance stream is first clamped to be non-decreasing
   * (`d[k] = max(d[k], d[k-1])`) to absorb GPS jitter/plateaus before the sweep.
   *
   * @param {number[]} timeData - cumulative elapsed seconds, non-decreasing
   * @param {number[]} distanceData - cumulative meters, same length as timeData
   * @param {number} targetMeters - minimum window distance to search for
   * @returns {{distance: number, elapsed_time: number}|null} null if streams are unusable
   *   or total distance covered is less than targetMeters
   */
  static computeBestEffort(timeData, distanceData, targetMeters) {
    if (!Array.isArray(timeData) || !Array.isArray(distanceData)) return null;
    if (timeData.length === 0 || distanceData.length === 0) return null;
    if (timeData.length !== distanceData.length) return null;
    if (!Number.isFinite(targetMeters) || targetMeters <= 0) return null;

    const n = timeData.length;
    const dist = new Array(n);
    dist[0] = distanceData[0];
    for (let i = 1; i < n; i++) {
      dist[i] = Math.max(distanceData[i], dist[i - 1]);
    }

    const totalDistance = dist[n - 1] - dist[0];
    if (totalDistance < targetMeters) return null;

    let right = 0;
    let minElapsed = Infinity;

    for (let left = 0; left < n; left++) {
      if (right < left) right = left;
      while (right < n && dist[right] - dist[left] < targetMeters) {
        right++;
      }
      if (right >= n) break; // dist is non-decreasing — no window works for any larger `left` either

      const elapsed = timeData[right] - timeData[left];
      if (elapsed < minElapsed) minElapsed = elapsed;
    }

    if (!Number.isFinite(minElapsed)) return null;

    return { distance: targetMeters, elapsed_time: minElapsed };
  }

  /**
   * Compute best-effort entries for every PB category the bot recognizes via
   * STRAVA_PR_RECORD_TYPE_MAP, shaped exactly like the entries PBManager
   * consumes from Strava's real `activity.best_efforts` array.
   *
   * The `name` field is derived from PB_EFFORT_LABELS (never invented) so
   * PBManager.extractBestEfforts's `PB_EFFORT_LABELS[effort.name]` lookup
   * resolves to the correct category.
   *
   * @param {{time?: number[], distance?: number[]}} streams - normalized stream map
   * @returns {Array<{name: string, distance: number, elapsed_time: number, moving_time: number}>}
   */
  static synthesizeBestEfforts(streams) {
    if (!streams || !Array.isArray(streams.time) || !Array.isArray(streams.distance)) return [];

    const nameByCategory = BestEffortCalculator._buildNameByCategory();
    const results = [];

    for (const [metersKey, category] of Object.entries(STRAVA_PR_RECORD_TYPE_MAP)) {
      const targetMeters = Number(metersKey);
      const name = nameByCategory[category];
      if (!name) continue; // defensive — every STRAVA_PR_RECORD_TYPE_MAP category has a PB_EFFORT_LABELS entry

      const effort = BestEffortCalculator.computeBestEffort(streams.time, streams.distance, targetMeters);
      if (!effort) continue; // activity doesn't cover this distance

      results.push({
        name,
        distance: effort.distance,
        elapsed_time: effort.elapsed_time,
        // Per-window moving time is unknowable from a cumulative stream —
        // equal to elapsed_time is the conservative choice.
        moving_time: effort.elapsed_time
      });
    }

    return results;
  }

  // Reverse PB_EFFORT_LABELS (name -> category) into (category -> name).
  static _buildNameByCategory() {
    const map = {};
    for (const [name, category] of Object.entries(PB_EFFORT_LABELS)) {
      if (!(category in map)) {
        map[category] = name;
      }
    }
    return map;
  }
}

module.exports = BestEffortCalculator;
