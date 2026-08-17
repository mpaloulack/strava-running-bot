const path = require('path');
const fs = require('fs').promises;
const os = require('os');
const { SQLiteSyncDialect } = require('drizzle-orm/sqlite-core');

// Used to render a drizzle-orm `where` condition object back into SQL text/params
// so tests can assert on which columns/values a query actually filters by,
// without depending on drizzle's internal object shape.
const sqlDialect = new SQLiteSyncDialect();

// Mock external dependencies but test the real DatabaseManager
jest.mock('../../src/utils/Logger', () => ({
  database: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
  },
  memberAction: jest.fn() // Add missing memberAction
}));

// Mock connection with a real database-like interface
const mockDb = {
  select: jest.fn(),
  from: jest.fn(),
  where: jest.fn(),
  orderBy: jest.fn().mockReturnValue(Promise.resolve([])), // Changed to return promise with array by default
  get: jest.fn(),
  all: jest.fn().mockReturnValue([]),
  insert: jest.fn(),
  values: jest.fn(),
  returning: jest.fn(),
  update: jest.fn(),
  set: jest.fn(),
  delete: jest.fn(),
  run: jest.fn().mockReturnValue({ changes: 1 }),
  transaction: jest.fn((callback) => () => callback())
};

// Set up chaining for mockDb methods
mockDb.select.mockReturnValue(mockDb);
mockDb.from.mockReturnValue(mockDb);
mockDb.where.mockReturnValue(mockDb);
mockDb.insert.mockReturnValue(mockDb);
mockDb.values.mockReturnValue(mockDb);
mockDb.returning.mockReturnValue(mockDb);
mockDb.update.mockReturnValue(mockDb);
mockDb.set.mockReturnValue(mockDb);
mockDb.delete.mockReturnValue(mockDb);

jest.mock('../../src/database/connection', () => ({
  initialize: jest.fn().mockResolvedValue(mockDb),
  close: jest.fn().mockResolvedValue(),
  backup: jest.fn().mockResolvedValue(),
  healthCheck: jest.fn().mockResolvedValue({ status: 'healthy' })
}));

jest.mock('../../src/managers/SettingsManager');

// Mock config to prevent environment variable requirements
jest.mock('../../config/config', () => ({
  database: {
    file: ':memory:'
  },
  strava: {
    clientId: 'test-client-id',
    clientSecret: 'test-client-secret'
  },
  discord: {
    token: 'test-token',
    channelId: 'test-channel'
  },
  webhook: {
    verifyToken: 'test-verify-token'
  },
  security: {
    // 64 hex characters = 32 bytes
    encryptionKey: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
  },
  server: {
    port: 3000
  }
}));

const config = require('../../config/config');
const logger = require('../../src/utils/Logger');
const dbConnection = require('../../src/database/connection');
const SettingsManager = require('../../src/managers/SettingsManager');
const EncryptionUtils = require('../../src/utils/EncryptionUtils');

// Import the real DatabaseManager to test
const DatabaseManager = require('../../src/database/DatabaseManager');

