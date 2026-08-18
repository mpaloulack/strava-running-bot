const { EmbedBuilder, AttachmentBuilder } = require('discord.js');
const config = require('../../config/config');
const ActivityEmbedBuilder = require('../../src/utils/EmbedBuilder');
const ActivityFormatter = require('../../src/utils/ActivityFormatter');
const MapRenderer = require('../../src/maps/MapRenderer');


jest.mock('../../config/config', () => ({
  strava: {
    baseUrl: 'https://www.strava.com/api/v3',
    authUrl: 'https://www.strava.com/oauth/authorize',
    tokenUrl: 'https://www.strava.com/oauth/token',
    clientId: 'test_client_id',
    clientSecret: 'test_client_secret'
  },
  server: {
    baseUrl: 'https://test.example.com'
  }
}));

// Mock EmbedBuilder methods
const mockEmbedBuilder = {
  setTitle: jest.fn().mockReturnThis(),
  setColor: jest.fn().mockReturnThis(),
  setTimestamp: jest.fn().mockReturnThis(),
  setURL: jest.fn().mockReturnThis(),
  setAuthor: jest.fn().mockReturnThis(),
  setFooter: jest.fn().mockReturnThis(),
  setDescription: jest.fn().mockReturnThis(),
  addFields: jest.fn().mockReturnThis(),
  setImage: jest.fn().mockReturnThis()
};

// Mock dependencies
jest.mock('discord.js', () => ({
  EmbedBuilder: jest.fn().mockImplementation(() => mockEmbedBuilder),
  AttachmentBuilder: jest.fn().mockImplementation((buffer, opts) => ({ buffer, ...opts }))
}));
jest.mock('../../src/utils/ActivityFormatter');
jest.mock('../../src/maps/MapRenderer', () => ({
  instance: {
    renderRoute: jest.fn()
  }
}));

