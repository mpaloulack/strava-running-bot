// EmbedBuilder.js requires the config module which calls process.exit when env
// vars are missing. Mock it so the test runs cleanly in CI.
jest.mock('../../config/config', () => ({
  server: { baseUrl: 'https://test.example.com' },
}));

const ActivityEmbedBuilder = require('../../src/utils/EmbedBuilder');

describe('ActivityEmbedBuilder.buildMonthlyLeaderboardEmbed', () => {
  it('builds an embed with rows sorted as provided', () => {
    const embed = ActivityEmbedBuilder.buildMonthlyLeaderboardEmbed({
      year: 2026,
      month: 3,
      entries: [
        { athleteId: 1, memberName: 'Alice', totalDistanceM: 156320, activityCount: 12 },
        { athleteId: 2, memberName: 'Bob', totalDistanceM: 142100, activityCount: 10 },
        { athleteId: 3, memberName: 'Carol', totalDistanceM: 89450, activityCount: 8 },
      ],
    });

    const json = embed.toJSON();
    expect(json.title).toMatch(/Monthly Running Leaderboard/i);
    expect(json.description).toContain('March 2026');

    // The leaderboard rows are rendered as fields or in description — assert
    // that all three names and their kilometre totals appear somewhere.
    const all = JSON.stringify(json);
    expect(all).toContain('Alice');
    expect(all).toContain('Bob');
    expect(all).toContain('Carol');
    expect(all).toContain('156.32');
    expect(all).toContain('142.10');
    expect(all).toContain('89.45');
  });

  it('uses 🥇🥈🥉 for the top three positions', () => {
    const embed = ActivityEmbedBuilder.buildMonthlyLeaderboardEmbed({
      year: 2026,
      month: 3,
      entries: [
        { athleteId: 1, memberName: 'A', totalDistanceM: 30000, activityCount: 3 },
        { athleteId: 2, memberName: 'B', totalDistanceM: 20000, activityCount: 2 },
        { athleteId: 3, memberName: 'C', totalDistanceM: 10000, activityCount: 1 },
      ],
    });
    const all = JSON.stringify(embed.toJSON());
    expect(all).toContain('🥇');
    expect(all).toContain('🥈');
    expect(all).toContain('🥉');
  });

  it('renders an empty-state message when there are no entries', () => {
    const embed = ActivityEmbedBuilder.buildMonthlyLeaderboardEmbed({
      year: 2026,
      month: 3,
      entries: [],
    });
    const json = embed.toJSON();
    const all = JSON.stringify(json);
    expect(all).toMatch(/no .* (run|activit)/i);
  });

  it('formats the month name for December correctly', () => {
    const embed = ActivityEmbedBuilder.buildMonthlyLeaderboardEmbed({
      year: 2025,
      month: 12,
      entries: [],
    });
    expect(embed.toJSON().description).toContain('December 2025');
  });
});
