const DatabaseMemberManager = require('../../src/database/DatabaseMemberManager');

// Mock dependencies
jest.mock('../../src/database/DatabaseManager');
jest.mock('../../src/utils/Logger');
jest.mock('../../src/utils/EncryptionUtils');
jest.mock('../../config/config', () => ({
  security: {
    encryptionKey: 'test-encryption-key-32-characters'
  }
}));

const mockDatabaseManager = {
  initialize: jest.fn().mockResolvedValue(undefined),
  registerMember: jest.fn(),
  relinkMember: jest.fn(),
  getMemberByAthleteId: jest.fn(),
  getMemberByDiscordId: jest.fn(),
  getAllMembers: jest.fn(),
  getAllMembersIncludingInactive: jest.fn(),
  getInactiveMembers: jest.fn(),
  getMemberCount: jest.fn(),
  deactivateMember: jest.fn(),
  reactivateMember: jest.fn(),
  removeMember: jest.fn(),
  updateTokens: jest.fn(),
  clearProviderTokens: jest.fn(),
  getStats: jest.fn(),
  close: jest.fn(),
  backup: jest.fn(),
  healthCheck: jest.fn()
};

const logger = require('../../src/utils/Logger');
const EncryptionUtils = require('../../src/utils/EncryptionUtils');