describe('ActivityEmbedBuilder', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    
    // Setup default mock returns
    ActivityFormatter.escapeDiscordMarkdown.mockImplementation(text => text);
    ActivityFormatter.getActivityTypeColor.mockReturnValue('#FC4C02');
    ActivityFormatter.getActivityTypeIcon.mockReturnValue('🏃');
    ActivityFormatter.formatDistance.mockReturnValue('5.00 km');
    ActivityFormatter.formatTime.mockReturnValue('30:00');
    ActivityFormatter.formatPace.mockReturnValue('6:00/km');
    MapRenderer.instance.renderRoute.mockReset();
  });

  describe('createActivityEmbed', () => {
    const mockActivity = {
      id: 12345,
      name: 'Morning Run',
      type: 'Run',
      description: 'Great run in the park',
      distance: 5000,
      moving_time: 1800,
      elapsed_time: 2100,
      total_elevation_gain: 150,
      average_heartrate: 145,
      start_date: '2024-01-01T10:00:00Z',
      map: {
        summary_polyline: 'encoded_polyline_data'
      },
      athlete: {
        id: 67890,
        firstname: 'John',
        lastname: 'Doe',
        discordUser: {
          username: 'johndoe',
          displayName: 'John Doe',
          avatarURL: 'https://cdn.discordapp.com/avatars/123/avatar.png'
        }
      }
    };

    it('should create basic embed with default options', () => {
      const embed = ActivityEmbedBuilder.createActivityEmbed(mockActivity);

      expect(EmbedBuilder).toHaveBeenCalledTimes(1);
      expect(mockEmbedBuilder.setTitle).toHaveBeenCalledWith('🏃 Morning Run');
      expect(mockEmbedBuilder.setColor).toHaveBeenCalledWith('#FC4C02');
      expect(mockEmbedBuilder.setTimestamp).toHaveBeenCalledWith(new Date('2024-01-01T10:00:00Z'));
      expect(mockEmbedBuilder.setURL).toHaveBeenCalledWith('https://www.strava.com/activities/12345');
      expect(ActivityFormatter.escapeDiscordMarkdown).toHaveBeenCalledWith('Morning Run');
      expect(ActivityFormatter.getActivityTypeColor).toHaveBeenCalledWith('Run');
    });

    it('should use activity.url when present instead of the Strava fallback', () => {
      const activityWithUrl = { ...mockActivity, url: 'https://intervals.icu/activities/i176829341' };

      ActivityEmbedBuilder.createActivityEmbed(activityWithUrl);

      expect(mockEmbedBuilder.setURL).toHaveBeenCalledWith('https://intervals.icu/activities/i176829341');
    });

    it('should fall back to the Strava URL when activity.url is absent', () => {
      ActivityEmbedBuilder.createActivityEmbed(mockActivity);

      expect(mockEmbedBuilder.setURL).toHaveBeenCalledWith('https://www.strava.com/activities/12345');
    });

    it('should create embed with posted type', () => {
      ActivityEmbedBuilder.createActivityEmbed(mockActivity, { type: 'posted' });

      expect(mockEmbedBuilder.setAuthor).toHaveBeenCalledWith({
        name: 'John Doe',
        iconURL: 'https://cdn.discordapp.com/avatars/123/avatar.png'
      });
      expect(mockEmbedBuilder.setFooter).toHaveBeenCalledWith({
        text: 'Powered by Strava'
      });
    });

    it('should create embed with latest type', () => {
      ActivityEmbedBuilder.createActivityEmbed(mockActivity, { type: 'latest' });

      expect(mockEmbedBuilder.setAuthor).toHaveBeenCalledWith({
        name: 'John Doe - Last Activity',
        iconURL: 'https://cdn.discordapp.com/avatars/123/avatar.png'
      });
      expect(mockEmbedBuilder.setFooter).toHaveBeenCalledWith({
        text: 'Latest Activity • Powered by Strava'
      });
    });

    it('should use the intervals.icu footer with no icon for posted intervals.icu activities', () => {
      const intervalsActivity = { ...mockActivity, provider: 'intervals' };

      ActivityEmbedBuilder.createActivityEmbed(intervalsActivity, { type: 'posted' });

      expect(mockEmbedBuilder.setFooter).toHaveBeenCalledWith({
        text: 'Powered by intervals.icu'
      });
    });

    it('should use the intervals.icu footer with no icon for latest-type intervals.icu activities', () => {
      const intervalsActivity = { ...mockActivity, provider: 'intervals' };

      ActivityEmbedBuilder.createActivityEmbed(intervalsActivity, { type: 'latest' });

      expect(mockEmbedBuilder.setFooter).toHaveBeenCalledWith({
        text: 'Latest Activity • Powered by intervals.icu'
      });
    });

    it('should still use the Strava footer for strava-provider activities', () => {
      const stravaActivity = { ...mockActivity, provider: 'strava' };

      ActivityEmbedBuilder.createActivityEmbed(stravaActivity, { type: 'posted' });

      expect(mockEmbedBuilder.setFooter).toHaveBeenCalledWith({
        text: 'Powered by Strava'
      });
    });

    it('should handle activity with description', () => {
      ActivityEmbedBuilder.createActivityEmbed(mockActivity);

      expect(mockEmbedBuilder.setDescription).toHaveBeenCalledWith('Great run in the park');
      expect(ActivityFormatter.escapeDiscordMarkdown).toHaveBeenCalledWith('Great run in the park');
    });

    it('should handle activity without description', () => {
      const activityWithoutDescription = { ...mockActivity };
      delete activityWithoutDescription.description;

      ActivityEmbedBuilder.createActivityEmbed(activityWithoutDescription);

      expect(mockEmbedBuilder.setDescription).not.toHaveBeenCalled();
    });

    it('should handle empty description', () => {
      const activityWithEmptyDescription = { ...mockActivity, description: '' };

      ActivityEmbedBuilder.createActivityEmbed(activityWithEmptyDescription);

      expect(mockEmbedBuilder.setDescription).not.toHaveBeenCalled();
    });

    it('should add core activity fields', () => {
      ActivityEmbedBuilder.createActivityEmbed(mockActivity);

      expect(mockEmbedBuilder.addFields).toHaveBeenNthCalledWith(1,[
        { name: '📏 Distance', value: '5.00 km', inline: true },
        { name: '⏱️ Time', value: '30:00', inline: true }
      ]);

      expect(mockEmbedBuilder.addFields).toHaveBeenNthCalledWith(2, [
        { name: '🏃 Pace', value: '6:00/km', inline: true }
      ]);
      expect(ActivityFormatter.formatDistance).toHaveBeenCalledWith(5000);
      expect(ActivityFormatter.formatTime).toHaveBeenCalledWith(1800);
      expect(ActivityFormatter.formatPace).toHaveBeenCalledWith(5000, 1800);
    });

    it('should add a pace field for TrailRun and VirtualRun activities', () => {
      // intervals.icu reports trail/virtual runs literally (Strava's legacy
      // `type` folds them into 'Run') — they must still get a pace field.
      for (const type of ['TrailRun', 'VirtualRun']) {
        jest.clearAllMocks();
        ActivityFormatter.formatPace.mockReturnValue('6:00/km');
        ActivityEmbedBuilder.createActivityEmbed({ ...mockActivity, type });

        expect(mockEmbedBuilder.addFields).toHaveBeenNthCalledWith(2, [
          { name: '🏃 Pace', value: '6:00/km', inline: true }
        ]);
      }
    });

    it('should add optional elevation field when present', () => {
      // Create activity with only elevation data
      const activityWithElevation = {
        ...mockActivity,
        average_heartrate: undefined
      };

      ActivityEmbedBuilder.createActivityEmbed(activityWithElevation);

      // Should be called 3 times - twice for core fields, once for elevation
      expect(mockEmbedBuilder.addFields).toHaveBeenCalledTimes(3);
      expect(mockEmbedBuilder.addFields).toHaveBeenNthCalledWith(3, [
        { name: '⛰️ Elevation Gain', value: '150m', inline: true }
      ]);
    });

    it('should add optional heart rate field when present', () => {
      const activityWithHR = { ...mockActivity, average_heartrate: 145 };
      ActivityEmbedBuilder.createActivityEmbed(activityWithHR);

      expect(mockEmbedBuilder.addFields).toHaveBeenNthCalledWith(3, [{
        name: '❤️ Avg Heart Rate',
        value: '145 bpm',
        inline: true,
      }]);
    });

    it('should handle activity without optional fields', () => {
      const minimalActivity = {
        ...mockActivity,
        total_elevation_gain: 0,
        average_heartrate: null
      };

      ActivityEmbedBuilder.createActivityEmbed(minimalActivity);

      // Only core fields should be added
      expect(mockEmbedBuilder.addFields).toHaveBeenCalledTimes(2);
    });

    it('should never call setImage directly — map rendering is handled by createActivityMessage', () => {
      ActivityEmbedBuilder.createActivityEmbed(mockActivity);

      expect(mockEmbedBuilder.setImage).not.toHaveBeenCalled();
      expect(MapRenderer.instance.renderRoute).not.toHaveBeenCalled();
    });

    it('should handle activity without map', () => {
      const activityWithoutMap = { ...mockActivity };
      delete activityWithoutMap.map;

      expect(() => ActivityEmbedBuilder.createActivityEmbed(activityWithoutMap)).not.toThrow();
    });

    it('should handle activity with athlete but no Discord user', () => {
      const activityWithoutDiscordUser = {
        ...mockActivity,
        athlete: {
          ...mockActivity.athlete,
          discordUser: null
        }
      };

      ActivityEmbedBuilder.createActivityEmbed(activityWithoutDiscordUser);

      expect(mockEmbedBuilder.setAuthor).toHaveBeenCalledWith({
        name: 'John Doe',
        iconURL: undefined
      });
    });

    it('should handle activity without athlete', () => {
      const activityWithoutAthlete = { ...mockActivity };
      delete activityWithoutAthlete.athlete;

      ActivityEmbedBuilder.createActivityEmbed(activityWithoutAthlete);

      expect(mockEmbedBuilder.setAuthor).toHaveBeenCalledWith({
        name: 'Unknown Athlete',
        iconURL: undefined
      });
    });

    it('should handle different activity types', () => {
      const rideActivity = { ...mockActivity, type: 'Ride' };
      ActivityFormatter.getActivityTypeColor.mockReturnValue('#0074D9');

      ActivityEmbedBuilder.createActivityEmbed(rideActivity);

      expect(ActivityFormatter.getActivityTypeColor).toHaveBeenCalledWith('Ride');
      expect(mockEmbedBuilder.setColor).toHaveBeenCalledWith('#0074D9');
    });

    it('should display VirtualRide with game icon and [Virtual] prefix', () => {
      const virtualRideActivity = { ...mockActivity, type: 'VirtualRide' };
      ActivityFormatter.isVirtualRide.mockReturnValue(true);
      ActivityFormatter.getActivityTypeIcon.mockReturnValue('🎮');
      ActivityFormatter.getActivityTypeColor.mockReturnValue('#0074D9');

      ActivityEmbedBuilder.createActivityEmbed(virtualRideActivity);

      expect(ActivityFormatter.isVirtualRide).toHaveBeenCalledWith(virtualRideActivity);
      expect(ActivityFormatter.getActivityTypeIcon).toHaveBeenCalledWith('VirtualRide');
      expect(mockEmbedBuilder.setTitle).toHaveBeenCalledWith('🎮 [Virtual] Morning Run');
      expect(ActivityFormatter.getActivityTypeColor).toHaveBeenCalledWith('VirtualRide');
      expect(mockEmbedBuilder.setColor).toHaveBeenCalledWith('#0074D9');
    });

    it('should display Ride with trainer=true as VirtualRide', () => {
      const trainerRideActivity = { ...mockActivity, type: 'Ride', trainer: true };
      ActivityFormatter.isVirtualRide.mockReturnValue(true);
      ActivityFormatter.getActivityTypeIcon.mockReturnValue('🎮');
      ActivityFormatter.getActivityTypeColor.mockReturnValue('#0074D9');
      ActivityFormatter.formatSpeed.mockReturnValue('25.0 km/h');

      ActivityEmbedBuilder.createActivityEmbed(trainerRideActivity);

      expect(ActivityFormatter.isVirtualRide).toHaveBeenCalledWith(trainerRideActivity);
      expect(ActivityFormatter.getActivityTypeIcon).toHaveBeenCalledWith('VirtualRide');
      expect(mockEmbedBuilder.setTitle).toHaveBeenCalledWith('🎮 [Virtual] Morning Run');
      expect(ActivityFormatter.getActivityTypeColor).toHaveBeenCalledWith('VirtualRide');
    });

    it('should use speed metric for VirtualRide (not pace)', () => {
      const virtualRideActivity = { ...mockActivity, type: 'VirtualRide', distance: 20000, moving_time: 3600 };
      ActivityFormatter.isVirtualRide.mockReturnValue(true);
      ActivityFormatter.formatSpeed.mockReturnValue('20.0 km/h');

      ActivityEmbedBuilder.createActivityEmbed(virtualRideActivity);

      // Should call formatSpeed, not formatPace
      expect(ActivityFormatter.formatSpeed).toHaveBeenCalledWith(20000, 3600);
      expect(mockEmbedBuilder.addFields).toHaveBeenNthCalledWith(2, [
        { name: '🚴 Speed', value: '20.0 km/h', inline: true }
      ]);
    });

    it('should NOT add [Virtual] prefix for regular rides', () => {
      const regularRide = { ...mockActivity, type: 'Ride', trainer: false };
      ActivityFormatter.isVirtualRide.mockReturnValue(false);
      ActivityFormatter.getActivityTypeIcon.mockReturnValue('🚴');

      ActivityEmbedBuilder.createActivityEmbed(regularRide);

      expect(ActivityFormatter.isVirtualRide).toHaveBeenCalledWith(regularRide);
      expect(mockEmbedBuilder.setTitle).toHaveBeenCalledWith('🚴 Morning Run');
      expect(mockEmbedBuilder.setTitle).not.toHaveBeenCalledWith(expect.stringContaining('[Virtual]'));
    });

    it('should escape markdown in activity name', () => {
      const activityWithMarkdown = { ...mockActivity, name: 'Run with *bold* text' };
      ActivityFormatter.escapeDiscordMarkdown.mockReturnValue('Run with \\*bold\\* text');

      ActivityEmbedBuilder.createActivityEmbed(activityWithMarkdown);

      expect(mockEmbedBuilder.setTitle).toHaveBeenCalledWith('🏃 Run with \\*bold\\* text');
      expect(ActivityFormatter.escapeDiscordMarkdown).toHaveBeenCalledWith('Run with *bold* text');
    });

    it('should escape markdown in description', () => {
      const activityWithMarkdownDesc = { ...mockActivity, description: 'Great **run** in the park' };
      ActivityFormatter.escapeDiscordMarkdown.mockReturnValue('Great \\*\\*run\\*\\* in the park');

      ActivityEmbedBuilder.createActivityEmbed(activityWithMarkdownDesc);

      expect(mockEmbedBuilder.setDescription).toHaveBeenCalledWith('Great \\*\\*run\\*\\* in the park');
    });

    it('should return the embed instance', () => {
      const result = ActivityEmbedBuilder.createActivityEmbed(mockActivity);
      
      expect(result).toBe(mockEmbedBuilder);
    });

    it('should handle activities with zero values', () => {
      const zeroActivity = {
        ...mockActivity,
        distance: 0,
        moving_time: 0,
        total_elevation_gain: 0,
        average_heartrate: 0
      };

      ActivityFormatter.formatDistance.mockReturnValue('0.00 km');
      ActivityFormatter.formatTime.mockReturnValue('0:00');
      ActivityFormatter.formatPace.mockReturnValue('N/A');

      ActivityEmbedBuilder.createActivityEmbed(zeroActivity);

      expect(mockEmbedBuilder.addFields).toHaveBeenNthCalledWith(1,[
        { name: '📏 Distance', value: '0.00 km', inline: true },
        { name: '⏱️ Time', value: '0:00', inline: true }
      ]);
      expect(mockEmbedBuilder.addFields).toHaveBeenNthCalledWith(2, [
        { name: '🏃 Pace', value: 'N/A', inline: true }
      ]);
    });
  });

  describe('createActivityMessage', () => {
    const mockActivity = {
      id: 12345,
      name: 'Morning Run',
      type: 'Run',
      distance: 5000,
      moving_time: 1800,
      elapsed_time: 2100,
      start_date: '2024-01-01T10:00:00Z',
      map: {
        summary_polyline: 'encoded_polyline_data'
      },
      athlete: {
        id: 67890,
        firstname: 'John',
        lastname: 'Doe'
      }
    };

    it('attaches a route.png file and sets attachment://route.png on the embed when the renderer returns a buffer', async () => {
      const buffer = Buffer.from('fake-png-bytes');
      MapRenderer.instance.renderRoute.mockResolvedValue(buffer);

      const payload = await ActivityEmbedBuilder.createActivityMessage(mockActivity, { type: 'posted' });

      expect(MapRenderer.instance.renderRoute).toHaveBeenCalledWith('encoded_polyline_data', { poweredByStrava: true });
      expect(AttachmentBuilder).toHaveBeenCalledWith(buffer, { name: 'route.png' });
      expect(mockEmbedBuilder.setImage).toHaveBeenCalledWith('attachment://route.png');
      expect(payload.embeds).toEqual([mockEmbedBuilder]);
      expect(payload.files).toHaveLength(1);
      expect(payload.files[0]).toEqual({ buffer, name: 'route.png' });
    });

    it('asks for the Powered by Strava logo on maps of Strava activities', async () => {
      MapRenderer.instance.renderRoute.mockResolvedValue(Buffer.from('png'));

      await ActivityEmbedBuilder.createActivityMessage({ ...mockActivity, provider: 'strava' });

      expect(MapRenderer.instance.renderRoute).toHaveBeenCalledWith(
        'encoded_polyline_data',
        { poweredByStrava: true }
      );
    });

    it('does not brand maps of intervals.icu activities with the Strava logo', async () => {
      MapRenderer.instance.renderRoute.mockResolvedValue(Buffer.from('png'));

      await ActivityEmbedBuilder.createActivityMessage({ ...mockActivity, provider: 'intervals' });

      expect(MapRenderer.instance.renderRoute).toHaveBeenCalledWith(
        'encoded_polyline_data',
        { poweredByStrava: false }
      );
    });

    it('returns an empty files array and does not call setImage when the renderer returns null', async () => {
      MapRenderer.instance.renderRoute.mockResolvedValue(null);

      const payload = await ActivityEmbedBuilder.createActivityMessage(mockActivity);

      expect(mockEmbedBuilder.setImage).not.toHaveBeenCalled();
      expect(payload.files).toEqual([]);
    });

    it('does not call the renderer when the activity has no polyline', async () => {
      const activityWithoutMap = { ...mockActivity, map: {} };

      const payload = await ActivityEmbedBuilder.createActivityMessage(activityWithoutMap);

      expect(MapRenderer.instance.renderRoute).not.toHaveBeenCalled();
      expect(payload.files).toEqual([]);
    });

    it('does not call the renderer when the activity has no map at all', async () => {
      const activityWithoutMap = { ...mockActivity };
      delete activityWithoutMap.map;

      const payload = await ActivityEmbedBuilder.createActivityMessage(activityWithoutMap);

      expect(MapRenderer.instance.renderRoute).not.toHaveBeenCalled();
      expect(payload.files).toEqual([]);
    });

    it('never throws and yields an empty files array when the renderer rejects', async () => {
      MapRenderer.instance.renderRoute.mockRejectedValue(new Error('sharp blew up'));

      const payload = await ActivityEmbedBuilder.createActivityMessage(mockActivity);

      expect(mockEmbedBuilder.setImage).not.toHaveBeenCalled();
      expect(payload.files).toEqual([]);
    });
  });

  describe('private methods behavior through createActivityEmbed', () => {
    const mockActivity = {
      id: 12345,
      name: 'Test Activity',
      type: 'Run',
      distance: 5000,
      moving_time: 1800,
      start_date: '2024-01-01T10:00:00Z',
      athlete: {
        firstname: 'Jane',
        lastname: 'Smith',
        discordUser: {
          displayName: 'Jane Smith',
          avatarURL: 'https://example.com/avatar.png'
        }
      }
    };

    it('should handle all combinations of optional fields', () => {
      // Test with elevation but no heart rate
      const activityWithElevation = {
        ...mockActivity,
        total_elevation_gain: 200,
        average_heartrate: null
      };

      ActivityEmbedBuilder.createActivityEmbed(activityWithElevation);
      expect(mockEmbedBuilder.addFields).toHaveBeenNthCalledWith(3, [
        { name: '⛰️ Elevation Gain', value: '200m', inline: true }
      ]);
    });

    it('should handle heart rate but no elevation', () => {
      const activityWithHR = {
        ...mockActivity,
        total_elevation_gain: 0,
        average_heartrate: 160
      };

      ActivityEmbedBuilder.createActivityEmbed(activityWithHR);
      expect(mockEmbedBuilder.addFields).toHaveBeenNthCalledWith(3, [
        { name: '❤️ Avg Heart Rate', value: '160 bpm', inline: true }
      ]);
    });

    it('should handle both elevation and heart rate', () => {
      const activityWithBoth = {
        ...mockActivity,
        total_elevation_gain: 300,
        average_heartrate: 155
      };

      ActivityEmbedBuilder.createActivityEmbed(activityWithBoth);
      // Heart rate is added first
      expect(mockEmbedBuilder.addFields).toHaveBeenNthCalledWith(3, [
        { name: '❤️ Avg Heart Rate', value: '155 bpm', inline: true }
      ]);

      // Then elevation
      expect(mockEmbedBuilder.addFields).toHaveBeenNthCalledWith(4, [
        { name: '⛰️ Elevation Gain', value: '300m', inline: true }
      ]);
    });
  });
});