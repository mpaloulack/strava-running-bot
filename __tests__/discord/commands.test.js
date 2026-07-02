const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const DiscordCommands = require('../../src/discord/commands');
const ActivityEmbedBuilder = require('../../src/utils/EmbedBuilder');
const DiscordUtils = require('../../src/utils/DiscordUtils');
const logger = require('../../src/utils/Logger');
const config = require('../../config/config');

// Mock dependencies
jest.mock('discord.js', () => {
  const mockSlashCommandBuilder = jest.fn().mockImplementation(() => {
    const mockCmd = {
      name: '',
      description: '',
      options: [],
      default_member_permissions: null,
      setName: jest.fn().mockImplementation((name) => {
        mockCmd.name = name;
        return mockCmd;
      }),
      setDescription: jest.fn().mockImplementation((desc) => {
        mockCmd.description = desc;
        return mockCmd;
      }),
      addSubcommand: jest.fn().mockImplementation((callback) => {
        const subcommand = {
          name: '',
          options: [],
          setName: jest.fn().mockImplementation((name) => {
            subcommand.name = name;
            return subcommand;
          }),
          setDescription: jest.fn().mockReturnThis(),
          addStringOption: jest.fn().mockImplementation((optionCallback) => {
            const option = {
              setName: jest.fn().mockReturnThis(),
              setDescription: jest.fn().mockReturnThis(),
              setRequired: jest.fn().mockReturnThis(),
              setMaxLength: jest.fn().mockReturnThis(),
              addChoices: jest.fn().mockReturnThis(),
              setAutocomplete: jest.fn().mockReturnThis()
            };
            optionCallback(option);
            subcommand.options.push(option);
            return subcommand;
          }),
          addIntegerOption: jest.fn().mockImplementation((optionCallback) => {
            const option = {
              setName: jest.fn().mockReturnThis(),
              setDescription: jest.fn().mockReturnThis(),
              setRequired: jest.fn().mockReturnThis(),
              setMinValue: jest.fn().mockReturnThis(),
              setMaxValue: jest.fn().mockReturnThis()
            };
            optionCallback(option);
            subcommand.options.push(option);
            return subcommand;
          }),
          addChannelOption: jest.fn().mockImplementation((optionCallback) => {
            const option = {
              setName: jest.fn().mockReturnThis(),
              setDescription: jest.fn().mockReturnThis(),
              setRequired: jest.fn().mockReturnThis()
            };
            optionCallback(option);
            subcommand.options.push(option);
            return subcommand;
          }),
          addUserOption: jest.fn().mockImplementation((optionCallback) => {
            const option = {
              setName: jest.fn().mockReturnThis(),
              setDescription: jest.fn().mockReturnThis(),
              setRequired: jest.fn().mockReturnThis()
            };
            optionCallback(option);
            subcommand.options.push(option);
            return subcommand;
          })
        };
        callback(subcommand);
        mockCmd.options.push(subcommand);
        return mockCmd;
      }),
      addStringOption: jest.fn().mockImplementation((callback) => {
        const option = {
          name: '',
          autocomplete: false,
          required: false,
          choices: [],
          setName: jest.fn().mockImplementation((name) => { option.name = name; return option; }),
          setDescription: jest.fn().mockReturnThis(),
          setRequired: jest.fn().mockImplementation((req) => { option.required = req; return option; }),
          setMaxLength: jest.fn().mockReturnThis(),
          addChoices: jest.fn().mockImplementation((...choices) => { option.choices.push(...choices); return option; }),
          setAutocomplete: jest.fn().mockImplementation((auto) => {
            option.autocomplete = auto;
            return option;
          })
        };
        callback(option);
        mockCmd.options.push(option);
        return mockCmd;
      }),
      addBooleanOption: jest.fn().mockImplementation((callback) => {
        const option = {
          name: '',
          required: false,
          setName: jest.fn().mockImplementation((name) => { option.name = name; return option; }),
          setDescription: jest.fn().mockReturnThis(),
          setRequired: jest.fn().mockImplementation((req) => { option.required = req; return option; })
        };
        callback(option);
        mockCmd.options.push(option);
        return mockCmd;
      }),
      setDefaultMemberPermissions: jest.fn().mockImplementation((perms) => {
        mockCmd.default_member_permissions = String(perms);
        return mockCmd;
      }),
      setAutocomplete: jest.fn().mockImplementation(function() { return this; }),
      toJSON: jest.fn().mockImplementation(() => ({
        name: mockCmd.name,
        description: mockCmd.description,
        options: mockCmd.options
      }))
    };
    // Make it appear as instanceof SlashCommandBuilder
    Object.setPrototypeOf(mockCmd, mockSlashCommandBuilder.prototype);
    return mockCmd;
  });

  return {
    SlashCommandBuilder: mockSlashCommandBuilder,
    EmbedBuilder: jest.fn().mockImplementation(() => ({
    setTitle: jest.fn().mockReturnThis(),
    setColor: jest.fn().mockReturnThis(),
    setDescription: jest.fn().mockReturnThis(),
    addFields: jest.fn().mockReturnThis(),
    setTimestamp: jest.fn().mockReturnThis(),
    setFooter: jest.fn().mockReturnThis()
  })),
    PermissionFlagsBits: {
      ManageGuild: 32n
    }
  };
});
jest.mock('../../src/utils/EmbedBuilder');
jest.mock('../../src/utils/DiscordUtils');
jest.mock('../../src/managers/PBManager', () => jest.fn().mockImplementation(() => ({
  getMemberPBsByDiscordId: jest.fn().mockResolvedValue([]),
  syncFromHistory: jest.fn().mockResolvedValue({ processed: 0, updated: 0, errors: 0 }),
  formatPBsForEmbed: jest.fn().mockReturnValue([]),
  extractBestEfforts: jest.fn().mockReturnValue([]),
  checkAndUpdatePBsFromEfforts: jest.fn().mockResolvedValue([]),
  databaseManager: {
    getPBSyncCursors: jest.fn().mockResolvedValue([]),
    getPBCountByAthleteId: jest.fn().mockResolvedValue(0),
  },
})));
jest.mock('../../src/managers/RaceManager', () => jest.fn().mockImplementation(() => ({
  getMemberRaces: jest.fn().mockResolvedValue([]),
  getUpcomingRaces: jest.fn().mockResolvedValue([]),
  addRace: jest.fn(),
  removeRace: jest.fn(),
  updateRace: jest.fn(),
})));
jest.mock('../../src/utils/Logger', () => ({
  discord: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
  }
}));
jest.mock('../../config/config', () => ({
  server: {
    baseUrl: 'https://test.example.com'
  }
}));

