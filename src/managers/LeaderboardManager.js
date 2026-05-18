const databaseManager = require('../database/DatabaseManager');
const logger = require('../utils/Logger');
const { LEADERBOARD_RUN_TYPES } = require('../constants');

class LeaderboardManager {
  constructor() {
    this.databaseManager = databaseManager;
  }

  // 1-12 month of the calendar month preceding `now`, with year rollover.
  // Used by the cron job — on Jan 1 we want December of the previous year.
  static getPreviousMonth(now = new Date()) {
    const m0 = now.getUTCMonth();
    const y = now.getUTCFullYear();
    if (m0 === 0) return { year: y - 1, month: 12 };
    return { year: y, month: m0 };
  }

  static getCurrentMonth(now = new Date()) {
    return { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 };
  }

  // Returns { year, month, startDate, endDate, entries: [...] }
  // where each entry is { athleteId, totalDistanceM, activityCount, memberName },
  // sorted DESC by totalDistanceM (the DB query orders for us).
  async getMonthlyLeaderboard({ year, month, memberManager }) {
    const start = new Date(Date.UTC(year, month - 1, 1));
    const end = new Date(Date.UTC(year, month, 1));
    const startDate = start.toISOString();
    const endDate = end.toISOString();

    let rows;
    try {
      rows = await this.databaseManager.getMonthlyRunTotals(startDate, endDate, LEADERBOARD_RUN_TYPES);
    } catch (error) {
      logger.database.error('Failed to query monthly leaderboard totals', {
        year, month, error: error.message,
      });
      throw error;
    }

    const entries = await Promise.all(rows.map(async (row) => {
      const member = await memberManager.getMemberByAthleteId(row.athleteId);
      const memberName = member?.discordUser?.displayName
        || (member?.athlete ? `${member.athlete.firstname} ${member.athlete.lastname}`.trim() : null)
        || 'Unknown';
      return {
        athleteId: row.athleteId,
        totalDistanceM: Number(row.totalDistanceM),
        activityCount: Number(row.activityCount),
        memberName,
      };
    }));

    return { year, month, startDate, endDate, entries };
  }
}

module.exports = LeaderboardManager;
