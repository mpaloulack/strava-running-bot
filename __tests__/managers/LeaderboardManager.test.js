const LeaderboardManager = require('../../src/managers/LeaderboardManager');

jest.mock('../../src/database/DatabaseManager', () => ({
  getMonthlyRunTotals: jest.fn(),
}));

jest.mock('../../src/utils/Logger', () => ({
  database: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
  scheduler: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
}));

const databaseManager = require('../../src/database/DatabaseManager');

describe('LeaderboardManager', () => {
  let manager;
  let memberManager;

  beforeEach(() => {
    jest.clearAllMocks();
    manager = new LeaderboardManager();
    memberManager = {
      getMemberByAthleteId: jest.fn(),
    };
  });

  describe('getPreviousMonth', () => {
    it('returns the previous month in 1-12 form within the same year', () => {
      // now = March 15, 2026 (UTC month index 2)
      const now = new Date(Date.UTC(2026, 2, 15));
      expect(LeaderboardManager.getPreviousMonth(now)).toEqual({ year: 2026, month: 2 });
    });

    it('rolls back to December of the previous year when now is January', () => {
      const now = new Date(Date.UTC(2026, 0, 5));
      expect(LeaderboardManager.getPreviousMonth(now)).toEqual({ year: 2025, month: 12 });
    });

    it('handles December correctly (returns November of same year)', () => {
      const now = new Date(Date.UTC(2026, 11, 31));
      expect(LeaderboardManager.getPreviousMonth(now)).toEqual({ year: 2026, month: 11 });
    });

    it('defaults to the current process time when no argument is given', () => {
      const result = LeaderboardManager.getPreviousMonth();
      expect(typeof result.year).toBe('number');
      expect(result.month).toBeGreaterThanOrEqual(1);
      expect(result.month).toBeLessThanOrEqual(12);
    });
  });

  describe('getCurrentMonth', () => {
    it('returns current month in 1-12 form', () => {
      const now = new Date(Date.UTC(2026, 4, 18));
      expect(LeaderboardManager.getCurrentMonth(now)).toEqual({ year: 2026, month: 5 });
    });

    it('defaults to the current process time when no argument is given', () => {
      const result = LeaderboardManager.getCurrentMonth();
      expect(typeof result.year).toBe('number');
      expect(result.month).toBeGreaterThanOrEqual(1);
      expect(result.month).toBeLessThanOrEqual(12);
    });
  });

  describe('getMonthlyLeaderboard', () => {
    it('queries the right date window (UTC month boundaries) and run types', async () => {
      databaseManager.getMonthlyRunTotals.mockResolvedValue([]);

      await manager.getMonthlyLeaderboard({ year: 2026, month: 3, memberManager });

      expect(databaseManager.getMonthlyRunTotals).toHaveBeenCalledTimes(1);
      const [startDate, endDate, runTypes] = databaseManager.getMonthlyRunTotals.mock.calls[0];
      expect(startDate).toBe('2026-03-01T00:00:00.000Z');
      expect(endDate).toBe('2026-04-01T00:00:00.000Z');
      expect(runTypes).toEqual(expect.arrayContaining(['Run', 'TrailRun', 'VirtualRun']));
    });

    it('rolls year boundary into next-January end date when month is December', async () => {
      databaseManager.getMonthlyRunTotals.mockResolvedValue([]);

      await manager.getMonthlyLeaderboard({ year: 2026, month: 12, memberManager });

      const [startDate, endDate] = databaseManager.getMonthlyRunTotals.mock.calls[0];
      expect(startDate).toBe('2026-12-01T00:00:00.000Z');
      expect(endDate).toBe('2027-01-01T00:00:00.000Z');
    });

    it('attaches member display names to each entry', async () => {
      databaseManager.getMonthlyRunTotals.mockResolvedValue([
        { athleteId: 111, totalDistanceM: 50000, activityCount: 5 },
        { athleteId: 222, totalDistanceM: 30000, activityCount: 3 },
      ]);
      memberManager.getMemberByAthleteId
        .mockResolvedValueOnce({ discordUser: { displayName: 'Alice' }, athlete: { firstname: 'A', lastname: 'X' } })
        .mockResolvedValueOnce({ athlete: { firstname: 'Bob', lastname: 'Y' } });

      const result = await manager.getMonthlyLeaderboard({ year: 2026, month: 3, memberManager });

      expect(result.entries).toEqual([
        { athleteId: 111, totalDistanceM: 50000, activityCount: 5, memberName: 'Alice' },
        { athleteId: 222, totalDistanceM: 30000, activityCount: 3, memberName: 'Bob Y' },
      ]);
      expect(result.year).toBe(2026);
      expect(result.month).toBe(3);
    });

    it('falls back to "Unknown" when member lookup returns null', async () => {
      databaseManager.getMonthlyRunTotals.mockResolvedValue([
        { athleteId: 999, totalDistanceM: 12000, activityCount: 1 },
      ]);
      memberManager.getMemberByAthleteId.mockResolvedValueOnce(null);

      const result = await manager.getMonthlyLeaderboard({ year: 2026, month: 3, memberManager });

      expect(result.entries[0].memberName).toBe('Unknown');
    });

    it('logs and rethrows when the database query fails', async () => {
      const dbError = new Error('connection lost');
      databaseManager.getMonthlyRunTotals.mockRejectedValue(dbError);
      const logger = require('../../src/utils/Logger');

      await expect(
        manager.getMonthlyLeaderboard({ year: 2026, month: 3, memberManager })
      ).rejects.toThrow('connection lost');

      expect(logger.database.error).toHaveBeenCalledWith(
        'Failed to query monthly leaderboard totals',
        expect.objectContaining({ year: 2026, month: 3, error: 'connection lost' })
      );
    });

    it('returns empty entries array when no rows match', async () => {
      databaseManager.getMonthlyRunTotals.mockResolvedValue([]);

      const result = await manager.getMonthlyLeaderboard({ year: 2026, month: 3, memberManager });

      expect(result.entries).toEqual([]);
    });

    it('coerces numeric strings from SQLite SUM/COUNT to numbers', async () => {
      databaseManager.getMonthlyRunTotals.mockResolvedValue([
        { athleteId: 111, totalDistanceM: '50000.5', activityCount: '5' },
      ]);
      memberManager.getMemberByAthleteId.mockResolvedValueOnce({
        discordUser: { displayName: 'Alice' },
      });

      const result = await manager.getMonthlyLeaderboard({ year: 2026, month: 3, memberManager });

      expect(typeof result.entries[0].totalDistanceM).toBe('number');
      expect(result.entries[0].totalDistanceM).toBe(50000.5);
      expect(typeof result.entries[0].activityCount).toBe('number');
      expect(result.entries[0].activityCount).toBe(5);
    });
  });
});