describe('DiscordCommands', () => {
  let discordCommands;
  let mockActivityProcessor;
  let mockMemberManager;
  let mockStravaAPI;
  let mockInteraction;

  const mockMember = {
    discordUserId: '123456789',
    athleteId: 12345,
    discordUser: {
      displayName: 'Test User',
      username: 'testuser'
    },
    athlete: {
      id: 12345,
      firstname: 'John',
      lastname: 'Doe'
    },
    tokens: {
      access_token: 'test_token'
    },
    registeredAt: '2024-01-01T00:00:00Z',
    isActive: true
  };

  const mockActivity = {
    id: 98765,
    name: 'Morning Run',
    type: 'Run',
    distance: 5000,
    moving_time: 1800,
    athlete: mockMember.athlete
  };

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock MemberManager
    mockMemberManager = {
      getAllMembers: jest.fn(),
      getInactiveMembers: jest.fn(),
      getMemberByDiscordId: jest.fn(),
      removeMemberByDiscordId: jest.fn(),
      deactivateMember: jest.fn(),
      reactivateMember: jest.fn(),
      getValidAccessToken: jest.fn(),
      getStats: jest.fn(),
      members: new Map([['12345', mockMember]]),
      discordToStrava: new Map([['123456789', '12345']])
    };

    // Mock StravaAPI
    mockStravaAPI = {
      getAthleteActivities: jest.fn(),
      getActivity: jest.fn(),
      shouldPostActivity: jest.fn(),
      processActivityWithStreams: jest.fn(),
      getRateLimiterStats: jest.fn()
    };

    // Mock ActivityProcessor
    mockActivityProcessor = {
      memberManager: mockMemberManager,
      stravaAPI: mockStravaAPI,
      getStats: jest.fn()
    };

    discordCommands = new DiscordCommands(mockActivityProcessor);

    // Mock Discord interaction
    mockInteraction = {
      commandName: 'test',
      options: {
        getSubcommand: jest.fn(),
        getString: jest.fn(),
        getFocused: jest.fn()
      },
      user: {
        tag: 'TestUser#1234',
        id: '123456789'
      },
      guild: {
        name: 'Test Guild',
        members: {
          cache: new Map([
            ['123456789', { displayName: 'Test User' }]
          ])
        }
      },
      channel: {
        name: 'test-channel'
      },
      reply: jest.fn(),
      editReply: jest.fn(),
      deferReply: jest.fn(),
      followUp: jest.fn(),
      respond: jest.fn(),
      replied: false,
      deferred: false
    };

    // Mock EmbedBuilder
    EmbedBuilder.mockImplementation(() => ({
      setTitle: jest.fn().mockReturnThis(),
      setColor: jest.fn().mockReturnThis(),
      setDescription: jest.fn().mockReturnThis(),
      addFields: jest.fn().mockReturnThis(),
      setTimestamp: jest.fn().mockReturnThis(),
      setFooter: jest.fn().mockReturnThis()
    }));

    ActivityEmbedBuilder.createActivityEmbed.mockReturnValue({ title: 'Test Activity Embed' });
    DiscordUtils.extractUserId.mockReturnValue('123456789');
    DiscordUtils.chunkArray.mockReturnValue([[mockMember]]);
  });

  describe('constructor', () => {
    it('should initialize with activity processor', () => {
      expect(discordCommands.activityProcessor).toBe(mockActivityProcessor);
    });
  });

  describe('getCommands', () => {
    it('should return array of slash commands', () => {
      const commands = discordCommands.getCommands();

      expect(commands).toHaveLength(12); // members, register, botstatus, last, race, teamraces, settings, scheduler, pb, help, sync, leaderboard
      expect(commands.every(cmd => cmd instanceof SlashCommandBuilder)).toBe(true);
    });

    it('should include members command with subcommands', () => {
      const commands = discordCommands.getCommands();
      const membersCommand = commands.find(cmd => cmd.name === 'members');

      expect(membersCommand).toBeDefined();
      expect(membersCommand.options).toHaveLength(5); // list, inactive, remove, deactivate, reactivate
    });

    it('should include register command', () => {
      const commands = discordCommands.getCommands();
      const registerCommand = commands.find(cmd => cmd.name === 'register');

      expect(registerCommand).toBeDefined();
    });

    it('should include botstatus command with admin permissions', () => {
      const commands = discordCommands.getCommands();
      const statusCommand = commands.find(cmd => cmd.name === 'botstatus');

      expect(statusCommand).toBeDefined();
      expect(statusCommand.default_member_permissions).toBe(String(PermissionFlagsBits.ManageGuild));
    });

    it('should include last command with autocomplete', () => {
      const commands = discordCommands.getCommands();
      const lastCommand = commands.find(cmd => cmd.name === 'last');

      expect(lastCommand).toBeDefined();
      expect(lastCommand.options[0].autocomplete).toBe(true);
    });

    it('should include pb command with 3 subcommands (check, add, status)', () => {
      const commands = discordCommands.getCommands();
      const pbCommand = commands.find(cmd => cmd.name === 'pb');

      expect(pbCommand).toBeDefined();
      expect(pbCommand.options).toHaveLength(3); // check, add, status
      expect(pbCommand.options.map(o => o.name)).toEqual(expect.arrayContaining(['check', 'add', 'status']));
      expect(pbCommand.options.map(o => o.name)).not.toContain('year');
    });

    it('should include top-level sync command with period option', () => {
      const commands = discordCommands.getCommands();
      const syncCommand = commands.find(cmd => cmd.name === 'sync');

      expect(syncCommand).toBeDefined();
      const periodOption = syncCommand.options.find(o => o.name === 'period');
      expect(periodOption).toBeDefined();
      expect(periodOption.required).toBe(true);
      const choiceValues = periodOption.choices.map(c => c.value);
      expect(choiceValues).toContain('current_year');
      expect(choiceValues).toContain('last_365_days');
      expect(choiceValues).toContain('current_month');
      expect(choiceValues).toContain('previous_month');

      const monthOption = syncCommand.options.find(o => o.name === 'month');
      expect(monthOption).toBeDefined();
      expect(monthOption.required).toBe(false);
    });

    it('sync command should be available to all registered users (no ManageGuild gate)', () => {
      // /sync syncs the invoking user's own PBs — gating it to admins
      // would prevent regular members from importing their history.
      const commands = discordCommands.getCommands();
      const syncCommand = commands.find(cmd => cmd.name === 'sync');

      // Mock initialises default_member_permissions to null; setDefaultMemberPermissions
      // would overwrite it with the stringified bitfield.
      expect(syncCommand.default_member_permissions).toBeNull();
    });

    it('should include top-level help command with French description and no options', () => {
      const commands = discordCommands.getCommands();
      const helpCommand = commands.find(cmd => cmd.name === 'help');

      expect(helpCommand).toBeDefined();
      expect(helpCommand.description).toMatch(/utiliser/i);
      expect(helpCommand.options ?? []).toHaveLength(0);
    });
  });

  describe('handleCommand', () => {
    it('should handle members command', async () => {
      mockInteraction.commandName = 'members';
      mockInteraction.options.getSubcommand.mockReturnValue('list');
      jest.spyOn(discordCommands, 'handleMembersCommand').mockResolvedValue();

      await discordCommands.handleCommand(mockInteraction);

      expect(discordCommands.handleMembersCommand).toHaveBeenCalledWith(mockInteraction, mockInteraction.options);
      expect(logger.discord.info).toHaveBeenCalledWith('Command received', expect.any(Object));
    });

    it('should handle register command', async () => {
      mockInteraction.commandName = 'register';
      jest.spyOn(discordCommands, 'handleRegisterCommand').mockResolvedValue();

      await discordCommands.handleCommand(mockInteraction);

      expect(discordCommands.handleRegisterCommand).toHaveBeenCalledWith(mockInteraction);
    });

    it('should handle botstatus command', async () => {
      mockInteraction.commandName = 'botstatus';
      jest.spyOn(discordCommands, 'handleBotStatusCommand').mockResolvedValue();

      await discordCommands.handleCommand(mockInteraction);

      expect(discordCommands.handleBotStatusCommand).toHaveBeenCalledWith(mockInteraction);
    });

    it('should handle last command', async () => {
      mockInteraction.commandName = 'last';
      jest.spyOn(discordCommands, 'handleLastActivityCommand').mockResolvedValue();

      await discordCommands.handleCommand(mockInteraction);

      expect(discordCommands.handleLastActivityCommand).toHaveBeenCalledWith(mockInteraction, mockInteraction.options);
    });

    it('should handle sync command', async () => {
      mockInteraction.commandName = 'sync';
      jest.spyOn(discordCommands, 'handleSyncCommand').mockResolvedValue();

      await discordCommands.handleCommand(mockInteraction);

      expect(discordCommands.handleSyncCommand).toHaveBeenCalledWith(mockInteraction, mockInteraction.options);
    });

    it('should handle help command', async () => {
      mockInteraction.commandName = 'help';
      jest.spyOn(discordCommands, 'handleHelpCommand').mockResolvedValue();

      await discordCommands.handleCommand(mockInteraction);

      expect(discordCommands.handleHelpCommand).toHaveBeenCalledWith(mockInteraction);
    });

    it('should handle unknown command', async () => {
      mockInteraction.commandName = 'unknown';

      await discordCommands.handleCommand(mockInteraction);

      expect(mockInteraction.reply).toHaveBeenCalledWith({
        content: '❌ Unknown command',
        ephemeral: true
      });
    });

    it('should handle command errors gracefully', async () => {
      mockInteraction.commandName = 'members';
      const error = new Error('Test error');
      jest.spyOn(discordCommands, 'handleMembersCommand').mockRejectedValue(error);

      await discordCommands.handleCommand(mockInteraction);

      expect(logger.discord.error).toHaveBeenCalledWith('Error handling command', expect.any(Object));
      expect(mockInteraction.reply).toHaveBeenCalledWith({
        content: '❌ An error occurred while processing your command.',
        ephemeral: true
      });
    });

    it('should use followUp for error if interaction already replied', async () => {
      mockInteraction.commandName = 'members';
      mockInteraction.replied = true;
      const error = new Error('Test error');
      jest.spyOn(discordCommands, 'handleMembersCommand').mockRejectedValue(error);

      await discordCommands.handleCommand(mockInteraction);

      expect(mockInteraction.followUp).toHaveBeenCalledWith({
        content: '❌ An error occurred while processing your command.',
        ephemeral: true
      });
    });
  });

  describe('handleMembersCommand', () => {
    it('should route to correct subcommand handlers', async () => {
      const handlers = ['listMembers', 'listInactiveMembers', 'removeMember', 'deactivateMember', 'reactivateMember'];
      const subcommands = ['list', 'inactive', 'remove', 'deactivate', 'reactivate'];

      for (let i = 0; i < handlers.length; i++) {
        jest.clearAllMocks();
        mockInteraction.options.getSubcommand.mockReturnValue(subcommands[i]);
        jest.spyOn(discordCommands, handlers[i]).mockResolvedValue();

        await discordCommands.handleMembersCommand(mockInteraction, mockInteraction.options);

        if (handlers[i] === 'listMembers') {
          expect(discordCommands[handlers[i]]).toHaveBeenCalledWith(mockInteraction);
        } else {
          expect(discordCommands[handlers[i]]).toHaveBeenCalledWith(mockInteraction, mockInteraction.options);
        }
      }
    });
  });

  describe('listMembers', () => {
    beforeEach(() => {
      mockMemberManager.getAllMembers.mockResolvedValue([mockMember]);
      mockMemberManager.getStats.mockResolvedValue({ active: 1, inactive: 0, total: 1 });
    });

    it('should list members successfully', async () => {
      await discordCommands.listMembers(mockInteraction);

      expect(mockInteraction.deferReply).toHaveBeenCalledWith({ ephemeral: true });
      expect(mockMemberManager.getAllMembers).toHaveBeenCalled();
      expect(mockInteraction.editReply).toHaveBeenCalledWith({
        embeds: [expect.any(Object)]
      });
    });

    it('should handle empty member list', async () => {
      mockMemberManager.getAllMembers.mockResolvedValue([]);

      await discordCommands.listMembers(mockInteraction);

      expect(mockInteraction.editReply).toHaveBeenCalledWith({
        content: '📭 No team members registered yet.',
        ephemeral: true
      });
    });

    it('should handle errors in listing members', async () => {
      const error = new Error('Database error');
      mockMemberManager.getAllMembers.mockRejectedValue(error);

      await discordCommands.listMembers(mockInteraction);

      expect(logger.discord.error).toHaveBeenCalledWith('Error listing members', expect.any(Object));
      expect(mockInteraction.editReply).toHaveBeenCalledWith({
        content: '❌ Failed to retrieve member list.',
        ephemeral: true
      });
    });

    it('should chunk large member lists', async () => {
      const manyMembers = new Array(15).fill(mockMember);
      mockMemberManager.getAllMembers.mockResolvedValue(manyMembers);
      DiscordUtils.chunkArray.mockReturnValue([manyMembers.slice(0, 10)]);

      await discordCommands.listMembers(mockInteraction);

      expect(DiscordUtils.chunkArray).toHaveBeenCalledWith(manyMembers, 10);
    });
  });

  describe('listInactiveMembers', () => {
    const inactiveMember = {
      discordUserId: '987654321',
      discordUser: {
        username: 'inactiveuser',
        displayName: 'Inactive User'
      },
      athlete: {
        id: 67890,
        firstname: 'Inactive',
        lastname: 'Runner'
      },
      isActive: false,
      tokenError: {
        message: 'Token refresh failed',
        timestamp: '2025-10-20T10:00:00.000Z'
      }
    };

    beforeEach(() => {
      mockInteraction.options.getString.mockReturnValue('none');
      mockInteraction.channel = {
        send: jest.fn().mockResolvedValue({})
      };
      mockInteraction.client = {
        users: {
          fetch: jest.fn()
        }
      };
    });

    it('should list inactive members successfully', async () => {
      mockMemberManager.getInactiveMembers.mockResolvedValue([inactiveMember]);

      await discordCommands.listInactiveMembers(mockInteraction, mockInteraction.options);

      expect(mockInteraction.deferReply).toHaveBeenCalledWith({ ephemeral: true });
      expect(mockMemberManager.getInactiveMembers).toHaveBeenCalled();
      expect(mockInteraction.editReply).toHaveBeenCalledWith({
        embeds: [expect.any(Object)]
      });
    });

    it('should handle no inactive members', async () => {
      mockMemberManager.getInactiveMembers.mockResolvedValue([]);

      await discordCommands.listInactiveMembers(mockInteraction, mockInteraction.options);

      expect(mockInteraction.editReply).toHaveBeenCalledWith({
        content: '✅ All team members are active!',
        ephemeral: true
      });
    });

    it('should send DMs when notify is "dm"', async () => {
      mockInteraction.options.getString.mockReturnValue('dm');
      mockMemberManager.getInactiveMembers.mockResolvedValue([inactiveMember]);
      
      const mockUser = {
        send: jest.fn().mockResolvedValue({})
      };
      mockInteraction.client.users.fetch.mockResolvedValue(mockUser);

      await discordCommands.listInactiveMembers(mockInteraction, mockInteraction.options);

      expect(mockInteraction.client.users.fetch).toHaveBeenCalledWith('987654321');
      expect(mockUser.send).toHaveBeenCalledWith({
        embeds: [expect.any(Object)]
      });
      expect(mockInteraction.followUp).toHaveBeenCalledWith({
        content: expect.stringContaining('DM Notification Results'),
        ephemeral: true
      });
    });

    it('should post in channel when notify is "channel"', async () => {
      mockInteraction.options.getString.mockReturnValue('channel');
      mockMemberManager.getInactiveMembers.mockResolvedValue([inactiveMember]);

      await discordCommands.listInactiveMembers(mockInteraction, mockInteraction.options);

      expect(mockInteraction.channel.send).toHaveBeenCalledWith({
        embeds: [expect.any(Object)]
      });
      expect(mockInteraction.followUp).toHaveBeenCalledWith({
        content: expect.stringContaining('Posted notification in channel'),
        ephemeral: true
      });
    });

    it('should handle DM send failures gracefully', async () => {
      mockInteraction.options.getString.mockReturnValue('dm');
      mockMemberManager.getInactiveMembers.mockResolvedValue([inactiveMember]);
      
      mockInteraction.client.users.fetch.mockRejectedValue(new Error('User not found'));

      await discordCommands.listInactiveMembers(mockInteraction, mockInteraction.options);

      expect(mockInteraction.followUp).toHaveBeenCalledWith({
        content: expect.stringContaining('Failed: 1'),
        ephemeral: true
      });
    });

    it('should handle errors', async () => {
      const error = new Error('Database error');
      mockMemberManager.getInactiveMembers.mockRejectedValue(error);

      await discordCommands.listInactiveMembers(mockInteraction, mockInteraction.options);

      expect(mockInteraction.editReply).toHaveBeenCalledWith({
        content: '❌ Failed to retrieve inactive member list.',
        ephemeral: true
      });
    });

    it('should handle multiple inactive members with DM notification', async () => {
      mockInteraction.options.getString.mockReturnValue('dm');
      
      const inactiveMember2 = {
        ...inactiveMember,
        discordUserId: '111222333',
        athlete: { id: 11111, firstname: 'Another', lastname: 'User' }
      };
      
      mockMemberManager.getInactiveMembers.mockResolvedValue([inactiveMember, inactiveMember2]);
      
      const mockUser1 = { send: jest.fn().mockResolvedValue({}) };
      const mockUser2 = { send: jest.fn().mockResolvedValue({}) };
      
      mockInteraction.client.users.fetch
        .mockResolvedValueOnce(mockUser1)
        .mockResolvedValueOnce(mockUser2);

      await discordCommands.listInactiveMembers(mockInteraction, mockInteraction.options);

      expect(mockInteraction.client.users.fetch).toHaveBeenCalledTimes(2);
      expect(mockUser1.send).toHaveBeenCalled();
      expect(mockUser2.send).toHaveBeenCalled();
      expect(mockInteraction.followUp).toHaveBeenCalledWith({
        content: expect.stringContaining('Sent: 2'),
        ephemeral: true
      });
    });

    it('should handle mix of successful and failed DM sends', async () => {
      mockInteraction.options.getString.mockReturnValue('dm');
      
      const inactiveMember2 = {
        ...inactiveMember,
        discordUserId: '111222333',
        athlete: { id: 11111, firstname: 'Another', lastname: 'User' }
      };
      
      mockMemberManager.getInactiveMembers.mockResolvedValue([inactiveMember, inactiveMember2]);
      
      const mockUser = { send: jest.fn().mockResolvedValue({}) };
      
      mockInteraction.client.users.fetch
        .mockResolvedValueOnce(mockUser)
        .mockRejectedValueOnce(new Error('User not found'));

      await discordCommands.listInactiveMembers(mockInteraction, mockInteraction.options);

      expect(mockInteraction.followUp).toHaveBeenCalledWith({
        content: expect.stringContaining('Sent: 1'),
        ephemeral: true
      });
      expect(mockInteraction.followUp).toHaveBeenCalledWith({
        content: expect.stringContaining('Failed: 1'),
        ephemeral: true
      });
    });

    it('should handle multiple inactive members with channel notification', async () => {
      mockInteraction.options.getString.mockReturnValue('channel');
      
      const inactiveMember2 = {
        ...inactiveMember,
        discordUserId: '111222333'
      };
      
      mockMemberManager.getInactiveMembers.mockResolvedValue([inactiveMember, inactiveMember2]);

      await discordCommands.listInactiveMembers(mockInteraction, mockInteraction.options);

      expect(mockInteraction.channel.send).toHaveBeenCalledWith({
        embeds: [expect.any(Object)]
      });
      expect(mockInteraction.followUp).toHaveBeenCalledWith({
        content: expect.stringContaining('2 inactive member'),
        ephemeral: true
      });
    });

    it('should display member without tokenError correctly', async () => {
      mockInteraction.options.getString.mockReturnValue('none');
      
      const memberNoError = {
        ...inactiveMember,
        tokenError: undefined
      };
      
      mockMemberManager.getInactiveMembers.mockResolvedValue([memberNoError]);

      await discordCommands.listInactiveMembers(mockInteraction, mockInteraction.options);

      expect(mockInteraction.editReply).toHaveBeenCalledWith({
        embeds: [expect.any(Object)]
      });
    });
  });

  describe('removeMember', () => {
    beforeEach(() => {
      mockInteraction.options.getString.mockReturnValue('<@123456789>');
      DiscordUtils.extractUserId.mockReturnValue('123456789');
    });

    it('should remove member successfully', async () => {
      mockMemberManager.removeMemberByDiscordId.mockResolvedValue(mockMember);

      await discordCommands.removeMember(mockInteraction, mockInteraction.options);

      expect(DiscordUtils.extractUserId).toHaveBeenCalledWith('<@123456789>');
      expect(mockMemberManager.removeMemberByDiscordId).toHaveBeenCalledWith('123456789');
      expect(mockInteraction.editReply).toHaveBeenCalledWith({
        embeds: [expect.any(Object)]
      });
    });

    it('should handle invalid user input', async () => {
      DiscordUtils.extractUserId.mockReturnValue(null);

      await discordCommands.removeMember(mockInteraction, mockInteraction.options);

      expect(mockInteraction.editReply).toHaveBeenCalledWith({
        content: '❌ Invalid user. Please use @mention or a valid user ID.',
        ephemeral: true
      });
    });

    it('should handle non-existent member', async () => {
      mockMemberManager.removeMemberByDiscordId.mockResolvedValue(null);

      await discordCommands.removeMember(mockInteraction, mockInteraction.options);

      expect(mockInteraction.editReply).toHaveBeenCalledWith({
        content: '❌ User not found in team members.',
        ephemeral: true
      });
    });

    it('should handle removal errors', async () => {
      const error = new Error('Removal failed');
      mockMemberManager.removeMemberByDiscordId.mockRejectedValue(error);

      await discordCommands.removeMember(mockInteraction, mockInteraction.options);

      expect(logger.discord.error).toHaveBeenCalledWith('Error removing member', expect.any(Object));
      expect(mockInteraction.editReply).toHaveBeenCalledWith({
        content: '❌ Failed to remove member.',
        ephemeral: true
      });
    });
  });

  describe('deactivateMember', () => {
    beforeEach(() => {
      mockInteraction.options.getString.mockReturnValue('<@123456789>');
      DiscordUtils.extractUserId.mockReturnValue('123456789');
      mockMemberManager.getMemberByDiscordId.mockResolvedValue(mockMember);
    });

    it('should deactivate member successfully', async () => {
      mockMemberManager.deactivateMember.mockResolvedValue(true);

      await discordCommands.deactivateMember(mockInteraction, mockInteraction.options);

      expect(mockMemberManager.getMemberByDiscordId).toHaveBeenCalledWith('123456789');
      expect(mockMemberManager.deactivateMember).toHaveBeenCalledWith(12345);
      expect(mockInteraction.editReply).toHaveBeenCalledWith({
        embeds: [expect.any(Object)]
      });
    });

    it('should handle invalid user input', async () => {
      DiscordUtils.extractUserId.mockReturnValue(null);

      await discordCommands.deactivateMember(mockInteraction, mockInteraction.options);

      expect(mockInteraction.editReply).toHaveBeenCalledWith({
        content: '❌ Invalid user. Please use @mention or a valid user ID.',
        ephemeral: true
      });
    });

    it('should handle non-existent member', async () => {
      mockMemberManager.getMemberByDiscordId.mockResolvedValue(null);

      await discordCommands.deactivateMember(mockInteraction, mockInteraction.options);

      expect(mockInteraction.editReply).toHaveBeenCalledWith({
        content: '❌ User not found in team members.',
        ephemeral: true
      });
    });

    it('should handle deactivation failure', async () => {
      mockMemberManager.deactivateMember.mockResolvedValue(false);

      await discordCommands.deactivateMember(mockInteraction, mockInteraction.options);

      expect(mockInteraction.editReply).toHaveBeenCalledWith({
        content: '❌ Failed to deactivate member.',
        ephemeral: true
      });
    });
  });

  describe('reactivateMember', () => {
    beforeEach(() => {
      mockInteraction.options.getString.mockReturnValue('<@123456789>');
      DiscordUtils.extractUserId.mockReturnValue('123456789');
      mockMemberManager.getMemberByDiscordId.mockResolvedValue(mockMember);
    });

    it('should reactivate member successfully', async () => {
      mockMemberManager.reactivateMember.mockResolvedValue(true);

      await discordCommands.reactivateMember(mockInteraction, mockInteraction.options);

      expect(mockMemberManager.getMemberByDiscordId).toHaveBeenCalledWith('123456789');
      expect(mockMemberManager.reactivateMember).toHaveBeenCalledWith(12345);
      expect(mockInteraction.editReply).toHaveBeenCalledWith({
        embeds: [expect.any(Object)]
      });
    });

    it('should handle non-existent member', async () => {
      mockMemberManager.getMemberByDiscordId.mockResolvedValue(null);

      await discordCommands.reactivateMember(mockInteraction, mockInteraction.options);

      expect(mockInteraction.editReply).toHaveBeenCalledWith({
        content: '❌ User not found in team members.',
        ephemeral: true
      });
    });

    it('should handle reactivation failure', async () => {
      mockMemberManager.reactivateMember.mockResolvedValue(false);

      await discordCommands.reactivateMember(mockInteraction, mockInteraction.options);

      expect(mockMemberManager.getMemberByDiscordId).toHaveBeenCalledWith('123456789');
      expect(mockMemberManager.reactivateMember).toHaveBeenCalledWith(12345);
      expect(mockInteraction.editReply).toHaveBeenCalledWith({
        content: '❌ Failed to reactivate member.',
        ephemeral: true
      });
    });
  });

  describe('handleRegisterCommand', () => {
    it('should provide registration URL for new user', async () => {
      mockMemberManager.getMemberByDiscordId.mockResolvedValue(null);

      await discordCommands.handleRegisterCommand(mockInteraction);

      expect(mockInteraction.deferReply).toHaveBeenCalledWith({ ephemeral: true });
      expect(mockInteraction.editReply).toHaveBeenCalledWith({
        embeds: [expect.any(Object)]
      });
    });

    it('should handle already registered user', async () => {
      mockMemberManager.getMemberByDiscordId.mockResolvedValue(mockMember);

      await discordCommands.handleRegisterCommand(mockInteraction);

      expect(mockInteraction.deferReply).toHaveBeenCalledWith({ ephemeral: true });
      expect(mockInteraction.editReply).toHaveBeenCalledWith({
        content: '✅ You\'re already registered as **Test User**.'
      });
    });

    it('should handle member without display name', async () => {
      const memberWithoutDisplayName = {
        ...mockMember,
        discordUser: null
      };
      mockMemberManager.getMemberByDiscordId.mockResolvedValue(memberWithoutDisplayName);

      await discordCommands.handleRegisterCommand(mockInteraction);

      expect(mockInteraction.deferReply).toHaveBeenCalledWith({ ephemeral: true });
      expect(mockInteraction.editReply).toHaveBeenCalledWith({
        content: '✅ You\'re already registered as **John Doe**.'
      });
    });
  });

  describe('handleHelpCommand', () => {
    const readFields = () => {
      const embedInstance = EmbedBuilder.mock.results[EmbedBuilder.mock.results.length - 1].value;
      return embedInstance.addFields.mock.calls
        .flatMap(call => call[0])
        .map(f => `${f.name}\n${f.value}`)
        .join('\n');
    };

    it('non-admin user: reply contains user-facing commands in French but no admin section', async () => {
      mockInteraction.memberPermissions = { has: jest.fn().mockReturnValue(false) };

      await discordCommands.handleHelpCommand(mockInteraction);

      expect(mockInteraction.deferReply).toHaveBeenCalledWith({ ephemeral: true });
      expect(mockInteraction.editReply).toHaveBeenCalledWith({
        embeds: [expect.any(Object)],
      });

      const fields = readFields();
      // User-facing commands present (including /sync, now available to all users)
      expect(fields).toContain('/register');
      expect(fields).toContain('/last');
      expect(fields).toContain('/pb');
      expect(fields).toContain('/my-races');
      expect(fields).toContain('/sync');
      expect(fields).toContain('/leaderboard');
      // Admin-only commands hidden
      expect(fields).not.toContain('/members');
      expect(fields).not.toContain('/all-races');
      expect(fields).not.toContain('/settings');
      expect(fields).not.toContain('/scheduler');
      expect(fields).not.toMatch(/Commandes admin/i);
      // French content sanity check
      expect(fields.toLowerCase()).toMatch(/connecter|connecte/);
      expect(fields.toLowerCase()).toMatch(/courses?/);
    });

    it('admin user (ManageGuild): reply also includes the admin commands section', async () => {
      mockInteraction.memberPermissions = { has: jest.fn().mockReturnValue(true) };

      await discordCommands.handleHelpCommand(mockInteraction);

      const fields = readFields();
      expect(fields).toContain('/members');
      expect(fields).toContain('/all-races');
      expect(fields).toContain('/settings');
      expect(fields).toContain('/scheduler');
      expect(fields).toMatch(/Commandes admin/i);
      // ManageGuild was the permission consulted
      expect(mockInteraction.memberPermissions.has).toHaveBeenCalledWith(PermissionFlagsBits.ManageGuild);
    });

    it('treats missing memberPermissions (e.g. DM context) as non-admin', async () => {
      mockInteraction.memberPermissions = null;

      await discordCommands.handleHelpCommand(mockInteraction);

      const fields = readFields();
      expect(fields).not.toContain('/members');
      expect(fields).not.toMatch(/Commandes admin/i);
    });
  });

  describe('handleBotStatusCommand', () => {
    beforeEach(() => {
      mockActivityProcessor.getStats.mockReturnValue({
        processedActivities: 50,
        uptime: 7200,
        memoryUsage: { heapUsed: 52428800 },
        activityQueue: { totalQueued: 5, delayMinutes: 15 }
      });
      mockMemberManager.getStats.mockReturnValue({
        active: 10,
        inactive: 2,
        total: 12
      });
      mockStravaAPI.getRateLimiterStats.mockReturnValue({
        shortTerm: { used: 100, limit: 1000 },
        daily: { used: 5000, limit: 25000 },
        queueLength: 2
      });
    });

    it('should display comprehensive bot status', async () => {
      await discordCommands.handleBotStatusCommand(mockInteraction);

      expect(mockInteraction.deferReply).toHaveBeenCalledWith({ ephemeral: true });
      expect(mockActivityProcessor.getStats).toHaveBeenCalled();
      expect(mockMemberManager.getStats).toHaveBeenCalled();
      expect(mockStravaAPI.getRateLimiterStats).toHaveBeenCalled();
      expect(mockInteraction.editReply).toHaveBeenCalledWith({
        embeds: [expect.any(Object)]
      });
    });

    it('should handle status retrieval errors', async () => {
      const error = new Error('Stats unavailable');
      mockActivityProcessor.getStats.mockImplementation(() => {
        throw error;
      });

      await discordCommands.handleBotStatusCommand(mockInteraction);

      expect(logger.discord.error).toHaveBeenCalledWith('Error getting bot status', expect.any(Object));
      expect(mockInteraction.editReply).toHaveBeenCalledWith({
        content: '❌ Failed to retrieve bot status.',
        ephemeral: true
      });
    });
  });

  describe('handleLastActivityCommand', () => {
    let findMemberSpy;

    beforeEach(() => {
      mockInteraction.options.getString.mockReturnValue('Test User');
      findMemberSpy = jest.spyOn(discordCommands, 'findMemberByInput').mockResolvedValue(mockMember);
      mockMemberManager.getValidAccessToken.mockResolvedValue('valid_token');
      mockStravaAPI.getAthleteActivities.mockResolvedValue([mockActivity]);
      mockStravaAPI.getActivity.mockResolvedValue(mockActivity);
      mockStravaAPI.shouldPostActivity.mockReturnValue(true);
      mockStravaAPI.processActivityWithStreams.mockResolvedValue(mockActivity);
    });

    afterEach(() => {
      if (findMemberSpy) {
        findMemberSpy.mockRestore();
      }
    });

    it('should display member\'s last activity successfully', async () => {
      await discordCommands.handleLastActivityCommand(mockInteraction, mockInteraction.options);

      expect(mockInteraction.deferReply).toHaveBeenCalled();
      expect(discordCommands.findMemberByInput).toHaveBeenCalledWith('Test User');
      expect(mockMemberManager.getValidAccessToken).toHaveBeenCalledWith(mockMember);
      expect(mockStravaAPI.getAthleteActivities).toHaveBeenCalledWith('valid_token', 1, 10);
      expect(ActivityEmbedBuilder.createActivityEmbed).toHaveBeenCalledWith(mockActivity, { type: 'latest' });
      expect(mockInteraction.editReply).toHaveBeenCalledWith({
        embeds: [expect.any(Object)]
      });
    });

    it('should handle member not found', async () => {
      findMemberSpy.mockResolvedValue(null);

      await discordCommands.handleLastActivityCommand(mockInteraction, mockInteraction.options);

      expect(mockInteraction.editReply).toHaveBeenCalledWith({
        content: '❌ Team member not found. Use `/members list` to see all registered members.'
      });
    });

    it('should handle invalid access token', async () => {
      mockMemberManager.getValidAccessToken.mockResolvedValue(null);

      await discordCommands.handleLastActivityCommand(mockInteraction, mockInteraction.options);

      expect(mockInteraction.editReply).toHaveBeenCalledWith({
        content: '❌ **Test User** needs to re-authorize with Strava to view their activities.\n' +
                 'Please use the `/register` command to reconnect your Strava account.'
      });
    });

    it('should handle no recent activities', async () => {
      mockStravaAPI.getAthleteActivities.mockResolvedValue([]);

      await discordCommands.handleLastActivityCommand(mockInteraction, mockInteraction.options);

      expect(mockInteraction.editReply).toHaveBeenCalledWith({
        content: '📭 No recent activities found for **Test User**.'
      });
    });

    it('should handle no public activities', async () => {
      mockStravaAPI.shouldPostActivity.mockReturnValue(false);

      await discordCommands.handleLastActivityCommand(mockInteraction, mockInteraction.options);

      expect(mockInteraction.editReply).toHaveBeenCalledWith({
        content: '🔒 **Test User** has no recent public activities to display.'
      });
    });

    it('should handle API errors gracefully', async () => {
      const error = new Error('Strava API error');
      mockStravaAPI.getAthleteActivities.mockRejectedValue(error);

      await discordCommands.handleLastActivityCommand(mockInteraction, mockInteraction.options);

      expect(logger.discord.error).toHaveBeenCalledWith('Error fetching last activity', expect.any(Object));
      expect(mockInteraction.editReply).toHaveBeenCalledWith({
        content: '❌ Failed to fetch the last activity. Please try again later.'
      });
    });
  });

  describe('findMemberByInput', () => {
    beforeEach(() => {
      mockMemberManager.getAllMembers.mockResolvedValue([mockMember]);
    });

    it('should find member by Discord mention', async () => {
      DiscordUtils.extractUserId.mockReturnValue('123456789');
      mockMemberManager.getMemberByDiscordId.mockResolvedValue(mockMember);

      const result = await discordCommands.findMemberByInput('<@123456789>');

      expect(DiscordUtils.extractUserId).toHaveBeenCalledWith('<@123456789>');
      expect(mockMemberManager.getMemberByDiscordId).toHaveBeenCalledWith('123456789');
      expect(result).toBe(mockMember);
    });

    it('should find member by first name', async () => {
      DiscordUtils.extractUserId.mockReturnValue(null);

      const result = await discordCommands.findMemberByInput('john');

      expect(result).toBe(mockMember);
    });

    it('should find member by last name', async () => {
      DiscordUtils.extractUserId.mockReturnValue(null);

      const result = await discordCommands.findMemberByInput('doe');

      expect(result).toBe(mockMember);
    });

    it('should find member by full name', async () => {
      DiscordUtils.extractUserId.mockReturnValue(null);

      const result = await discordCommands.findMemberByInput('john doe');

      expect(result).toBe(mockMember);
    });

    it('should find member by Discord display name', async () => {
      DiscordUtils.extractUserId.mockReturnValue(null);

      const result = await discordCommands.findMemberByInput('test user');

      expect(result).toBe(mockMember);
    });

    it('should handle case insensitive search', async () => {
      DiscordUtils.extractUserId.mockReturnValue(null);

      const result = await discordCommands.findMemberByInput('JOHN');

      expect(result).toBe(mockMember);
    });

    it('should return undefined if no match found', async () => {
      DiscordUtils.extractUserId.mockReturnValue(null);

      const result = await discordCommands.findMemberByInput('nonexistent');

      expect(result).toBeUndefined();
    });
  });

  describe('handleAutocomplete', () => {
    beforeEach(() => {
      mockInteraction.commandName = 'last';
      mockInteraction.options.getFocused.mockReturnValue({
        name: 'member',
        value: 'jo'
      });
      mockMemberManager.getAllMembers.mockResolvedValue([
        mockMember,
        {
          ...mockMember,
          athlete: { ...mockMember.athlete, id: 67890, firstname: 'Jane', lastname: 'Smith' },
          discordUser: { displayName: 'Jane Smith' }
        }
      ]);
    });

    it('should provide autocomplete choices for member names', async () => {
      await discordCommands.handleAutocomplete(mockInteraction);

      expect(mockMemberManager.getAllMembers).toHaveBeenCalled();
      expect(mockInteraction.respond).toHaveBeenCalledWith([
        { name: 'Test User', value: 'Test User' }
      ]);
    });

    it('should filter choices based on search term', async () => {
      mockInteraction.options.getFocused.mockReturnValue({
        name: 'member',
        value: 'jane'
      });

      await discordCommands.handleAutocomplete(mockInteraction);

      expect(mockInteraction.respond).toHaveBeenCalledWith([
        { name: 'Jane Smith', value: 'Jane Smith' }
      ]);
    });

    it('should limit choices to 25 items', async () => {
      const manyMembers = new Array(30).fill(0).map((_, i) => ({
        ...mockMember,
        athlete: { ...mockMember.athlete, id: i, firstname: `User${i}`, lastname: 'Test' },
        discordUser: { displayName: `User${i} Test` }
      }));
      mockMemberManager.getAllMembers.mockResolvedValue(manyMembers);
      mockInteraction.options.getFocused.mockReturnValue({
        name: 'member',
        value: 'user'
      });

      await discordCommands.handleAutocomplete(mockInteraction);

      expect(mockInteraction.respond).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ name: expect.stringContaining('User') })
        ])
      );
      expect(mockInteraction.respond.mock.calls[0][0]).toHaveLength(25);
    });

    it('should handle autocomplete errors gracefully', async () => {
      const error = new Error('Database error');
      mockMemberManager.getAllMembers.mockRejectedValue(error);

      await discordCommands.handleAutocomplete(mockInteraction);

      expect(logger.discord.error).toHaveBeenCalledWith('Error in autocomplete', expect.any(Object));
      expect(mockInteraction.respond).toHaveBeenCalledWith([]);
    });

    it('should ignore autocomplete for non-last commands', async () => {
      mockInteraction.commandName = 'register';

      await discordCommands.handleAutocomplete(mockInteraction);

      expect(mockInteraction.respond).not.toHaveBeenCalled();
    });

    it('should handle members without Discord user data in autocomplete', async () => {
      const memberWithoutDiscord = {
        ...mockMember,
        discordUser: null
      };
      mockMemberManager.getAllMembers.mockResolvedValue([memberWithoutDiscord]);

      await discordCommands.handleAutocomplete(mockInteraction);

      expect(mockInteraction.respond).toHaveBeenCalledWith([
        { name: 'John Doe', value: 'John Doe' }
      ]);
    });
  });

  describe('helper methods', () => {
    describe('formatDistanceDisplay', () => {
      it('should format 5K distance', () => {
        expect(discordCommands.formatDistanceDisplay(5)).toBe('5K');
      });

      it('should format 10K distance', () => {
        expect(discordCommands.formatDistanceDisplay(10)).toBe('10K');
      });

      it('should format Half Marathon distance', () => {
        expect(discordCommands.formatDistanceDisplay(21.1)).toBe('Half Marathon (21.1K)');
      });

      it('should format Marathon distance', () => {
        expect(discordCommands.formatDistanceDisplay(42.2)).toBe('Marathon (42.2K)');
      });

      it('should format custom distance', () => {
        expect(discordCommands.formatDistanceDisplay(15)).toBe('15km');
      });

      it('should format decimal custom distance', () => {
        expect(discordCommands.formatDistanceDisplay(12.5)).toBe('12.5km');
      });
    });

    describe('_processRaceDistance', () => {
      it('should process 5K road race preset', () => {
        const result = discordCommands._processRaceDistance('road', '5', null);

        expect(result).toEqual({
          finalDistance: '5K',
          distanceKm: '5'
        });
      });

      it('should process 10K road race preset', () => {
        const result = discordCommands._processRaceDistance('road', '10', null);

        expect(result).toEqual({
          finalDistance: '10K',
          distanceKm: '10'
        });
      });

      it('should process Half Marathon preset', () => {
        const result = discordCommands._processRaceDistance('road', '21.1', null);

        expect(result).toEqual({
          finalDistance: 'Half Marathon (21.1K)',
          distanceKm: '21.1'
        });
      });

      it('should process Marathon preset', () => {
        const result = discordCommands._processRaceDistance('road', '42.2', null);

        expect(result).toEqual({
          finalDistance: 'Marathon (42.2K)',
          distanceKm: '42.2'
        });
      });

      it('should process custom road race distance', () => {
        const result = discordCommands._processRaceDistance('road', 'other', '15');

        expect(result).toEqual({
          finalDistance: '15km',
          distanceKm: '15'
        });
      });

      it('should process custom road race with decimal distance', () => {
        const result = discordCommands._processRaceDistance('road', 'other', '12.5');

        expect(result).toEqual({
          finalDistance: '12.5km',
          distanceKm: '12.5'
        });
      });

      it('should handle trail race without custom distance', () => {
        const result = discordCommands._processRaceDistance('trail', null, null);

        expect(result).toEqual({
          finalDistance: null,
          distanceKm: null
        });
      });

      it('should process trail race with custom distance', () => {
        const result = discordCommands._processRaceDistance('trail', null, '25');

        expect(result).toEqual({
          finalDistance: '25km',
          distanceKm: '25'
        });
      });

      it('should handle triathlon without custom distance', () => {
        const result = discordCommands._processRaceDistance('triathlon', null, null);

        expect(result).toEqual({
          finalDistance: null,
          distanceKm: null
        });
      });

      it('should return nulls for triathlon (not handled)', () => {
        const result = discordCommands._processRaceDistance('triathlon', null, '70.3');

        expect(result).toEqual({
          finalDistance: null,
          distanceKm: null
        });
      });

      it('should handle other race types without custom distance', () => {
        const result = discordCommands._processRaceDistance('obstacle', null, null);

        expect(result).toEqual({
          finalDistance: null,
          distanceKm: null
        });
      });

      it('should return nulls for other race types (not handled)', () => {
        const result = discordCommands._processRaceDistance('obstacle', null, '10');

        expect(result).toEqual({
          finalDistance: null,
          distanceKm: null
        });
      });

      it('should return nulls when road race preset is "other" but no custom distance', () => {
        const result = discordCommands._processRaceDistance('road', 'other', null);

        expect(result).toEqual({
          finalDistance: null,
          distanceKm: null
        });
      });
    });
  });

  // ─── handlePBCheck ─────────────────────────────────────────────────────────

  describe('handlePBCheck', () => {
    let checkInteraction;

    beforeEach(() => {
      checkInteraction = {
        user: { tag: 'TestUser#1234', id: '123456789', globalName: 'TestUser', username: 'testuser' },
        member: { displayName: 'Test Display' },
        deferReply: jest.fn().mockResolvedValue(undefined),
        editReply: jest.fn().mockResolvedValue(undefined),
        options: { getUser: jest.fn().mockReturnValue(null) },
      };
    });

    it('should defer reply', async () => {
      await discordCommands.handlePBCheck(checkInteraction, checkInteraction.options);

      expect(checkInteraction.deferReply).toHaveBeenCalled();
    });

    it('should reply with "no PBs" message when getMemberPBsByDiscordId returns empty array', async () => {
      // getMemberPBsByDiscordId is already mocked to return [] by default

      await discordCommands.handlePBCheck(checkInteraction, checkInteraction.options);

      expect(checkInteraction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('No Personal Bests') })
      );
      expect(checkInteraction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('/sync') })
      );
    });

    it('should send embed when PBs exist', async () => {
      discordCommands.pbManager.getMemberPBsByDiscordId.mockResolvedValue([
        { category: '5K', elapsed_time: 1200 },
      ]);
      discordCommands.pbManager.formatPBsForEmbed.mockReturnValue([
        { name: '🏆 TestUser', value: '5K — 20:00', inline: false },
      ]);

      await discordCommands.handlePBCheck(checkInteraction, checkInteraction.options);

      expect(checkInteraction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({ embeds: [expect.any(Object)] })
      );
    });

    it('should use targetUser id and name when member option is provided', async () => {
      checkInteraction.options.getUser.mockReturnValue({ id: '999', globalName: 'OtherUser', username: 'other' });
      discordCommands.pbManager.getMemberPBsByDiscordId.mockResolvedValue([
        { category: '5K', elapsed_time: 1200 },
      ]);

      await discordCommands.handlePBCheck(checkInteraction, checkInteraction.options);

      expect(discordCommands.pbManager.getMemberPBsByDiscordId).toHaveBeenCalledWith('999');
    });

    it('should reply with error message when getMemberPBsByDiscordId throws', async () => {
      discordCommands.pbManager.getMemberPBsByDiscordId.mockRejectedValue(new Error('DB error'));

      await discordCommands.handlePBCheck(checkInteraction, checkInteraction.options);

      expect(checkInteraction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('Failed') })
      );
      expect(logger.discord.error).toHaveBeenCalled();
    });
  });

  // ─── handleSyncCommand ─────────────────────────────────────────────────────

  describe('handleSyncCommand', () => {
    let syncInteraction;

    beforeEach(() => {
      syncInteraction = {
        user: { tag: 'TestUser#1234', id: '123456789' },
        deferReply: jest.fn().mockResolvedValue(undefined),
        editReply: jest.fn().mockResolvedValue(undefined),
        options: {
          getString: jest.fn((name) => (name === 'period' ? 'current_year' : null)),
          getBoolean: jest.fn().mockReturnValue(null),
        },
      };
      mockMemberManager.getMemberByDiscordId.mockResolvedValue({
        discordUserId: '123456789',
        athleteId: 12345,
        isActive: true,
      });
      mockMemberManager.getValidAccessToken.mockResolvedValue('valid_token');
    });

    it('should reply with error when user is not registered', async () => {
      mockMemberManager.getMemberByDiscordId.mockResolvedValue(null);

      await discordCommands.handleSyncCommand(syncInteraction, syncInteraction.options);

      expect(syncInteraction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('not registered') })
      );
      expect(discordCommands.pbManager.syncFromHistory).not.toHaveBeenCalled();
    });

    it('should reply with error when access token cannot be retrieved', async () => {
      mockMemberManager.getValidAccessToken.mockResolvedValue(null);

      await discordCommands.handleSyncCommand(syncInteraction, syncInteraction.options);

      expect(syncInteraction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('access token') })
      );
    });

    it('should call syncFromHistory with current_year afterTs anchored to UTC Jan 1', async () => {
      // Regression: previously used `new Date(year, 0, 1).getTime()`, which
      // interprets Jan 1 in the *server's* timezone — a Docker host running in
      // UTC-5 would silently drop activities recorded between 00:00 and 05:00
      // UTC on Jan 1. afterTs must be Jan 1 00:00 UTC.
      discordCommands.pbManager.syncFromHistory.mockResolvedValue({ processed: 10, updated: 2, errors: 0 });
      syncInteraction.options.getString.mockImplementation((name) => (name === 'period' ? 'current_year' : null));

      await discordCommands.handleSyncCommand(syncInteraction, syncInteraction.options);

      expect(discordCommands.pbManager.syncFromHistory).toHaveBeenCalledWith(
        '123456789',
        'valid_token',
        mockStravaAPI,
        expect.any(Function),
        expect.any(Number),
        null
      );
      const calledAfterTs = discordCommands.pbManager.syncFromHistory.mock.calls[0][4];
      const jan1Utc = Math.floor(Date.UTC(new Date().getUTCFullYear(), 0, 1) / 1000);
      expect(calledAfterTs).toBe(jan1Utc);
    });

    it('should call syncFromHistory with last_365_days afterTs', async () => {
      discordCommands.pbManager.syncFromHistory.mockResolvedValue({ processed: 5, updated: 1, errors: 0 });
      syncInteraction.options.getString.mockImplementation((name) => (name === 'period' ? 'last_365_days' : null));

      await discordCommands.handleSyncCommand(syncInteraction, syncInteraction.options);

      const calledAfterTs = discordCommands.pbManager.syncFromHistory.mock.calls[0][4];
      const expected365 = Math.floor((Date.now() - 365 * 24 * 60 * 60 * 1000) / 1000);
      expect(Math.abs(calledAfterTs - expected365)).toBeLessThan(60);
      // last_365_days is an open-ended window — beforeTs must be null.
      expect(discordCommands.pbManager.syncFromHistory.mock.calls[0][5]).toBeNull();
    });

    it('should call syncFromHistory with current_month afterTs anchored to UTC 1st of this month', async () => {
      discordCommands.pbManager.syncFromHistory.mockResolvedValue({ processed: 0, updated: 0, errors: 0 });
      syncInteraction.options.getString.mockImplementation((name) => (name === 'period' ? 'current_month' : null));

      await discordCommands.handleSyncCommand(syncInteraction, syncInteraction.options);

      const calledAfterTs = discordCommands.pbManager.syncFromHistory.mock.calls[0][4];
      const now = new Date();
      const firstUtc = Math.floor(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1) / 1000);
      expect(calledAfterTs).toBe(firstUtc);
      expect(discordCommands.pbManager.syncFromHistory.mock.calls[0][5]).toBeNull();
    });

    it('should call syncFromHistory with previous_month bounded window', async () => {
      discordCommands.pbManager.syncFromHistory.mockResolvedValue({ processed: 0, updated: 0, errors: 0 });
      syncInteraction.options.getString.mockImplementation((name) => (name === 'period' ? 'previous_month' : null));

      await discordCommands.handleSyncCommand(syncInteraction, syncInteraction.options);

      const now = new Date();
      const expectedAfter = Math.floor(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1) / 1000);
      const expectedBefore = Math.floor(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1) / 1000);
      const [, , , , calledAfter, calledBefore] = discordCommands.pbManager.syncFromHistory.mock.calls[0];
      expect(calledAfter).toBe(expectedAfter);
      expect(calledBefore).toBe(expectedBefore);
    });

    it('should call syncFromHistory with explicit month:YYYY-MM bounded window (overrides period)', async () => {
      discordCommands.pbManager.syncFromHistory.mockResolvedValue({ processed: 0, updated: 0, errors: 0 });
      syncInteraction.options.getString.mockImplementation((name) => {
        if (name === 'period') return 'current_year';
        if (name === 'month') return '2024-03';
        return null;
      });

      await discordCommands.handleSyncCommand(syncInteraction, syncInteraction.options);

      const expectedAfter = Math.floor(Date.UTC(2024, 2, 1) / 1000);
      const expectedBefore = Math.floor(Date.UTC(2024, 3, 1) / 1000);
      const [, , , , calledAfter, calledBefore] = discordCommands.pbManager.syncFromHistory.mock.calls[0];
      expect(calledAfter).toBe(expectedAfter);
      expect(calledBefore).toBe(expectedBefore);
    });

    it('should reject malformed month and not call syncFromHistory', async () => {
      syncInteraction.options.getString.mockImplementation((name) => {
        if (name === 'period') return 'current_year';
        if (name === 'month') return 'March-2024';
        return null;
      });

      await discordCommands.handleSyncCommand(syncInteraction, syncInteraction.options);

      expect(discordCommands.pbManager.syncFromHistory).not.toHaveBeenCalled();
      expect(syncInteraction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('Invalid `month` format') })
      );
    });

    it('should reject month with out-of-range month number', async () => {
      syncInteraction.options.getString.mockImplementation((name) => {
        if (name === 'period') return 'current_year';
        if (name === 'month') return '2024-13';
        return null;
      });

      await discordCommands.handleSyncCommand(syncInteraction, syncInteraction.options);

      expect(discordCommands.pbManager.syncFromHistory).not.toHaveBeenCalled();
      expect(syncInteraction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('between 01 and 12') })
      );
    });

    it('should reject month in the future', async () => {
      const future = new Date();
      future.setUTCFullYear(future.getUTCFullYear() + 1);
      const yyyy = future.getUTCFullYear();
      const mm = String(future.getUTCMonth() + 1).padStart(2, '0');
      syncInteraction.options.getString.mockImplementation((name) => {
        if (name === 'period') return 'current_year';
        if (name === 'month') return `${yyyy}-${mm}`;
        return null;
      });

      await discordCommands.handleSyncCommand(syncInteraction, syncInteraction.options);

      expect(discordCommands.pbManager.syncFromHistory).not.toHaveBeenCalled();
      expect(syncInteraction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('future') })
      );
    });

    it('should reply with embed showing updated count', async () => {
      discordCommands.pbManager.syncFromHistory.mockResolvedValue({ processed: 10, updated: 3, errors: 0 });

      await discordCommands.handleSyncCommand(syncInteraction, syncInteraction.options);

      expect(syncInteraction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({ embeds: expect.any(Array) })
      );
    });

    it('should include period label in progress message for current_year', async () => {
      discordCommands.pbManager.syncFromHistory.mockResolvedValue({ processed: 0, updated: 0, errors: 0 });
      syncInteraction.options.getString.mockImplementation((name) => (name === 'period' ? 'current_year' : null));

      await discordCommands.handleSyncCommand(syncInteraction, syncInteraction.options);

      // The first editReply call contains the progress message with the period label
      const progressMessage = syncInteraction.editReply.mock.calls[0][0].content;
      expect(progressMessage).toContain('Current year');
    });

    it('should include period label in progress message for last_365_days', async () => {
      discordCommands.pbManager.syncFromHistory.mockResolvedValue({ processed: 0, updated: 0, errors: 0 });
      syncInteraction.options.getString.mockImplementation((name) => (name === 'period' ? 'last_365_days' : null));

      await discordCommands.handleSyncCommand(syncInteraction, syncInteraction.options);

      const progressMessage = syncInteraction.editReply.mock.calls[0][0].content;
      expect(progressMessage).toContain('Last 365 days');
    });

    it('should block a second concurrent sync from the same user', async () => {
      discordCommands.pbSyncInProgress.add('123456789');

      await discordCommands.handleSyncCommand(syncInteraction, syncInteraction.options);

      expect(syncInteraction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('already in progress') })
      );
      expect(discordCommands.pbManager.syncFromHistory).not.toHaveBeenCalled();
    });

    it('should release the lock after sync completes', async () => {
      discordCommands.pbManager.syncFromHistory.mockResolvedValue({ processed: 0, updated: 0, errors: 0 });

      await discordCommands.handleSyncCommand(syncInteraction, syncInteraction.options);

      expect(discordCommands.pbSyncInProgress.has('123456789')).toBe(false);
    });

    it('should release the lock even if syncFromHistory throws', async () => {
      discordCommands.pbManager.syncFromHistory.mockRejectedValue(new Error('API down'));

      await discordCommands.handleSyncCommand(syncInteraction, syncInteraction.options);

      expect(discordCommands.pbSyncInProgress.has('123456789')).toBe(false);
      expect(syncInteraction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('Failed') })
      );
    });

    it('falls back to DM when the summary editReply fails (past 15-min window)', async () => {
      discordCommands.pbManager.syncFromHistory.mockResolvedValue({ processed: 10, updated: 3, errors: 0 });
      syncInteraction.user.send = jest.fn().mockResolvedValue(undefined);
      syncInteraction.channel = { send: jest.fn().mockResolvedValue(undefined) };
      // First editReply (progress message) succeeds; the summary edit fails
      syncInteraction.editReply
        .mockResolvedValueOnce(undefined)
        .mockRejectedValue(new Error('Invalid Webhook Token'));

      await discordCommands.handleSyncCommand(syncInteraction, syncInteraction.options);

      expect(syncInteraction.user.send).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('sync complete'),
          embeds: expect.any(Array),
        })
      );
      expect(syncInteraction.channel.send).not.toHaveBeenCalled();
    });

    it('falls back to the channel with a mention when editReply and DM both fail', async () => {
      discordCommands.pbManager.syncFromHistory.mockResolvedValue({ processed: 10, updated: 3, errors: 0 });
      syncInteraction.user.send = jest.fn().mockRejectedValue(new Error('Cannot send messages to this user'));
      syncInteraction.channel = { send: jest.fn().mockResolvedValue(undefined) };
      syncInteraction.editReply
        .mockResolvedValueOnce(undefined)
        .mockRejectedValue(new Error('Invalid Webhook Token'));

      await discordCommands.handleSyncCommand(syncInteraction, syncInteraction.options);

      expect(syncInteraction.channel.send).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('<@123456789>'),
          embeds: expect.any(Array),
        })
      );
    });

    it('does not throw and still releases the lock when every delivery path fails', async () => {
      discordCommands.pbManager.syncFromHistory.mockResolvedValue({ processed: 10, updated: 3, errors: 0 });
      syncInteraction.user.send = jest.fn().mockRejectedValue(new Error('Cannot send messages to this user'));
      syncInteraction.channel = { send: jest.fn().mockRejectedValue(new Error('Missing Permissions')) };
      syncInteraction.editReply
        .mockResolvedValueOnce(undefined)
        .mockRejectedValue(new Error('Invalid Webhook Token'));

      await expect(
        discordCommands.handleSyncCommand(syncInteraction, syncInteraction.options)
      ).resolves.toBeUndefined();

      expect(discordCommands.pbSyncInProgress.has('123456789')).toBe(false);
    });

    it('handles a missing channel (DM context) when editReply and DM fail', async () => {
      discordCommands.pbManager.syncFromHistory.mockResolvedValue({ processed: 10, updated: 3, errors: 0 });
      syncInteraction.user.send = jest.fn().mockRejectedValue(new Error('Cannot send messages to this user'));
      syncInteraction.channel = null;
      syncInteraction.editReply
        .mockResolvedValueOnce(undefined)
        .mockRejectedValue(new Error('Invalid Webhook Token'));

      await expect(
        discordCommands.handleSyncCommand(syncInteraction, syncInteraction.options)
      ).resolves.toBeUndefined();
    });
  });

  // ─── handleSyncCommand — all_members (admin bulk sync) ─────────────────────

  describe('handleSyncCommand with all_members', () => {
    let bulkInteraction;
    const memberAlice = {
      discordUserId: '111',
      athleteId: 1,
      isActive: true,
      discordUser: { displayName: 'Alice' },
      athlete: { firstname: 'Alice', lastname: 'Runner' },
    };
    const memberBob = {
      discordUserId: '222',
      athleteId: 2,
      isActive: true,
      discordUser: null,
      athlete: { firstname: 'Bob', lastname: 'Jogger' },
    };

    beforeEach(() => {
      bulkInteraction = {
        user: { tag: 'Admin#1234', id: '999999999' },
        memberPermissions: { has: jest.fn().mockReturnValue(true) },
        deferReply: jest.fn().mockResolvedValue(undefined),
        editReply: jest.fn().mockResolvedValue(undefined),
        options: {
          getString: jest.fn((name) => (name === 'period' ? 'previous_month' : null)),
          getBoolean: jest.fn((name) => (name === 'all_members' ? true : null)),
        },
      };
      mockMemberManager.getAllMembers.mockResolvedValue([memberAlice, memberBob]);
      mockMemberManager.getValidAccessToken.mockResolvedValue('valid_token');
      discordCommands.pbManager.syncFromHistory.mockResolvedValue({ processed: 3, updated: 1, errors: 0 });
    });

    it('rejects users without Manage Server permission', async () => {
      bulkInteraction.memberPermissions.has.mockReturnValue(false);

      await discordCommands.handleSyncCommand(bulkInteraction, bulkInteraction.options);

      expect(bulkInteraction.memberPermissions.has).toHaveBeenCalledWith(PermissionFlagsBits.ManageGuild);
      expect(bulkInteraction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('Manage Server') })
      );
      expect(discordCommands.pbManager.syncFromHistory).not.toHaveBeenCalled();
    });

    it('treats missing memberPermissions (e.g. DM context) as non-admin', async () => {
      bulkInteraction.memberPermissions = null;

      await discordCommands.handleSyncCommand(bulkInteraction, bulkInteraction.options);

      expect(discordCommands.pbManager.syncFromHistory).not.toHaveBeenCalled();
    });

    it('syncs every registered member with the resolved window', async () => {
      await discordCommands.handleSyncCommand(bulkInteraction, bulkInteraction.options);

      const now = new Date();
      const expectedAfter = Math.floor(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1) / 1000);
      const expectedBefore = Math.floor(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1) / 1000);

      expect(discordCommands.pbManager.syncFromHistory).toHaveBeenCalledTimes(2);
      expect(discordCommands.pbManager.syncFromHistory).toHaveBeenCalledWith(
        '111', 'valid_token', mockStravaAPI, null, expectedAfter, expectedBefore
      );
      expect(discordCommands.pbManager.syncFromHistory).toHaveBeenCalledWith(
        '222', 'valid_token', mockStravaAPI, null, expectedAfter, expectedBefore
      );
      expect(bulkInteraction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({ embeds: expect.any(Array) })
      );
    });

    it('supports an explicit month window', async () => {
      bulkInteraction.options.getString.mockImplementation((name) => {
        if (name === 'period') return 'current_year';
        if (name === 'month') return '2026-06';
        return null;
      });

      await discordCommands.handleSyncCommand(bulkInteraction, bulkInteraction.options);

      const expectedAfter = Math.floor(Date.UTC(2026, 5, 1) / 1000);
      const expectedBefore = Math.floor(Date.UTC(2026, 6, 1) / 1000);
      const [, , , , calledAfter, calledBefore] = discordCommands.pbManager.syncFromHistory.mock.calls[0];
      expect(calledAfter).toBe(expectedAfter);
      expect(calledBefore).toBe(expectedBefore);
    });

    it('rejects an invalid month window without syncing', async () => {
      bulkInteraction.options.getString.mockImplementation((name) => {
        if (name === 'period') return 'current_year';
        if (name === 'month') return 'June-2026';
        return null;
      });

      await discordCommands.handleSyncCommand(bulkInteraction, bulkInteraction.options);

      expect(discordCommands.pbManager.syncFromHistory).not.toHaveBeenCalled();
      expect(bulkInteraction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('Invalid `month` format') })
      );
    });

    it('skips members without a valid token and still syncs the rest', async () => {
      mockMemberManager.getValidAccessToken.mockImplementation(async (member) =>
        member.discordUserId === '222' ? null : 'valid_token'
      );

      await discordCommands.handleSyncCommand(bulkInteraction, bulkInteraction.options);

      expect(discordCommands.pbManager.syncFromHistory).toHaveBeenCalledTimes(1);
      expect(discordCommands.pbManager.syncFromHistory.mock.calls[0][0]).toBe('111');
      expect(bulkInteraction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({ embeds: expect.any(Array) })
      );
    });

    it('continues with remaining members when one sync fails', async () => {
      discordCommands.pbManager.syncFromHistory
        .mockRejectedValueOnce(new Error('Strava 500'))
        .mockResolvedValueOnce({ processed: 4, updated: 2, errors: 0 });

      await discordCommands.handleSyncCommand(bulkInteraction, bulkInteraction.options);

      expect(discordCommands.pbManager.syncFromHistory).toHaveBeenCalledTimes(2);
      expect(bulkInteraction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({ embeds: expect.any(Array) })
      );
    });

    it('blocks a second concurrent team-wide sync', async () => {
      discordCommands.bulkSyncInProgress = true;

      await discordCommands.handleSyncCommand(bulkInteraction, bulkInteraction.options);

      expect(bulkInteraction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('already in progress') })
      );
      expect(discordCommands.pbManager.syncFromHistory).not.toHaveBeenCalled();

      discordCommands.bulkSyncInProgress = false;
    });

    it('releases the bulk lock after completion', async () => {
      await discordCommands.handleSyncCommand(bulkInteraction, bulkInteraction.options);

      expect(discordCommands.bulkSyncInProgress).toBe(false);
    });

    it('releases the bulk lock even when member listing fails', async () => {
      mockMemberManager.getAllMembers.mockRejectedValue(new Error('DB down'));

      await discordCommands.handleSyncCommand(bulkInteraction, bulkInteraction.options);

      expect(discordCommands.bulkSyncInProgress).toBe(false);
      expect(bulkInteraction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('Failed') })
      );
    });

    it('does not take the per-user sync lock for bulk runs', async () => {
      await discordCommands.handleSyncCommand(bulkInteraction, bulkInteraction.options);

      expect(discordCommands.pbSyncInProgress.has('999999999')).toBe(false);
    });

    it('falls back to DM when the summary editReply fails (past 15-min window)', async () => {
      bulkInteraction.user.send = jest.fn().mockResolvedValue(undefined);
      bulkInteraction.channel = { send: jest.fn().mockResolvedValue(undefined) };
      bulkInteraction.editReply.mockRejectedValue(new Error('Invalid Webhook Token'));

      await discordCommands.handleSyncCommand(bulkInteraction, bulkInteraction.options);

      // The sync itself completed for every member despite editReply failing
      expect(discordCommands.pbManager.syncFromHistory).toHaveBeenCalledTimes(2);
      expect(bulkInteraction.user.send).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('Team sync complete'),
          embeds: expect.any(Array),
        })
      );
      expect(bulkInteraction.channel.send).not.toHaveBeenCalled();
    });

    it('falls back to the channel with a mention when editReply and DM both fail', async () => {
      bulkInteraction.user.send = jest.fn().mockRejectedValue(new Error('Cannot send messages to this user'));
      bulkInteraction.channel = { send: jest.fn().mockResolvedValue(undefined) };
      bulkInteraction.editReply.mockRejectedValue(new Error('Invalid Webhook Token'));

      await discordCommands.handleSyncCommand(bulkInteraction, bulkInteraction.options);

      expect(bulkInteraction.channel.send).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('<@999999999>'),
          embeds: expect.any(Array),
        })
      );
    });

    it('releases the bulk lock even when every delivery path fails', async () => {
      bulkInteraction.user.send = jest.fn().mockRejectedValue(new Error('Cannot send messages to this user'));
      bulkInteraction.channel = { send: jest.fn().mockRejectedValue(new Error('Missing Permissions')) };
      bulkInteraction.editReply.mockRejectedValue(new Error('Invalid Webhook Token'));

      await expect(
        discordCommands.handleSyncCommand(bulkInteraction, bulkInteraction.options)
      ).resolves.toBeUndefined();

      expect(discordCommands.bulkSyncInProgress).toBe(false);
    });
  });

  // ─── handlePBAdd ───────────────────────────────────────────────────────────

  describe('handlePBAdd', () => {
    let addInteraction;

    beforeEach(() => {
      addInteraction = {
        user: { tag: 'TestUser#1234', id: '123456789' },
        deferReply: jest.fn().mockResolvedValue(undefined),
        editReply: jest.fn().mockResolvedValue(undefined),
        options: {
          getString: jest.fn().mockReturnValue('https://www.strava.com/activities/15730864623'),
          getInteger: jest.fn().mockReturnValue(null),
        },
      };
      mockMemberManager.getMemberByDiscordId.mockResolvedValue({
        discordUserId: '123456789',
        athleteId: 12345,
        isActive: true,
      });
      mockMemberManager.getValidAccessToken.mockResolvedValue('valid_token');
      mockStravaAPI.getActivity.mockResolvedValue({
        id: 15730864623,
        name: 'Race',
        type: 'Run',
        start_date: '2024-01-01T10:00:00Z',
        best_efforts: [
          { name: '5K', distance: 5000, elapsed_time: 1037, moving_time: 1037 },
        ],
      });
      discordCommands.pbManager.checkAndUpdatePBs = jest.fn().mockResolvedValue([
        { isNewPB: true, category: '5K', newPB: { elapsedTime: 1037 }, previousPB: null },
      ]);
    });

    it('should reply with error for invalid URL format', async () => {
      addInteraction.options.getString.mockReturnValue('not-a-url');

      await discordCommands.handlePBAdd(addInteraction, addInteraction.options);

      expect(addInteraction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('Invalid Strava activity URL') })
      );
      expect(mockStravaAPI.getActivity).not.toHaveBeenCalled();
    });

    it('should extract activity ID from URL and call getActivity', async () => {
      await discordCommands.handlePBAdd(addInteraction, addInteraction.options);

      expect(mockStravaAPI.getActivity).toHaveBeenCalledWith('15730864623', 'valid_token');
    });

    it('should reply with error when user is not registered', async () => {
      mockMemberManager.getMemberByDiscordId.mockResolvedValue(null);

      await discordCommands.handlePBAdd(addInteraction, addInteraction.options);

      expect(addInteraction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('not registered') })
      );
    });

    it('should reply with success listing new PBs when new records found', async () => {
      await discordCommands.handlePBAdd(addInteraction, addInteraction.options);

      expect(addInteraction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('5K') })
      );
    });

    it('should reply with no-new-PBs message when all times are slower than existing', async () => {
      discordCommands.pbManager.checkAndUpdatePBs.mockResolvedValue([
        { isNewPB: false, category: '5K', newPB: null, previousPB: { elapsed_time: 900 } },
      ]);

      await discordCommands.handlePBAdd(addInteraction, addInteraction.options);

      expect(addInteraction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('no new Personal Bests') })
      );
    });

    it('should reply with error when getActivity throws', async () => {
      mockStravaAPI.getActivity.mockRejectedValue(new Error('Activity not found'));

      await discordCommands.handlePBAdd(addInteraction, addInteraction.options);

      expect(addInteraction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('Failed') })
      );
    });

    describe('distance_m override', () => {
      beforeEach(() => {
        // Set up extractBestEfforts and checkAndUpdatePBsFromEfforts for override path
        discordCommands.pbManager.extractBestEfforts = jest.fn().mockReturnValue([
          { category: '5K', distanceM: 5080, elapsedTime: 1037, movingTime: 1037, activityId: 15730864623, activityName: 'Race', activityDate: '2024-01-01' },
        ]);
        discordCommands.pbManager.checkAndUpdatePBsFromEfforts = jest.fn().mockResolvedValue([
          { isNewPB: true, category: '5K', newPB: { elapsedTime: 1037 }, previousPB: null },
        ]);
      });

      it('should call checkAndUpdatePBs (no override) when distance_m not provided', async () => {
        addInteraction.options.getInteger = jest.fn().mockReturnValue(null);

        await discordCommands.handlePBAdd(addInteraction, addInteraction.options);

        expect(discordCommands.pbManager.checkAndUpdatePBs).toHaveBeenCalled();
        expect(discordCommands.pbManager.checkAndUpdatePBsFromEfforts).not.toHaveBeenCalled();
      });

      it('should call checkAndUpdatePBsFromEfforts when distance_m is provided', async () => {
        addInteraction.options.getInteger = jest.fn().mockReturnValue(5000);

        await discordCommands.handlePBAdd(addInteraction, addInteraction.options);

        expect(discordCommands.pbManager.extractBestEfforts).toHaveBeenCalled();
        expect(discordCommands.pbManager.checkAndUpdatePBsFromEfforts).toHaveBeenCalled();
        expect(discordCommands.pbManager.checkAndUpdatePBs).not.toHaveBeenCalled();
      });

      it('should apply override to closest effort distanceM', async () => {
        addInteraction.options.getInteger = jest.fn().mockReturnValue(5000);

        await discordCommands.handlePBAdd(addInteraction, addInteraction.options);

        const passedEfforts = discordCommands.pbManager.checkAndUpdatePBsFromEfforts.mock.calls[0][1];
        expect(passedEfforts[0].distanceM).toBe(5000);
      });

      it('should not show warning when difference is less than 5%', async () => {
        // GPS: 5080m, override: 5000m → diff = 1.57% < 5%
        addInteraction.options.getInteger = jest.fn().mockReturnValue(5000);

        await discordCommands.handlePBAdd(addInteraction, addInteraction.options);

        const reply = addInteraction.editReply.mock.calls[0][0];
        expect(reply.content).not.toContain('⚠️');
      });

      it('should show warning when difference is 5% or more', async () => {
        // GPS: 5080m, override: 4700m → diff = 7.5% ≥ 5%
        addInteraction.options.getInteger = jest.fn().mockReturnValue(4700);

        await discordCommands.handlePBAdd(addInteraction, addInteraction.options);

        const reply = addInteraction.editReply.mock.calls[0][0];
        expect(reply.content).toContain('⚠️');
        expect(reply.content).toContain('4700');
        expect(reply.content).toContain('5080');
      });

      it('should still record PB even when warning is shown', async () => {
        addInteraction.options.getInteger = jest.fn().mockReturnValue(4700);

        await discordCommands.handlePBAdd(addInteraction, addInteraction.options);

        const reply = addInteraction.editReply.mock.calls[0][0];
        expect(reply.content).toContain('Personal Best');
      });

      it('should handle distance_m provided but no best efforts extracted', async () => {
        addInteraction.options.getInteger = jest.fn().mockReturnValue(5000);
        discordCommands.pbManager.extractBestEfforts.mockReturnValue([]);
        discordCommands.pbManager.checkAndUpdatePBsFromEfforts.mockResolvedValue([]);

        await discordCommands.handlePBAdd(addInteraction, addInteraction.options);

        expect(addInteraction.editReply).toHaveBeenCalledWith(
          expect.objectContaining({ content: expect.stringContaining('no new Personal Bests') })
        );
      });

      it('should create synthetic effort when no best efforts exist and record PB', async () => {
        // Activity GPS = 4990m (< 5K), no best_efforts generated by Strava
        mockStravaAPI.getActivity.mockResolvedValue({
          id: 15730864623,
          name: 'City 5K Race',
          type: 'Run',
          start_date: '2024-06-01T09:00:00Z',
          elapsed_time: 1185,
          moving_time: 1180,
          distance: 4990,
          best_efforts: [],
        });
        addInteraction.options.getInteger = jest.fn().mockReturnValue(5000);
        discordCommands.pbManager.extractBestEfforts.mockReturnValue([]);
        discordCommands.pbManager.checkAndUpdatePBsFromEfforts.mockResolvedValue([
          { isNewPB: true, category: '5K', newPB: { elapsedTime: 1185 }, previousPB: null },
        ]);

        await discordCommands.handlePBAdd(addInteraction, addInteraction.options);

        // Synthetic effort should be passed to checkAndUpdatePBsFromEfforts
        const passedEfforts = discordCommands.pbManager.checkAndUpdatePBsFromEfforts.mock.calls[0][1];
        expect(passedEfforts).toHaveLength(1);
        expect(passedEfforts[0].distanceM).toBe(5000);
        expect(passedEfforts[0].elapsedTime).toBe(1185);
        expect(passedEfforts[0].category).toBe('5K');
      });

      it('should show 📝 note when synthetic effort is used', async () => {
        mockStravaAPI.getActivity.mockResolvedValue({
          id: 15730864623, name: 'Race', type: 'Run',
          start_date: '2024-06-01T09:00:00Z',
          elapsed_time: 1185, moving_time: 1180, distance: 4990,
          best_efforts: [],
        });
        addInteraction.options.getInteger = jest.fn().mockReturnValue(5000);
        discordCommands.pbManager.extractBestEfforts.mockReturnValue([]);
        discordCommands.pbManager.checkAndUpdatePBsFromEfforts.mockResolvedValue([
          { isNewPB: true, category: '5K', newPB: { elapsedTime: 1185 }, previousPB: null },
        ]);

        await discordCommands.handlePBAdd(addInteraction, addInteraction.options);

        const reply = addInteraction.editReply.mock.calls[0][0];
        expect(reply.content).toContain('📝');
        expect(reply.content).not.toContain('⚠️');
      });

      it('should use synthetic fallback when closest effort is beyond 15% threshold', async () => {
        // closest effort is 1 mile (1609m), override is 5000m → |1609-5000|/5000 = 67.8% > 15%
        mockStravaAPI.getActivity.mockResolvedValue({
          id: 15730864623, name: 'Short Run', type: 'Run',
          start_date: '2024-06-01T09:00:00Z',
          elapsed_time: 1185, moving_time: 1180, distance: 4990,
          best_efforts: [],
        });
        addInteraction.options.getInteger = jest.fn().mockReturnValue(5000);
        discordCommands.pbManager.extractBestEfforts.mockReturnValue([
          { category: '1 Mile', distanceM: 1609, elapsedTime: 380, movingTime: 375, activityId: 15730864623, activityName: 'Short Run', activityDate: '2024-06-01' },
        ]);
        discordCommands.pbManager.checkAndUpdatePBsFromEfforts.mockResolvedValue([
          { isNewPB: true, category: '5K', newPB: { elapsedTime: 1185 }, previousPB: null },
        ]);

        await discordCommands.handlePBAdd(addInteraction, addInteraction.options);

        const passedEfforts = discordCommands.pbManager.checkAndUpdatePBsFromEfforts.mock.calls[0][1];
        // Should have original 1 mile effort + synthetic 5K effort
        const syntheticEffort = passedEfforts.find(e => e.category === '5K' && e.distanceM === 5000);
        expect(syntheticEffort).toBeDefined();
        expect(syntheticEffort.elapsedTime).toBe(1185);

        const reply = addInteraction.editReply.mock.calls[0][0];
        expect(reply.content).toContain('📝');
      });

      it('should use "?" for distance when activity.distance is falsy', async () => {
        mockStravaAPI.getActivity.mockResolvedValue({
          id: 15730864623,
          name: 'Race',
          type: 'Run',
          start_date: '2024-06-01T09:00:00Z',
          elapsed_time: 1185,
          moving_time: 1180,
          distance: 0,
          best_efforts: [],
        });
        addInteraction.options.getInteger = jest.fn().mockReturnValue(5000);
        discordCommands.pbManager.extractBestEfforts.mockReturnValue([]);
        discordCommands.pbManager.checkAndUpdatePBsFromEfforts.mockResolvedValue([
          { isNewPB: true, category: '5K', newPB: { elapsedTime: 1185 }, previousPB: null },
        ]);

        await discordCommands.handlePBAdd(addInteraction, addInteraction.options);

        const reply = addInteraction.editReply.mock.calls[0][0];
        expect(reply.content).toContain('?');
      });

      it('should handle activity with no start_date gracefully', async () => {
        mockStravaAPI.getActivity.mockResolvedValue({
          id: 15730864623,
          name: 'Race',
          type: 'Run',
          start_date: null,
          elapsed_time: 1185,
          moving_time: 1180,
          distance: 4990,
          best_efforts: [],
        });
        addInteraction.options.getInteger = jest.fn().mockReturnValue(5000);
        discordCommands.pbManager.extractBestEfforts.mockReturnValue([]);
        discordCommands.pbManager.checkAndUpdatePBsFromEfforts.mockResolvedValue([
          { isNewPB: true, category: '5K', newPB: { elapsedTime: 1185 }, previousPB: null },
        ]);

        await discordCommands.handlePBAdd(addInteraction, addInteraction.options);

        expect(addInteraction.editReply).toHaveBeenCalled();
      });
    });
  });

  // ─── handlePBStatus ────────────────────────────────────────────────────────

  describe('handlePBStatus', () => {
    let statusInteraction;

    beforeEach(() => {
      statusInteraction = {
        user: { tag: 'Admin#0001', id: '999999' },
        memberPermissions: { has: jest.fn().mockReturnValue(true) },
        deferReply: jest.fn().mockResolvedValue(undefined),
        editReply: jest.fn().mockResolvedValue(undefined),
      };
      mockMemberManager.getAllMembers.mockResolvedValue([mockMember]);
      mockMemberManager.getMemberByDiscordId.mockResolvedValue(mockMember);
      discordCommands.pbManager.databaseManager.getPBSyncCursors.mockResolvedValue([]);
      discordCommands.pbManager.databaseManager.getPBCountByAthleteId.mockResolvedValue(3);
    });

    it('should defer with ephemeral: true', async () => {
      await discordCommands.handlePBStatus(statusInteraction, {});

      expect(statusInteraction.deferReply).toHaveBeenCalledWith({ ephemeral: true });
    });

    it('should reply with embed when user has ManageGuild permission', async () => {
      await discordCommands.handlePBStatus(statusInteraction, {});

      expect(statusInteraction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({ embeds: expect.any(Array) })
      );
    });

    it('should reply with permission error when user lacks ManageGuild', async () => {
      statusInteraction.memberPermissions.has.mockReturnValue(false);

      await discordCommands.handlePBStatus(statusInteraction, {});

      expect(statusInteraction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('permission') })
      );
      expect(discordCommands.pbManager.databaseManager.getPBSyncCursors).not.toHaveBeenCalled();
    });

    it('should show active syncs from pbSyncInProgress', async () => {
      discordCommands.pbSyncInProgress.add('888888');

      await discordCommands.handlePBStatus(statusInteraction, {});

      expect(statusInteraction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({ embeds: expect.any(Array) })
      );

      discordCommands.pbSyncInProgress.delete('888888');
    });

    it('should query getPBSyncCursors for interrupted syncs', async () => {
      discordCommands.pbManager.databaseManager.getPBSyncCursors.mockResolvedValue([
        { discordUserId: '555', cursor: '1750000000', updatedAt: '2026-03-19T00:00:00Z' },
      ]);

      await discordCommands.handlePBStatus(statusInteraction, {});

      expect(discordCommands.pbManager.databaseManager.getPBSyncCursors).toHaveBeenCalled();
      expect(statusInteraction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({ embeds: expect.any(Array) })
      );
    });

    it('should not list cursor as interrupted if userId is in pbSyncInProgress', async () => {
      discordCommands.pbSyncInProgress.add('555');
      discordCommands.pbManager.databaseManager.getPBSyncCursors.mockResolvedValue([
        { discordUserId: '555', cursor: '1750000000', updatedAt: '2026-03-19T00:00:00Z' },
      ]);
      discordCommands.pbManager.databaseManager.getPBCountByAthleteId.mockClear();

      await discordCommands.handlePBStatus(statusInteraction, {});

      // getPBCountByAthleteId should only be called for the member summary, not for '555' cursor
      const calls = discordCommands.pbManager.databaseManager.getPBCountByAthleteId.mock.calls;
      // none of the calls should have been for the discordUserId resolution path (cursor was filtered)
      expect(statusInteraction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({ embeds: expect.any(Array) })
      );

      discordCommands.pbSyncInProgress.delete('555');
    });

    it('should call getPBCountByAthleteId for each active member', async () => {
      await discordCommands.handlePBStatus(statusInteraction, {});

      expect(discordCommands.pbManager.databaseManager.getPBCountByAthleteId).toHaveBeenCalledWith(
        mockMember.athleteId
      );
    });

    it('should reply with error message on DB failure', async () => {
      discordCommands.pbManager.databaseManager.getPBSyncCursors.mockRejectedValue(new Error('DB fail'));

      await discordCommands.handlePBStatus(statusInteraction, {});

      expect(statusInteraction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining('Failed') })
      );
      expect(logger.discord.error).toHaveBeenCalledWith(
        'Error retrieving PB sync status',
        expect.any(Object)
      );
    });

    it('should handle getMemberByDiscordId returning null for a cursor entry', async () => {
      discordCommands.pbManager.databaseManager.getPBSyncCursors.mockResolvedValue([
        { discordUserId: 'unknown999', cursor: '1750000000', updatedAt: '2026-03-19T00:00:00Z' },
      ]);
      mockMemberManager.getMemberByDiscordId.mockResolvedValue(null);

      await discordCommands.handlePBStatus(statusInteraction, {});

      expect(statusInteraction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({ embeds: expect.any(Array) })
      );
    });

    it('should display member Discord mention when member has no athlete field', async () => {
      mockMemberManager.getAllMembers.mockResolvedValue([
        { discordUserId: '111222', athleteId: 99999, isActive: true },
      ]);

      await discordCommands.handlePBStatus(statusInteraction, {});

      expect(statusInteraction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({ embeds: expect.any(Array) })
      );
    });
  });
});