describe('DatabaseMemberManager', () => {
  let memberManager;

  beforeEach(() => {
    jest.clearAllMocks();
    memberManager = new DatabaseMemberManager();
    memberManager.databaseManager = mockDatabaseManager;
  });

  describe('initialization', () => {
    it('should initialize database manager', async () => {
      await memberManager.initialize();

      expect(mockDatabaseManager.initialize).toHaveBeenCalledTimes(1);
      expect(memberManager.isInitialized).toBe(true);
    });

    it('should not reinitialize if already initialized', async () => {
      await memberManager.initialize();
      await memberManager.initialize();

      expect(mockDatabaseManager.initialize).toHaveBeenCalledTimes(1);
    });
  });

  describe('registerMember', () => {
    const mockAthlete = { id: 12345, username: 'test_athlete' };
    const mockTokenData = { access_token: 'token123', refresh_token: 'refresh123' };
    const mockDiscordUser = { id: 'discord123', username: 'testuser' };

    it('should register a new member', async () => {
      mockDatabaseManager.registerMember.mockResolvedValue({ athleteId: 12345 });

      const result = await memberManager.registerMember('discord123', mockAthlete, mockTokenData, mockDiscordUser);

      expect(mockDatabaseManager.initialize).toHaveBeenCalled();
      expect(mockDatabaseManager.registerMember).toHaveBeenCalledWith('discord123', mockAthlete, mockTokenData, mockDiscordUser, 'strava');
      expect(result.athleteId).toBe(12345);
    });

    it('should register member without discord user data', async () => {
      mockDatabaseManager.registerMember.mockResolvedValue({ athleteId: 12345 });

      await memberManager.registerMember('discord123', mockAthlete, mockTokenData);

      expect(mockDatabaseManager.registerMember).toHaveBeenCalledWith('discord123', mockAthlete, mockTokenData, null, 'strava');
    });

    it('should pass an explicit provider through to registerMember', async () => {
      mockDatabaseManager.registerMember.mockResolvedValue({ athleteId: 12345, provider: 'intervals' });

      await memberManager.registerMember('discord123', mockAthlete, mockTokenData, mockDiscordUser, 'intervals');

      expect(mockDatabaseManager.registerMember).toHaveBeenCalledWith('discord123', mockAthlete, mockTokenData, mockDiscordUser, 'intervals');
    });

    it('should relink an existing active member whose stored tokens no longer work', async () => {
      const existingMember = { athleteId: 12345, discordUserId: 'discord123', isActive: true, tokens: { encrypted: 'data' } };
      mockDatabaseManager.getMemberByDiscordId.mockResolvedValue(existingMember);
      jest.spyOn(memberManager, 'getValidAccessToken').mockResolvedValue(null);
      mockDatabaseManager.relinkMember.mockResolvedValue({ athleteId: 12345, discordUserId: 'discord123' });

      const result = await memberManager.registerMember('discord123', mockAthlete, mockTokenData, mockDiscordUser);

      expect(mockDatabaseManager.relinkMember).toHaveBeenCalledWith(12345, mockAthlete, mockTokenData, mockDiscordUser, 'strava');
      expect(mockDatabaseManager.registerMember).not.toHaveBeenCalled();
      expect(result.athleteId).toBe(12345);
    });

    it('should throw already-registered when an existing active member still has valid tokens', async () => {
      const existingMember = { athleteId: 12345, discordUserId: 'discord123', isActive: true, tokens: { encrypted: 'data' } };
      mockDatabaseManager.getMemberByDiscordId.mockResolvedValue(existingMember);
      jest.spyOn(memberManager, 'getValidAccessToken').mockResolvedValue('valid_access_token');

      await expect(
        memberManager.registerMember('discord123', mockAthlete, mockTokenData, mockDiscordUser)
      ).rejects.toThrow();

      expect(mockDatabaseManager.relinkMember).not.toHaveBeenCalled();
    });

    it('should not attempt a relink for an existing inactive member', async () => {
      const existingMember = { athleteId: 12345, discordUserId: 'discord123', isActive: false, tokens: null };
      mockDatabaseManager.getMemberByDiscordId.mockResolvedValue(existingMember);
      mockDatabaseManager.registerMember.mockRejectedValue(new Error('Discord user discord123 is already registered'));

      await expect(
        memberManager.registerMember('discord123', mockAthlete, mockTokenData, mockDiscordUser)
      ).rejects.toThrow('already registered');

      expect(mockDatabaseManager.relinkMember).not.toHaveBeenCalled();
    });

    it('should relink an active member who explicitly switches provider, without consulting getValidAccessToken', async () => {
      const existingMember = {
        athleteId: 12345,
        discordUserId: 'discord123',
        isActive: true,
        provider: 'strava',
        tokens: { encrypted: 'data' }
      };
      mockDatabaseManager.getMemberByDiscordId.mockResolvedValue(existingMember);
      const validTokenSpy = jest.spyOn(memberManager, 'getValidAccessToken');
      mockDatabaseManager.relinkMember.mockResolvedValue({
        athleteId: 12345,
        discordUserId: 'discord123',
        provider: 'intervals'
      });

      const result = await memberManager.registerMember('discord123', mockAthlete, mockTokenData, mockDiscordUser, 'intervals');

      expect(validTokenSpy).not.toHaveBeenCalled();
      expect(mockDatabaseManager.relinkMember).toHaveBeenCalledWith(12345, mockAthlete, mockTokenData, mockDiscordUser, 'intervals');
      expect(mockDatabaseManager.registerMember).not.toHaveBeenCalled();
      expect(result.provider).toBe('intervals');
      expect(logger.database.info).toHaveBeenCalledWith(
        'Explicit provider switch on registration - relinking member',
        expect.objectContaining({ fromProvider: 'strava', toProvider: 'intervals' })
      );
    });

    it('should relink a member with no stored provider (legacy strava default) switching to intervals', async () => {
      const existingMember = {
        athleteId: 12345,
        discordUserId: 'discord123',
        isActive: true,
        // no `provider` field at all - defaults to 'strava'
        tokens: { encrypted: 'data' }
      };
      mockDatabaseManager.getMemberByDiscordId.mockResolvedValue(existingMember);
      const validTokenSpy = jest.spyOn(memberManager, 'getValidAccessToken');
      mockDatabaseManager.relinkMember.mockResolvedValue({ athleteId: 12345, provider: 'intervals' });

      await memberManager.registerMember('discord123', mockAthlete, mockTokenData, mockDiscordUser, 'intervals');

      expect(validTokenSpy).not.toHaveBeenCalled();
      expect(mockDatabaseManager.relinkMember).toHaveBeenCalledWith(12345, mockAthlete, mockTokenData, mockDiscordUser, 'intervals');
    });

    it('should still throw already-registered for an active member re-registering with the SAME provider and valid tokens', async () => {
      const existingMember = {
        athleteId: 12345,
        discordUserId: 'discord123',
        isActive: true,
        provider: 'strava',
        tokens: { encrypted: 'data' }
      };
      mockDatabaseManager.getMemberByDiscordId.mockResolvedValue(existingMember);
      jest.spyOn(memberManager, 'getValidAccessToken').mockResolvedValue('valid_access_token');

      await expect(
        memberManager.registerMember('discord123', mockAthlete, mockTokenData, mockDiscordUser, 'strava')
      ).rejects.toThrow('already registered');

      expect(mockDatabaseManager.relinkMember).not.toHaveBeenCalled();
    });

    it('should not bypass the inactive-member block even when the provider differs', async () => {
      const existingMember = {
        athleteId: 12345,
        discordUserId: 'discord123',
        isActive: false,
        provider: 'strava',
        tokens: null
      };
      mockDatabaseManager.getMemberByDiscordId.mockResolvedValue(existingMember);
      const validTokenSpy = jest.spyOn(memberManager, 'getValidAccessToken');

      await expect(
        memberManager.registerMember('discord123', mockAthlete, mockTokenData, mockDiscordUser, 'intervals')
      ).rejects.toThrow('already registered');

      expect(validTokenSpy).not.toHaveBeenCalled();
      expect(mockDatabaseManager.relinkMember).not.toHaveBeenCalled();
    });
  });

  describe('getMemberByAthleteId', () => {
    it('should retrieve member by athlete ID', async () => {
      const mockMember = { athleteId: 12345, discordUserId: 'discord123' };
      mockDatabaseManager.getMemberByAthleteId.mockResolvedValue(mockMember);

      const result = await memberManager.getMemberByAthleteId(12345);

      expect(mockDatabaseManager.initialize).toHaveBeenCalled();
      expect(mockDatabaseManager.getMemberByAthleteId).toHaveBeenCalledWith(12345);
      expect(result).toEqual(mockMember);
    });

    it('should return null for non-existent member', async () => {
      mockDatabaseManager.getMemberByAthleteId.mockResolvedValue(null);

      const result = await memberManager.getMemberByAthleteId(99999);

      expect(result).toBeNull();
    });
  });

  describe('getMemberByDiscordId', () => {
    it('should retrieve member by Discord ID', async () => {
      const mockMember = { athleteId: 12345, discordUserId: 'discord123' };
      mockDatabaseManager.getMemberByDiscordId.mockResolvedValue(mockMember);

      const result = await memberManager.getMemberByDiscordId('discord123');

      expect(mockDatabaseManager.initialize).toHaveBeenCalled();
      expect(mockDatabaseManager.getMemberByDiscordId).toHaveBeenCalledWith('discord123');
      expect(result).toEqual(mockMember);
    });

    it('should return null for non-existent Discord ID', async () => {
      mockDatabaseManager.getMemberByDiscordId.mockResolvedValue(null);

      const result = await memberManager.getMemberByDiscordId('unknown');

      expect(result).toBeNull();
    });
  });

  describe('getAllMembers', () => {
    it('should return all active members', async () => {
      const mockMembers = [
        { athleteId: 1, isActive: true },
        { athleteId: 2, isActive: true }
      ];
      mockDatabaseManager.getAllMembers.mockResolvedValue(mockMembers);

      const result = await memberManager.getAllMembers();

      expect(mockDatabaseManager.getAllMembers).toHaveBeenCalled();
      expect(result).toEqual(mockMembers);
      expect(result).toHaveLength(2);
    });

    it('should return empty array when no members', async () => {
      mockDatabaseManager.getAllMembers.mockResolvedValue([]);

      const result = await memberManager.getAllMembers();

      expect(result).toEqual([]);
    });
  });

  describe('getAllMembersIncludingInactive', () => {
    it('should return all members including inactive', async () => {
      const mockMembers = [
        { athleteId: 1, isActive: true },
        { athleteId: 2, isActive: false }
      ];
      mockDatabaseManager.getAllMembersIncludingInactive.mockResolvedValue(mockMembers);

      const result = await memberManager.getAllMembersIncludingInactive();

      expect(mockDatabaseManager.getAllMembersIncludingInactive).toHaveBeenCalled();
      expect(result).toHaveLength(2);
    });
  });

  describe('getInactiveMembers', () => {
    it('should return only inactive members', async () => {
      const mockInactiveMembers = [
        { athleteId: 2, isActive: false },
        { athleteId: 3, isActive: false }
      ];
      mockDatabaseManager.getInactiveMembers.mockResolvedValue(mockInactiveMembers);

      const result = await memberManager.getInactiveMembers();

      expect(mockDatabaseManager.getInactiveMembers).toHaveBeenCalled();
      expect(result).toEqual(mockInactiveMembers);
    });
  });

  describe('getMemberCount', () => {
    it('should return count of active members', async () => {
      const mockMembers = [{ athleteId: 1 }, { athleteId: 2 }, { athleteId: 3 }];
      mockDatabaseManager.getAllMembers.mockResolvedValue(mockMembers);

      const result = await memberManager.getMemberCount();

      expect(result).toBe(3);
    });

    it('should return 0 when no members', async () => {
      mockDatabaseManager.getAllMembers.mockResolvedValue([]);

      const result = await memberManager.getMemberCount();

      expect(result).toBe(0);
    });
  });

  describe('deactivateMember', () => {
    it('should deactivate a member', async () => {
      mockDatabaseManager.deactivateMember.mockResolvedValue(true);

      const result = await memberManager.deactivateMember(12345);

      expect(mockDatabaseManager.initialize).toHaveBeenCalled();
      expect(mockDatabaseManager.deactivateMember).toHaveBeenCalledWith(12345);
      expect(result).toBe(true);
    });

    it('should return false for non-existent member', async () => {
      mockDatabaseManager.deactivateMember.mockResolvedValue(false);

      const result = await memberManager.deactivateMember(99999);

      expect(result).toBe(false);
    });
  });

  describe('reactivateMember', () => {
    it('should reactivate a member', async () => {
      mockDatabaseManager.reactivateMember.mockResolvedValue(true);

      const result = await memberManager.reactivateMember(12345);

      expect(mockDatabaseManager.initialize).toHaveBeenCalled();
      expect(mockDatabaseManager.reactivateMember).toHaveBeenCalledWith(12345);
      expect(result).toBe(true);
    });

    it('should return false for non-existent member', async () => {
      mockDatabaseManager.reactivateMember.mockResolvedValue(false);

      const result = await memberManager.reactivateMember(99999);

      expect(result).toBe(false);
    });
  });

  describe('removeMember', () => {
    it('should remove a member', async () => {
      mockDatabaseManager.removeMember.mockResolvedValue(true);

      const result = await memberManager.removeMember(12345);

      expect(mockDatabaseManager.initialize).toHaveBeenCalled();
      expect(mockDatabaseManager.removeMember).toHaveBeenCalledWith(12345);
      expect(result).toBe(true);
    });

    it('should return null for non-existent member', async () => {
      mockDatabaseManager.removeMember.mockResolvedValue(null);

      const result = await memberManager.removeMember(99999);

      expect(result).toBeNull();
    });
  });

  describe('removeMemberByDiscordId', () => {
    it('should remove member by Discord ID', async () => {
      const mockMember = { athleteId: 12345, discordUserId: 'discord123' };
      mockDatabaseManager.getMemberByDiscordId.mockResolvedValue(mockMember);
      mockDatabaseManager.removeMember.mockResolvedValue(true);

      const result = await memberManager.removeMemberByDiscordId('discord123');

      expect(mockDatabaseManager.getMemberByDiscordId).toHaveBeenCalledWith('discord123');
      expect(mockDatabaseManager.removeMember).toHaveBeenCalledWith(12345);
      expect(result).toBe(true);
    });

    it('should return null when Discord ID not found', async () => {
      mockDatabaseManager.getMemberByDiscordId.mockResolvedValue(null);

      const result = await memberManager.removeMemberByDiscordId('unknown');

      expect(result).toBeNull();
      expect(mockDatabaseManager.removeMember).not.toHaveBeenCalled();
    });
  });

  describe('updateTokens', () => {
    it('should update member tokens, defaulting provider to strava', async () => {
      const mockTokenData = { access_token: 'new_token', refresh_token: 'new_refresh' };
      mockDatabaseManager.updateTokens.mockResolvedValue(true);

      const result = await memberManager.updateTokens(12345, mockTokenData);

      expect(mockDatabaseManager.initialize).toHaveBeenCalled();
      expect(mockDatabaseManager.updateTokens).toHaveBeenCalledWith(12345, mockTokenData, 'strava');
      expect(result).toBe(true);
    });

    it('should pass an explicit provider through to databaseManager.updateTokens', async () => {
      const mockTokenData = { api_key: 'intervals-key' };
      mockDatabaseManager.updateTokens.mockResolvedValue(true);

      await memberManager.updateTokens(12345, mockTokenData, 'intervals');

      expect(mockDatabaseManager.updateTokens).toHaveBeenCalledWith(12345, mockTokenData, 'intervals');
    });
  });

  describe('clearProviderTokens', () => {
    it('should ensure initialization and delegate to databaseManager.clearProviderTokens, returning its result', async () => {
      mockDatabaseManager.clearProviderTokens.mockResolvedValue({ athlete_id: 12345 });

      const result = await memberManager.clearProviderTokens(12345, 'strava');

      expect(mockDatabaseManager.initialize).toHaveBeenCalled();
      expect(mockDatabaseManager.clearProviderTokens).toHaveBeenCalledWith(12345, 'strava');
      expect(result).toEqual({ athlete_id: 12345 });
    });

    it('should forward the given provider through unchanged', async () => {
      mockDatabaseManager.clearProviderTokens.mockResolvedValue(null);

      const result = await memberManager.clearProviderTokens(67890, 'intervals');

      expect(mockDatabaseManager.clearProviderTokens).toHaveBeenCalledWith(67890, 'intervals');
      expect(result).toBeNull();
    });
  });

  describe('_decryptTokenData', () => {
    it('should decrypt token data successfully', () => {
      const mockEncrypted = { encrypted: 'encrypted_data', iv: 'iv_data', authTag: 'tag' };
      const mockDecrypted = { access_token: 'token123', refresh_token: 'refresh123', expires_at: Date.now() / 1000 + 3600 };

      EncryptionUtils.decryptTokens.mockReturnValue(mockDecrypted);

      const result = memberManager._decryptTokenData(mockEncrypted, 12345);

      expect(EncryptionUtils.decryptTokens).toHaveBeenCalledWith(mockEncrypted);
      expect(result).toEqual(mockDecrypted);
    });

    it('should return null when no encryption key configured', () => {
      // Temporarily remove encryption key
      const config = require('../../config/config');
      const originalKey = config.security.encryptionKey;
      config.security.encryptionKey = null;

      const result = memberManager._decryptTokenData({ encrypted: 'data' }, 12345);

      expect(result).toBeNull();
      expect(logger.database.warn).toHaveBeenCalled();

      // Restore
      config.security.encryptionKey = originalKey;
    });
  });

  describe('_getTokensFromDatabase', () => {
    it('should return null when member has no tokens', async () => {
      const member = { athleteId: 12345, tokens: null };

      const result = await memberManager._getTokensFromDatabase(member);

      expect(result).toBeNull();
    });

    it('should return null when tokens not encrypted', async () => {
      const member = { athleteId: 12345, tokens: {} };

      const result = await memberManager._getTokensFromDatabase(member);

      expect(result).toBeNull();
    });

    it('should return valid access token when not expired', async () => {
      const futureExpiry = Date.now() / 1000 + 3600; // 1 hour from now
      const member = {
        athleteId: 12345,
        tokens: { encrypted: 'data', iv: 'iv', authTag: 'tag' }
      };
      const mockDecrypted = {
        access_token: 'valid_token',
        refresh_token: 'refresh',
        expires_at: futureExpiry
      };

      EncryptionUtils.decryptTokens.mockReturnValue(mockDecrypted);

      const result = await memberManager._getTokensFromDatabase(member);

      expect(result).toBe('valid_token');
      expect(logger.database.info).toHaveBeenCalledWith(
        'Successfully retrieved valid access token from database',
        expect.any(Object)
      );
    });

    it('should return null when decryption returns null', async () => {
      const member = {
        athleteId: 12345,
        tokens: { encrypted: 'data' }
      };

      EncryptionUtils.decryptTokens.mockReturnValue(null);

      const result = await memberManager._getTokensFromDatabase(member);

      expect(result).toBeNull();
    });

    it('should auto-refresh expired token', async () => {
      const pastExpiry = Date.now() / 1000 - 3600; // Expired 1 hour ago
      const member = {
        athleteId: 12345,
        tokens: { encrypted: 'data', iv: 'iv', authTag: 'tag' }
      };
      const mockExpiredToken = {
        access_token: 'expired_token',
        refresh_token: 'refresh123',
        expires_at: pastExpiry
      };
      const mockNewTokens = {
        access_token: 'new_token',
        refresh_token: 'new_refresh',
        expires_at: Date.now() / 1000 + 3600
      };

      EncryptionUtils.decryptTokens.mockReturnValue(mockExpiredToken);

      // Mock Strava API
      const mockStravaAPI = {
        refreshAccessToken: jest.fn().mockResolvedValue(mockNewTokens)
      };
      jest.doMock('../../src/strava/api', () => {
        return jest.fn(() => mockStravaAPI);
      });

      mockDatabaseManager.updateTokens.mockResolvedValue(true);

      const result = await memberManager._getTokensFromDatabase(member);

      expect(result).toBe('new_token');
      expect(mockDatabaseManager.updateTokens).toHaveBeenCalledWith(12345, mockNewTokens, 'strava');
    });

    it('should return null when token expired and no refresh token', async () => {
      const pastExpiry = Date.now() / 1000 - 3600;
      const member = {
        athleteId: 12345,
        tokens: { encrypted: 'data' }
      };
      const mockExpiredToken = {
        access_token: 'expired',
        expires_at: pastExpiry
        // No refresh_token
      };

      EncryptionUtils.decryptTokens.mockReturnValue(mockExpiredToken);

      const result = await memberManager._getTokensFromDatabase(member);

      expect(result).toBeNull();
      expect(logger.database.warn).toHaveBeenCalled();
    });

    it('should handle decryption errors gracefully', async () => {
      const member = {
        athleteId: 12345,
        tokens: { encrypted: 'bad_data' }
      };

      EncryptionUtils.decryptTokens.mockImplementation(() => {
        throw new Error('Decryption failed');
      });

      const result = await memberManager._getTokensFromDatabase(member);

      expect(result).toBeNull();
      expect(logger.database.error).toHaveBeenCalledWith(
        'Could not decrypt tokens from database',
        expect.any(Object)
      );
    });
  });

  describe('getValidAccessToken', () => {
    it('should return token from database when available', async () => {
      const member = {
        athleteId: 12345,
        discordUserId: 'discord123',
        tokens: { encrypted: 'data', iv: 'iv', authTag: 'tag' }
      };
      const mockToken = {
        access_token: 'db_token',
        expires_at: Date.now() / 1000 + 3600
      };

      EncryptionUtils.decryptTokens.mockReturnValue(mockToken);

      const result = await memberManager.getValidAccessToken(member);

      expect(result).toBe('db_token');
    });

    it('should try JSON fallback when database token fails', async () => {
      const member = {
        athleteId: 12345,
        discordUserId: 'discord123',
        tokens: null
      };

      // Mock file system for JSON fallback
      jest.spyOn(memberManager, '_getTokensFromJsonFallback').mockResolvedValue('json_token');

      const result = await memberManager.getValidAccessToken(member);

      expect(result).toBe('json_token');
      expect(logger.database.info).toHaveBeenCalledWith(
        'No valid tokens in database, trying JSON fallback',
        expect.any(Object)
      );
    });

    it('should return null when both database and JSON fail', async () => {
      const member = {
        athleteId: 12345,
        discordUserId: 'discord123',
        tokens: null
      };

      jest.spyOn(memberManager, '_getTokensFromJsonFallback').mockResolvedValue(null);

      const result = await memberManager.getValidAccessToken(member);

      expect(result).toBeNull();
    });

    it('should return decrypted api_key for intervals.icu members without touching the database token path', async () => {
      const member = {
        athleteId: 12345,
        discordUserId: 'discord123',
        provider: 'intervals',
        tokens: { encrypted: 'data', iv: 'iv', authTag: 'tag' }
      };

      EncryptionUtils.decryptTokens.mockReturnValue({ api_key: 'intervals_api_key' });

      const result = await memberManager.getValidAccessToken(member);

      expect(result).toBe('intervals_api_key');
      expect(EncryptionUtils.decryptTokens).toHaveBeenCalledWith(member.tokens);
    });

    it('should return null when intervals.icu token decryption fails', async () => {
      const member = {
        athleteId: 12345,
        discordUserId: 'discord123',
        provider: 'intervals',
        tokens: { encrypted: 'data', iv: 'iv', authTag: 'tag' }
      };

      EncryptionUtils.decryptTokens.mockReturnValue(null);

      const result = await memberManager.getValidAccessToken(member);

      expect(result).toBeNull();
    });

    it('should return the strava access token from a database blob for a strava member (namespaced format)', async () => {
      const member = {
        athleteId: 12345,
        discordUserId: 'discord123',
        provider: 'strava',
        tokens: { encrypted: 'data', iv: 'iv', authTag: 'tag' }
      };

      EncryptionUtils.decryptTokens.mockReturnValue({
        strava: { access_token: 'namespaced_strava_token', expires_at: Date.now() / 1000 + 3600 },
        intervals: { api_key: 'unrelated_intervals_key' }
      });

      const result = await memberManager.getValidAccessToken(member);

      expect(result).toBe('namespaced_strava_token');
    });

    it('should return the intervals.icu api_key from a namespaced blob without disturbing a stored strava namespace', async () => {
      const member = {
        athleteId: 12345,
        discordUserId: 'discord123',
        provider: 'intervals',
        tokens: { encrypted: 'data', iv: 'iv', authTag: 'tag' }
      };

      EncryptionUtils.decryptTokens.mockReturnValue({
        strava: { access_token: 'preserved_strava_token', expires_at: Date.now() / 1000 + 3600 },
        intervals: { api_key: 'namespaced_intervals_key' }
      });

      const result = await memberManager.getValidAccessToken(member);

      expect(result).toBe('namespaced_intervals_key');
    });

    it('should return null for an intervals.icu member whose blob only has a strava namespace', async () => {
      const member = {
        athleteId: 12345,
        discordUserId: 'discord123',
        provider: 'intervals',
        tokens: { encrypted: 'data', iv: 'iv', authTag: 'tag' }
      };

      EncryptionUtils.decryptTokens.mockReturnValue({
        strava: { access_token: 'strava_only_token', expires_at: Date.now() / 1000 + 3600 }
      });

      const result = await memberManager.getValidAccessToken(member);

      expect(result).toBeNull();
    });
  });

  describe('getStoredProviderTokens', () => {
    it('should return the requested namespace from a namespaced blob', async () => {
      const member = { athleteId: 12345, tokens: { encrypted: 'data', iv: 'iv', authTag: 'tag' } };
      const stravaTokens = { access_token: 'stored_strava_token', expires_at: 123 };

      EncryptionUtils.decryptTokens.mockReturnValue({
        strava: stravaTokens,
        intervals: { api_key: 'stored_intervals_key' }
      });

      const result = await memberManager.getStoredProviderTokens(member, 'strava');

      expect(result).toEqual(stravaTokens);
    });

    it('should normalize a legacy flat strava blob before returning the strava namespace', async () => {
      const member = { athleteId: 12345, tokens: { encrypted: 'data', iv: 'iv', authTag: 'tag' } };
      const legacyFlatBlob = { access_token: 'legacy_token', refresh_token: 'legacy_refresh', expires_at: 123 };

      EncryptionUtils.decryptTokens.mockReturnValue(legacyFlatBlob);

      const result = await memberManager.getStoredProviderTokens(member, 'strava');

      expect(result).toEqual(legacyFlatBlob);
    });

    it('should normalize a legacy flat intervals blob before returning the intervals namespace', async () => {
      const member = { athleteId: 12345, tokens: { encrypted: 'data', iv: 'iv', authTag: 'tag' } };

      EncryptionUtils.decryptTokens.mockReturnValue({ api_key: 'legacy_intervals_key' });

      const result = await memberManager.getStoredProviderTokens(member, 'intervals');

      expect(result).toEqual({ api_key: 'legacy_intervals_key' });
    });

    it('should return null when the requested namespace is not present', async () => {
      const member = { athleteId: 12345, tokens: { encrypted: 'data', iv: 'iv', authTag: 'tag' } };

      EncryptionUtils.decryptTokens.mockReturnValue({ strava: { access_token: 'only_strava' } });

      const result = await memberManager.getStoredProviderTokens(member, 'intervals');

      expect(result).toBeNull();
    });

    it('should return null when there are no stored tokens at all', async () => {
      const member = { athleteId: 12345, tokens: null };

      EncryptionUtils.decryptTokens.mockReturnValue(null);

      const result = await memberManager.getStoredProviderTokens(member, 'strava');

      expect(result).toBeNull();
    });
  });

  describe('token decryption error handling', () => {
    it('should return null when token decryption fails', async () => {
      const member = {
        athleteId: 12345,
        discordUserId: 'discord123',
        tokens: { encrypted: 'bad_data', iv: 'iv', authTag: 'tag' }
      };

      // Mock decryption to throw error
      jest.spyOn(memberManager, '_decryptTokenData').mockImplementation(() => {
        throw new Error('Decryption failed');
      });

      const result = await memberManager._getTokensFromDatabase(member);

      expect(result).toBeNull();
    });
  });

  describe('_getTokensFromJsonFallback', () => {
    beforeEach(() => {
      jest.resetModules();
    });

    // `node:fs` is a core module: `jest.resetModules()` does not re-create it,
    // and a worker process is reused across test files. Stubbing `fs.readFile`
    // here without restoring it leaves every later test file in that worker with
    // a broken `fs.readFile` — which is why these must be spies, not assignments.
    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('should successfully retrieve tokens from JSON fallback', async () => {
      const member = {
        athleteId: 12345,
        discordUserId: 'discord123'
      };

      const mockJsonData = {
        members: [{
          discordUserId: 'discord123',
          tokens: { encrypted: 'data', iv: 'iv', authTag: 'tag' }
        }]
      };

      const fs = require('node:fs').promises;
      jest.spyOn(fs, 'readFile').mockResolvedValue(JSON.stringify(mockJsonData));

      jest.spyOn(memberManager, '_decryptTokenData').mockReturnValue({
        access_token: 'fallback_token'
      });

      const result = await memberManager._getTokensFromJsonFallback(member);

      expect(result).toEqual({ access_token: 'fallback_token' });
    });

    it('should return null when member not found in JSON', async () => {
      const member = {
        athleteId: 12345,
        discordUserId: 'discord999'
      };

      const mockJsonData = {
        members: [{
          discordUserId: 'discord123',
          tokens: { encrypted: 'data', iv: 'iv', authTag: 'tag' }
        }]
      };

      const fs = require('node:fs').promises;
      jest.spyOn(fs, 'readFile').mockResolvedValue(JSON.stringify(mockJsonData));

      const result = await memberManager._getTokensFromJsonFallback(member);

      expect(result).toBeNull();
    });

    it('should return null when member has no tokens in JSON', async () => {
      const member = {
        athleteId: 12345,
        discordUserId: 'discord123'
      };

      const mockJsonData = {
        members: [{
          discordUserId: 'discord123'
        }]
      };

      const fs = require('node:fs').promises;
      jest.spyOn(fs, 'readFile').mockResolvedValue(JSON.stringify(mockJsonData));

      const result = await memberManager._getTokensFromJsonFallback(member);

      expect(result).toBeNull();
    });

    it('should handle JSON file read errors', async () => {
      const member = {
        athleteId: 12345,
        discordUserId: 'discord123'
      };

      const fs = require('node:fs').promises;
      jest.spyOn(fs, 'readFile').mockRejectedValue(new Error('File not found'));

      const result = await memberManager._getTokensFromJsonFallback(member);

      expect(result).toBeNull();
    });
  });

  describe('utility methods', () => {
    beforeEach(async () => {
      await memberManager.initialize();
    });

    describe('getStats', () => {
      it('should return formatted statistics', async () => {
        mockDatabaseManager.getStats.mockResolvedValue({
          members: {
            total: 50,
            active: 45,
            inactive: 5
          }
        });

        const result = await memberManager.getStats();

        expect(result).toEqual({
          total: 50,
          active: 45,
          inactive: 5,
          recentRegistrations: 0
        });
        expect(mockDatabaseManager.getStats).toHaveBeenCalled();
      });

      it('should handle missing stats gracefully', async () => {
        mockDatabaseManager.getStats.mockResolvedValue({
          members: {}
        });

        const result = await memberManager.getStats();

        expect(result.total).toBe(0);
        expect(result.active).toBe(0);
        expect(result.inactive).toBe(0);
      });
    });

    describe('close', () => {
      it('should close database connection', async () => {
        mockDatabaseManager.close.mockResolvedValue(true);

        const result = await memberManager.close();

        expect(mockDatabaseManager.close).toHaveBeenCalled();
        expect(result).toBe(true);
      });
    });

    describe('backup', () => {
      it('should backup database to specified path', async () => {
        const backupPath = '/tmp/backup.db';
        mockDatabaseManager.backup.mockResolvedValue(true);

        const result = await memberManager.backup(backupPath);

        expect(mockDatabaseManager.backup).toHaveBeenCalledWith(backupPath);
        expect(result).toBe(true);
      });
    });

    describe('healthCheck', () => {
      it('should perform health check', async () => {
        const healthStatus = { status: 'healthy', uptime: 12345 };
        mockDatabaseManager.healthCheck.mockResolvedValue(healthStatus);

        const result = await memberManager.healthCheck();

        expect(mockDatabaseManager.healthCheck).toHaveBeenCalled();
        expect(result).toEqual(healthStatus);
      });
    });
  });

  describe('legacy support methods', () => {
    it('should resolve saveMembersAsync', async () => {
      await expect(memberManager.saveMembersAsync()).resolves.toBeUndefined();
    });

    it('should resolve saveMembers', async () => {
      await expect(memberManager.saveMembers()).resolves.toBeUndefined();
    });

    it('should initialize on loadMembers', async () => {
      mockDatabaseManager.initialize.mockResolvedValue(undefined);

      await memberManager.loadMembers();

      expect(mockDatabaseManager.initialize).toHaveBeenCalled();
    });
  });

  describe('map-like interface', () => {
    beforeEach(async () => {
      await memberManager.initialize();
    });

    describe('discordToStrava', () => {
      it('should get athlete ID from discord user ID', async () => {
        const mockMember = { athleteId: 12345, discordUserId: 'discord123' };
        mockDatabaseManager.getMemberByDiscordId.mockResolvedValue(mockMember);

        const result = await memberManager.discordToStrava.get('discord123');

        expect(result).toBe('12345');
      });

      it('should return undefined for non-existent discord user', async () => {
        mockDatabaseManager.getMemberByDiscordId.mockResolvedValue(null);

        const result = await memberManager.discordToStrava.get('discord999');

        expect(result).toBeUndefined();
      });

      it('should check if discord user exists', async () => {
        const mockMember = { athleteId: 12345, discordUserId: 'discord123' };
        mockDatabaseManager.getMemberByDiscordId.mockResolvedValue(mockMember);

        const result = await memberManager.discordToStrava.has('discord123');

        expect(result).toBe(true);
      });

      it('should return false for non-existent discord user', async () => {
        mockDatabaseManager.getMemberByDiscordId.mockResolvedValue(null);

        const result = await memberManager.discordToStrava.has('discord999');

        expect(result).toBe(false);
      });

      it('should handle set as no-op', () => {
        expect(() => memberManager.discordToStrava.set()).not.toThrow();
      });

      it('should handle delete as no-op', () => {
        expect(() => memberManager.discordToStrava.delete()).not.toThrow();
      });
    });

    describe('members', () => {
      it('should get member by athlete ID', async () => {
        const mockMember = { athleteId: 12345, discordUserId: 'discord123' };
        mockDatabaseManager.getMemberByAthleteId.mockResolvedValue(mockMember);

        const result = await memberManager.members.get(12345);

        expect(result).toEqual(mockMember);
      });

      it('should check if member exists', async () => {
        const mockMember = { athleteId: 12345, discordUserId: 'discord123' };
        mockDatabaseManager.getMemberByAthleteId.mockResolvedValue(mockMember);

        const result = await memberManager.members.has(12345);

        expect(result).toBe(true);
      });

      it('should return false for non-existent member', async () => {
        mockDatabaseManager.getMemberByAthleteId.mockResolvedValue(null);

        const result = await memberManager.members.has(99999);

        expect(result).toBe(false);
      });

      it('should get all members via values', async () => {
        const mockMembers = [
          { athleteId: 12345, discordUserId: 'discord123' },
          { athleteId: 67890, discordUserId: 'discord456' }
        ];
        mockDatabaseManager.getAllMembers.mockResolvedValue(mockMembers);

        const result = await memberManager.members.values();

        expect(result).toEqual(mockMembers);
      });

      it('should get member count via size', async () => {
        const mockMembers = new Array(42).fill({ athleteId: 123, discordUserId: 'discord' });
        mockDatabaseManager.getAllMembers.mockResolvedValue(mockMembers);

        const result = await memberManager.members.size();

        expect(result).toBe(42);
      });

      it('should handle set as no-op', () => {
        expect(() => memberManager.members.set()).not.toThrow();
      });

      it('should handle delete as no-op', () => {
        expect(() => memberManager.members.delete()).not.toThrow();
      });
    });
  });

  describe('legacy helper methods', () => {
    it('should verify map consistency', () => {
      const result = memberManager.verifyMapConsistency();

      expect(result).toEqual({
        isConsistent: true,
        errors: [],
        memberCount: 0,
        mappingCount: 0
      });
    });

    it('should return member as-is for encryptMemberData', () => {
      const member = { athleteId: 12345, name: 'Test' };
      const result = memberManager.encryptMemberData(member);

      expect(result).toEqual(member);
    });

    it('should return member as-is for decryptMemberData', () => {
      const member = { athleteId: 12345, name: 'Test' };
      const result = memberManager.decryptMemberData(member);

      expect(result).toEqual(member);
    });
  });
});