describe('DatabaseManager', () => {
  let testDataDir;
  let originalDbPath;
  let originalEncryptionKey;

  beforeEach(async () => {
    // Create temporary test directory
    testDataDir = path.join(os.tmpdir(), `db_test_${Date.now()}`);
    await fs.mkdir(testDataDir, { recursive: true });
    
    // Store and set test config
    originalDbPath = config.database?.path;
    originalEncryptionKey = config.database?.encryptionKey;
    
    config.database = {
      path: path.join(testDataDir, 'test.db'),
      encryptionKey: 'test-encryption-key-32-chars-long'
    };

    // Reset all mocks and state
    jest.clearAllMocks();
    dbConnection.initialize.mockResolvedValue(mockDb);

    // Re-setup chaining after clearAllMocks
    mockDb.select.mockReturnValue(mockDb);
    mockDb.from.mockReturnValue(mockDb);
    mockDb.where.mockReturnValue(mockDb);
    mockDb.insert.mockReturnValue(mockDb);
    mockDb.values.mockReturnValue(mockDb);
    mockDb.returning.mockReturnValue(mockDb);
    mockDb.update.mockReturnValue(mockDb);
    mockDb.set.mockReturnValue(mockDb);
    mockDb.delete.mockReturnValue(mockDb);
    mockDb.run.mockReturnValue({ changes: 1 });
    mockDb.transaction.mockImplementation((callback) => () => callback());

    // Reset DatabaseManager singleton state
    DatabaseManager.isInitialized = false;
    DatabaseManager.db = null;
    DatabaseManager.settingsManager = null;
  });

  afterEach(async () => {
    // Restore original config
    if (config.database) {
      config.database.path = originalDbPath;
      config.database.encryptionKey = originalEncryptionKey;
    }
    
    // Clean up test directory
    try {
      await fs.rm(testDataDir, { recursive: true, force: true });
    } catch (_error) {
      // Ignore cleanup errors
    }
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('initialization', () => {
    it('should initialize successfully', async () => {
      const mockSettingsManager = { initialize: jest.fn() };
      SettingsManager.mockImplementation(() => mockSettingsManager);
      
      await DatabaseManager.initialize();
      
      expect(DatabaseManager.isInitialized).toBe(true);
      expect(DatabaseManager.db).toBeDefined();
      expect(dbConnection.initialize).toHaveBeenCalled();
      expect(logger.database.info).toHaveBeenCalledWith('DatabaseManager initialized successfully');
    });

    it('should not reinitialize if already initialized', async () => {
      const mockSettingsManager = { initialize: jest.fn() };
      SettingsManager.mockImplementation(() => mockSettingsManager);
      
      await DatabaseManager.initialize();
      const firstDb = DatabaseManager.db;
      
      await DatabaseManager.initialize();
      
      expect(DatabaseManager.db).toBe(firstDb);
      expect(dbConnection.initialize).toHaveBeenCalledTimes(1);
    });
  });

  describe('member operations', () => {
    beforeEach(async () => {
      const mockSettingsManager = { initialize: jest.fn() };
      SettingsManager.mockImplementation(() => mockSettingsManager);
      
      // Mock the checkAndMigrateFromJson query that's called during initialize
      mockDb.get.mockResolvedValue(null); // No existing migration
      
      await DatabaseManager.initialize();
    });

    it('should register a new member successfully', async () => {
      const discordUserId = 'discord123';
      const athlete = { id: 12345, firstname: 'John', lastname: 'Doe' };
      const tokenData = { access_token: 'token', refresh_token: 'refresh' };
      
      const mockMember = {
        id: 1,
        athlete_id: parseInt(athlete.id),
        discord_id: discordUserId,
        athlete: JSON.stringify(athlete),
        is_active: 1,
        registeredAt: new Date()
      };
      
      // Mock the database operations for insert
      mockDb.insert.mockReturnValue({
        values: jest.fn().mockReturnThis()
      });
      
      // Mock getMemberByAthleteId calls - first returns null (no existing), then returns the new member
      mockDb.get
        .mockResolvedValueOnce(null) // getMemberByDiscordId - no existing
        .mockResolvedValueOnce(null) // getMemberByAthleteId - no existing  
        .mockResolvedValueOnce(mockMember); // getMemberByAthleteId - returns new member

      const result = await DatabaseManager.registerMember(discordUserId, athlete, tokenData);

      expect(result).toBeDefined();
      expect(result.athleteId).toBe(parseInt(athlete.id));
      expect(result.discordUserId).toBe(discordUserId);
      expect(mockDb.insert).toHaveBeenCalled();
    });

    it('should store the given provider on the inserted member row', async () => {
      const discordUserId = 'discord123';
      const athlete = { id: 12345, firstname: 'John', lastname: 'Doe' };
      const tokenData = { api_key: 'intervals-key' };

      const mockInsertChain = { values: jest.fn().mockReturnThis() };
      mockDb.insert.mockReturnValue(mockInsertChain);

      mockDb.get
        .mockResolvedValueOnce(null) // getMemberByDiscordId - no existing
        .mockResolvedValueOnce(null) // getMemberByAthleteId - no existing
        .mockResolvedValueOnce({ athlete_id: 12345, discord_id: discordUserId, provider: 'intervals' }); // getMemberByAthleteId after insert

      await DatabaseManager.registerMember(discordUserId, athlete, tokenData, null, 'intervals');

      expect(mockInsertChain.values).toHaveBeenCalledWith(
        expect.objectContaining({ provider: 'intervals' })
      );
    });

    it('should namespace tokens by provider when encrypting for a new member', async () => {
      const discordUserId = 'discord123';
      const athlete = { id: 12345, firstname: 'John', lastname: 'Doe' };
      const tokenData = { api_key: 'intervals-key' };

      const encryptSpy = jest.spyOn(EncryptionUtils, 'encryptTokensToJSON');

      const mockInsertChain = { values: jest.fn().mockReturnThis() };
      mockDb.insert.mockReturnValue(mockInsertChain);

      mockDb.get
        .mockResolvedValueOnce(null) // getMemberByDiscordId - no existing
        .mockResolvedValueOnce(null) // getMemberByAthleteId - no existing
        .mockResolvedValueOnce({ athlete_id: 12345, discord_id: discordUserId, provider: 'intervals' });

      await DatabaseManager.registerMember(discordUserId, athlete, tokenData, null, 'intervals');

      expect(encryptSpy).toHaveBeenCalledWith({ intervals: tokenData });

      encryptSpy.mockRestore();
    });

    it('should relink an existing member with fresh tokens and athlete/discord info', async () => {
      const existingAthleteId = 12345;
      const athlete = { id: 12345, firstname: 'John', lastname: 'Doe' };
      const tokenData = { access_token: 'new_token', refresh_token: 'new_refresh' };
      const discordUser = { username: 'jdoe', displayName: 'J Doe', discriminator: '0', avatar: 'abc' };

      const mockUpdateChain = {
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockResolvedValue(undefined)
      };
      mockDb.update.mockReturnValue(mockUpdateChain);

      const mockSelectChain = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        get: jest.fn().mockResolvedValue({
          athlete_id: existingAthleteId,
          discord_id: 'discord123',
          athlete: JSON.stringify(athlete),
          is_active: 1,
          encrypted_tokens: JSON.stringify({ iv: 'iv', encrypted: 'enc', authTag: 'tag' })
        })
      };
      mockDb.select.mockReturnValue(mockSelectChain);

      const result = await DatabaseManager.relinkMember(existingAthleteId, athlete, tokenData, discordUser);

      expect(mockDb.update).toHaveBeenCalled();
      expect(mockUpdateChain.set).toHaveBeenCalledWith(
        expect.objectContaining({
          athlete: JSON.stringify(athlete),
          discord_username: 'jdoe',
          encrypted_tokens: expect.any(String)
        })
      );
      expect(result.athleteId).toBe(existingAthleteId);
      expect(result.discordUserId).toBe('discord123');
    });

    it('should include the given provider in the relink update payload', async () => {
      const existingAthleteId = 12345;
      const athlete = { id: 12345, firstname: 'John', lastname: 'Doe' };
      const tokenData = { api_key: 'intervals-key' };

      const mockUpdateChain = {
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockResolvedValue(undefined)
      };
      mockDb.update.mockReturnValue(mockUpdateChain);

      const mockSelectChain = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        get: jest.fn().mockResolvedValue({
          athlete_id: existingAthleteId,
          discord_id: 'discord123',
          athlete: JSON.stringify(athlete),
          is_active: 1,
          provider: 'intervals',
          encrypted_tokens: JSON.stringify({ iv: 'iv', encrypted: 'enc', authTag: 'tag' })
        })
      };
      mockDb.select.mockReturnValue(mockSelectChain);

      await DatabaseManager.relinkMember(existingAthleteId, athlete, tokenData, null, 'intervals');

      expect(mockUpdateChain.set).toHaveBeenCalledWith(
        expect.objectContaining({ provider: 'intervals' })
      );
    });

    it('should renumber athlete_id and cascade into races/personal_bests/activities inside one transaction when the athlete id changes', async () => {
      const oldAthleteId = 12345;
      const newAthleteId = 99999;
      const athlete = { id: newAthleteId, firstname: 'Jane', lastname: 'Runner' };
      const tokenData = { api_key: 'intervals-key' };

      const mockUpdateChain = {
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        run: jest.fn().mockReturnValue({ changes: 1 })
      };
      mockDb.update.mockReturnValue(mockUpdateChain);

      const mockGet = jest.fn()
        .mockResolvedValueOnce(null) // token-preservation lookup at oldAthleteId - nothing to preserve
        .mockResolvedValueOnce(null) // conflict check at newAthleteId - no conflict
        .mockResolvedValueOnce({    // final fetch at newAthleteId after the transaction
          athlete_id: newAthleteId,
          discord_id: 'discord123',
          athlete: JSON.stringify(athlete),
          is_active: 1,
          provider: 'intervals'
        });

      mockDb.select.mockReturnValue({
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        get: mockGet
      });

      const result = await DatabaseManager.relinkMember(oldAthleteId, athlete, tokenData, null, 'intervals');

      expect(mockDb.transaction).toHaveBeenCalled();
      // members row renumbered + provider switched
      expect(mockUpdateChain.set).toHaveBeenNthCalledWith(1, expect.objectContaining({
        athlete_id: newAthleteId,
        provider: 'intervals'
      }));
      // races, personal_bests, activities all repointed at the new id
      expect(mockUpdateChain.set).toHaveBeenNthCalledWith(2, { member_athlete_id: newAthleteId });
      expect(mockUpdateChain.set).toHaveBeenNthCalledWith(3, { member_athlete_id: newAthleteId });
      expect(mockUpdateChain.set).toHaveBeenNthCalledWith(4, { member_athlete_id: newAthleteId });
      expect(mockUpdateChain.where).toHaveBeenCalledTimes(4);
      expect(mockUpdateChain.run).toHaveBeenCalledTimes(4);

      expect(result.athleteId).toBe(newAthleteId);
    });

    it('should reject the relink when another member already owns the target athlete id', async () => {
      const oldAthleteId = 12345;
      const newAthleteId = 99999;
      const athlete = { id: newAthleteId, firstname: 'Jane', lastname: 'Runner' };
      const tokenData = { api_key: 'intervals-key' };

      const mockGet = jest.fn()
        .mockResolvedValueOnce(null) // token-preservation lookup at oldAthleteId - nothing to preserve
        .mockResolvedValueOnce({    // conflict check at newAthleteId - ALREADY TAKEN
          athlete_id: newAthleteId,
          discord_id: 'someone-else',
          is_active: 1
        });

      mockDb.select.mockReturnValue({
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        get: mockGet
      });

      await expect(
        DatabaseManager.relinkMember(oldAthleteId, athlete, tokenData, null, 'intervals')
      ).rejects.toThrow(/already registered to a different member/);

      expect(mockDb.update).not.toHaveBeenCalled();
      expect(mockDb.transaction).not.toHaveBeenCalled();
    });

    it('should keep the single-update path (no transaction, no renumbering) when the athlete id is unchanged', async () => {
      const existingAthleteId = 12345;
      const athlete = { id: existingAthleteId, firstname: 'Jane', lastname: 'Runner' };
      const tokenData = { api_key: 'intervals-key' };

      const mockUpdateChain = {
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockResolvedValue(undefined)
      };
      mockDb.update.mockReturnValue(mockUpdateChain);

      mockDb.select.mockReturnValue({
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        get: jest.fn().mockResolvedValue({
          athlete_id: existingAthleteId,
          discord_id: 'discord123',
          athlete: JSON.stringify(athlete),
          is_active: 1,
          provider: 'strava'
        })
      });

      await DatabaseManager.relinkMember(existingAthleteId, athlete, tokenData, null, 'intervals');

      expect(mockDb.transaction).not.toHaveBeenCalled();
      expect(mockUpdateChain.set).toHaveBeenCalledTimes(1);
      expect(mockUpdateChain.set).toHaveBeenCalledWith(
        expect.objectContaining({ provider: 'intervals' })
      );
      // athlete_id itself is never part of the single-update payload
      expect(mockUpdateChain.set.mock.calls[0][0]).not.toHaveProperty('athlete_id');
    });

    it('should preserve the existing strava namespace when switching to intervals (same id)', async () => {
      const existingAthleteId = 12345;
      const athlete = { id: existingAthleteId, firstname: 'Jane', lastname: 'Runner' };
      const tokenData = { api_key: 'new-intervals-key' };

      // Legacy flat Strava blob - normalizes to { strava: {...} }
      const decryptSpy = jest.spyOn(EncryptionUtils, 'decryptTokens').mockReturnValue({
        access_token: 'preserved_strava_token',
        refresh_token: 'preserved_refresh',
        expires_at: 111
      });
      const encryptSpy = jest.spyOn(EncryptionUtils, 'encryptTokensToJSON');

      const mockUpdateChain = {
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockResolvedValue(undefined)
      };
      mockDb.update.mockReturnValue(mockUpdateChain);

      mockDb.select.mockReturnValue({
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        get: jest.fn().mockResolvedValue({
          athlete_id: existingAthleteId,
          discord_id: 'discord123',
          athlete: JSON.stringify(athlete),
          is_active: 1,
          provider: 'strava',
          encrypted_tokens: JSON.stringify({ iv: 'iv', encrypted: 'enc', authTag: 'tag' })
        })
      });

      await DatabaseManager.relinkMember(existingAthleteId, athlete, tokenData, null, 'intervals');

      expect(encryptSpy).toHaveBeenCalledWith({
        strava: { access_token: 'preserved_strava_token', refresh_token: 'preserved_refresh', expires_at: 111 },
        intervals: tokenData
      });

      decryptSpy.mockRestore();
      encryptSpy.mockRestore();
    });

    it('should preserve the existing intervals namespace when switching back to strava (same id)', async () => {
      const existingAthleteId = 12345;
      const athlete = { id: existingAthleteId, firstname: 'Jane', lastname: 'Runner' };
      const tokenData = { access_token: 'new_strava_token', refresh_token: 'new_refresh', expires_at: 222 };

      // Already-namespaced blob with only intervals stored
      const decryptSpy = jest.spyOn(EncryptionUtils, 'decryptTokens').mockReturnValue({
        intervals: { api_key: 'preserved_intervals_key' }
      });
      const encryptSpy = jest.spyOn(EncryptionUtils, 'encryptTokensToJSON');

      const mockUpdateChain = {
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockResolvedValue(undefined)
      };
      mockDb.update.mockReturnValue(mockUpdateChain);

      mockDb.select.mockReturnValue({
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        get: jest.fn().mockResolvedValue({
          athlete_id: existingAthleteId,
          discord_id: 'discord123',
          athlete: JSON.stringify(athlete),
          is_active: 1,
          provider: 'intervals',
          encrypted_tokens: JSON.stringify({ iv: 'iv', encrypted: 'enc', authTag: 'tag' })
        })
      });

      await DatabaseManager.relinkMember(existingAthleteId, athlete, tokenData, null, 'strava');

      expect(encryptSpy).toHaveBeenCalledWith({
        intervals: { api_key: 'preserved_intervals_key' },
        strava: tokenData
      });

      decryptSpy.mockRestore();
      encryptSpy.mockRestore();
    });

    it('should throw and not update the row when token encryption fails during relink', async () => {
      const existingAthleteId = 12345;
      const athlete = { id: 12345, firstname: 'John', lastname: 'Doe' };
      const tokenData = { access_token: 'token' };

      jest.spyOn(EncryptionUtils, 'encryptTokensToJSON').mockImplementation(() => {
        throw new Error('Invalid key length');
      });

      await expect(
        DatabaseManager.relinkMember(existingAthleteId, athlete, tokenData)
      ).rejects.toThrow('Invalid key length');

      expect(mockDb.update).not.toHaveBeenCalled();

      EncryptionUtils.encryptTokensToJSON.mockRestore();
    });

    it('should throw and not insert the member when token encryption fails', async () => {
      const discordUserId = 'discord123';
      const athlete = { id: 12345, firstname: 'John', lastname: 'Doe' };
      const tokenData = { access_token: 'token', refresh_token: 'refresh' };

      mockDb.get
        .mockResolvedValueOnce(null) // getMemberByDiscordId - no existing
        .mockResolvedValueOnce(null); // getMemberByAthleteId - no existing

      jest.spyOn(EncryptionUtils, 'encryptTokensToJSON').mockImplementation(() => {
        throw new Error('Invalid key length');
      });

      await expect(
        DatabaseManager.registerMember(discordUserId, athlete, tokenData)
      ).rejects.toThrow('Invalid key length');

      expect(mockDb.insert).not.toHaveBeenCalled();

      EncryptionUtils.encryptTokensToJSON.mockRestore();
    });

    it('should get member by athlete ID', async () => {
      const athleteId = 12345;
      const memberData = {
        id: 1,
        athlete_id: athleteId,
        athlete_firstname: 'John',
        athlete_lastname: 'Doe',
        discord_user_id: 'discord123',
        is_active: true
      };
      
      mockDb.get.mockResolvedValue(memberData);

      const result = await DatabaseManager.getMemberByAthleteId(athleteId);
      
      // The result goes through decryptMember which transforms the data
      expect(result).toBeDefined();
      expect(result.athleteId).toBe(athleteId);
      expect(mockDb.select).toHaveBeenCalled();
    });

    it('should get all active members', async () => {
      const membersData = [
        { id: 1, athlete_id: 12345, is_active: true },
        { id: 2, athlete_id: 67890, is_active: true }
      ];
      
      // Mock the chained query - orderBy should return promise with data
      mockDb.orderBy.mockReturnValue(Promise.resolve(membersData));

      const result = await DatabaseManager.getAllMembers();
      
      // The result goes through decryptMember transformation, so expect an array
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(2);
      expect(mockDb.select).toHaveBeenCalled();
    });

    it('should update member tokens', async () => {
      const athleteId = 12345;
      const tokenData = { access_token: 'new_token', refresh_token: 'new_refresh' };

      // Mock returning some result to indicate success
      mockDb.returning.mockResolvedValue([{ athlete_id: athleteId }]);

      const result = await DatabaseManager.updateTokens(athleteId, tokenData);

      // updateTokens now returns the updated member object
      expect(result).toEqual({ athlete_id: athleteId });
      expect(mockDb.update).toHaveBeenCalled();
    });

    it('should merge the new tokens with the OTHER provider namespace already stored for the member', async () => {
      const athleteId = 12345;
      const tokenData = { access_token: 'refreshed_strava_token', refresh_token: 'r', expires_at: 999 };

      const decryptSpy = jest.spyOn(EncryptionUtils, 'decryptTokens').mockReturnValue({
        intervals: { api_key: 'preserved_intervals_key' }
      });
      const encryptSpy = jest.spyOn(EncryptionUtils, 'encryptTokensToJSON');

      mockDb.select.mockReturnValue({
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        get: jest.fn().mockResolvedValue({
          athlete_id: athleteId,
          discord_id: 'discord123',
          encrypted_tokens: JSON.stringify({ iv: 'iv', encrypted: 'enc', authTag: 'tag' })
        })
      });
      mockDb.returning.mockResolvedValue([{ athlete_id: athleteId }]);

      await DatabaseManager.updateTokens(athleteId, tokenData, 'strava');

      expect(encryptSpy).toHaveBeenCalledWith({
        intervals: { api_key: 'preserved_intervals_key' },
        strava: tokenData
      });

      decryptSpy.mockRestore();
      encryptSpy.mockRestore();
    });

    it('should default provider to strava and preserve an existing intervals namespace with no explicit provider arg', async () => {
      const athleteId = 12345;
      const tokenData = { access_token: 'refreshed_token' };

      const decryptSpy = jest.spyOn(EncryptionUtils, 'decryptTokens').mockReturnValue({
        api_key: 'legacy_intervals_key' // legacy flat intervals blob
      });
      const encryptSpy = jest.spyOn(EncryptionUtils, 'encryptTokensToJSON');

      mockDb.select.mockReturnValue({
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        get: jest.fn().mockResolvedValue({
          athlete_id: athleteId,
          encrypted_tokens: JSON.stringify({ iv: 'iv', encrypted: 'enc', authTag: 'tag' })
        })
      });
      mockDb.returning.mockResolvedValue([{ athlete_id: athleteId }]);

      await DatabaseManager.updateTokens(athleteId, tokenData);

      expect(encryptSpy).toHaveBeenCalledWith({
        intervals: { api_key: 'legacy_intervals_key' },
        strava: tokenData
      });

      decryptSpy.mockRestore();
      encryptSpy.mockRestore();
    });

    it('should deactivate member', async () => {
      const athleteId = 12345;
      
      // Mock returning some result to indicate success
      mockDb.returning.mockResolvedValue([{ 
        athlete_id: athleteId, 
        updated_at: new Date() 
      }]);
      
      const result = await DatabaseManager.deactivateMember(athleteId);
      
      // deactivateMember returns a boolean, not an object
      expect(result).toBe(true);
      expect(mockDb.update).toHaveBeenCalled();
    });
  });

  describe('statistics and utilities', () => {
    beforeEach(async () => {
      const mockSettingsManager = { initialize: jest.fn() };
      SettingsManager.mockImplementation(() => mockSettingsManager);
      
      // Mock the checkAndMigrateFromJson query that's called during initialize
      mockDb.get.mockResolvedValue(null); // No existing migration
      
      await DatabaseManager.initialize();
    });

    it('should return member statistics', async () => {
      // Each select() call creates a new chain, we need to mock each step
      const mockSelectChain1 = { from: jest.fn().mockResolvedValue([{ count: 10 }]) };
      const mockSelectChain2 = { from: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue([{ count: 8 }]) }) };
      const mockSelectChain3 = { from: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue([{ count: 2 }]) }) };
      const mockSelectChain4 = { from: jest.fn().mockResolvedValue([{ count: 5 }]) };
      const mockSelectChain5 = { from: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue([{ count: 2 }]) }) };

      mockDb.select
        .mockReturnValueOnce(mockSelectChain1)  // totalMembers
        .mockReturnValueOnce(mockSelectChain2)  // activeMembers 
        .mockReturnValueOnce(mockSelectChain3)  // inactiveMembers
        .mockReturnValueOnce(mockSelectChain4)  // totalRaces
        .mockReturnValueOnce(mockSelectChain5); // upcomingRaces

      const result = await DatabaseManager.getStats();
      
      expect(result).toEqual({
        members: {
          total: 10,
          active: 8,
          inactive: 2
        },
        races: {
          total: 5,
          upcoming: 2
        }
      });
    });

    it('should backup database', async () => {
      const backupPath = '/path/to/backup.db';
      
      await DatabaseManager.backup(backupPath);
      
      expect(dbConnection.backup).toHaveBeenCalledWith(backupPath);
    });

    it('should perform health check', async () => {
      const healthResult = { status: 'healthy' };
      dbConnection.healthCheck.mockResolvedValue(healthResult);
      
      const result = await DatabaseManager.healthCheck();
      
      expect(result).toEqual(healthResult);
    });
  });

  describe('encryption', () => {
    it('should encrypt and decrypt data', () => {
      const testData = 'sensitive-data';
      
      const encrypted = DatabaseManager.encryptData(testData);
      const decrypted = DatabaseManager.decryptData(encrypted);
      
      expect(decrypted).toBe(testData);
    });

    it('should return original data when no encryption key', () => {
      const originalKey = config.database.encryptionKey;
      config.database.encryptionKey = null;
      
      const testData = 'test-data';
      const encrypted = DatabaseManager.encryptData(testData);
      
      // When no encryption key, data is JSON stringified
      expect(encrypted).toBe(JSON.stringify(testData));
      
      config.database.encryptionKey = originalKey;
    });
  });

  describe('ensureInitialized', () => {
    it('should not reinitialize if already initialized', async () => {
      DatabaseManager.isInitialized = true;
      await DatabaseManager.ensureInitialized();
      // Should not call initialize again
      expect(DatabaseManager.isInitialized).toBe(true);
    });
  });

  describe('close', () => {
    it('should close database connection', async () => {
      const dbConnection = require('../../src/database/connection');
      await DatabaseManager.close();
      expect(dbConnection.close).toHaveBeenCalled();
    });
  });

  describe('getStats', () => {
    it('should return statistics', async () => {
      // Mock the count queries
      const mockCountChain = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        get: jest.fn()
          .mockResolvedValueOnce({ count: 5 })  // total members
          .mockResolvedValueOnce({ count: 3 })  // total races
          .mockResolvedValueOnce({ count: 2 })  // upcoming races
      };

      mockDb.select.mockReturnValue(mockCountChain);

      const stats = await DatabaseManager.getStats();

      expect(stats).toBeDefined();
      expect(stats.members).toBeDefined();
      expect(stats.races).toBeDefined();
    });
  });

  describe('decryptMember', () => {
    it('should decrypt member data when tokens exist', () => {
      const encryptedMember = {
        athlete_id: 12345,
        discord_user_id: 'discord123',
        athlete: JSON.stringify({ id: 12345, firstname: 'John' }),
        is_active: 1,
        encrypted_tokens: JSON.stringify({ access: 'token' }),
        discord_username: 'user',
        discord_display_name: 'User Name'
      };

      const result = DatabaseManager.decryptMember(encryptedMember);

      expect(result).toBeDefined();
      expect(result.athleteId).toBe(12345);
      expect(result.discordUserId).toBe('discord123');
      expect(result.isActive).toBe(true);
      expect(result.tokens).toBeDefined();
    });

    it('should handle member without tokens', () => {
      const member = {
        athlete_id: 12345,
        discord_user_id: 'discord123',
        athlete: JSON.stringify({ id: 12345, firstname: 'John' }),
        is_active: 1
      };

      const result = DatabaseManager.decryptMember(member);

      expect(result).toBeDefined();
      expect(result.athleteId).toBe(12345);
      expect(result.discordUserId).toBe('discord123');
      expect(result.tokens).toBeNull();
    });

    it('should default provider to strava when column is missing', () => {
      const member = {
        athlete_id: 12345,
        discord_user_id: 'discord123',
        athlete: JSON.stringify({ id: 12345, firstname: 'John' }),
        is_active: 1
      };

      const result = DatabaseManager.decryptMember(member);

      expect(result.provider).toBe('strava');
    });

    it('should preserve a non-default provider value', () => {
      const member = {
        athlete_id: 12345,
        discord_user_id: 'discord123',
        athlete: JSON.stringify({ id: 12345, firstname: 'John' }),
        is_active: 1,
        provider: 'intervals'
      };

      const result = DatabaseManager.decryptMember(member);

      expect(result.provider).toBe('intervals');
    });
  });

  describe('getMemberByDiscordId', () => {
    it('should return member when found', async () => {
      const mockMember = {
        athlete_id: 12345,
        discord_user_id: 'discord123',
        athlete: JSON.stringify({ id: 12345, firstname: 'John' }),
        is_active: 1
      };

      const mockSelectChain = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        get: jest.fn().mockResolvedValue(mockMember)
      };

      mockDb.select.mockReturnValue(mockSelectChain);

      const result = await DatabaseManager.getMemberByDiscordId('discord123');

      expect(result).toBeDefined();
      expect(result.athleteId).toBe(12345);
      expect(result.discordUserId).toBe('discord123');
    });

    it('should return null when member not found', async () => {
      const mockSelectChain = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        get: jest.fn().mockResolvedValue(null)
      };

      mockDb.select.mockReturnValue(mockSelectChain);

      const result = await DatabaseManager.getMemberByDiscordId('nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('reactivateMember', () => {
    it('should reactivate a member successfully', async () => {
      const mockUpdateChain = {
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        returning: jest.fn().mockResolvedValue([{ athlete_id: 12345, is_active: 1 }])
      };

      mockDb.update.mockReturnValue(mockUpdateChain);

      const result = await DatabaseManager.reactivateMember(12345);

      expect(result).toBe(true);
      expect(mockDb.update).toHaveBeenCalled();
    });

    it('should return false when member not found', async () => {
      const mockUpdateChain = {
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        returning: jest.fn().mockResolvedValue([])
      };

      mockDb.update.mockReturnValue(mockUpdateChain);

      const result = await DatabaseManager.reactivateMember(99999);

      expect(result).toBe(false);
    });
  });

  describe('addRace', () => {
    beforeEach(() => {
      // Skip initialization for these tests
      DatabaseManager.isInitialized = true;
      DatabaseManager.db = mockDb;
    });

    it('should add a race for an active member', async () => {
      const mockMember = {
        athlete_id: 12345,
        is_active: 1
      };

      const mockRace = {
        id: 1,
        member_athlete_id: 12345,
        name: 'Boston Marathon',
        race_date: '2025-04-21',
        status: 'registered'
      };

      // Mock getMemberByAthleteId
      const mockSelectChain = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        get: jest.fn().mockResolvedValue(mockMember)
      };
      mockDb.select.mockReturnValue(mockSelectChain);

      // Mock insert
      const mockInsertChain = {
        values: jest.fn().mockReturnThis(),
        returning: jest.fn().mockResolvedValue([mockRace])
      };
      mockDb.insert.mockReturnValue(mockInsertChain);

      const raceData = {
        name: 'Boston Marathon',
        raceDate: '2025-04-21',
        distance: '42.2km'
      };

      const result = await DatabaseManager.addRace(12345, raceData);

      expect(result).toBeDefined();
      expect(result.id).toBe(1);
    });

    it('should throw error if member not found', async () => {
      const mockSelectChain = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        get: jest.fn().mockResolvedValue(null)
      };
      mockDb.select.mockReturnValue(mockSelectChain);

      const raceData = { name: 'Test Race', raceDate: '2025-04-21' };

      await expect(
        DatabaseManager.addRace(99999, raceData)
      ).rejects.toThrow('Member not found or inactive');
    });

    it('should throw error if member is inactive', async () => {
      const mockMember = {
        athlete_id: 12345,
        is_active: 0
      };

      const mockSelectChain = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        get: jest.fn().mockResolvedValue(mockMember)
      };
      mockDb.select.mockReturnValue(mockSelectChain);

      const raceData = { name: 'Test Race', raceDate: '2025-04-21' };

      await expect(
        DatabaseManager.addRace(12345, raceData)
      ).rejects.toThrow('Member not found or inactive');
    });
  });

  describe('updateRace', () => {
    beforeEach(() => {
      DatabaseManager.isInitialized = true;
      DatabaseManager.db = mockDb;
    });

    it('should update a race successfully', async () => {
      const updates = { distance: '42.195km' };
      const updatedRace = { id: 1, distance: '42.195km' };

      const mockUpdateChain = {
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        returning: jest.fn().mockResolvedValue([updatedRace])
      };
      mockDb.update.mockReturnValue(mockUpdateChain);

      const result = await DatabaseManager.updateRace(1, updates);

      expect(result).toBeDefined();
      expect(result.distance).toBe('42.195km');
    });

    it('should return null if race not found', async () => {
      const mockUpdateChain = {
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        returning: jest.fn().mockResolvedValue([])
      };
      mockDb.update.mockReturnValue(mockUpdateChain);

      const result = await DatabaseManager.updateRace(999, { distance: '10km' });

      expect(result).toBeNull();
    });
  });

  describe('removeRace', () => {
    beforeEach(() => {
      DatabaseManager.isInitialized = true;
      DatabaseManager.db = mockDb;
    });

    it('should remove a race successfully', async () => {
      const mockRace = { id: 1, name: 'Test Race' };

      // Mock the select to get the race
      const mockSelectChain = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        get: jest.fn().mockResolvedValue(mockRace)
      };
      mockDb.select.mockReturnValue(mockSelectChain);

      // Mock the delete
      const mockDeleteChain = {
        where: jest.fn().mockResolvedValue()
      };
      mockDb.delete.mockReturnValue(mockDeleteChain);

      const result = await DatabaseManager.removeRace(1);

      expect(result).toBeDefined();
      expect(result.id).toBe(1);
    });

    it('should return null if race not found', async () => {
      const mockSelectChain = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        get: jest.fn().mockResolvedValue(null)
      };
      mockDb.select.mockReturnValue(mockSelectChain);

      const result = await DatabaseManager.removeRace(999);

      expect(result).toBeNull();
    });
  });

  describe('getMemberRaces', () => {
    beforeEach(() => {
      DatabaseManager.isInitialized = true;
      DatabaseManager.db = mockDb;
    });

    it('should return all races for a member', async () => {
      const mockRaces = [
        { id: 1, name: 'Race 1', race_date: '2025-04-21' },
        { id: 2, name: 'Race 2', race_date: '2025-05-15' }
      ];

      const mockSelectChain = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockResolvedValue(mockRaces)
      };
      mockDb.select.mockReturnValue(mockSelectChain);

      const result = await DatabaseManager.getMemberRaces(12345);

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(2);
    });

    it('should filter by status when provided', async () => {
      const mockRaces = [{ id: 1, status: 'registered' }];

      const mockWhereChain = jest.fn().mockReturnThis();
      const mockSelectChain = {
        from: jest.fn().mockReturnThis(),
        where: mockWhereChain,
        orderBy: jest.fn().mockResolvedValue(mockRaces)
      };
      mockDb.select.mockReturnValue(mockSelectChain);

      const result = await DatabaseManager.getMemberRaces(12345, { status: 'registered' });

      expect(result.length).toBe(1);
      expect(mockWhereChain).toHaveBeenCalled();
    });
  });

  describe('getUpcomingRaces', () => {
    beforeEach(() => {
      DatabaseManager.isInitialized = true;
      DatabaseManager.db = mockDb;
    });

    it('should return upcoming races within days ahead', async () => {
      const mockRaces = [
        { id: 1, race_date: '2025-11-01', status: 'registered' }
      ];

      const mockSelectChain = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockResolvedValue(mockRaces)
      };
      mockDb.select.mockReturnValue(mockSelectChain);

      const result = await DatabaseManager.getUpcomingRaces(30);

      expect(Array.isArray(result)).toBe(true);
    });

    it('should use default 30 days if not specified', async () => {
      const mockSelectChain = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockResolvedValue([])
      };
      mockDb.select.mockReturnValue(mockSelectChain);

      await DatabaseManager.getUpcomingRaces();

      expect(mockSelectChain.from).toHaveBeenCalled();
    });
  });

  describe('getAllRaces', () => {
    beforeEach(() => {
      DatabaseManager.isInitialized = true;
      DatabaseManager.db = mockDb;
    });

    it('should return all races ordered by date', async () => {
      const mockRaces = [
        { id: 1, race_date: '2025-12-01' },
        { id: 2, race_date: '2025-11-01' }
      ];

      const mockSelectChain = {
        from: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockResolvedValue(mockRaces)
      };
      mockDb.select.mockReturnValue(mockSelectChain);

      const result = await DatabaseManager.getAllRaces();

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(2);
    });

    it('should filter by status when provided', async () => {
      const mockSelectChain = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockResolvedValue([])
      };
      mockDb.select.mockReturnValue(mockSelectChain);

      await DatabaseManager.getAllRaces({ status: 'completed' });

      expect(mockSelectChain.where).toHaveBeenCalled();
    });
  });

  describe('getRacesByDateRange', () => {
    beforeEach(() => {
      DatabaseManager.isInitialized = true;
      DatabaseManager.db = mockDb;
    });

    it('should return races within date range', async () => {
      const mockRaces = [
        { id: 1, race_date: '2025-04-15' }
      ];

      const mockSelectChain = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockResolvedValue(mockRaces)
      };
      mockDb.select.mockReturnValue(mockSelectChain);

      const result = await DatabaseManager.getRacesByDateRange('2025-04-01', '2025-04-30');

      expect(Array.isArray(result)).toBe(true);
    });

    it('should filter by status when provided in options', async () => {
      const mockSelectChain = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockResolvedValue([])
      };
      mockDb.select.mockReturnValue(mockSelectChain);

      await DatabaseManager.getRacesByDateRange('2025-04-01', '2025-04-30', { status: 'registered' });

      expect(mockSelectChain.where).toHaveBeenCalled();
    });
  });

  describe('removeMember', () => {
    beforeEach(() => {
      DatabaseManager.isInitialized = true;
      DatabaseManager.db = mockDb;
      
      // Mock transaction to return a function that executes the callback
      mockDb.transaction = jest.fn((callback) => {
        return async () => await callback();
      });
    });

    it('should remove member with transaction', async () => {
      const mockDbMember = {
        athlete_id: 12345,
        discord_user_id: '999',
        athlete: JSON.stringify({ firstname: 'Test' }),
        is_active: false,
        encrypted_tokens: null,
        discord_username: undefined,
        discord_display_name: undefined,
        discord_discriminator: '0',
        discord_avatar: undefined,
        registered_at: undefined,
        updated_at: undefined
      };

      // Mock getMemberByAthleteId to return the decrypted format
      const mockSelectChain = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        get: jest.fn().mockResolvedValue(mockDbMember)
      };
      mockDb.select.mockReturnValue(mockSelectChain);

      // Mock deletes for races and member
      const mockDeleteChain = {
        where: jest.fn().mockReturnThis(),
        run: jest.fn().mockReturnValue({ changes: 1 })
      };
      mockDb.delete.mockReturnValue(mockDeleteChain);

      const result = await DatabaseManager.removeMember(12345);

      // The result should be the decrypted member format
      expect(result).toEqual({
        discordUserId: '999',
        athlete: { firstname: 'Test' },
        athleteId: 12345,
        isActive: false,
        provider: 'strava',
        registeredAt: undefined,
        lastTokenRefresh: undefined,
        discordUser: {
          username: undefined,
          displayName: undefined,
          discriminator: '0',
          avatar: undefined
        },
        tokens: null
      });
      expect(mockDb.transaction).toHaveBeenCalled();
    });

    it('should return null if member not found', async () => {
      const mockSelectChain = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        get: jest.fn().mockResolvedValue(null)
      };
      mockDb.select.mockReturnValue(mockSelectChain);

      const result = await DatabaseManager.removeMember(99999);

      expect(result).toBe(null);
    });
  });

  describe('initializeSettings', () => {
    it('should initialize settings manager', async () => {
      DatabaseManager.db = mockDb;
      
      await DatabaseManager.initializeSettings();

      expect(DatabaseManager.settingsManager).toBeDefined();
    });
  });

  // Note: JSON migration methods (migrateFromJson, migrateSingleMember) are complex
  // and depend on file system operations. These are better tested with integration tests.

  describe('upsertActivity', () => {
    beforeEach(() => {
      DatabaseManager.isInitialized = true;
      DatabaseManager.db = mockDb;
    });

    const mockActivity = {
      id: 98765,
      name: 'Morning Run',
      type: 'Run',
      sport_type: 'Run',
      distance: 5000.5,
      moving_time: 1800,
      elapsed_time: 1850,
      total_elevation_gain: 50.3,
      average_speed: 2.77,
      max_speed: 3.5,
      average_heartrate: 145.2,
      max_heartrate: 170,
      start_date: '2026-03-19T07:00:00Z',
      start_date_local: '2026-03-19T08:00:00+01:00',
      timezone: 'Europe/Paris',
      map: { summary_polyline: 'abcdef123' },
      has_heartrate: true,
    };

    it('should insert a new activity with all mapped fields', async () => {
      const mockInsertChain = {
        values: jest.fn().mockReturnThis(),
        onConflictDoUpdate: jest.fn().mockResolvedValue(undefined),
      };
      mockDb.insert.mockReturnValue(mockInsertChain);

      await DatabaseManager.upsertActivity(12345, mockActivity);

      expect(mockDb.insert).toHaveBeenCalled();
      expect(mockInsertChain.values).toHaveBeenCalledWith(
        expect.objectContaining({
          strava_activity_id: '98765',
          member_athlete_id: 12345,
          name: 'Morning Run',
          type: 'Run',
          sport_type: 'Run',
          distance: 5000.5,
          moving_time: 1800,
          elapsed_time: 1850,
          total_elevation_gain: 50.3,
          average_speed: 2.77,
          max_speed: 3.5,
          average_heartrate: 145.2,
          max_heartrate: 170,
          start_date: '2026-03-19T07:00:00Z',
          start_date_local: '2026-03-19T08:00:00+01:00',
          timezone: 'Europe/Paris',
          map_summary_polyline: 'abcdef123',
          has_heartrate: 1,
        })
      );
      expect(mockInsertChain.onConflictDoUpdate).toHaveBeenCalled();
    });

    it('should convert activity.id to string for strava_activity_id', async () => {
      const mockInsertChain = {
        values: jest.fn().mockReturnThis(),
        onConflictDoUpdate: jest.fn().mockResolvedValue(undefined),
      };
      mockDb.insert.mockReturnValue(mockInsertChain);

      await DatabaseManager.upsertActivity(12345, { ...mockActivity, id: 123456789012345 });

      expect(mockInsertChain.values).toHaveBeenCalledWith(
        expect.objectContaining({ strava_activity_id: '123456789012345' })
      );
    });

    it('should handle null optional fields gracefully', async () => {
      const mockInsertChain = {
        values: jest.fn().mockReturnThis(),
        onConflictDoUpdate: jest.fn().mockResolvedValue(undefined),
      };
      mockDb.insert.mockReturnValue(mockInsertChain);

      const minimalActivity = { id: 1, name: 'Run', type: 'Run' };
      await DatabaseManager.upsertActivity(12345, minimalActivity);

      expect(mockInsertChain.values).toHaveBeenCalledWith(
        expect.objectContaining({
          strava_activity_id: '1',
          distance: null,
          average_heartrate: null,
          map_summary_polyline: null,
          has_heartrate: 0,
        })
      );
    });

    it('should use onConflictDoUpdate to upsert existing activity', async () => {
      const mockInsertChain = {
        values: jest.fn().mockReturnThis(),
        onConflictDoUpdate: jest.fn().mockResolvedValue(undefined),
      };
      mockDb.insert.mockReturnValue(mockInsertChain);

      await DatabaseManager.upsertActivity(12345, mockActivity);

      expect(mockInsertChain.onConflictDoUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          target: expect.anything(),
          set: expect.objectContaining({ strava_activity_id: '98765' }),
        })
      );
    });

    it('should default provider to strava when not specified', async () => {
      const mockInsertChain = {
        values: jest.fn().mockReturnThis(),
        onConflictDoUpdate: jest.fn().mockResolvedValue(undefined),
      };
      mockDb.insert.mockReturnValue(mockInsertChain);

      await DatabaseManager.upsertActivity(12345, mockActivity);

      expect(mockInsertChain.values).toHaveBeenCalledWith(
        expect.objectContaining({ provider: 'strava' })
      );
    });

    it('should persist an explicitly supplied provider', async () => {
      const mockInsertChain = {
        values: jest.fn().mockReturnThis(),
        onConflictDoUpdate: jest.fn().mockResolvedValue(undefined),
      };
      mockDb.insert.mockReturnValue(mockInsertChain);

      await DatabaseManager.upsertActivity(12345, mockActivity, 'intervals');

      expect(mockInsertChain.values).toHaveBeenCalledWith(
        expect.objectContaining({ provider: 'intervals' })
      );
    });
  });

  describe('getActivityById', () => {
    beforeEach(() => {
      DatabaseManager.isInitialized = true;
      DatabaseManager.db = mockDb;
    });

    it('should return the activity when found', async () => {
      const mockActivity = { strava_activity_id: 'i176829341', name: 'Morning Run' };

      const mockSelectChain = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        get: jest.fn().mockResolvedValue(mockActivity)
      };
      mockDb.select.mockReturnValue(mockSelectChain);

      const result = await DatabaseManager.getActivityById('i176829341');

      expect(result).toEqual(mockActivity);
    });

    it('should stringify numeric activity ids before querying', async () => {
      const mockWhereChain = jest.fn().mockReturnThis();
      const mockSelectChain = {
        from: jest.fn().mockReturnThis(),
        where: mockWhereChain,
        get: jest.fn().mockResolvedValue(null)
      };
      mockDb.select.mockReturnValue(mockSelectChain);

      const result = await DatabaseManager.getActivityById(98765);

      expect(result).toBeNull();
      expect(mockWhereChain).toHaveBeenCalled();
    });

    it('should return null when activity not found', async () => {
      const mockSelectChain = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        get: jest.fn().mockResolvedValue(undefined)
      };
      mockDb.select.mockReturnValue(mockSelectChain);

      const result = await DatabaseManager.getActivityById('missing');

      expect(result).toBeNull();
    });
  });

  describe('findDuplicateActivity', () => {
    beforeEach(() => {
      DatabaseManager.isInitialized = true;
      DatabaseManager.db = mockDb;
    });

    it('should return null immediately when startDateLocal is falsy, without querying', async () => {
      const result = await DatabaseManager.findDuplicateActivity(12345, null, 'i176829341');

      expect(result).toBeNull();
      expect(mockDb.select).not.toHaveBeenCalled();
    });

    it('should return null when the target startDateLocal itself is unparseable, without querying', async () => {
      const result = await DatabaseManager.findDuplicateActivity(12345, 'not-a-date', 'i176829341');

      expect(result).toBeNull();
      expect(mockDb.select).not.toHaveBeenCalled();
    });

    it('should match a candidate within 10 minutes despite a Z/no-Z formatting difference between providers', async () => {
      // Strava-style start_date_local carries a misleading trailing Z; intervals.icu carries none.
      const candidate = { strava_activity_id: '98765', start_date_local: '2026-08-17T07:05:00' };
      const mockWhereChain = jest.fn().mockResolvedValue([candidate]);
      mockDb.select.mockReturnValue({ from: jest.fn().mockReturnThis(), where: mockWhereChain });

      const result = await DatabaseManager.findDuplicateActivity(12345, '2026-08-17T07:00:00Z', 'i176829341');

      expect(result).toEqual(candidate);
      expect(mockWhereChain).toHaveBeenCalled();
    });

    it('should not match a candidate more than 10 minutes away', async () => {
      const candidate = { strava_activity_id: '98765', start_date_local: '2026-08-17T07:20:00' };
      mockDb.select.mockReturnValue({
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockResolvedValue([candidate])
      });

      const result = await DatabaseManager.findDuplicateActivity(12345, '2026-08-17T07:00:00Z', 'i176829341');

      expect(result).toBeNull();
    });

    it('should return null when there are no candidates at all', async () => {
      mockDb.select.mockReturnValue({
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockResolvedValue([])
      });

      const result = await DatabaseManager.findDuplicateActivity(12345, '2026-08-17T07:00:00Z', 'i176829341');

      expect(result).toBeNull();
    });

    it('should skip candidates with a missing or unparseable start_date_local and still find a valid match', async () => {
      const candidates = [
        { strava_activity_id: '1', start_date_local: null },
        { strava_activity_id: '2', start_date_local: 'not-a-date' },
        { strava_activity_id: '3', start_date_local: '2026-08-17T07:02:00' }
      ];
      mockDb.select.mockReturnValue({
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockResolvedValue(candidates)
      });

      const result = await DatabaseManager.findDuplicateActivity(12345, '2026-08-17T07:00:00Z', 'i176829341');

      expect(result).toEqual(candidates[2]);
    });

    it('should not scope the query by provider when no provider argument is given (backward compatible)', async () => {
      const mockWhereChain = jest.fn().mockResolvedValue([]);
      mockDb.select.mockReturnValue({ from: jest.fn().mockReturnThis(), where: mockWhereChain });

      await DatabaseManager.findDuplicateActivity(12345, '2026-08-17T07:00:00Z', 'i176829341');

      const whereCondition = mockWhereChain.mock.calls[0][0];
      const { sql } = sqlDialect.sqlToQuery(whereCondition);
      expect(sql).not.toContain('provider');
    });

    it('should scope the query to rows from a DIFFERENT provider when a provider argument is given', async () => {
      const mockWhereChain = jest.fn().mockResolvedValue([]);
      mockDb.select.mockReturnValue({ from: jest.fn().mockReturnThis(), where: mockWhereChain });

      await DatabaseManager.findDuplicateActivity(12345, '2026-08-17T07:00:00Z', 'i176829341', 'strava');

      const whereCondition = mockWhereChain.mock.calls[0][0];
      const { sql, params } = sqlDialect.sqlToQuery(whereCondition);
      expect(sql).toContain('"provider" <>');
      expect(params).toContain('strava');
    });

    it('should still match a same-time candidate from a different provider when scoped', async () => {
      const candidate = { strava_activity_id: '98765', start_date_local: '2026-08-17T07:05:00' };
      const mockWhereChain = jest.fn().mockResolvedValue([candidate]);
      mockDb.select.mockReturnValue({ from: jest.fn().mockReturnThis(), where: mockWhereChain });

      const result = await DatabaseManager.findDuplicateActivity(12345, '2026-08-17T07:00:00Z', 'i176829341', 'intervals');

      expect(result).toEqual(candidate);
    });
  });

  describe('getMonthlyRunTotals', () => {
    beforeEach(() => {
      DatabaseManager.isInitialized = true;
      DatabaseManager.db = mockDb;
    });

    it('aggregates distance per athlete via inner join and groupBy', async () => {
      const mockRows = [
        { athleteId: 111, totalDistanceM: 52340.5, activityCount: 6 },
        { athleteId: 222, totalDistanceM: 31200, activityCount: 4 },
      ];

      const mockSelectChain = {
        from: jest.fn().mockReturnThis(),
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockResolvedValue(mockRows),
      };
      mockDb.select.mockReturnValue(mockSelectChain);

      const result = await DatabaseManager.getMonthlyRunTotals(
        '2026-04-01T00:00:00.000Z',
        '2026-05-01T00:00:00.000Z',
        ['Run', 'TrailRun', 'VirtualRun']
      );

      expect(result).toEqual(mockRows);
      expect(mockSelectChain.innerJoin).toHaveBeenCalledTimes(1);
      expect(mockSelectChain.where).toHaveBeenCalledTimes(1);
      expect(mockSelectChain.groupBy).toHaveBeenCalledTimes(1);
      expect(mockSelectChain.orderBy).toHaveBeenCalledTimes(1);
    });
  });

  describe('getPBSyncCursors', () => {
    beforeEach(() => {
      DatabaseManager.isInitialized = true;
      DatabaseManager.db = mockDb;
    });

    it('should return mapped cursor objects for matching keys', async () => {
      const mockSelectChain = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockResolvedValue([
          { key: 'pb_sync_cursor_111', value: '1750000000', updated_at: '2026-03-19T10:00:00Z' },
          { key: 'pb_sync_cursor_222', value: '1748000000', updated_at: '2026-03-18T08:00:00Z' },
        ]),
      };
      mockDb.select.mockReturnValue(mockSelectChain);

      const result = await DatabaseManager.getPBSyncCursors();

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ discordUserId: '111', cursor: '1750000000', updatedAt: '2026-03-19T10:00:00Z' });
      expect(result[1]).toEqual({ discordUserId: '222', cursor: '1748000000', updatedAt: '2026-03-18T08:00:00Z' });
    });

    it('should return empty array when no cursors exist', async () => {
      const mockSelectChain = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockResolvedValue([]),
      };
      mockDb.select.mockReturnValue(mockSelectChain);

      const result = await DatabaseManager.getPBSyncCursors();

      expect(result).toEqual([]);
    });

    it('should return empty array and log error when DB throws', async () => {
      const mockSelectChain = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockRejectedValue(new Error('DB error')),
      };
      mockDb.select.mockReturnValue(mockSelectChain);

      const result = await DatabaseManager.getPBSyncCursors();

      expect(result).toEqual([]);
      expect(logger.database.error).toHaveBeenCalledWith(
        'Failed to query PB sync cursors',
        expect.objectContaining({ error: 'DB error' })
      );
    });
  });

  describe('getPBCountByAthleteId', () => {
    beforeEach(() => {
      DatabaseManager.isInitialized = true;
      DatabaseManager.db = mockDb;
    });

    it('should return count of PBs for an athlete', async () => {
      const mockSelectChain = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockResolvedValue([{ count: 5 }]),
      };
      mockDb.select.mockReturnValue(mockSelectChain);

      const count = await DatabaseManager.getPBCountByAthleteId(12345);

      expect(count).toBe(5);
    });

    it('should return 0 when athlete has no PBs', async () => {
      const mockSelectChain = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockResolvedValue([{ count: 0 }]),
      };
      mockDb.select.mockReturnValue(mockSelectChain);

      const count = await DatabaseManager.getPBCountByAthleteId(12345);

      expect(count).toBe(0);
    });

    it('should return 0 when result array is empty', async () => {
      const mockSelectChain = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockResolvedValue([]),
      };
      mockDb.select.mockReturnValue(mockSelectChain);

      const count = await DatabaseManager.getPBCountByAthleteId(12345);

      expect(count).toBe(0);
    });

    it('should return 0 and log error when DB throws', async () => {
      const mockSelectChain = {
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockRejectedValue(new Error('DB error')),
      };
      mockDb.select.mockReturnValue(mockSelectChain);

      const count = await DatabaseManager.getPBCountByAthleteId(12345);

      expect(count).toBe(0);
      expect(logger.database.error).toHaveBeenCalledWith(
        'Failed to get PB count',
        expect.objectContaining({ athleteId: 12345, error: 'DB error' })
      );
    });
  });
});
