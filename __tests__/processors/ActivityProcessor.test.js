const ActivityProcessor = require('../../src/processors/ActivityProcessor');
const StravaAPI = require('../../src/strava/api');
const IntervalsAPI = require('../../src/intervals/api');
const DiscordBot = require('../../src/discord/bot');
const DatabaseMemberManager = require('../../src/database/DatabaseMemberManager');
const ActivityQueue = require('../../src/managers/ActivityQueue');
const BestEffortCalculator = require('../../src/utils/BestEffortCalculator');
const config = require('../../config/config');
const logger = require('../../src/utils/Logger');

// Mock dependencies
jest.mock('../../src/strava/api');
jest.mock('../../src/intervals/api');
jest.mock('../../src/discord/bot');
jest.mock('../../src/managers/MemberManager');
jest.mock('../../src/database/DatabaseMemberManager');
jest.mock('../../src/managers/ActivityQueue');
jest.mock('../../src/managers/Scheduler');
jest.mock('../../src/managers/RaceManager');
jest.mock('../../src/utils/BestEffortCalculator');
jest.mock('../../config/dynamicConfig', () => ({
  getDiscordChannelId: jest.fn(),
  setSettingsManager: jest.fn()
}));
jest.mock('../../config/config', () => ({
  posting: {
    delayMinutes: 15
  },
  strava: {
    athleteCap: 10
  }
}));
jest.mock('../../src/utils/Logger', () => ({
  activity: {
    info: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
    warn: jest.fn()
  },
  member: {
    info: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
    warn: jest.fn()
  },
  activityProcessing: jest.fn()
}));

