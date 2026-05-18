const PBManager = require('../../src/managers/PBManager');
const DatabaseManager = require('../../src/database/DatabaseManager');

jest.mock('../../src/database/DatabaseManager', () => ({
  initialize: jest.fn(),
  getMemberByDiscordId: jest.fn(),
  upsertPersonalBest: jest.fn(),
  getPersonalBestsByAthleteId: jest.fn(),
  getPersonalBest: jest.fn(),
  upsertActivity: jest.fn().mockResolvedValue(undefined),
  settingsManager: {
    getSetting: jest.fn().mockResolvedValue(null),
    setSetting: jest.fn().mockResolvedValue(undefined),
    deleteSetting: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock('../../src/utils/Logger', () => ({
  database: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
  activity: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
}));

describe('PBManager', () => {
  let pbManager;

  const mockMember = {
    athleteId: 12345,
    discordId: 'discord123',
    isActive: true,
    athlete: { firstname: 'John', lastname: 'Runner' },
  };

  const mockActivity = {
    id: 999,
    name: 'Morning Run',
    type: 'Run',
    start_date: '2026-03-18T07:00:00Z',
    best_efforts: [
      {
        name: '5K',
        distance: 5012.3,
        elapsed_time: 1410,
        moving_time: 1380,
      },
      {
        name: '10K',
        distance: 10018.5,
        elapsed_time: 2880,
        moving_time: 2820,
      },
    ],
  };

  beforeEach(() => {
    pbManager = new PBManager();
    jest.clearAllMocks();
  });

  // ─── extractBestEfforts ───────────────────────────────────────────────────

  describe('extractBestEfforts', () => {
    it('should return normalized efforts from valid best_efforts data', () => {
      const efforts = pbManager.extractBestEfforts(mockActivity);
      expect(efforts).toHaveLength(2);
      expect(efforts[0]).toMatchObject({
        category: '5K',
        distanceM: 5012.3,
        elapsedTime: 1410,
        movingTime: 1380,
        activityId: 999,
        activityName: 'Morning Run',
      });
      expect(efforts[1].category).toBe('10K');
    });

    it('should skip unknown effort names not in PB_EFFORT_LABELS', () => {
      const activity = {
        ...mockActivity,
        best_efforts: [
          { name: 'Unknown Distance', distance: 3000, elapsed_time: 900, moving_time: 900 },
          { name: '5K', distance: 5000, elapsed_time: 1200, moving_time: 1200 },
        ],
      };
      const efforts = pbManager.extractBestEfforts(activity);
      expect(efforts).toHaveLength(1);
      expect(efforts[0].category).toBe('5K');
    });

    it('should return [] when best_efforts is null', () => {
      // No distance on mockActivity → phase 2 guard skips synthesis too
      expect(pbManager.extractBestEfforts({ ...mockActivity, best_efforts: null })).toEqual([]);
    });

    it('should return [] when best_efforts is undefined', () => {
      // No distance on mockActivity → phase 2 guard skips synthesis too
      const { best_efforts: _best_efforts, ...activity } = mockActivity;
      expect(pbManager.extractBestEfforts(activity)).toEqual([]);
    });

    it('should return [] when best_efforts is empty array', () => {
      // No distance on mockActivity → phase 2 guard skips synthesis too
      expect(pbManager.extractBestEfforts({ ...mockActivity, best_efforts: [] })).toEqual([]);
    });

    it('should return [] when activity type is not Run', () => {
      const rideActivity = { ...mockActivity, type: 'Ride' };
      expect(pbManager.extractBestEfforts(rideActivity)).toEqual([]);
    });

    it('should include activity_date in ISO date format', () => {
      const efforts = pbManager.extractBestEfforts(mockActivity);
      expect(efforts[0].activityDate).toBe('2026-03-18');
    });

    // ─── Phase 2: near-miss synthesis ─────────────────────────────────────

    it('(a) near-miss: synthesizes 5K entry when distance=4990 and best_efforts=[]', () => {
      const activity = { ...mockActivity, best_efforts: [], distance: 4990, elapsed_time: 1500, moving_time: 1480 };
      const efforts = pbManager.extractBestEfforts(activity);
      expect(efforts).toHaveLength(1);
      expect(efforts[0]).toMatchObject({ category: '5K', isSynthetic: true, distanceM: 4990 });
    });

    it('(b) no duplicate: real 5K effort present, distance=4990 → only 1 result', () => {
      const activity = {
        ...mockActivity,
        distance: 4990,
        elapsed_time: 1500,
        moving_time: 1480,
        best_efforts: [{ name: '5K', distance: 4990, elapsed_time: 1500, moving_time: 1480 }],
      };
      const efforts = pbManager.extractBestEfforts(activity);
      expect(efforts).toHaveLength(1);
      expect(efforts[0].isSynthetic).toBeUndefined();
    });

    it('(c) 4899m (2.02% short) → [] — outside tolerance', () => {
      const activity = { ...mockActivity, best_efforts: [], distance: 4899, elapsed_time: 1500, moving_time: 1480 };
      expect(pbManager.extractBestEfforts(activity)).toEqual([]);
    });

    it('(d) 10210m (2.1% over 10K) → [] — outside tolerance', () => {
      const activity = { ...mockActivity, best_efforts: [], distance: 10210, elapsed_time: 3000, moving_time: 2950 };
      expect(pbManager.extractBestEfforts(activity)).toEqual([]);
    });

    it('(e) 5090m (1.8% over 5K) → synthesizes 5K entry', () => {
      const activity = { ...mockActivity, best_efforts: [], distance: 5090, elapsed_time: 1510, moving_time: 1490 };
      const efforts = pbManager.extractBestEfforts(activity);
      expect(efforts).toHaveLength(1);
      expect(efforts[0]).toMatchObject({ category: '5K', isSynthetic: true });
    });

    it('(f) best_efforts=null, distance=4990 → synthesizes 5K', () => {
      const activity = { ...mockActivity, best_efforts: null, distance: 4990, elapsed_time: 1500, moving_time: 1480 };
      const efforts = pbManager.extractBestEfforts(activity);
      expect(efforts).toHaveLength(1);
      expect(efforts[0].isSynthetic).toBe(true);
    });

    it('(g) best_efforts absent, distance=4990 → synthesizes 5K', () => {
      const { best_efforts: _be, ...base } = mockActivity;
      const activity = { ...base, distance: 4990, elapsed_time: 1500, moving_time: 1480 };
      const efforts = pbManager.extractBestEfforts(activity);
      expect(efforts).toHaveLength(1);
      expect(efforts[0].isSynthetic).toBe(true);
    });

    it('(h) type=Ride, distance=4990 → [] — non-Run type excluded', () => {
      const activity = { ...mockActivity, type: 'Ride', best_efforts: [], distance: 4990 };
      expect(pbManager.extractBestEfforts(activity)).toEqual([]);
    });

    it('(i) distance=0 → [] — phase 2 guard prevents synthesis', () => {
      const activity = { ...mockActivity, best_efforts: [], distance: 0, elapsed_time: 0, moving_time: 0 };
      expect(pbManager.extractBestEfforts(activity)).toEqual([]);
    });

    it('(j) distance undefined → [] — phase 2 guard prevents synthesis', () => {
      const activity = { ...mockActivity, best_efforts: [], elapsed_time: 1500, moving_time: 1480 };
      expect(pbManager.extractBestEfforts(activity)).toEqual([]);
    });

    it('(k) activityId and activityName are set on synthetic effort', () => {
      const activity = { ...mockActivity, id: 777, name: 'Near 5K', best_efforts: [], distance: 4990, elapsed_time: 1500, moving_time: 1480 };
      const efforts = pbManager.extractBestEfforts(activity);
      expect(efforts[0]).toMatchObject({ activityId: 777, activityName: 'Near 5K' });
    });

    it('(l) distance=42000 (0.46% short of marathon) → synthesizes Marathon entry', () => {
      const activity = { ...mockActivity, best_efforts: [], distance: 42000, elapsed_time: 14400, moving_time: 14350 };
      const efforts = pbManager.extractBestEfforts(activity);
      expect(efforts.some(e => e.category === 'Marathon' && e.isSynthetic)).toBe(true);
    });

    it('(m) distance=10050 with real 5K effort → real 5K + synthetic 10K', () => {
      const activity = {
        ...mockActivity,
        distance: 10050,
        elapsed_time: 2900,
        moving_time: 2870,
        best_efforts: [{ name: '5K', distance: 5001, elapsed_time: 1400, moving_time: 1380 }],
      };
      const efforts = pbManager.extractBestEfforts(activity);
      expect(efforts).toHaveLength(2);
      expect(efforts.find(e => e.category === '5K' && !e.isSynthetic)).toBeTruthy();
      expect(efforts.find(e => e.category === '10K' && e.isSynthetic)).toBeTruthy();
    });
  });

  // ─── checkAndUpdatePBs ───────────────────────────────────────────────────

  describe('checkAndUpdatePBs', () => {
    it('should return empty array when no best_efforts in activity', async () => {
      const { best_efforts: _best_efforts, ...activity } = mockActivity;
      const results = await pbManager.checkAndUpdatePBs(12345, activity);
      expect(results).toEqual([]);
      expect(DatabaseManager.getPersonalBest).not.toHaveBeenCalled();
    });

    it('should create new PB when no existing PB for category', async () => {
      DatabaseManager.getPersonalBest.mockResolvedValue(null);
      DatabaseManager.upsertPersonalBest.mockResolvedValue({ id: 1, category: '5K' });

      const results = await pbManager.checkAndUpdatePBs(12345, mockActivity);

      expect(results.some(r => r.isNewPB && r.category === '5K')).toBe(true);
      expect(DatabaseManager.upsertPersonalBest).toHaveBeenCalledWith(12345, expect.objectContaining({
        category: '5K',
        elapsedTime: 1410,
      }));
    });

    it('should update PB when new elapsed_time is faster than existing', async () => {
      DatabaseManager.getPersonalBest.mockResolvedValue({ elapsed_time: 1500, category: '5K' });
      DatabaseManager.upsertPersonalBest.mockResolvedValue({ id: 1 });

      const results = await pbManager.checkAndUpdatePBs(12345, mockActivity);

      const pbResult = results.find(r => r.category === '5K');
      expect(pbResult.isNewPB).toBe(true);
      expect(pbResult.previousPB).toMatchObject({ elapsed_time: 1500 });
    });

    it('should not update PB when new elapsed_time is slower than existing', async () => {
      DatabaseManager.getPersonalBest.mockResolvedValue({ elapsed_time: 1300, category: '5K' });

      const results = await pbManager.checkAndUpdatePBs(12345, mockActivity);

      const pbResult = results.find(r => r.category === '5K');
      expect(pbResult.isNewPB).toBe(false);
      expect(DatabaseManager.upsertPersonalBest).not.toHaveBeenCalledWith(12345, expect.objectContaining({ category: '5K' }));
    });

    it('should not update PB when new elapsed_time equals existing', async () => {
      DatabaseManager.getPersonalBest.mockResolvedValue({ elapsed_time: 1410, category: '5K' });

      const results = await pbManager.checkAndUpdatePBs(12345, mockActivity);

      const pb5k = results.find(r => r.category === '5K');
      expect(pb5k.isNewPB).toBe(false);
    });

    it('should handle multiple best efforts in one activity independently', async () => {
      DatabaseManager.getPersonalBest
        .mockResolvedValueOnce(null)                           // 5K — no existing
        .mockResolvedValueOnce({ elapsed_time: 2700, category: '10K' }); // 10K — existing faster
      DatabaseManager.upsertPersonalBest.mockResolvedValue({ id: 1 });

      const results = await pbManager.checkAndUpdatePBs(12345, mockActivity);

      expect(results).toHaveLength(2);
      expect(results.find(r => r.category === '5K').isNewPB).toBe(true);
      expect(results.find(r => r.category === '10K').isNewPB).toBe(false);
    });

    it('should handle DB error gracefully per effort without crashing', async () => {
      DatabaseManager.getPersonalBest
        .mockRejectedValueOnce(new Error('DB error'))
        .mockResolvedValueOnce(null);
      DatabaseManager.upsertPersonalBest.mockResolvedValue({ id: 1 });

      const results = await pbManager.checkAndUpdatePBs(12345, mockActivity);

      // Only the non-errored effort should be processed
      expect(results).toHaveLength(1);
      expect(results[0].category).toBe('10K');
    });
  });

  // ─── checkAndUpdatePBsFromEfforts ─────────────────────────────────────────

  describe('checkAndUpdatePBsFromEfforts', () => {
    const mockEfforts = [
      {
        category: '5K',
        distanceM: 5012.3,
        elapsedTime: 1410,
        movingTime: 1380,
        activityId: 999,
        activityName: 'Morning Run',
        activityDate: '2026-03-18',
      },
      {
        category: '10K',
        distanceM: 10018.5,
        elapsedTime: 2880,
        movingTime: 2820,
        activityId: 999,
        activityName: 'Morning Run',
        activityDate: '2026-03-18',
      },
    ];

    it('should return empty array when efforts array is empty', async () => {
      const results = await pbManager.checkAndUpdatePBsFromEfforts(12345, []);
      expect(results).toEqual([]);
    });

    it('should create new PB when no existing PB for category', async () => {
      DatabaseManager.getPersonalBest.mockResolvedValue(null);
      DatabaseManager.upsertPersonalBest.mockResolvedValue({ id: 1 });

      const results = await pbManager.checkAndUpdatePBsFromEfforts(12345, [mockEfforts[0]]);

      expect(results).toHaveLength(1);
      expect(results[0].isNewPB).toBe(true);
      expect(results[0].category).toBe('5K');
      expect(DatabaseManager.upsertPersonalBest).toHaveBeenCalledWith(12345, expect.objectContaining({
        category: '5K',
        elapsedTime: 1410,
      }));
    });

    it('should update PB when new elapsed_time is faster', async () => {
      DatabaseManager.getPersonalBest.mockResolvedValue({ elapsed_time: 1500, category: '5K' });
      DatabaseManager.upsertPersonalBest.mockResolvedValue({ id: 1 });

      const results = await pbManager.checkAndUpdatePBsFromEfforts(12345, [mockEfforts[0]]);

      expect(results[0].isNewPB).toBe(true);
      expect(results[0].previousPB).toMatchObject({ elapsed_time: 1500 });
    });

    it('should not update PB when new elapsed_time is slower', async () => {
      DatabaseManager.getPersonalBest.mockResolvedValue({ elapsed_time: 1300, category: '5K' });

      const results = await pbManager.checkAndUpdatePBsFromEfforts(12345, [mockEfforts[0]]);

      expect(results[0].isNewPB).toBe(false);
      expect(DatabaseManager.upsertPersonalBest).not.toHaveBeenCalled();
    });

    it('should not update PB when elapsed_time equals existing', async () => {
      DatabaseManager.getPersonalBest.mockResolvedValue({ elapsed_time: 1410, category: '5K' });

      const results = await pbManager.checkAndUpdatePBsFromEfforts(12345, [mockEfforts[0]]);

      expect(results[0].isNewPB).toBe(false);
    });

    it('should process multiple efforts independently', async () => {
      DatabaseManager.getPersonalBest
        .mockResolvedValueOnce(null)                                     // 5K — no existing
        .mockResolvedValueOnce({ elapsed_time: 2700, category: '10K' }); // 10K — existing is faster
      DatabaseManager.upsertPersonalBest.mockResolvedValue({ id: 1 });

      const results = await pbManager.checkAndUpdatePBsFromEfforts(12345, mockEfforts);

      expect(results).toHaveLength(2);
      expect(results.find(r => r.category === '5K').isNewPB).toBe(true);
      expect(results.find(r => r.category === '10K').isNewPB).toBe(false);
    });

    it('should handle DB error per effort gracefully without crashing', async () => {
      DatabaseManager.getPersonalBest
        .mockRejectedValueOnce(new Error('DB error'))
        .mockResolvedValueOnce(null);
      DatabaseManager.upsertPersonalBest.mockResolvedValue({ id: 1 });

      const results = await pbManager.checkAndUpdatePBsFromEfforts(12345, mockEfforts);

      expect(results).toHaveLength(1);
      expect(results[0].category).toBe('10K');
    });

    it('should store the overridden distanceM when provided in the effort object', async () => {
      DatabaseManager.getPersonalBest.mockResolvedValue(null);
      DatabaseManager.upsertPersonalBest.mockResolvedValue({ id: 1 });

      const effortWithOverride = { ...mockEfforts[0], distanceM: 5000 };
      await pbManager.checkAndUpdatePBsFromEfforts(12345, [effortWithOverride]);

      expect(DatabaseManager.upsertPersonalBest).toHaveBeenCalledWith(12345, expect.objectContaining({
        distanceM: 5000,
      }));
    });

  });

  // ─── getMemberPBs ─────────────────────────────────────────────────────────

  describe('getMemberPBs', () => {
    it('should return empty array when member has no PBs', async () => {
      DatabaseManager.getPersonalBestsByAthleteId.mockResolvedValue([]);
      const result = await pbManager.getMemberPBs(12345);
      expect(result).toEqual([]);
    });

    it('should return sorted PB rows for athlete', async () => {
      const mockPBs = [
        { id: 1, category: '5K', elapsed_time: 1200 },
        { id: 2, category: '10K', elapsed_time: 2500 },
      ];
      DatabaseManager.getPersonalBestsByAthleteId.mockResolvedValue(mockPBs);
      const result = await pbManager.getMemberPBs(12345);
      expect(result).toEqual(mockPBs);
      expect(DatabaseManager.getPersonalBestsByAthleteId).toHaveBeenCalledWith(12345);
    });
  });

  // ─── getMemberPBsByDiscordId ──────────────────────────────────────────────

  describe('getMemberPBsByDiscordId', () => {
    it('should return [] when member not found', async () => {
      DatabaseManager.getMemberByDiscordId.mockResolvedValue(null);
      const result = await pbManager.getMemberPBsByDiscordId('unknownDiscordId');
      expect(result).toEqual([]);
    });

    it('should return [] when member is inactive', async () => {
      DatabaseManager.getMemberByDiscordId.mockResolvedValue({ ...mockMember, isActive: false });
      const result = await pbManager.getMemberPBsByDiscordId('discord123');
      expect(result).toEqual([]);
    });

    it('should return PBs for active member', async () => {
      const mockPBs = [{ id: 1, category: '5K', elapsed_time: 1200 }];
      DatabaseManager.getMemberByDiscordId.mockResolvedValue(mockMember);
      DatabaseManager.getPersonalBestsByAthleteId.mockResolvedValue(mockPBs);

      const result = await pbManager.getMemberPBsByDiscordId('discord123');
      expect(result).toEqual(mockPBs);
      expect(DatabaseManager.getPersonalBestsByAthleteId).toHaveBeenCalledWith(12345);
    });
  });

  // ─── syncFromHistory ──────────────────────────────────────────────────────

  describe('syncFromHistory', () => {
    let mockStravaAPI;

    beforeEach(() => {
      mockStravaAPI = {
        getAthleteActivities: jest.fn(),
        getActivity: jest.fn(),
      };
      DatabaseManager.getMemberByDiscordId.mockResolvedValue(mockMember);
    });

    it('should call getAthleteActivities with Jan 1st (UTC) of current year as after timestamp', async () => {
      mockStravaAPI.getAthleteActivities.mockResolvedValue([]);
      DatabaseManager.settingsManager.getSetting.mockResolvedValue(null);

      await pbManager.syncFromHistory('discord123', 'token', mockStravaAPI);

      // First call must pass both `before` (≈ now) and `after` (Jan 1 UTC) so that
      // Strava returns results in DESC order — Strava switches to ASC when only
      // `after` is passed, which breaks the backward-walk cursor algorithm.
      expect(mockStravaAPI.getAthleteActivities).toHaveBeenCalledWith('token', 1, 100, expect.any(Number), expect.any(Number));
      const [, , , before, after] = mockStravaAPI.getAthleteActivities.mock.calls[0];
      const nowSec = Math.floor(Date.now() / 1000);
      expect(Math.abs(before - nowSec)).toBeLessThan(60);
      const jan1Utc = Math.floor(Date.UTC(new Date().getUTCFullYear(), 0, 1) / 1000);
      expect(Math.abs(after - jan1Utc)).toBeLessThan(60);
    });

    it('should use saved cursor as before param when resuming', async () => {
      const cursor = 1700000000; // saved before-cursor (unix seconds)
      DatabaseManager.settingsManager.getSetting.mockResolvedValue(String(cursor));
      mockStravaAPI.getAthleteActivities.mockResolvedValue([]);

      await pbManager.syncFromHistory('discord123', 'token', mockStravaAPI);

      // First call uses the resumed `before` cursor; `after` is the period bound.
      expect(mockStravaAPI.getAthleteActivities).toHaveBeenCalledWith(
        'token', 1, 100, cursor, expect.any(Number)
      );
    });

    it('should write checkpoint after each page with (oldest activity timestamp - 1)', async () => {
      // Strava returns DESC (newest first), so the LAST element is the oldest.
      const activities = [
        { id: 1, type: 'Run', start_date: '2026-01-10T10:00:00Z' }, // newest on page
        { id: 2, type: 'Run', start_date: '2026-01-05T10:00:00Z' }, // oldest on page
      ];
      mockStravaAPI.getAthleteActivities
        .mockResolvedValueOnce(activities)
        .mockResolvedValueOnce([]);
      mockStravaAPI.getActivity.mockResolvedValue({ id: 1, type: 'Run', best_efforts: [] });
      DatabaseManager.settingsManager.getSetting.mockResolvedValue(null);

      await pbManager.syncFromHistory('discord123', 'token', mockStravaAPI);

      // Cursor moves backward in time: saved as (oldest_ts - 1) so the next page
      // starts strictly older than the last activity processed.
      const oldestTs = Math.floor(new Date('2026-01-05T10:00:00Z').getTime() / 1000);
      expect(DatabaseManager.settingsManager.setSetting).toHaveBeenCalledWith(
        expect.stringMatching(/^pb_sync_cursor_discord123_\d+$/),
        String(oldestTs - 1),
        expect.any(String)
      );
    });

    it('should delete checkpoint on successful completion', async () => {
      mockStravaAPI.getAthleteActivities.mockResolvedValue([]);
      DatabaseManager.settingsManager.getSetting.mockResolvedValue(null);

      await pbManager.syncFromHistory('discord123', 'token', mockStravaAPI);

      expect(DatabaseManager.settingsManager.deleteSetting).toHaveBeenCalledWith(
        expect.stringMatching(/^pb_sync_cursor_discord123_\d+$/)
      );
    });

    it('should not delete checkpoint if sync stops mid-way (throws)', async () => {
      mockStravaAPI.getAthleteActivities.mockRejectedValue(new Error('Network error'));
      DatabaseManager.settingsManager.getSetting.mockResolvedValue(null);

      await expect(pbManager.syncFromHistory('discord123', 'token', mockStravaAPI)).rejects.toThrow();

      expect(DatabaseManager.settingsManager.deleteSetting).not.toHaveBeenCalled();
    });

    it('should paginate until empty page returned', async () => {
      const page1 = [
        { id: 1, type: 'Run', start_date: '2026-01-10T10:00:00Z' },
        { id: 2, type: 'Run', start_date: '2026-01-05T10:00:00Z' },
      ];
      mockStravaAPI.getAthleteActivities
        .mockResolvedValueOnce(page1)
        .mockResolvedValueOnce([]);
      mockStravaAPI.getActivity.mockResolvedValue({ id: 1, type: 'Run', best_efforts: [] });
      DatabaseManager.settingsManager.getSetting.mockResolvedValue(null);

      await pbManager.syncFromHistory('discord123', 'token', mockStravaAPI);

      expect(mockStravaAPI.getAthleteActivities).toHaveBeenCalledTimes(2);
    });

    it('should always pass page=1 to API (cursor-based via before, not page-based)', async () => {
      // Strava returns DESC (newest first). We walk backwards via `before`.
      const page1 = [
        { id: 2, type: 'Run', start_date: '2025-04-05T10:00:00Z' }, // newest on page 1
        { id: 1, type: 'Run', start_date: '2025-03-23T10:00:00Z' }, // oldest on page 1
      ];
      const page2 = [
        { id: 3, type: 'Run', start_date: '2025-02-20T10:00:00Z' },
      ];
      mockStravaAPI.getAthleteActivities
        .mockResolvedValueOnce(page1)
        .mockResolvedValueOnce(page2)
        .mockResolvedValueOnce([]);
      mockStravaAPI.getActivity.mockResolvedValue({ id: 1, type: 'Run', best_efforts: [] });
      DatabaseManager.settingsManager.getSetting.mockResolvedValue(null);

      await pbManager.syncFromHistory('discord123', 'token', mockStravaAPI);

      // All calls must use page=1
      for (const call of mockStravaAPI.getAthleteActivities.mock.calls) {
        expect(call[1]).toBe(1);   // page
      }
      // Every call (including the first) must have a `before` so Strava returns DESC.
      // The first `before` is ≈ now; subsequent calls advance strictly backwards.
      const firstBefore = mockStravaAPI.getAthleteActivities.mock.calls[0][3];
      const secondBefore = mockStravaAPI.getAthleteActivities.mock.calls[1][3];
      expect(firstBefore).toEqual(expect.any(Number));
      expect(secondBefore).toBeLessThan(firstBefore);
    });

    it('should advance before cursor to (oldest activity timestamp - 1) on each page', async () => {
      // Strava returns DESC (newest first), so the LAST element is the oldest.
      const oldestTs = Math.floor(new Date('2026-01-05T10:00:00Z').getTime() / 1000);
      const page1 = [
        { id: 1, type: 'Run', start_date: '2026-01-10T10:00:00Z' }, // newest
        { id: 2, type: 'Run', start_date: '2026-01-05T10:00:00Z' }, // oldest
      ];
      mockStravaAPI.getAthleteActivities
        .mockResolvedValueOnce(page1)
        .mockResolvedValueOnce([]);
      mockStravaAPI.getActivity.mockResolvedValue({ id: 1, type: 'Run', best_efforts: [] });
      DatabaseManager.settingsManager.getSetting.mockResolvedValue(null);

      await pbManager.syncFromHistory('discord123', 'token', mockStravaAPI);

      // Second call uses before = oldestTs - 1 to step strictly past the oldest activity.
      const secondCall = mockStravaAPI.getAthleteActivities.mock.calls[1];
      expect(secondCall[3]).toBe(oldestTs - 1); // before
    });

    it('should call getActivity for each Run in the list', async () => {
      const activities = [
        { id: 10, type: 'Run' },
        { id: 11, type: 'Ride' }, // Should be skipped
        { id: 12, type: 'Run' },
      ];
      mockStravaAPI.getAthleteActivities
        .mockResolvedValueOnce(activities)
        .mockResolvedValueOnce([]);
      mockStravaAPI.getActivity.mockResolvedValue({ id: 10, type: 'Run', best_efforts: [] });

      await pbManager.syncFromHistory('discord123', 'token', mockStravaAPI);

      expect(mockStravaAPI.getActivity).toHaveBeenCalledTimes(2);
      expect(mockStravaAPI.getActivity).toHaveBeenCalledWith(10, 'token');
      expect(mockStravaAPI.getActivity).toHaveBeenCalledWith(12, 'token');
    });

    it('should return correct summary { processed, updated, errors }', async () => {
      const activities = [{ id: 10, type: 'Run' }];
      const detailedActivity = {
        id: 10,
        name: 'Easy Run',
        type: 'Run',
        start_date: '2026-03-18T07:00:00Z',
        best_efforts: [{ name: '5K', distance: 5000, elapsed_time: 1200, moving_time: 1200 }],
      };
      mockStravaAPI.getAthleteActivities
        .mockResolvedValueOnce(activities)
        .mockResolvedValueOnce([]);
      mockStravaAPI.getActivity.mockResolvedValue(detailedActivity);
      DatabaseManager.getPersonalBest.mockResolvedValue(null);
      DatabaseManager.upsertPersonalBest.mockResolvedValue({ id: 1 });

      const result = await pbManager.syncFromHistory('discord123', 'token', mockStravaAPI);

      expect(result.processed).toBe(1);
      expect(result.updated).toBe(1);
      expect(result.errors).toBe(0);
    });

    it('should handle per-activity API errors without crashing full sync', async () => {
      const activities = [{ id: 10, type: 'Run' }, { id: 11, type: 'Run' }];
      mockStravaAPI.getAthleteActivities
        .mockResolvedValueOnce(activities)
        .mockResolvedValueOnce([]);
      mockStravaAPI.getActivity
        .mockRejectedValueOnce(new Error('API error'))
        .mockResolvedValueOnce({ id: 11, type: 'Run', best_efforts: [] });

      const result = await pbManager.syncFromHistory('discord123', 'token', mockStravaAPI);

      expect(result.errors).toBe(1);
      expect(result.processed).toBe(1);
    });

    it('should return [] if member not found', async () => {
      DatabaseManager.getMemberByDiscordId.mockResolvedValue(null);

      const result = await pbManager.syncFromHistory('unknown', 'token', mockStravaAPI);

      expect(result).toEqual({ processed: 0, updated: 0, errors: 0 });
      expect(mockStravaAPI.getAthleteActivities).not.toHaveBeenCalled();
    });

    it('should call progressCallback every 5 pages', async () => {
      // Create 5 pages of data (one activity each), then empty.
      // start_date must decrease across pages — the cursor walks backwards.
      for (let i = 1; i <= 5; i++) {
        mockStravaAPI.getAthleteActivities.mockResolvedValueOnce([{
          id: i,
          type: 'Run',
          start_date: `2025-01-${10 + i}T10:00:00Z`,
        }]);
      }
      mockStravaAPI.getAthleteActivities.mockResolvedValueOnce([]);
      mockStravaAPI.getActivity.mockResolvedValue({ id: 1, type: 'Run', best_efforts: [] });

      const progressCb = jest.fn();
      await pbManager.syncFromHistory('discord123', 'token', mockStravaAPI, progressCb);

      expect(progressCb).toHaveBeenCalledWith(5);
    });

    it('should call upsertActivity for each fetched Run activity detail', async () => {
      const activities = [
        { id: 10, type: 'Run' },
        { id: 11, type: 'Run' },
      ];
      const detail = { id: 10, type: 'Run', best_efforts: [] };
      mockStravaAPI.getAthleteActivities
        .mockResolvedValueOnce(activities)
        .mockResolvedValueOnce([]);
      mockStravaAPI.getActivity.mockResolvedValue(detail);

      await pbManager.syncFromHistory('discord123', 'token', mockStravaAPI);

      expect(DatabaseManager.upsertActivity).toHaveBeenCalledTimes(2);
      expect(DatabaseManager.upsertActivity).toHaveBeenCalledWith(
        mockMember.athleteId,
        expect.objectContaining({ id: detail.id, type: detail.type, best_efforts: detail.best_efforts })
      );
    });

    it('should continue processing if upsertActivity throws', async () => {
      const activities = [{ id: 10, type: 'Run' }, { id: 11, type: 'Run' }];
      const detail = { id: 10, type: 'Run', best_efforts: [] };
      mockStravaAPI.getAthleteActivities
        .mockResolvedValueOnce(activities)
        .mockResolvedValueOnce([]);
      mockStravaAPI.getActivity.mockResolvedValue(detail);
      DatabaseManager.upsertActivity
        .mockRejectedValueOnce(new Error('DB write error'))
        .mockResolvedValue(undefined);

      const result = await pbManager.syncFromHistory('discord123', 'token', mockStravaAPI);

      // Both activities still processed; upsertActivity error is non-blocking
      expect(result.processed).toBe(2);
      expect(result.errors).toBe(0);
    });

    it('should log sync start with discordUserId and athleteId', async () => {
      mockStravaAPI.getAthleteActivities.mockResolvedValue([]);

      await pbManager.syncFromHistory('discord123', 'token', mockStravaAPI);

      expect(require('../../src/utils/Logger').database.info).toHaveBeenCalledWith(
        'PB sync started',
        expect.objectContaining({ discordUserId: 'discord123', athleteId: 12345 })
      );
    });

    it('should log sync complete with totals and durationMs', async () => {
      mockStravaAPI.getAthleteActivities.mockResolvedValue([]);

      await pbManager.syncFromHistory('discord123', 'token', mockStravaAPI);

      expect(require('../../src/utils/Logger').database.info).toHaveBeenCalledWith(
        'PB sync complete',
        expect.objectContaining({
          discordUserId: 'discord123',
          processed: 0,
          updated: 0,
          errors: 0,
          durationMs: expect.any(Number),
        })
      );
    });

    it('should log page fetch info including run count', async () => {
      const activities = [
        { id: 1, type: 'Run', start_date: '2026-01-10T10:00:00Z', name: 'Run 1' },
        { id: 2, type: 'Ride', start_date: '2026-01-09T10:00:00Z', name: 'Ride 1' },
      ];
      mockStravaAPI.getAthleteActivities
        .mockResolvedValueOnce(activities)
        .mockResolvedValueOnce([]);
      mockStravaAPI.getActivity.mockResolvedValue({ id: 1, type: 'Run', best_efforts: [] });

      await pbManager.syncFromHistory('discord123', 'token', mockStravaAPI);

      expect(require('../../src/utils/Logger').database.info).toHaveBeenCalledWith(
        'PB sync page fetched',
        expect.objectContaining({ page: 1, total: 2, runs: 1 })
      );
    });

    it('should log each Run activity being processed', async () => {
      const activities = [{ id: 10, type: 'Run', name: 'Easy Run', start_date: '2026-01-10T10:00:00Z' }];
      mockStravaAPI.getAthleteActivities
        .mockResolvedValueOnce(activities)
        .mockResolvedValueOnce([]);
      mockStravaAPI.getActivity.mockResolvedValue({ id: 10, type: 'Run', best_efforts: [] });

      await pbManager.syncFromHistory('discord123', 'token', mockStravaAPI);

      expect(require('../../src/utils/Logger').database.info).toHaveBeenCalledWith(
        'PB sync processing activity',
        expect.objectContaining({ discordUserId: 'discord123', activityId: 10 })
      );
    });

    it('should log no-best-efforts when activity detail has empty best_efforts', async () => {
      const activities = [{ id: 10, type: 'Run', start_date: '2026-01-10T10:00:00Z' }];
      mockStravaAPI.getAthleteActivities
        .mockResolvedValueOnce(activities)
        .mockResolvedValueOnce([]);
      mockStravaAPI.getActivity.mockResolvedValue({ id: 10, type: 'Run', best_efforts: [] });

      await pbManager.syncFromHistory('discord123', 'token', mockStravaAPI);

      expect(require('../../src/utils/Logger').database.info).toHaveBeenCalledWith(
        'PB sync activity has no best efforts',
        expect.objectContaining({ discordUserId: 'discord123', activityId: 10 })
      );
    });

    it('should log checkpoint saved with page and ISO timestamp', async () => {
      const activities = [{ id: 1, type: 'Run', start_date: '2026-01-05T10:00:00Z' }];
      mockStravaAPI.getAthleteActivities
        .mockResolvedValueOnce(activities)
        .mockResolvedValueOnce([]);
      mockStravaAPI.getActivity.mockResolvedValue({ id: 1, type: 'Run', best_efforts: [] });

      await pbManager.syncFromHistory('discord123', 'token', mockStravaAPI);

      expect(require('../../src/utils/Logger').database.info).toHaveBeenCalledWith(
        'PB sync checkpoint saved',
        expect.objectContaining({ discordUserId: 'discord123', page: 1, checkpoint: expect.any(String) })
      );
    });

    it('should pass pr_categories as JSON array to upsertActivity when activity has pr_rank=1 efforts', async () => {
      const detailWithPR = {
        id: 10,
        name: 'Race Day',
        type: 'Run',
        start_date: '2026-03-01T07:00:00Z',
        best_efforts: [
          { name: '5K', distance: 5000, elapsed_time: 1037, moving_time: 1037, pr_rank: 1 },
          { name: '10K', distance: 10000, elapsed_time: 2229, moving_time: 2229, pr_rank: 1 },
          { name: '1 mile', distance: 1609, elapsed_time: 310, moving_time: 310, pr_rank: 2 },
        ],
      };
      mockStravaAPI.getAthleteActivities
        .mockResolvedValueOnce([{ id: 10, type: 'Run' }])
        .mockResolvedValueOnce([]);
      mockStravaAPI.getActivity.mockResolvedValue(detailWithPR);
      DatabaseManager.getPersonalBest.mockResolvedValue(null);
      DatabaseManager.upsertPersonalBest.mockResolvedValue({ id: 1 });

      await pbManager.syncFromHistory('discord123', 'token', mockStravaAPI);

      expect(DatabaseManager.upsertActivity).toHaveBeenCalledWith(
        mockMember.athleteId,
        expect.objectContaining({
          pr_categories: expect.stringContaining('5K'),
        })
      );
      const saved = DatabaseManager.upsertActivity.mock.calls[0][1];
      const cats = JSON.parse(saved.pr_categories);
      expect(cats).toContain('5K');
      expect(cats).toContain('10K');
      expect(cats).not.toContain('1 mile'); // pr_rank=2, not a PR
    });

    it('should pass pr_categories as null to upsertActivity when no pr_rank=1 efforts', async () => {
      const detailNoPR = {
        id: 11,
        name: 'Easy Run',
        type: 'Run',
        start_date: '2026-03-10T07:00:00Z',
        best_efforts: [
          { name: '5K', distance: 5000, elapsed_time: 1200, moving_time: 1200, pr_rank: 3 },
        ],
      };
      mockStravaAPI.getAthleteActivities
        .mockResolvedValueOnce([{ id: 11, type: 'Run' }])
        .mockResolvedValueOnce([]);
      mockStravaAPI.getActivity.mockResolvedValue(detailNoPR);

      await pbManager.syncFromHistory('discord123', 'token', mockStravaAPI);

      expect(DatabaseManager.upsertActivity).toHaveBeenCalledWith(
        mockMember.athleteId,
        expect.objectContaining({ pr_categories: null })
      );
    });

    it('should pass pr_categories as null when best_efforts is empty', async () => {
      mockStravaAPI.getAthleteActivities
        .mockResolvedValueOnce([{ id: 12, type: 'Run' }])
        .mockResolvedValueOnce([]);
      mockStravaAPI.getActivity.mockResolvedValue({ id: 12, type: 'Run', best_efforts: [] });

      await pbManager.syncFromHistory('discord123', 'token', mockStravaAPI);

      expect(DatabaseManager.upsertActivity).toHaveBeenCalledWith(
        mockMember.athleteId,
        expect.objectContaining({ pr_categories: null })
      );
    });

    it('should use explicit afterTs when provided (last 365 days)', async () => {
      mockStravaAPI.getAthleteActivities.mockResolvedValue([]);
      DatabaseManager.settingsManager.getSetting.mockResolvedValue(null);

      const afterTs = Math.floor((Date.now() - 365 * 24 * 60 * 60 * 1000) / 1000);
      await pbManager.syncFromHistory('discord123', 'token', mockStravaAPI, undefined, afterTs);

      // Called with page=1, before=≈now, after=afterTs (DESC mode requires `before`)
      expect(mockStravaAPI.getAthleteActivities).toHaveBeenCalledWith('token', 1, 100, expect.any(Number), afterTs);
    });

    it('should derive a stable cursor key from afterTs rounded to the day', async () => {
      mockStravaAPI.getAthleteActivities
        .mockResolvedValueOnce([{ id: 1, type: 'Run', start_date: '2025-03-19T10:00:00Z' }])
        .mockResolvedValueOnce([]);
      mockStravaAPI.getActivity.mockResolvedValue({ id: 1, type: 'Run', best_efforts: [] });
      DatabaseManager.settingsManager.getSetting.mockResolvedValue(null);

      const afterTs = 1700000000;
      const expectedDayKey = Math.floor(afterTs / 86400);
      await pbManager.syncFromHistory('discord123', 'token', mockStravaAPI, undefined, afterTs);

      expect(DatabaseManager.settingsManager.setSetting).toHaveBeenCalledWith(
        `pb_sync_cursor_discord123_${expectedDayKey}`,
        expect.any(String),
        expect.any(String)
      );
    });

    it('should produce the same cursor key for two invocations seconds apart (resume works)', async () => {
      // Two distinct afterTs values within the same day should hash to the same cursor key.
      const baseSec = Math.floor(new Date('2025-06-01T00:00:00Z').getTime() / 1000);
      const a = baseSec;
      const b = baseSec + 30; // 30 seconds later, same day
      expect(Math.floor(a / 86400)).toBe(Math.floor(b / 86400));
    });

    it('should use separate cursor keys for current_year vs last_365_days syncs', async () => {
      const now = new Date();
      const jan1Ts = Math.floor(new Date(now.getFullYear(), 0, 1).getTime() / 1000);
      const last365Ts = Math.floor((Date.now() - 365 * 24 * 60 * 60 * 1000) / 1000);

      expect(jan1Ts).not.toBe(last365Ts);
      const jan1Day = Math.floor(jan1Ts / 86400);
      const last365Day = Math.floor(last365Ts / 86400);

      // Two distinct periods land on different day-keys → distinct cursors.
      expect(`pb_sync_cursor_discord123_${jan1Day}`).not.toBe(`pb_sync_cursor_discord123_${last365Day}`);
    });

    it('should continue sync if getSetting throws', async () => {
      DatabaseManager.settingsManager.getSetting.mockRejectedValue(new Error('settings fail'));
      mockStravaAPI.getAthleteActivities.mockResolvedValue([]);

      const result = await pbManager.syncFromHistory('discord123', 'token', mockStravaAPI);

      expect(result).toMatchObject({ processed: expect.any(Number), updated: expect.any(Number), errors: expect.any(Number) });
    });

    it('should continue sync if setSetting throws', async () => {
      DatabaseManager.settingsManager.getSetting.mockResolvedValue(null);
      DatabaseManager.settingsManager.setSetting.mockRejectedValue(new Error('write fail'));
      mockStravaAPI.getAthleteActivities
        .mockResolvedValueOnce([{ id: 1, type: 'Run', start_date: '2026-03-01T10:00:00Z', name: 'Run 1' }])
        .mockResolvedValueOnce([]);
      mockStravaAPI.getActivity.mockResolvedValue({ id: 1, type: 'Run', best_efforts: [] });

      const result = await pbManager.syncFromHistory('discord123', 'token', mockStravaAPI);

      expect(result).toMatchObject({ processed: expect.any(Number), updated: expect.any(Number), errors: expect.any(Number) });
    });

    it('first call should pass `before` set to (≈ now) so Strava returns DESC, not ASC', async () => {
      // Regression: previously the first call passed before=null. Strava's
      // /athlete/activities switches to ASC when only `after` is set, breaking
      // the algorithm that assumes the last array element is the oldest.
      mockStravaAPI.getAthleteActivities.mockResolvedValue([]);
      DatabaseManager.settingsManager.getSetting.mockResolvedValue(null);

      await pbManager.syncFromHistory('discord123', 'token', mockStravaAPI);

      const firstBefore = mockStravaAPI.getAthleteActivities.mock.calls[0][3];
      const nowSec = Math.floor(Date.now() / 1000);
      expect(firstBefore).toEqual(expect.any(Number));
      expect(Math.abs(firstBefore - nowSec)).toBeLessThan(60);
    });

    it('should compute oldest from min(start_date), so ASC-ordered Strava response still advances cursor correctly', async () => {
      // Regression: previously took activities[activities.length-1] as the
      // oldest. That breaks if Strava returns ASC (oldest first), making the
      // cursor jump to the newest activity and re-fetch the same window twice.
      const ascending = [
        { id: 1, type: 'Run', start_date: '2026-01-05T10:00:00Z' }, // oldest
        { id: 2, type: 'Run', start_date: '2026-01-08T10:00:00Z' },
        { id: 3, type: 'Run', start_date: '2026-01-10T10:00:00Z' }, // newest (last in array)
      ];
      mockStravaAPI.getAthleteActivities
        .mockResolvedValueOnce(ascending)
        .mockResolvedValueOnce([]);
      mockStravaAPI.getActivity.mockResolvedValue({ id: 1, type: 'Run', best_efforts: [] });
      DatabaseManager.settingsManager.getSetting.mockResolvedValue(null);

      await pbManager.syncFromHistory('discord123', 'token', mockStravaAPI);

      const minTs = Math.floor(new Date('2026-01-05T10:00:00Z').getTime() / 1000);
      // Cursor for the NEXT call must be based on the minimum across the page,
      // not on activities[length-1] (which would be the newest in ASC mode).
      const secondBefore = mockStravaAPI.getAthleteActivities.mock.calls[1][3];
      expect(secondBefore).toBe(minTs - 1);
    });

    it('should continue if deleteSetting throws on completion', async () => {
      DatabaseManager.settingsManager.getSetting.mockResolvedValue(null);
      DatabaseManager.settingsManager.deleteSetting.mockRejectedValue(new Error('delete fail'));
      mockStravaAPI.getAthleteActivities.mockResolvedValue([]);

      const result = await pbManager.syncFromHistory('discord123', 'token', mockStravaAPI);

      expect(result).toMatchObject({ processed: expect.any(Number), updated: expect.any(Number), errors: expect.any(Number) });
    });
  });

  // ─── formatPBsForEmbed ────────────────────────────────────────────────────

  describe('formatPBsForEmbed', () => {
    it('should return empty array when no PBs', () => {
      const fields = pbManager.formatPBsForEmbed([], 'John');
      expect(fields).toEqual([]);
    });

    it('should return embed fields with trophy emoji and formatted time', () => {
      const mockPBs = [
        { category: '5K', elapsed_time: 1200, distance_m: 5000 },
        { category: '10K', elapsed_time: 2500, distance_m: 10000 },
      ];
      const fields = pbManager.formatPBsForEmbed(mockPBs, 'John');
      expect(fields.length).toBeGreaterThan(0);
      const fieldText = fields.map(f => f.value).join('\n');
      expect(fieldText).toContain('5K');
      expect(fieldText).toContain('10K');
    });

    it('should include pace per category', () => {
      const mockPBs = [{ category: '5K', elapsed_time: 1200, distance_m: 5000 }];
      const fields = pbManager.formatPBsForEmbed(mockPBs, 'John');
      const fieldText = fields.map(f => f.value).join('\n');
      expect(fieldText).toContain('/km');
    });

    it('should include Strava activity link with arrow label when strava_activity_id is present', () => {
      const mockPBs = [{
        category: '5K', elapsed_time: 1200, distance_m: 5000,
        strava_activity_id: '123456789', activity_name: 'City 5K Race',
      }];
      const fields = pbManager.formatPBsForEmbed(mockPBs, 'John');
      const fieldText = fields.map(f => f.value).join('\n');
      expect(fieldText).toContain('https://www.strava.com/activities/123456789');
      expect(fieldText).toContain('[↗]');
    });

    it('should use arrow label when activity_name is missing', () => {
      const mockPBs = [{
        category: '5K', elapsed_time: 1200, distance_m: 5000,
        strava_activity_id: '123456789', activity_name: null,
      }];
      const fields = pbManager.formatPBsForEmbed(mockPBs, 'John');
      const fieldText = fields.map(f => f.value).join('\n');
      expect(fieldText).toContain('https://www.strava.com/activities/123456789');
      expect(fieldText).toContain('[↗]');
    });

    it('should not include a link when strava_activity_id is absent', () => {
      const mockPBs = [{ category: '5K', elapsed_time: 1200, distance_m: 5000 }];
      const fields = pbManager.formatPBsForEmbed(mockPBs, 'John');
      const fieldText = fields.map(f => f.value).join('\n');
      expect(fieldText).not.toContain('strava.com');
    });

    it('should not include a link when strava_activity_id is the corrupted string "undefined"', () => {
      const mockPBs = [{
        category: '5K', elapsed_time: 1200, distance_m: 5000,
        strava_activity_id: 'undefined', activity_name: null,
      }];
      const fields = pbManager.formatPBsForEmbed(mockPBs, 'John');
      const fieldText = fields.map(f => f.value).join('\n');
      expect(fieldText).not.toContain('strava.com');
    });

    it('should split into multiple fields when value would exceed 1024 chars', () => {
      // Create 20 PBs each with a long-ish line to exceed 1024 chars in one field
      const mockPBs = Array.from({ length: 20 }, (_, i) => ({
        category: `Cat${i}`,
        elapsed_time: 1200 + i,
        distance_m: 5000 + i * 100,
        strava_activity_id: `10000000000${i}`,
      }));
      const fields = pbManager.formatPBsForEmbed(mockPBs, 'John');
      expect(fields.length).toBeGreaterThan(1);
      for (const field of fields) {
        expect(field.value.length).toBeLessThanOrEqual(1024);
      }
    });
  });

  // ─── formatTimeImprovement ───────────────────────────────────────────────

  describe('formatTimeImprovement', () => {
    it('should return correct improvement for seconds only', () => {
      expect(pbManager.formatTimeImprovement(65, 60)).toBe('-0:05');
    });

    it('should return correct improvement for minutes and seconds', () => {
      expect(pbManager.formatTimeImprovement(1500, 1417)).toBe('-1:23');
    });

    it('should return correct improvement spanning many minutes', () => {
      expect(pbManager.formatTimeImprovement(3700, 100)).toBe('-60:00');
    });

    it('should handle zero improvement (same time)', () => {
      expect(pbManager.formatTimeImprovement(1200, 1200)).toBe('-0:00');
    });

    it('should handle large improvements correctly', () => {
      const result = pbManager.formatTimeImprovement(7200, 3600);
      expect(result).toBe('-60:00');
    });
  });
});
