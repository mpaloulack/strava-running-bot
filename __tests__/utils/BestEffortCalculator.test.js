const BestEffortCalculator = require('../../src/utils/BestEffortCalculator');
const { PB_EFFORT_LABELS, STRAVA_PR_RECORD_TYPE_MAP } = require('../../src/constants');

// Build a constant-pace stream: 1Hz samples, speed in m/s.
function constantPaceStream(durationSeconds, speedMps) {
  const time = [];
  const distance = [];
  for (let t = 0; t <= durationSeconds; t++) {
    time.push(t);
    distance.push(t * speedMps);
  }
  return { time, distance };
}

describe('BestEffortCalculator', () => {
  describe('computeBestEffort', () => {
    it('should compute the exact elapsed time for a constant-pace stream', () => {
      // 10/3 m/s => 5000m in exactly 1500s
      const { time, distance } = constantPaceStream(2000, 10 / 3);

      const result = BestEffortCalculator.computeBestEffort(time, distance, 5000);

      expect(result).toEqual({ distance: 5000, elapsed_time: 1500 });
    });

    it('should find the fastest window in a negative-split stream (fast end)', () => {
      // First half slow (2 m/s), second half fast (5 m/s). 600s total.
      const time = [];
      const distance = [];
      let d = 0;
      for (let t = 0; t < 300; t++) {
        time.push(t);
        distance.push(d);
        d += 2;
      }
      for (let t = 300; t <= 600; t++) {
        time.push(t);
        distance.push(d);
        d += 5;
      }

      // 1000m target should be fastest entirely within the fast (back) half.
      const result = BestEffortCalculator.computeBestEffort(time, distance, 1000);

      // At 5 m/s, 1000m takes 200s — much faster than at 2 m/s (500s).
      expect(result).toEqual({ distance: 1000, elapsed_time: 200 });
    });

    it('should clamp jittery/plateaued distance to be monotonic', () => {
      // Distance jitters backward and plateaus, but is trending at 5 m/s.
      const time = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      const distance = [0, 5, 4.9, 10, 10, 10, 25, 30, 29.5, 40, 45];

      const result = BestEffortCalculator.computeBestEffort(time, distance, 40);

      expect(result).not.toBeNull();
      expect(result.distance).toBe(40);
      // Clamped distance is non-decreasing: [0,5,5,10,10,10,25,30,30,40,45]
      // Fastest window covering >=40m is index 2 (dist=5, t=2) to index 10
      // (dist=45, t=10): 40m in 8s — faster than the naive [0..9] window (9s).
      expect(result.elapsed_time).toBe(8);
    });

    it('should return null when total distance is shorter than the target', () => {
      const { time, distance } = constantPaceStream(100, 2); // 200m total

      const result = BestEffortCalculator.computeBestEffort(time, distance, 5000);

      expect(result).toBeNull();
    });

    it('should return null for empty streams', () => {
      expect(BestEffortCalculator.computeBestEffort([], [], 1000)).toBeNull();
    });

    it('should return null for null/undefined streams', () => {
      expect(BestEffortCalculator.computeBestEffort(null, null, 1000)).toBeNull();
      expect(BestEffortCalculator.computeBestEffort(undefined, [1], 1000)).toBeNull();
    });

    it('should return null for mismatched stream lengths', () => {
      expect(BestEffortCalculator.computeBestEffort([0, 1, 2], [0, 1], 1)).toBeNull();
    });

    it('should return null for a non-positive or non-finite target', () => {
      const { time, distance } = constantPaceStream(100, 5);
      expect(BestEffortCalculator.computeBestEffort(time, distance, 0)).toBeNull();
      expect(BestEffortCalculator.computeBestEffort(time, distance, -100)).toBeNull();
      expect(BestEffortCalculator.computeBestEffort(time, distance, NaN)).toBeNull();
    });
  });

  describe('synthesizeBestEfforts', () => {
    it('should return [] for null/unusable streams', () => {
      expect(BestEffortCalculator.synthesizeBestEfforts(null)).toEqual([]);
      expect(BestEffortCalculator.synthesizeBestEfforts({})).toEqual([]);
      expect(BestEffortCalculator.synthesizeBestEfforts({ time: [1, 2], distance: null })).toEqual([]);
    });

    it('should skip categories longer than the total covered distance', () => {
      // Only ~2000m covered — shorter than 5K/10K/etc.
      const { time, distance } = constantPaceStream(500, 4); // 2000m total

      const results = BestEffortCalculator.synthesizeBestEfforts({ time, distance });

      const names = results.map(r => r.name);
      expect(names).not.toContain('5K');
      expect(names).not.toContain('Marathon');
    });

    it('should emit entries with distance/elapsed_time/moving_time for every covered category', () => {
      // A long, fast enough activity to cover every STRAVA_PR_RECORD_TYPE_MAP category
      const { time, distance } = constantPaceStream(15000, 5); // 75km total

      const results = BestEffortCalculator.synthesizeBestEfforts({ time, distance });

      expect(results.length).toBe(Object.keys(STRAVA_PR_RECORD_TYPE_MAP).length);
      for (const entry of results) {
        expect(entry.moving_time).toBe(entry.elapsed_time);
        expect(Number.isFinite(entry.distance)).toBe(true);
        expect(Number.isFinite(entry.elapsed_time)).toBe(true);
      }
    });

    it('should emit names that PBManager\'s PB_EFFORT_LABELS mapping recognizes for the correct category', () => {
      const { time, distance } = constantPaceStream(15000, 5);

      const results = BestEffortCalculator.synthesizeBestEfforts({ time, distance });

      expect(results.length).toBeGreaterThan(0);
      for (const entry of results) {
        const category = PB_EFFORT_LABELS[entry.name];
        expect(category).toBeDefined();
        // The category resolved via PB_EFFORT_LABELS must match what
        // STRAVA_PR_RECORD_TYPE_MAP says this distance corresponds to.
        expect(category).toBe(STRAVA_PR_RECORD_TYPE_MAP[entry.distance]);
      }
    });

    it('should not invent any name outside of PB_EFFORT_LABELS', () => {
      const { time, distance } = constantPaceStream(15000, 5);

      const results = BestEffortCalculator.synthesizeBestEfforts({ time, distance });

      for (const entry of results) {
        expect(Object.keys(PB_EFFORT_LABELS)).toContain(entry.name);
      }
    });
  });
});
