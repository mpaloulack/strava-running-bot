// Focused test for the /leaderboard slash command handler.
// We mock the heavy collaborators so this stays a pure unit test.
jest.mock('../../src/utils/EmbedBuilder', () => ({
  buildMonthlyLeaderboardEmbed: jest.fn(() => ({ __mockEmbed: true })),
}));

jest.mock('../../src/managers/LeaderboardManager', () => {
  const MockLeaderboardManager = jest.fn().mockImplementation(() => ({
    getMonthlyLeaderboard: jest.fn(),
  }));
  MockLeaderboardManager.getPreviousMonth = jest.fn(() => ({ year: 2026, month: 4 }));
  MockLeaderboardManager.getCurrentMonth = jest.fn(() => ({ year: 2026, month: 5 }));
  return MockLeaderboardManager;
});

jest.mock('../../src/managers/PBManager', () => jest.fn().mockImplementation(() => ({})));
jest.mock('../../src/managers/RaceManager', () => jest.fn().mockImplementation(() => ({})));

jest.mock('../../src/utils/Logger', () => ({
  discord: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
}));

jest.mock('../../config/config', () => ({
  server: { baseUrl: 'https://test.example.com' },
}));

const DiscordCommands = require('../../src/discord/commands');
const ActivityEmbedBuilder = require('../../src/utils/EmbedBuilder');
const LeaderboardManager = require('../../src/managers/LeaderboardManager');

describe('DiscordCommands - /leaderboard', () => {
  let commands;
  let mockInteraction;
  let mockActivityProcessor;

  beforeEach(() => {
    jest.clearAllMocks();

    mockActivityProcessor = {
      memberManager: { getMemberByAthleteId: jest.fn() },
    };

    commands = new DiscordCommands(mockActivityProcessor);
    commands.leaderboardManager.getMonthlyLeaderboard = jest.fn().mockResolvedValue({
      year: 2026, month: 5, startDate: '', endDate: '',
      entries: [{ athleteId: 1, memberName: 'Alice', totalDistanceM: 50000, activityCount: 5 }],
    });

    mockInteraction = {
      commandName: 'leaderboard',
      options: {
        getString: jest.fn(),
      },
      user: { tag: 'tester#0' },
      deferReply: jest.fn().mockResolvedValue(undefined),
      editReply: jest.fn().mockResolvedValue(undefined),
    };
  });

  test('uses current month when no option is supplied', async () => {
    mockInteraction.options.getString.mockReturnValue(null);

    await commands.handleLeaderboardCommand(mockInteraction, mockInteraction.options);

    expect(mockInteraction.deferReply).toHaveBeenCalled();
    expect(LeaderboardManager.getCurrentMonth).toHaveBeenCalled();
    expect(LeaderboardManager.getPreviousMonth).not.toHaveBeenCalled();
    expect(commands.leaderboardManager.getMonthlyLeaderboard).toHaveBeenCalledWith({
      year: 2026, month: 5, memberManager: mockActivityProcessor.memberManager,
    });
    expect(ActivityEmbedBuilder.buildMonthlyLeaderboardEmbed).toHaveBeenCalled();
    expect(mockInteraction.editReply).toHaveBeenCalledWith({ embeds: [{ __mockEmbed: true }] });
  });

  test('uses previous month when option is "previous"', async () => {
    mockInteraction.options.getString.mockReturnValue('previous');

    await commands.handleLeaderboardCommand(mockInteraction, mockInteraction.options);

    expect(LeaderboardManager.getPreviousMonth).toHaveBeenCalled();
    expect(commands.leaderboardManager.getMonthlyLeaderboard).toHaveBeenCalledWith({
      year: 2026, month: 4, memberManager: mockActivityProcessor.memberManager,
    });
  });

  test('replies with error message when the manager throws', async () => {
    mockInteraction.options.getString.mockReturnValue('current');
    commands.leaderboardManager.getMonthlyLeaderboard.mockRejectedValue(new Error('boom'));

    await commands.handleLeaderboardCommand(mockInteraction, mockInteraction.options);

    expect(mockInteraction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringMatching(/failed/i) })
    );
  });

  test('dispatcher routes "leaderboard" command to the handler', async () => {
    const spy = jest.spyOn(commands, 'handleLeaderboardCommand').mockResolvedValue(undefined);
    mockInteraction.reply = jest.fn();
    await commands.handleCommand(mockInteraction);
    expect(spy).toHaveBeenCalledWith(mockInteraction, mockInteraction.options);
  });
});