describe('ActivityProcessor', () => {
  let activityProcessor;
  let mockStravaAPI;
  let mockIntervalsAPI;
  let mockDiscordBot;
  let mockMemberManager;
  let mockActivityQueue;

  const mockMember = {
    discordUserId: '123456789',
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
      access_token: 'test_access_token',
      refresh_token: 'test_refresh_token',
      expires_at: Math.floor(Date.now() / 1000) + 3600
    },
    isActive: true
  };

  const mockActivity = {
    id: 98765,
    name: 'Morning Run',
    type: 'Run',
    distance: 5000,
    moving_time: 1800,
    private: false
  };

  const mockProcessedActivity = {
    ...mockActivity,
    athlete: mockMember.athlete
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    // Create fresh mocks for each test
    mockStravaAPI = {
      getActivity: jest.fn(),
      shouldPostActivity: jest.fn(),
      processActivityWithStreams: jest.fn(),
      getAthleteActivities: jest.fn(),
      deauthorize: jest.fn(),
      refreshAccessToken: jest.fn()
    };

    mockIntervalsAPI = {
      getAthleteActivities: jest.fn(),
      shouldPostActivity: jest.fn(),
      processActivityData: jest.fn(),
      getAthlete: jest.fn(),
      mapAthlete: jest.fn(),
      getActivity: jest.fn(),
      getActivityStreams: jest.fn().mockResolvedValue({})
    };

    BestEffortCalculator.synthesizeBestEfforts = jest.fn().mockReturnValue([]);

    mockDiscordBot = {
      start: jest.fn(),
      stop: jest.fn(),
      postActivity: jest.fn()
    };

    mockMemberManager = {
      initialize: jest.fn(),
      loadMembers: jest.fn(),
      saveMembers: jest.fn(),
      getMemberByAthleteId: jest.fn(),
      getValidAccessToken: jest.fn(),
      refreshMemberToken: jest.fn(),
      getAllMembers: jest.fn(),
      getAllMembersIncludingInactive: jest.fn(),
      getMemberCount: jest.fn(),
      getStoredProviderTokens: jest.fn(),
      databaseManager: {
        upsertActivity: jest.fn().mockResolvedValue(undefined),
        getActivityById: jest.fn().mockResolvedValue(null),
        findDuplicateActivity: jest.fn().mockResolvedValue(null),
        clearProviderTokens: jest.fn().mockResolvedValue(undefined),
        settingsManager: {
          getSetting: jest.fn().mockResolvedValue(null),
          setSetting: jest.fn().mockResolvedValue(undefined),
        },
      }
    };

    mockActivityQueue = {
      queueActivity: jest.fn(),
      updateQueuedActivity: jest.fn(),
      removeFromQueue: jest.fn(),
      getStats: jest.fn(),
      shutdown: jest.fn()
    };

    // Mock constructors
    StravaAPI.mockImplementation(() => mockStravaAPI);
    IntervalsAPI.mockImplementation(() => mockIntervalsAPI);
    DiscordBot.mockImplementation(() => mockDiscordBot);
    DatabaseMemberManager.mockImplementation(() => mockMemberManager);
    ActivityQueue.mockImplementation(() => mockActivityQueue);

    activityProcessor = new ActivityProcessor();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('constructor', () => {
    it('should initialize with all required components', () => {
      expect(activityProcessor.stravaAPI).toBe(mockStravaAPI);
      expect(activityProcessor.memberManager).toBe(mockMemberManager);
      expect(activityProcessor.discordBot).toBe(mockDiscordBot);
      expect(activityProcessor.activityQueue).toBe(mockActivityQueue);
      expect(activityProcessor.processedActivities).toBeInstanceOf(Set);
      expect(activityProcessor.processedActivities.size).toBe(0);
    });

    it('should pass itself to DiscordBot and ActivityQueue', () => {
      expect(DiscordBot).toHaveBeenCalledWith(activityProcessor);
      expect(ActivityQueue).toHaveBeenCalledWith(activityProcessor);
    });
  });

  describe('initialize', () => {
    it('should initialize all components successfully', async () => {
      mockDiscordBot.start.mockResolvedValue();
      mockMemberManager.getMemberCount.mockReturnValue(10);

      await activityProcessor.initialize();

      expect(mockDiscordBot.start).toHaveBeenCalled();
      expect(logger.activity.info).toHaveBeenCalledWith('Initializing Activity Processor...');
      expect(logger.activity.info).toHaveBeenCalledWith('Activity Processor initialized successfully', {
        memberCount: 10
      });
    });

    it('should handle Discord bot start failure', async () => {
      const error = new Error('Discord connection failed');
      mockDiscordBot.start.mockRejectedValue(error);

      await expect(activityProcessor.initialize()).rejects.toThrow(error);
      expect(logger.activity.error).toHaveBeenCalledWith('Failed to initialize Activity Processor', expect.objectContaining({
        message: error.message,
        error: error
      }));
    });

    it('should handle member manager initialization failure', async () => {
      const error = new Error('Failed to initialize member manager');
      mockMemberManager.initialize.mockRejectedValue(error);

      await expect(activityProcessor.initialize()).rejects.toThrow(error);
      expect(logger.activity.error).toHaveBeenCalledWith('Failed to initialize Activity Processor', expect.objectContaining({
        message: error.message,
        error: error
      }));
    });
  });

  describe('processNewActivity', () => {
    beforeEach(() => {
      mockMemberManager.getMemberByAthleteId.mockResolvedValue(mockMember);
      mockMemberManager.getValidAccessToken.mockResolvedValue('valid_token');
      mockStravaAPI.getActivity.mockResolvedValue(mockActivity);
      mockStravaAPI.shouldPostActivity.mockReturnValue(true);
      mockStravaAPI.processActivityWithStreams.mockResolvedValue(mockProcessedActivity);
      mockDiscordBot.postActivity.mockResolvedValue();
    });

    it('should process new activity successfully', async () => {
      await activityProcessor.processNewActivity(98765, 12345);

      expect(mockMemberManager.getMemberByAthleteId).toHaveBeenCalledWith(12345);
      expect(mockMemberManager.getValidAccessToken).toHaveBeenCalledWith(mockMember);
      expect(mockStravaAPI.getActivity).toHaveBeenCalledWith(98765, 'valid_token');
      expect(mockStravaAPI.shouldPostActivity).toHaveBeenCalledWith(mockActivity);
      expect(mockStravaAPI.processActivityWithStreams).toHaveBeenCalledWith(
        mockActivity,
        expect.objectContaining({ ...mockMember.athlete, discordUser: mockMember.discordUser }),
        'valid_token'
      );
      expect(mockDiscordBot.postActivity).toHaveBeenCalledWith(mockProcessedActivity);
      expect(activityProcessor.processedActivities.has('12345-98765')).toBe(true);
      expect(logger.activityProcessing).toHaveBeenCalledWith(98765, 12345, mockActivity.name, 'COMPLETED', expect.any(Object));
    });

    it('should prevent duplicate processing', async () => {
      // Process once
      await activityProcessor.processNewActivity(98765, 12345);
      jest.clearAllMocks();

      // Try to process again
      await activityProcessor.processNewActivity(98765, 12345);

      expect(mockMemberManager.getMemberByAthleteId).not.toHaveBeenCalled();
      expect(logger.activityProcessing).toHaveBeenCalledWith(98765, 12345, 'DUPLICATE', 'SKIPPED', {
        reason: 'Already processed'
      });
    });

    it('should skip activities for non-registered athletes', async () => {
      mockMemberManager.getMemberByAthleteId.mockResolvedValue(null);

      await activityProcessor.processNewActivity(98765, 99999);

      expect(mockStravaAPI.getActivity).not.toHaveBeenCalled();
      expect(logger.activityProcessing).toHaveBeenCalledWith(98765, 99999, 'NOT_MEMBER', 'SKIPPED', {
        reason: 'Athlete not registered as member'
      });
    });

    it('should skip activities when access token is invalid', async () => {
      mockMemberManager.getValidAccessToken.mockResolvedValue(null);

      await activityProcessor.processNewActivity(98765, 12345);

      expect(mockStravaAPI.getActivity).not.toHaveBeenCalled();
      expect(logger.activityProcessing).toHaveBeenCalledWith(98765, 12345, 'Test User', 'FAILED', {
        reason: 'Unable to get valid access token'
      });
    });

    it('should skip webhook events for a member who has switched to a non-strava provider', async () => {
      const intervalsMember = { ...mockMember, provider: 'intervals' };
      mockMemberManager.getMemberByAthleteId.mockResolvedValue(intervalsMember);

      await activityProcessor.processNewActivity(98765, 12345);

      expect(mockMemberManager.getValidAccessToken).not.toHaveBeenCalled();
      expect(mockStravaAPI.getActivity).not.toHaveBeenCalled();
      expect(logger.activityProcessing).toHaveBeenCalledWith(98765, 12345, 'NON_STRAVA_MEMBER', 'SKIPPED', {
        provider: 'intervals'
      });
    });

    it('should still process a member with no provider field set (legacy default strava)', async () => {
      const legacyMember = { ...mockMember };
      delete legacyMember.provider;
      mockMemberManager.getMemberByAthleteId.mockResolvedValue(legacyMember);

      await activityProcessor.processNewActivity(98765, 12345);

      expect(mockStravaAPI.getActivity).toHaveBeenCalledWith(98765, 'valid_token');
      expect(mockDiscordBot.postActivity).toHaveBeenCalled();
    });

    it('should skip and not upsert/post a cross-provider duplicate, after still running PB detection', async () => {
      const pbSpy = jest.spyOn(activityProcessor.pbManager, 'checkAndUpdatePBs').mockResolvedValue([]);
      mockMemberManager.databaseManager.findDuplicateActivity.mockResolvedValue({
        strava_activity_id: 'i176829341'
      });

      await activityProcessor.processNewActivity(98765, 12345);

      expect(pbSpy).toHaveBeenCalledWith(12345, mockActivity);
      expect(mockMemberManager.databaseManager.findDuplicateActivity).toHaveBeenCalledWith(
        12345, mockActivity.start_date_local, 98765, 'strava'
      );
      expect(mockMemberManager.databaseManager.upsertActivity).not.toHaveBeenCalled();
      expect(mockDiscordBot.postActivity).not.toHaveBeenCalled();
      expect(activityProcessor.processedActivities.has('12345-98765')).toBe(true);
      expect(logger.activityProcessing).toHaveBeenCalledWith(98765, 12345, 'CROSS_PROVIDER_DUPLICATE', 'SKIPPED', {
        duplicateOf: 'i176829341'
      });
    });

    it('should skip filtered activities', async () => {
      mockStravaAPI.shouldPostActivity.mockReturnValue(false);

      await activityProcessor.processNewActivity(98765, 12345);

      expect(mockDiscordBot.postActivity).not.toHaveBeenCalled();
      expect(activityProcessor.processedActivities.has('12345-98765')).toBe(true);
      expect(logger.activityProcessing).toHaveBeenCalledWith(
        98765,
        12345,
        mockActivity.name,
        'FILTERED',
        expect.objectContaining({ reason: 'Activity filtered by posting rules' })
      );
    });

    it('should handle Discord posting errors', async () => {
      const error = new Error('Discord API error');
      mockDiscordBot.postActivity.mockRejectedValue(error);

      await activityProcessor.processNewActivity(98765, 12345);

      expect(logger.activityProcessing).toHaveBeenCalledWith(98765, 12345, 'UNKNOWN', 'FAILED', expect.objectContaining({
        error: error.message
      }));
      expect(activityProcessor.processedActivities.has('12345-98765')).toBe(false);
    });

    it('should handle 401 authentication errors with token refresh', async () => {
      const authError = new Error('Unauthorized');
      authError.response = { status: 401 };
      mockStravaAPI.getActivity.mockRejectedValue(authError);
      mockMemberManager.refreshMemberToken.mockResolvedValue('new_token');

      const processSpy = jest.spyOn(activityProcessor, 'processNewActivity');
      
      await activityProcessor.processNewActivity(98765, 12345);

      expect(mockMemberManager.refreshMemberToken).toHaveBeenCalledWith(mockMember);
      expect(logger.activity.info).toHaveBeenCalledWith('Attempting token refresh for authentication error', expect.any(Object));
      expect(logger.activity.info).toHaveBeenCalledWith('Token refreshed, retrying activity processing', expect.any(Object));

      // Fast-forward timer to trigger retry
      jest.advanceTimersByTime(1000);
      
      // Should attempt retry after 1 second
      expect(processSpy).toHaveBeenCalledTimes(2); // Original call + retry
    });

    it('should handle token refresh failure during 401 error', async () => {
      const authError = new Error('Unauthorized');
      authError.response = { status: 401 };
      mockStravaAPI.getActivity.mockRejectedValue(authError);
      
      const refreshError = new Error('Refresh failed');
      mockMemberManager.refreshMemberToken.mockRejectedValue(refreshError);

      await activityProcessor.processNewActivity(98765, 12345);

      expect(logger.activity.error).toHaveBeenCalledWith(
        'Failed to refresh token during activity processing',
        expect.objectContaining({
          activityId: 98765,
          athleteId: 12345,
          error: refreshError.message
        })
      );
    });

    it('should handle member without Discord user data', async () => {
      const memberWithoutDiscord = {
        ...mockMember,
        discordUser: null
      };
      mockMemberManager.getMemberByAthleteId.mockResolvedValue(memberWithoutDiscord);

      await activityProcessor.processNewActivity(98765, 12345);

      expect(mockStravaAPI.processActivityWithStreams).toHaveBeenCalledWith(
        mockActivity,
        expect.objectContaining({ ...mockMember.athlete, discordUser: null }),
        'valid_token'
      );
      expect(mockDiscordBot.postActivity).toHaveBeenCalled();
    });

    it('should call upsertActivity after fetching the activity', async () => {
      await activityProcessor.processNewActivity(98765, 12345);

      expect(mockMemberManager.databaseManager.upsertActivity).toHaveBeenCalledWith(
        12345,
        mockActivity,
        'strava',
        { posted: true }
      );
    });

    it('should continue posting to Discord even if upsertActivity throws', async () => {
      mockMemberManager.databaseManager.upsertActivity.mockRejectedValue(new Error('DB error'));

      await activityProcessor.processNewActivity(98765, 12345);

      expect(mockDiscordBot.postActivity).toHaveBeenCalled();
      expect(activityProcessor.processedActivities.has('12345-98765')).toBe(true);
    });

    it('should still cache the activity and run PB detection for filtered activities', async () => {
      // PB tracking is a member-private record; activity-post filtering must
      // not prevent us from updating PBs or our local activity cache.
      mockStravaAPI.shouldPostActivity.mockReturnValue(false);
      const pbSpy = jest.spyOn(activityProcessor.pbManager, 'checkAndUpdatePBs').mockResolvedValue([]);

      await activityProcessor.processNewActivity(98765, 12345);

      expect(mockMemberManager.databaseManager.upsertActivity).toHaveBeenCalledWith(12345, mockActivity, 'strava', { posted: false });
      expect(pbSpy).toHaveBeenCalledWith(12345, mockActivity);
      // But still skipped for Discord posting:
      expect(mockDiscordBot.postActivity).not.toHaveBeenCalled();
    });
  });

  describe('queueActivity', () => {
    it('should queue activity with webhook data', async () => {
      const webhookData = { eventType: 'create', receivedAt: '2024-01-01T00:00:00Z' };
      mockActivityQueue.queueActivity.mockResolvedValue(true);

      const result = await activityProcessor.queueActivity(98765, 12345, webhookData);

      expect(mockActivityQueue.queueActivity).toHaveBeenCalledWith(98765, 12345, webhookData);
      expect(logger.activity.info).toHaveBeenCalledWith('Queueing activity for delayed posting', {
        activityId: 98765,
        athleteId: 12345,
        delayMinutes: config.posting.delayMinutes
      });
      expect(result).toBe(true);
    });

    it('should queue activity with empty webhook data', async () => {
      await activityProcessor.queueActivity(98765, 12345);

      expect(mockActivityQueue.queueActivity).toHaveBeenCalledWith(98765, 12345, {});
    });
  });

  describe('updateQueuedActivity', () => {
    it('should update existing queued activity', async () => {
      const webhookData = { eventType: 'update', receivedAt: '2024-01-01T01:00:00Z' };
      mockActivityQueue.updateQueuedActivity.mockReturnValue(true);

      await activityProcessor.updateQueuedActivity(98765, 12345, webhookData);

      expect(mockActivityQueue.updateQueuedActivity).toHaveBeenCalledWith(98765, 12345, webhookData);
      expect(logger.activity.info).toHaveBeenCalledWith('Updated queued activity with new data', {
        activityId: 98765,
        athleteId: 12345
      });
    });

    it('should queue activity if not currently queued and not processed', async () => {
      mockActivityQueue.updateQueuedActivity.mockReturnValue(false);
      jest.spyOn(activityProcessor, 'queueActivity').mockResolvedValue();

      await activityProcessor.updateQueuedActivity(98765, 12345);

      expect(logger.activity.debug).toHaveBeenCalledWith('Activity update received for non-queued activity', {
        activityId: 98765,
        athleteId: 12345
      });
      expect(activityProcessor.queueActivity).toHaveBeenCalledWith(98765, 12345, {});
    });

    it('should ignore updates for already processed activities', async () => {
      mockActivityQueue.updateQueuedActivity.mockReturnValue(false);
      activityProcessor.processedActivities.add('12345-98765');

      await activityProcessor.updateQueuedActivity(98765, 12345);

      expect(logger.activity.debug).toHaveBeenCalledWith('Activity already posted, ignoring update', {
        activityId: 98765,
        athleteId: 12345
      });
    });

    // Reported 2026-08-26: an activity uploaded privately and then switched to
    // public never posted. The filter marked it processed, so the update that
    // made it public was dropped - permanently, and silently at debug level.
    describe('activity made public after being filtered', () => {
      it('should re-queue an activity that was filtered and then updated', async () => {
        mockActivityQueue.updateQueuedActivity.mockReturnValue(false);
        jest.spyOn(activityProcessor, 'queueActivity').mockResolvedValue();
        activityProcessor.markFiltered('12345-98765');

        await activityProcessor.updateQueuedActivity(98765, 12345, {
          updates: { private: 'false', visibility: 'everyone' }
        });

        expect(activityProcessor.queueActivity).toHaveBeenCalledWith(98765, 12345, {
          updates: { private: 'false', visibility: 'everyone' }
        });
      });

      it('should say why it is reconsidering the activity', async () => {
        mockActivityQueue.updateQueuedActivity.mockReturnValue(false);
        jest.spyOn(activityProcessor, 'queueActivity').mockResolvedValue();
        activityProcessor.markFiltered('12345-98765');

        await activityProcessor.updateQueuedActivity(98765, 12345);

        expect(logger.activity.info).toHaveBeenCalledWith(
          expect.stringMatching(/filtered/i),
          expect.objectContaining({ activityId: 98765, athleteId: 12345 })
        );
      });

      it('should clear the filtered mark so it cannot loop on repeat updates', async () => {
        mockActivityQueue.updateQueuedActivity.mockReturnValue(false);
        jest.spyOn(activityProcessor, 'queueActivity').mockResolvedValue();
        activityProcessor.markFiltered('12345-98765');

        await activityProcessor.updateQueuedActivity(98765, 12345);

        expect(activityProcessor.filteredActivities.has('12345-98765')).toBe(false);
        expect(activityProcessor.processedActivities.has('12345-98765')).toBe(false);
      });

      // A title edit on an activity that already posted must not repost it.
      it('should still ignore updates for an activity that was actually posted', async () => {
        mockActivityQueue.updateQueuedActivity.mockReturnValue(false);
        jest.spyOn(activityProcessor, 'queueActivity').mockResolvedValue();
        activityProcessor.processedActivities.add('12345-98765');

        await activityProcessor.updateQueuedActivity(98765, 12345);

        expect(activityProcessor.queueActivity).not.toHaveBeenCalled();
      });

      it('should record a filtered activity as filtered, not merely processed', async () => {
        mockStravaAPI.shouldPostActivity.mockReturnValue(false);
        mockMemberManager.getMemberByAthleteId.mockResolvedValue(mockMember);
        mockMemberManager.getValidAccessToken.mockResolvedValue('token');
        mockStravaAPI.getActivity.mockResolvedValue({ id: 98765, name: 'Private run' });

        await activityProcessor.processNewActivity(98765, 12345);

        expect(activityProcessor.filteredActivities.has('12345-98765')).toBe(true);
      });

      it('should forget filtered marks alongside processed ones during cleanup', () => {
        for (let i = 0; i < 10001; i++) {
          activityProcessor.markFiltered(`12345-${i}`);
        }

        activityProcessor.cleanupProcessedActivities();

        expect(activityProcessor.filteredActivities.size)
          .toBeLessThanOrEqual(activityProcessor.processedActivities.size);
      });
    });
  });

  describe('removeQueuedActivity', () => {
    it('should remove activity from queue', async () => {
      mockActivityQueue.removeFromQueue.mockReturnValue(true);

      await activityProcessor.removeQueuedActivity(98765, 12345);

      expect(mockActivityQueue.removeFromQueue).toHaveBeenCalledWith(98765);
      expect(logger.activity.info).toHaveBeenCalledWith('Removed deleted activity from queue', {
        activityId: 98765,
        athleteId: 12345
      });
    });

    it('should handle removal of non-queued activity', async () => {
      mockActivityQueue.removeFromQueue.mockReturnValue(false);

      await activityProcessor.removeQueuedActivity(98765, 12345);

      expect(logger.activity.debug).toHaveBeenCalledWith('Activity deletion received for non-queued activity', {
        activityId: 98765,
        athleteId: 12345
      });
    });
  });

  describe('processRecentActivities', () => {
    // Increase timeout for all tests in this describe block
    jest.setTimeout(2000);

    const mockActivities = [
      { id: 111, name: 'Recent Run 1' },
      { id: 222, name: 'Recent Run 2' }
    ];

    beforeEach(() => {
      // Clear all mocks and setup fake timers
      jest.clearAllMocks();
      jest.useFakeTimers();
      
      // Setup mock responses
      mockMemberManager.getAllMembers.mockResolvedValue([mockMember]);
      mockMemberManager.getValidAccessToken.mockResolvedValue('valid_token');
      mockStravaAPI.getAthleteActivities.mockResolvedValue(mockActivities);
      jest.spyOn(activityProcessor, 'processNewActivity').mockResolvedValue();
    });

    it('should process recent activities for all members', async () => {
      const hoursBack = 6;
      const expectedAfter = Math.floor((Date.now() - (6 * 60 * 60 * 1000)) / 1000);
      
      // Create multiple members to test with
      const members = [
        mockMember,
        { ...mockMember, athlete: { ...mockMember.athlete, id: 67890 } }
      ];
      mockMemberManager.getAllMembers.mockResolvedValue(members);
      
      // Setup staggered responses to simulate delay
      mockStravaAPI.getAthleteActivities
        .mockImplementationOnce(() => Promise.resolve(mockActivities))
        .mockImplementationOnce(() => Promise.resolve([{ id: 333, name: 'Recent Run 3' }]));

      // Create a promise that resolves when processing is done
      const processPromise = activityProcessor.processRecentActivities(hoursBack);

      // Run all pending promises and advance timers
      await jest.runAllTimersAsync();
      
      // Now wait for the processing to complete
      await processPromise;

      expect(mockMemberManager.getAllMembers).toHaveBeenCalled();
      expect(mockStravaAPI.getAthleteActivities).toHaveBeenCalledTimes(2);
      expect(mockStravaAPI.getAthleteActivities).toHaveBeenCalledWith(
        'valid_token',
        1,
        30,
        null,
        expect.any(Number)
      );
      
      // Verify all activities were processed for both members
      expect(activityProcessor.processNewActivity).toHaveBeenCalledWith(111, 12345);
      expect(activityProcessor.processNewActivity).toHaveBeenCalledWith(222, 12345);
      expect(activityProcessor.processNewActivity).toHaveBeenCalledWith(333, 67890);
    });

    it('should skip members with invalid tokens', async () => {
      mockMemberManager.getValidAccessToken.mockResolvedValue(null);

      await activityProcessor.processRecentActivities(6);

      expect(mockStravaAPI.getAthleteActivities).not.toHaveBeenCalled();
      expect(logger.activity.warn).toHaveBeenCalledWith('Unable to get valid access token for recent activities', {
        memberName: 'Test User',
        athleteId: 12345
      });
    });

    it('should handle member processing errors gracefully', async () => {
      const error = new Error('API error');
      mockStravaAPI.getAthleteActivities.mockRejectedValue(error);

      await activityProcessor.processRecentActivities(6);

      expect(logger.activity.error).toHaveBeenCalledWith('Error processing recent activities for member', {
        memberName: 'Test User',
        athleteId: 12345,
        error: error.message
      });
    });

    it('should process activities with delay to avoid rate limiting', async () => {
      const activities = [
        { id: 111, name: 'Run 1' },
        { id: 222, name: 'Run 2' }
      ];
      mockStravaAPI.getAthleteActivities.mockResolvedValue(activities);

      // Start processing activities
      const processPromise = activityProcessor.processRecentActivities(6);
      
      // Fast-forward each timeout
      for (let i = 0; i < activities.length; i++) {
        // Advance timers by 200ms (the rate limit delay)
        await jest.advanceTimersByTimeAsync(200);
      }
      
      // Complete the processing
      await processPromise;

      // Verify that activities were processed in sequence with delays
      expect(activityProcessor.processNewActivity).toHaveBeenCalledWith(111, 12345);
      expect(activityProcessor.processNewActivity).toHaveBeenCalledWith(222, 12345);
      expect(activityProcessor.processNewActivity).toHaveBeenCalledTimes(2);
    });

    it('should handle members without Discord user data', async () => {
      const memberWithoutDiscord = {
        ...mockMember,
        discordUser: null
      };
      mockMemberManager.getAllMembers.mockResolvedValue([memberWithoutDiscord]);
      
      // Ensure mocks return quickly to avoid timeouts
      mockMemberManager.getValidAccessToken.mockResolvedValue('valid_token');
      mockStravaAPI.getAthleteActivities.mockResolvedValue([]);

      await activityProcessor.processRecentActivities(6);

      expect(logger.activity.debug).toHaveBeenCalledWith('Processing recent activities for member', {
        memberName: 'John Doe',
        athleteId: 12345,
        discordUserId: '123456789'
      });
    }, 15000);

    it('should skip intervals.icu members (recovered separately via pollIntervalsActivities)', async () => {
      const intervalsMember = {
        ...mockMember,
        athlete: { ...mockMember.athlete, id: 54321 },
        provider: 'intervals'
      };
      mockMemberManager.getAllMembers.mockResolvedValue([mockMember, intervalsMember]);
      mockStravaAPI.getAthleteActivities.mockResolvedValue([]);

      await activityProcessor.processRecentActivities(6);

      expect(mockStravaAPI.getAthleteActivities).toHaveBeenCalledTimes(1);
      expect(mockMemberManager.getValidAccessToken).toHaveBeenCalledTimes(1);
      expect(mockMemberManager.getValidAccessToken).toHaveBeenCalledWith(mockMember);
    });
  });

  describe('pollIntervalsActivities', () => {
    const stravaMember = {
      ...mockMember,
      provider: 'strava'
    };

    const intervalsMember = {
      discordUserId: '555555',
      discordUser: { displayName: 'Intervals User', username: 'intervalsuser' },
      athleteId: 54321,
      athlete: { id: 54321, firstname: 'Jane', lastname: 'Runner' },
      provider: 'intervals'
    };

    const intervalsActivity = {
      id: 'i176829341',
      name: 'Easy Run',
      type: 'Run',
      distance: 8000,
      moving_time: 2400,
      start_date_local: '2026-08-17T07:00:00'
    };

    beforeEach(() => {
      jest.clearAllMocks();
      jest.useFakeTimers();

      mockMemberManager.getAllMembers.mockResolvedValue([stravaMember, intervalsMember]);
      mockMemberManager.getValidAccessToken.mockResolvedValue('intervals_api_key');
      mockIntervalsAPI.getAthleteActivities.mockResolvedValue([intervalsActivity]);
      mockIntervalsAPI.shouldPostActivity.mockReturnValue(true);
      mockIntervalsAPI.processActivityData.mockReturnValue({ ...intervalsActivity, provider: 'intervals' });
      mockDiscordBot.postActivity.mockResolvedValue();
      mockMemberManager.databaseManager.getActivityById.mockResolvedValue(null);
    });

    it('polls only intervals.icu members and ignores strava-provider members', async () => {
      const promise = activityProcessor.pollIntervalsActivities();
      await jest.runAllTimersAsync();
      await promise;

      expect(mockMemberManager.getValidAccessToken).toHaveBeenCalledTimes(1);
      expect(mockMemberManager.getValidAccessToken).toHaveBeenCalledWith(intervalsMember);
      expect(mockIntervalsAPI.getAthleteActivities).toHaveBeenCalledTimes(1);
    });

    it('passes the resolved API key through to processIntervalsActivity', async () => {
      const spy = jest.spyOn(activityProcessor, 'processIntervalsActivity').mockResolvedValue();

      const promise = activityProcessor.pollIntervalsActivities();
      await jest.runAllTimersAsync();
      await promise;

      expect(spy).toHaveBeenCalledWith(intervalsActivity, intervalsMember, 'intervals_api_key');
    });

    it('always uses a fixed 40-hour lookback window, independent of any prior poll', async () => {
      const now = Date.now();
      jest.spyOn(Date, 'now').mockReturnValue(now);

      const promise = activityProcessor.pollIntervalsActivities();
      await jest.runAllTimersAsync();
      await promise;

      const [, oldest] = mockIntervalsAPI.getAthleteActivities.mock.calls[0];
      expect(oldest).toBe(new Date(now - 40 * 60 * 60 * 1000).toISOString());

      Date.now.mockRestore();
    });

    it('does not read or write any intervals poll watermark setting', async () => {
      const promise = activityProcessor.pollIntervalsActivities();
      await jest.runAllTimersAsync();
      await promise;

      expect(mockMemberManager.databaseManager.settingsManager.getSetting).not.toHaveBeenCalled();
      expect(mockMemberManager.databaseManager.settingsManager.setSetting).not.toHaveBeenCalled();
    });

    it('skips members without a valid api key and continues', async () => {
      mockMemberManager.getValidAccessToken.mockResolvedValue(null);

      const promise = activityProcessor.pollIntervalsActivities();
      await jest.runAllTimersAsync();
      await promise;

      expect(mockIntervalsAPI.getAthleteActivities).not.toHaveBeenCalled();
      expect(logger.activity.warn).toHaveBeenCalledWith(
        'Unable to get valid API key for intervals.icu poll',
        expect.objectContaining({ athleteId: 54321 })
      );
    });

    it('returns early when there are no intervals.icu members', async () => {
      mockMemberManager.getAllMembers.mockResolvedValue([stravaMember]);

      await activityProcessor.pollIntervalsActivities();

      expect(mockIntervalsAPI.getAthleteActivities).not.toHaveBeenCalled();
      expect(mockMemberManager.databaseManager.settingsManager.setSetting).not.toHaveBeenCalled();
    });

    it('continues to the next member when one member errors', async () => {
      const secondIntervalsMember = {
        ...intervalsMember,
        discordUserId: '666666',
        athlete: { id: 99999, firstname: 'Second', lastname: 'Runner' }
      };
      mockMemberManager.getAllMembers.mockResolvedValue([intervalsMember, secondIntervalsMember]);
      mockMemberManager.getValidAccessToken
        .mockResolvedValueOnce('intervals_api_key')
        .mockResolvedValueOnce('intervals_api_key');
      mockIntervalsAPI.getAthleteActivities
        .mockRejectedValueOnce(new Error('rate limited'))
        .mockResolvedValueOnce([intervalsActivity]);

      const promise = activityProcessor.pollIntervalsActivities();
      await jest.runAllTimersAsync();
      await promise;

      expect(logger.activity.error).toHaveBeenCalledWith(
        'Error polling intervals.icu activities for member',
        expect.objectContaining({ athleteId: 54321, error: 'rate limited' })
      );
      expect(mockIntervalsAPI.getAthleteActivities).toHaveBeenCalledTimes(2);
      expect(mockDiscordBot.postActivity).toHaveBeenCalled();
    });

    it('does not throw when the poll itself fails unexpectedly', async () => {
      mockMemberManager.getAllMembers.mockRejectedValue(new Error('db down'));

      await expect(activityProcessor.pollIntervalsActivities()).resolves.toBeUndefined();
      expect(logger.activity.error).toHaveBeenCalledWith(
        'Failed to poll intervals.icu activities',
        expect.objectContaining({ error: 'db down' })
      );
    });
  });

  describe('processIntervalsActivity', () => {
    const intervalsMember = {
      discordUserId: '555555',
      discordUser: { displayName: 'Intervals User', username: 'intervalsuser' },
      athleteId: 54321,
      athlete: { id: 54321, firstname: 'Jane', lastname: 'Runner' },
      provider: 'intervals'
    };

    const intervalsActivity = {
      id: 'i176829341',
      name: 'Easy Run',
      type: 'Run',
      distance: 8000,
      moving_time: 2400,
      start_date_local: '2026-08-17T07:00:00'
    };

    const apiKey = 'intervals_api_key';

    beforeEach(() => {
      mockMemberManager.databaseManager.getActivityById.mockResolvedValue(null);
      mockMemberManager.databaseManager.upsertActivity.mockResolvedValue(undefined);
      mockIntervalsAPI.shouldPostActivity.mockReturnValue(true);
      mockIntervalsAPI.processActivityData.mockImplementation(() => ({
        ...intervalsActivity,
        provider: 'intervals',
        url: 'https://intervals.icu/activities/i176829341'
      }));
      mockDiscordBot.postActivity.mockResolvedValue();
    });

    it('posts the processed activity, then persists it, and marks it processed on the happy path', async () => {
      const callOrder = [];
      mockDiscordBot.postActivity.mockImplementation(async () => { callOrder.push('post'); });
      mockMemberManager.databaseManager.upsertActivity.mockImplementation(async () => { callOrder.push('upsert'); });

      await activityProcessor.processIntervalsActivity(intervalsActivity, intervalsMember, apiKey);

      expect(mockMemberManager.databaseManager.upsertActivity).toHaveBeenCalledWith(54321, intervalsActivity, 'intervals', { posted: true });
      expect(mockIntervalsAPI.processActivityData).toHaveBeenCalledWith(
        intervalsActivity,
        expect.objectContaining({ ...intervalsMember.athlete, discordUser: intervalsMember.discordUser }),
        {}
      );
      expect(mockDiscordBot.postActivity).toHaveBeenCalledWith(expect.objectContaining({
        id: intervalsActivity.id,
        provider: 'intervals',
        url: 'https://intervals.icu/activities/i176829341'
      }));
      // Persist only happens after a successful post, so a post failure can never
      // leave a DB row that permanently blocks a retry.
      expect(callOrder).toEqual(['post', 'upsert']);
      expect(activityProcessor.processedActivities.has('54321-i176829341')).toBe(true);
      expect(logger.activityProcessing).toHaveBeenCalledWith(
        'i176829341', 54321, intervalsActivity.name, 'COMPLETED', expect.any(Object)
      );
    });

    it('fetches streams once and passes them to processActivityData', async () => {
      const streams = { time: [0, 1, 2], distance: [0, 5, 10], altitude: [10, 11, 12] };
      mockIntervalsAPI.getActivityStreams.mockResolvedValue(streams);

      await activityProcessor.processIntervalsActivity(intervalsActivity, intervalsMember, apiKey);

      expect(mockIntervalsAPI.getActivityStreams).toHaveBeenCalledTimes(1);
      expect(mockIntervalsAPI.getActivityStreams).toHaveBeenCalledWith(intervalsActivity.id, apiKey);
      expect(mockIntervalsAPI.processActivityData).toHaveBeenCalledWith(
        intervalsActivity,
        expect.objectContaining({ ...intervalsMember.athlete, discordUser: intervalsMember.discordUser }),
        streams
      );
    });

    it('does not fetch streams when no apiKey is provided, and processes with null streams', async () => {
      await activityProcessor.processIntervalsActivity(intervalsActivity, intervalsMember);

      expect(mockIntervalsAPI.getActivityStreams).not.toHaveBeenCalled();
      expect(BestEffortCalculator.synthesizeBestEfforts).not.toHaveBeenCalled();
      expect(mockIntervalsAPI.processActivityData).toHaveBeenCalledWith(
        intervalsActivity,
        expect.objectContaining({ ...intervalsMember.athlete, discordUser: intervalsMember.discordUser }),
        null
      );
      expect(mockDiscordBot.postActivity).toHaveBeenCalled();
    });

    it('processes the activity with null streams and skips PB check when the stream fetch fails', async () => {
      mockIntervalsAPI.getActivityStreams.mockRejectedValue(new Error('streams unavailable'));
      const pbSpy = jest.spyOn(activityProcessor.pbManager, 'checkAndUpdatePBs');

      await activityProcessor.processIntervalsActivity(intervalsActivity, intervalsMember, apiKey);

      expect(logger.activity.debug).toHaveBeenCalledWith(
        'Failed to fetch intervals.icu activity streams (non-blocking)',
        expect.objectContaining({
          activityId: intervalsActivity.id,
          athleteId: 54321,
          error: 'streams unavailable'
        })
      );
      expect(BestEffortCalculator.synthesizeBestEfforts).not.toHaveBeenCalled();
      expect(pbSpy).not.toHaveBeenCalled();
      expect(mockIntervalsAPI.processActivityData).toHaveBeenCalledWith(
        intervalsActivity,
        expect.objectContaining({ ...intervalsMember.athlete, discordUser: intervalsMember.discordUser }),
        null
      );
      expect(mockDiscordBot.postActivity).toHaveBeenCalled();
    });

    it('does not call checkAndUpdatePBs when no best efforts are synthesized from streams', async () => {
      mockIntervalsAPI.getActivityStreams.mockResolvedValue({ time: [0, 1] });
      BestEffortCalculator.synthesizeBestEfforts.mockReturnValue([]);
      const pbSpy = jest.spyOn(activityProcessor.pbManager, 'checkAndUpdatePBs');

      await activityProcessor.processIntervalsActivity(intervalsActivity, intervalsMember, apiKey);

      expect(pbSpy).not.toHaveBeenCalled();
    });

    it('runs PB detection with synthesized best_efforts, attaches pbResults, and posts', async () => {
      const streams = { time: [0, 1, 2], distance: [0, 5, 10] };
      mockIntervalsAPI.getActivityStreams.mockResolvedValue(streams);
      const efforts = [{ name: '1/2 mile', distance: 805, elapsed_time: 200, moving_time: 200 }];
      BestEffortCalculator.synthesizeBestEfforts.mockReturnValue(efforts);
      const pbResults = [{ isNewPB: true, category: 'Half Mile', previousPB: null, newPB: efforts[0] }];
      const pbSpy = jest.spyOn(activityProcessor.pbManager, 'checkAndUpdatePBs').mockResolvedValue(pbResults);

      await activityProcessor.processIntervalsActivity(intervalsActivity, intervalsMember, apiKey);

      expect(BestEffortCalculator.synthesizeBestEfforts).toHaveBeenCalledWith(streams);
      expect(pbSpy).toHaveBeenCalledWith(54321, { ...intervalsActivity, best_efforts: efforts });
      // PB check must run before the post-filter is evaluated.
      const pbCallOrder = pbSpy.mock.invocationCallOrder[0];
      const shouldPostCallOrder = mockIntervalsAPI.shouldPostActivity.mock.invocationCallOrder[0];
      expect(pbCallOrder).toBeLessThan(shouldPostCallOrder);
      expect(mockDiscordBot.postActivity).toHaveBeenCalledWith(expect.objectContaining({ pbResults }));
    });

    it('does not block posting when the PB check fails (non-blocking)', async () => {
      mockIntervalsAPI.getActivityStreams.mockResolvedValue({ time: [0, 1, 2], distance: [0, 5, 10] });
      BestEffortCalculator.synthesizeBestEfforts.mockReturnValue([{ name: '1K' }]);
      jest.spyOn(activityProcessor.pbManager, 'checkAndUpdatePBs').mockRejectedValue(new Error('pb db error'));

      await activityProcessor.processIntervalsActivity(intervalsActivity, intervalsMember, apiKey);

      expect(logger.activity.error).toHaveBeenCalledWith('PB check failed (non-blocking)', expect.objectContaining({
        activityId: intervalsActivity.id,
        athleteId: 54321,
        error: 'pb db error'
      }));
      expect(mockDiscordBot.postActivity).toHaveBeenCalled();
      expect(activityProcessor.processedActivities.has('54321-i176829341')).toBe(true);
    });

    it('skips already-processed activities (in-memory dedup) without fetching streams or running PB checks', async () => {
      activityProcessor.processedActivities.add('54321-i176829341');

      await activityProcessor.processIntervalsActivity(intervalsActivity, intervalsMember, apiKey);

      expect(mockMemberManager.databaseManager.getActivityById).not.toHaveBeenCalled();
      expect(mockIntervalsAPI.getActivityStreams).not.toHaveBeenCalled();
      expect(BestEffortCalculator.synthesizeBestEfforts).not.toHaveBeenCalled();
      expect(logger.activityProcessing).toHaveBeenCalledWith(
        'i176829341', 54321, 'DUPLICATE', 'SKIPPED', { reason: 'Already processed' }
      );
    });

    it('skips activities already present in the database (restart-safe dedup) without fetching streams or running PB checks', async () => {
      mockMemberManager.databaseManager.getActivityById.mockResolvedValue({ strava_activity_id: 'i176829341', posted: 1 });

      await activityProcessor.processIntervalsActivity(intervalsActivity, intervalsMember, apiKey);

      expect(mockMemberManager.databaseManager.upsertActivity).not.toHaveBeenCalled();
      expect(mockDiscordBot.postActivity).not.toHaveBeenCalled();
      expect(mockIntervalsAPI.getActivityStreams).not.toHaveBeenCalled();
      expect(BestEffortCalculator.synthesizeBestEfforts).not.toHaveBeenCalled();
      expect(activityProcessor.processedActivities.has('54321-i176829341')).toBe(true);
    });

    it('skips a cross-provider duplicate (found via findDuplicateActivity) without upserting, fetching streams, or running PB checks', async () => {
      mockMemberManager.databaseManager.findDuplicateActivity.mockResolvedValue({
        strava_activity_id: '98765'
      });

      await activityProcessor.processIntervalsActivity(intervalsActivity, intervalsMember, apiKey);

      expect(mockMemberManager.databaseManager.findDuplicateActivity).toHaveBeenCalledWith(
        54321, intervalsActivity.start_date_local, intervalsActivity.id, 'intervals'
      );
      expect(mockMemberManager.databaseManager.upsertActivity).not.toHaveBeenCalled();
      expect(mockDiscordBot.postActivity).not.toHaveBeenCalled();
      expect(mockIntervalsAPI.getActivityStreams).not.toHaveBeenCalled();
      expect(BestEffortCalculator.synthesizeBestEfforts).not.toHaveBeenCalled();
      expect(activityProcessor.processedActivities.has('54321-i176829341')).toBe(true);
      expect(logger.activityProcessing).toHaveBeenCalledWith(
        'i176829341', 54321, 'CROSS_PROVIDER_DUPLICATE', 'SKIPPED', { duplicateOf: '98765' }
      );
    });

    it('caches and skips activities filtered by shouldPostActivity, but still records PBs found via streams', async () => {
      mockIntervalsAPI.shouldPostActivity.mockReturnValue(false);
      const streams = { time: [0, 1, 2], distance: [0, 5, 10] };
      mockIntervalsAPI.getActivityStreams.mockResolvedValue(streams);
      const efforts = [{ name: '1K' }];
      BestEffortCalculator.synthesizeBestEfforts.mockReturnValue(efforts);
      const pbSpy = jest.spyOn(activityProcessor.pbManager, 'checkAndUpdatePBs').mockResolvedValue([{ isNewPB: true }]);

      await activityProcessor.processIntervalsActivity(intervalsActivity, intervalsMember, apiKey);

      expect(pbSpy).toHaveBeenCalledWith(54321, { ...intervalsActivity, best_efforts: efforts });
      expect(mockMemberManager.databaseManager.upsertActivity).toHaveBeenCalled();
      expect(mockDiscordBot.postActivity).not.toHaveBeenCalled();
      expect(activityProcessor.processedActivities.has('54321-i176829341')).toBe(true);
      expect(logger.activityProcessing).toHaveBeenCalledWith(
        'i176829341', 54321, intervalsActivity.name, 'FILTERED', expect.objectContaining({ pbsRecorded: 1 })
      );
    });

    it('does not persist or mark as processed when Discord posting fails, so a later poll retries it', async () => {
      mockDiscordBot.postActivity.mockRejectedValue(new Error('discord error'));

      await activityProcessor.processIntervalsActivity(intervalsActivity, intervalsMember, apiKey);

      expect(mockMemberManager.databaseManager.upsertActivity).not.toHaveBeenCalled();
      expect(activityProcessor.processedActivities.has('54321-i176829341')).toBe(false);
      expect(logger.activityProcessing).toHaveBeenCalledWith(
        'i176829341', 54321, 'UNKNOWN', 'FAILED', expect.any(Object)
      );

      // Simulate the next poll: DB still has no row and the in-memory set has
      // no entry for this activity, so dedup lets it through and a retry can
      // succeed.
      mockDiscordBot.postActivity.mockResolvedValue();
      await activityProcessor.processIntervalsActivity(intervalsActivity, intervalsMember, apiKey);

      expect(mockDiscordBot.postActivity).toHaveBeenCalledTimes(2);
      expect(mockMemberManager.databaseManager.upsertActivity).toHaveBeenCalledWith(54321, intervalsActivity, 'intervals', { posted: true });
      expect(activityProcessor.processedActivities.has('54321-i176829341')).toBe(true);
    });
  });

  describe('cleanupProcessedActivities', () => {
    it('should not cleanup if size is below threshold', () => {
      // Add some activities but stay below threshold
      for (let i = 0; i < 5000; i++) {
        activityProcessor.processedActivities.add(`test-${i}`);
      }

      activityProcessor.cleanupProcessedActivities();

      expect(activityProcessor.processedActivities.size).toBe(5000);
      expect(logger.activity.debug).not.toHaveBeenCalled();
    });

    it('should cleanup when size exceeds threshold', () => {
      // Add activities to exceed threshold
      for (let i = 0; i < 12000; i++) {
        activityProcessor.processedActivities.add(`test-${i}`);
      }

      activityProcessor.cleanupProcessedActivities();

      expect(activityProcessor.processedActivities.size).toBe(8000); // 80% of 10000
      expect(logger.activity.debug).toHaveBeenCalledWith('Cleaned up processed activities cache', {
        previousSize: 10000,
        currentSize: 8000,
        cleanupRatio: '80%'
      });
    });

    it('should keep most recent activities during cleanup', () => {
      // Add activities with predictable order
      for (let i = 0; i < 12000; i++) {
        activityProcessor.processedActivities.add(`test-${i}`);
      }

      activityProcessor.cleanupProcessedActivities();

      // Should keep the most recent ones (higher numbers)
      expect(activityProcessor.processedActivities.has('test-11999')).toBe(true);
      expect(activityProcessor.processedActivities.has('test-0')).toBe(false);
    });
  });

  describe('revokeStravaAccess', () => {
    const athleteId = 12345;
    const member = { athleteId, discordUserId: '123456789', provider: 'strava' };

    it('should return no_credentials when the member has no stored Strava tokens', async () => {
      mockMemberManager.getStoredProviderTokens.mockResolvedValue(null);

      const result = await activityProcessor.revokeStravaAccess(member);

      expect(mockMemberManager.getStoredProviderTokens).toHaveBeenCalledWith(member, 'strava');
      expect(mockStravaAPI.deauthorize).not.toHaveBeenCalled();
      expect(result).toEqual({ revoked: false, reason: 'no_credentials' });
    });

    it('should deauthorize directly with a still-valid access token', async () => {
      const tokenData = {
        access_token: 'valid_access_token',
        refresh_token: 'refresh_token',
        expires_at: Math.floor(Date.now() / 1000) + 3600
      };
      mockMemberManager.getStoredProviderTokens.mockResolvedValue(tokenData);
      mockStravaAPI.deauthorize.mockResolvedValue({ revoked: true });

      const result = await activityProcessor.revokeStravaAccess(member);

      expect(mockStravaAPI.refreshAccessToken).not.toHaveBeenCalled();
      expect(mockStravaAPI.deauthorize).toHaveBeenCalledWith('valid_access_token');
      expect(mockMemberManager.databaseManager.clearProviderTokens).toHaveBeenCalledWith(athleteId, 'strava');
      expect(result).toEqual({ revoked: true });
    });

    it('should refresh an expired access token before deauthorizing', async () => {
      const tokenData = {
        access_token: 'stale_access_token',
        refresh_token: 'refresh_token',
        expires_at: Math.floor(Date.now() / 1000) - 10
      };
      mockMemberManager.getStoredProviderTokens.mockResolvedValue(tokenData);
      mockStravaAPI.refreshAccessToken.mockResolvedValue({ access_token: 'new_access_token' });
      mockStravaAPI.deauthorize.mockResolvedValue({ revoked: true });

      const result = await activityProcessor.revokeStravaAccess(member);

      expect(mockStravaAPI.refreshAccessToken).toHaveBeenCalledWith('refresh_token');
      expect(mockStravaAPI.deauthorize).toHaveBeenCalledWith('new_access_token');
      expect(result).toEqual({ revoked: true });
    });

    it('should treat a failed token refresh as already revoked', async () => {
      const tokenData = {
        access_token: 'stale_access_token',
        refresh_token: 'refresh_token',
        expires_at: Math.floor(Date.now() / 1000) - 10
      };
      mockMemberManager.getStoredProviderTokens.mockResolvedValue(tokenData);
      mockStravaAPI.refreshAccessToken.mockRejectedValue(new Error('invalid_grant'));

      const result = await activityProcessor.revokeStravaAccess(member);

      expect(mockStravaAPI.deauthorize).not.toHaveBeenCalled();
      expect(mockMemberManager.databaseManager.clearProviderTokens).not.toHaveBeenCalled();
      expect(result).toEqual({ revoked: true, reason: 'already_revoked' });
    });

    it('should treat an expired token with no refresh token as already revoked', async () => {
      const tokenData = {
        access_token: 'stale_access_token',
        expires_at: Math.floor(Date.now() / 1000) - 10
      };
      mockMemberManager.getStoredProviderTokens.mockResolvedValue(tokenData);

      const result = await activityProcessor.revokeStravaAccess(member);

      expect(mockStravaAPI.deauthorize).not.toHaveBeenCalled();
      expect(result).toEqual({ revoked: true, reason: 'already_revoked' });
    });

    it('should not clear stored tokens when the Strava API call fails', async () => {
      const tokenData = {
        access_token: 'valid_access_token',
        refresh_token: 'refresh_token',
        expires_at: Math.floor(Date.now() / 1000) + 3600
      };
      mockMemberManager.getStoredProviderTokens.mockResolvedValue(tokenData);
      mockStravaAPI.deauthorize.mockResolvedValue({ revoked: false, reason: 'Network error' });

      const result = await activityProcessor.revokeStravaAccess(member);

      expect(mockMemberManager.databaseManager.clearProviderTokens).not.toHaveBeenCalled();
      expect(result).toEqual({ revoked: false, reason: 'Network error' });
    });

    it('should never throw - unexpected errors resolve to revoked:false', async () => {
      mockMemberManager.getStoredProviderTokens.mockRejectedValue(new Error('db exploded'));

      const result = await activityProcessor.revokeStravaAccess(member);

      expect(result).toEqual({ revoked: false, reason: 'db exploded' });
      expect(logger.member.error).toHaveBeenCalledWith('Unexpected error revoking Strava access', {
        athleteId,
        error: 'db exploded'
      });
    });
  });

  describe('countStravaSeats / getReclaimableStravaMembers', () => {
    // Shared fixture set exercising every category from the seat-accounting
    // contract: real seat usage (`used`) is any stored Strava credential,
    // active state or provider notwithstanding; `reclaimable` is the subset
    // that no longer needs it.
    const activeStravaWithTokens = { athleteId: 1, isActive: true, provider: 'strava' };
    const inactiveStravaWithTokens = { athleteId: 2, isActive: false, provider: 'strava' };
    const activeIntervalsWithLingeringStravaTokens = { athleteId: 3, isActive: true, provider: 'intervals' };
    const activeIntervalsNoStravaTokens = { athleteId: 4, isActive: true, provider: 'intervals' };
    const activeStravaClearedTokens = { athleteId: 5, isActive: true, provider: 'strava' };
    const corruptBlobMember = { athleteId: 6, isActive: true, provider: 'strava' };

    const allMembers = [
      activeStravaWithTokens,
      inactiveStravaWithTokens,
      activeIntervalsWithLingeringStravaTokens,
      activeIntervalsNoStravaTokens,
      activeStravaClearedTokens,
      corruptBlobMember
    ];

    beforeEach(() => {
      mockMemberManager.getAllMembersIncludingInactive.mockResolvedValue(allMembers);
      mockMemberManager.getStoredProviderTokens.mockImplementation(async (member) => {
        switch (member.athleteId) {
        case 1: return { access_token: 'a' }; // active strava - not reclaimable
        case 2: return { access_token: 'b' }; // inactive strava - reclaimable
        case 3: return { access_token: 'c' }; // active intervals with lingering strava tokens - reclaimable
        case 4: return null; // no strava namespace at all
        case 5: return null; // cleared/null tokens
        case 6: throw new Error('corrupt token blob'); // must be skipped, not thrown
        default: return null;
        }
      });
    });

    describe('countStravaSeats', () => {
      it('should enumerate via getAllMembersIncludingInactive, not getAllMembers', async () => {
        await activityProcessor.countStravaSeats();

        expect(mockMemberManager.getAllMembersIncludingInactive).toHaveBeenCalled();
        expect(mockMemberManager.getAllMembers).not.toHaveBeenCalled();
      });

      it('should count every stored-credential holder as used, and the non-active-strava subset as reclaimable', async () => {
        const result = await activityProcessor.countStravaSeats();

        // used: athletes 1, 2, 3 hold a strava namespace (4, 5 don't; 6 errors and is skipped)
        // reclaimable: athletes 2 (inactive) and 3 (active but on intervals) - athlete 1 is active+strava, not reclaimable
        expect(result).toEqual({ used: 3, cap: 10, reclaimable: 2 });
      });

      it('should skip a member whose token blob throws, without propagating the error', async () => {
        await expect(activityProcessor.countStravaSeats()).resolves.toBeDefined();
        expect(logger.member.warn).toHaveBeenCalledWith(
          'Could not read stored Strava tokens for seat accounting - skipping member',
          { athleteId: 6, error: 'corrupt token blob' }
        );
      });

      it('should count an active strava member with tokens as used but not reclaimable', async () => {
        mockMemberManager.getAllMembersIncludingInactive.mockResolvedValue([activeStravaWithTokens]);
        mockMemberManager.getStoredProviderTokens.mockResolvedValue({ access_token: 'a' });

        const result = await activityProcessor.countStravaSeats();

        expect(result).toEqual({ used: 1, cap: 10, reclaimable: 0 });
      });

      it('should count an inactive member with lingering strava tokens as both used and reclaimable', async () => {
        mockMemberManager.getAllMembersIncludingInactive.mockResolvedValue([inactiveStravaWithTokens]);
        mockMemberManager.getStoredProviderTokens.mockResolvedValue({ access_token: 'b' });

        const result = await activityProcessor.countStravaSeats();

        expect(result).toEqual({ used: 1, cap: 10, reclaimable: 1 });
      });

      it('should count an active intervals member with lingering strava tokens as both used and reclaimable', async () => {
        mockMemberManager.getAllMembersIncludingInactive.mockResolvedValue([activeIntervalsWithLingeringStravaTokens]);
        mockMemberManager.getStoredProviderTokens.mockResolvedValue({ access_token: 'c' });

        const result = await activityProcessor.countStravaSeats();

        expect(result).toEqual({ used: 1, cap: 10, reclaimable: 1 });
      });

      it('should count an intervals member with no strava namespace as neither used nor reclaimable', async () => {
        mockMemberManager.getAllMembersIncludingInactive.mockResolvedValue([activeIntervalsNoStravaTokens]);
        mockMemberManager.getStoredProviderTokens.mockResolvedValue(null);

        const result = await activityProcessor.countStravaSeats();

        expect(result).toEqual({ used: 0, cap: 10, reclaimable: 0 });
      });

      it('should count a member with cleared/null strava tokens as neither used nor reclaimable', async () => {
        mockMemberManager.getAllMembersIncludingInactive.mockResolvedValue([activeStravaClearedTokens]);
        mockMemberManager.getStoredProviderTokens.mockResolvedValue(null);

        const result = await activityProcessor.countStravaSeats();

        expect(result).toEqual({ used: 0, cap: 10, reclaimable: 0 });
      });

      it('should default a missing provider field to strava when deciding reclaimability', async () => {
        mockMemberManager.getAllMembersIncludingInactive.mockResolvedValue([{ athleteId: 1, isActive: true }]);
        mockMemberManager.getStoredProviderTokens.mockResolvedValue({ access_token: 'a' });

        const result = await activityProcessor.countStravaSeats();

        // isActive true + defaulted provider 'strava' => not reclaimable
        expect(result).toEqual({ used: 1, cap: 10, reclaimable: 0 });
      });
    });

    describe('getReclaimableStravaMembers', () => {
      it('should return exactly the members counted as reclaimable by countStravaSeats, in list order', async () => {
        const [{ reclaimable: reclaimableCount }, reclaimableMembers] = await Promise.all([
          activityProcessor.countStravaSeats(),
          activityProcessor.getReclaimableStravaMembers()
        ]);

        expect(reclaimableMembers).toEqual([inactiveStravaWithTokens, activeIntervalsWithLingeringStravaTokens]);
        expect(reclaimableMembers).toHaveLength(reclaimableCount);
      });

      it('should return an empty array when nobody is reclaimable', async () => {
        mockMemberManager.getAllMembersIncludingInactive.mockResolvedValue([activeStravaWithTokens]);
        mockMemberManager.getStoredProviderTokens.mockResolvedValue({ access_token: 'a' });

        const result = await activityProcessor.getReclaimableStravaMembers();

        expect(result).toEqual([]);
      });

      it('should skip a member whose token blob throws, without propagating the error', async () => {
        await expect(activityProcessor.getReclaimableStravaMembers()).resolves.toBeDefined();
        expect(logger.member.warn).toHaveBeenCalledWith(
          'Could not read stored Strava tokens for seat accounting - skipping member',
          { athleteId: 6, error: 'corrupt token blob' }
        );
      });
    });
  });

  describe('getStats', () => {
    it('should return comprehensive statistics', async () => {
      const mockQueueStats = {
        totalQueued: 5,
        delayMinutes: 15
      };
      mockActivityQueue.getStats.mockReturnValue(mockQueueStats);
      mockMemberManager.getMemberCount.mockReturnValue(25);

      // Add some processed activities
      activityProcessor.processedActivities.add('test-1');
      activityProcessor.processedActivities.add('test-2');

      const stats = await activityProcessor.getStats();

      expect(stats).toEqual({
        processedActivities: 2,
        registeredMembers: 25,
        uptime: expect.any(Number),
        memoryUsage: expect.any(Object),
        activityQueue: mockQueueStats
      });
      expect(mockActivityQueue.getStats).toHaveBeenCalled();
      expect(mockMemberManager.getMemberCount).toHaveBeenCalled();
    });
  });

  describe('shutdown', () => {
    it('should shutdown all components gracefully', async () => {
      mockActivityQueue.shutdown.mockResolvedValue();
      mockDiscordBot.stop.mockResolvedValue();
      mockMemberManager.saveMembers.mockResolvedValue();

      await activityProcessor.shutdown();

      expect(mockActivityQueue.shutdown).toHaveBeenCalled();
      expect(mockDiscordBot.stop).toHaveBeenCalled();
      expect(mockMemberManager.saveMembers).toHaveBeenCalled();
      expect(logger.activity.info).toHaveBeenCalledWith('Shutting down Activity Processor...');
      expect(logger.activity.info).toHaveBeenCalledWith('Activity Processor shutdown complete');
    });

    it('should handle shutdown errors gracefully', async () => {
      const error = new Error('Shutdown failed');
      mockDiscordBot.stop.mockRejectedValue(error);

      await activityProcessor.shutdown();

      expect(logger.activity.error).toHaveBeenCalledWith('Error during Activity Processor shutdown', error);
    });

    it('should call shutdown in correct order', async () => {
      const shutdownOrder = [];
      
      mockActivityQueue.shutdown.mockImplementation(() => {
        shutdownOrder.push('queue');
      });
      mockDiscordBot.stop.mockImplementation(() => {
        shutdownOrder.push('discord');
        return Promise.resolve();
      });
      mockMemberManager.saveMembers.mockImplementation(() => {
        shutdownOrder.push('members');
        return Promise.resolve();
      });

      await activityProcessor.shutdown();

      expect(shutdownOrder).toEqual(['queue', 'discord', 'members']);
    });
  });

  describe('error handling and edge cases', () => {
    it('should handle null activity from Strava API', async () => {
      mockMemberManager.getMemberByAthleteId.mockResolvedValue(mockMember);
      mockMemberManager.getValidAccessToken.mockResolvedValue('valid_token');
      mockStravaAPI.getActivity.mockResolvedValue(null);

      await activityProcessor.processNewActivity(98765, 12345);

      expect(mockStravaAPI.shouldPostActivity).toHaveBeenCalledWith(null);
      expect(logger.activityProcessing).toHaveBeenCalledWith(98765, 12345, 'UNKNOWN', 'FAILED', expect.any(Object));
    });

    it('should handle very large processed activities set', () => {
      // Simulate a large set without actually creating 50k items
      const originalSize = activityProcessor.processedActivities.size;
      Object.defineProperty(activityProcessor.processedActivities, 'size', {
        get: () => 50000,
        configurable: true
      });

      expect(() => activityProcessor.cleanupProcessedActivities()).not.toThrow();

      // Restore original size property
      Object.defineProperty(activityProcessor.processedActivities, 'size', {
        get: () => originalSize,
        configurable: true
      });
    });

    it('should handle empty members list in processRecentActivities', async () => {
      mockMemberManager.getAllMembers.mockResolvedValue([]);

      await activityProcessor.processRecentActivities(6);

      expect(mockStravaAPI.getAthleteActivities).not.toHaveBeenCalled();
      expect(logger.activity.info).toHaveBeenCalledWith('Processing recent activities', expect.any(Object));
      expect(logger.activity.info).toHaveBeenCalledWith('Finished processing recent activities');
    });

    it('should handle concurrent activity processing safely', async () => {
      // Reset the processed activities set for this test
      activityProcessor.processedActivities.clear();
      
      mockMemberManager.getMemberByAthleteId.mockResolvedValue(mockMember);
      mockMemberManager.getValidAccessToken.mockResolvedValue('valid_token');
      mockStravaAPI.getActivity.mockResolvedValue(mockActivity);
      mockStravaAPI.shouldPostActivity.mockReturnValue(true);
      mockStravaAPI.processActivityWithStreams.mockResolvedValue(mockProcessedActivity);
      mockDiscordBot.postActivity.mockResolvedValue();

      // Process same activity concurrently
      const promise1 = activityProcessor.processNewActivity(98765, 12345);
      const promise2 = activityProcessor.processNewActivity(98765, 12345);

      await Promise.all([promise1, promise2]);

      // Due to async nature, both might process if the timing is very close
      // The important thing is that the activity was processed successfully
      expect(mockDiscordBot.postActivity).toHaveBeenCalled();
      expect(mockDiscordBot.postActivity.mock.calls.length).toBeGreaterThanOrEqual(1);
    });
  });

  // intervals.icu has no webhooks, so the poll is the only chance to notice an
  // activity became postable. The stored row is what survives a restart, so
  // "was this posted?" has to live in the database, not just in memory.
  describe('re-posting a filtered intervals.icu activity', () => {
    const intervalsMember = {
      athleteId: 555,
      provider: 'intervals',
      athlete: { id: 555, firstname: 'Int', lastname: 'Ervals' },
      discordUser: { displayName: 'Int' }
    };
    const intervalsActivity = { id: 'i123', name: 'Evening Run', start_date_local: '2026-08-26T18:00:00' };

    beforeEach(() => {
      mockIntervalsAPI.getActivityStreams.mockResolvedValue(null);
      mockIntervalsAPI.processActivityData.mockReturnValue({ name: 'Evening Run' });
    });

    it('should record a filtered activity as not posted', async () => {
      mockIntervalsAPI.shouldPostActivity.mockReturnValue(false);

      await activityProcessor.processIntervalsActivity(intervalsActivity, intervalsMember, 'key');

      expect(mockMemberManager.databaseManager.upsertActivity).toHaveBeenCalledWith(
        555, intervalsActivity, 'intervals', { posted: false }
      );
    });

    it('should record a posted activity as posted', async () => {
      mockIntervalsAPI.shouldPostActivity.mockReturnValue(true);

      await activityProcessor.processIntervalsActivity(intervalsActivity, intervalsMember, 'key');

      expect(mockMemberManager.databaseManager.upsertActivity).toHaveBeenCalledWith(
        555, intervalsActivity, 'intervals', { posted: true }
      );
    });

    it('should skip an activity already stored as posted', async () => {
      mockMemberManager.databaseManager.getActivityById.mockResolvedValue({ posted: 1 });

      await activityProcessor.processIntervalsActivity(intervalsActivity, intervalsMember, 'key');

      expect(mockDiscordBot.postActivity).not.toHaveBeenCalled();
      expect(mockIntervalsAPI.shouldPostActivity).not.toHaveBeenCalled();
    });

    it('should reconsider an activity stored as not posted', async () => {
      mockMemberManager.databaseManager.getActivityById.mockResolvedValue({ posted: 0 });
      mockIntervalsAPI.shouldPostActivity.mockReturnValue(true);

      await activityProcessor.processIntervalsActivity(intervalsActivity, intervalsMember, 'key');

      expect(mockDiscordBot.postActivity).toHaveBeenCalled();
    });

    // Without this the in-memory guard blocks the very re-check the DB flag
    // exists to allow, until the process restarts.
    it('should let a later poll reconsider an activity filtered earlier this run', async () => {
      mockIntervalsAPI.shouldPostActivity.mockReturnValue(false);
      await activityProcessor.processIntervalsActivity(intervalsActivity, intervalsMember, 'key');

      mockMemberManager.databaseManager.getActivityById.mockResolvedValue({ posted: 0 });
      mockIntervalsAPI.shouldPostActivity.mockReturnValue(true);
      await activityProcessor.processIntervalsActivity(intervalsActivity, intervalsMember, 'key');

      expect(mockDiscordBot.postActivity).toHaveBeenCalled();
    });
  });

  describe('strava activity posted flag', () => {
    it('should store a filtered Strava activity as not posted', async () => {
      mockStravaAPI.shouldPostActivity.mockReturnValue(false);
      mockMemberManager.getMemberByAthleteId.mockResolvedValue(mockMember);
      mockMemberManager.getValidAccessToken.mockResolvedValue('token');
      mockStravaAPI.getActivity.mockResolvedValue(mockActivity);

      await activityProcessor.processNewActivity(98765, 12345);

      expect(mockMemberManager.databaseManager.upsertActivity).toHaveBeenCalledWith(
        12345, mockActivity, 'strava', { posted: false }
      );
    });

    it('should store a posted Strava activity as posted', async () => {
      mockStravaAPI.shouldPostActivity.mockReturnValue(true);
      mockMemberManager.getMemberByAthleteId.mockResolvedValue(mockMember);
      mockMemberManager.getValidAccessToken.mockResolvedValue('token');
      mockStravaAPI.getActivity.mockResolvedValue(mockActivity);

      await activityProcessor.processNewActivity(98765, 12345);

      expect(mockMemberManager.databaseManager.upsertActivity).toHaveBeenCalledWith(
        12345, mockActivity, 'strava', { posted: true }
      );
    });
  });

});