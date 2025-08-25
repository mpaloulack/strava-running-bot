/**
 * Tests for ActivityEmbedBuilder utility class
 */

// Mock Discord.js before importing our module
jest.mock('discord.js', () => require('../../__mocks__/discord.js'));

const ActivityEmbedBuilder = require('../../../src/utils/EmbedBuilder');
const { mockStravaActivity, mockProcessedActivity, mockCyclingActivity } = require('../../fixtures/activities');

// Mock ActivityFormatter
jest.mock('../../../src/utils/ActivityFormatter', () => ({
  escapeDiscordMarkdown: jest.fn((text) => text ? text.replace(/[*_~`]/g, '\\$&') : text),
  getActivityColor: jest.fn((type) => {
    const colors = { Run: '#FC4C02', Ride: '#0074D9', Swim: '#39CCCC' };
    return colors[type] || '#FC4C02';
  }),
  formatDistance: jest.fn((meters) => `${(meters / 1000).toFixed(2)} km`),
  formatTime: jest.fn((seconds) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return hours > 0 ? `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}` 
                    : `${minutes}:${secs.toString().padStart(2, '0')}`;
  }),
  formatPace: jest.fn((distance, time) => {
    if (distance === 0) return 'N/A';
    const paceSeconds = (time / (distance / 1000));
    const minutes = Math.floor(paceSeconds / 60);
    const seconds = Math.floor(paceSeconds % 60);
    return `${minutes}:${seconds.toString().padStart(2, '0')}/km`;
  }),
  generateStaticMapUrl: jest.fn((polyline) => polyline ? `https://maps.googleapis.com/maps/api/staticmap?path=enc:${polyline}` : null)
}));

describe('ActivityEmbedBuilder', () => {
  
  beforeEach(() => {
    jest.clearAllMocks();
  });
  
  describe('createActivityEmbed', () => {
    
    describe('basic embed creation', () => {
      test('should create embed with required basic fields', () => {
        const embed = ActivityEmbedBuilder.createActivityEmbed(mockStravaActivity);
        
        expect(embed.setTitle).toHaveBeenCalledWith(`🏃 ${mockStravaActivity.name}`);
        expect(embed.setColor).toHaveBeenCalledWith('#FC4C02');
        expect(embed.setTimestamp).toHaveBeenCalledWith(new Date(mockStravaActivity.start_date));
        expect(embed.setURL).toHaveBeenCalledWith(`https://www.strava.com/activities/${mockStravaActivity.id}`);
      });
      
      test('should escape markdown in activity name', () => {
        const activityWithMarkdown = {
          ...mockStravaActivity,
          name: 'Morning *Run* with _emphasis_'
        };
        
        ActivityEmbedBuilder.createActivityEmbed(activityWithMarkdown);
        
        expect(require('../../../src/utils/ActivityFormatter').escapeDiscordMarkdown)
          .toHaveBeenCalledWith(activityWithMarkdown.name);
      });
      
      test('should set activity type color correctly', () => {
        const ActivityFormatter = require('../../../src/utils/ActivityFormatter');
        
        // Test running activity
        ActivityEmbedBuilder.createActivityEmbed(mockStravaActivity);
        expect(ActivityFormatter.getActivityColor).toHaveBeenCalledWith('Run');
        
        // Test cycling activity
        ActivityEmbedBuilder.createActivityEmbed(mockCyclingActivity);
        expect(ActivityFormatter.getActivityColor).toHaveBeenCalledWith('Ride');
      });
    });
    
    describe('embed type variations', () => {
      test('should set standard author and footer for default type', () => {
        const embed = ActivityEmbedBuilder.createActivityEmbed(mockStravaActivity);
        
        expect(embed.setAuthor).toHaveBeenCalledWith({
          name: `${mockStravaActivity.athlete.firstname} ${mockStravaActivity.athlete.lastname}`,
          iconURL: mockStravaActivity.athlete.profile_medium
        });
        
        expect(embed.setFooter).toHaveBeenCalledWith({
          text: 'Powered by Strava',
          iconURL: 'https://cdn.worldvectorlogo.com/logos/strava-1.svg'
        });
      });
      
      test('should set latest activity author and footer for latest type', () => {
        const embed = ActivityEmbedBuilder.createActivityEmbed(mockStravaActivity, { type: 'latest' });
        
        expect(embed.setAuthor).toHaveBeenCalledWith({
          name: `${mockStravaActivity.athlete.firstname} ${mockStravaActivity.athlete.lastname} - Last Activity`,
          iconURL: mockStravaActivity.athlete.profile_medium
        });
        
        expect(embed.setFooter).toHaveBeenCalledWith({
          text: 'Latest Activity • Powered by Strava',
          iconURL: 'https://cdn.worldvectorlogo.com/logos/strava-1.svg'
        });
      });
      
      test('should use Discord user info when available', () => {
        const embed = ActivityEmbedBuilder.createActivityEmbed(mockProcessedActivity);
        
        expect(embed.setAuthor).toHaveBeenCalledWith({
          name: mockProcessedActivity.athlete.discordUser.displayName,
          iconURL: mockProcessedActivity.athlete.discordUser.avatarURL
        });
      });
      
      test('should fallback to Strava info when Discord user unavailable', () => {
        const activityWithoutDiscord = {
          ...mockProcessedActivity,
          athlete: {
            ...mockProcessedActivity.athlete,
            discordUser: null
          }
        };
        
        const embed = ActivityEmbedBuilder.createActivityEmbed(activityWithoutDiscord);
        
        expect(embed.setAuthor).toHaveBeenCalledWith({
          name: `${activityWithoutDiscord.athlete.firstname} ${activityWithoutDiscord.athlete.lastname}`,
          iconURL: activityWithoutDiscord.athlete.profile_medium
        });
      });
    });
    
    describe('activity description handling', () => {
      test('should add description when present', () => {
        const embed = ActivityEmbedBuilder.createActivityEmbed(mockStravaActivity);
        
        expect(embed.setDescription).toHaveBeenCalledWith(mockStravaActivity.description);
      });
      
      test('should not add description when null', () => {
        const activityWithoutDescription = {
          ...mockStravaActivity,
          description: null
        };
        
        const embed = ActivityEmbedBuilder.createActivityEmbed(activityWithoutDescription);
        
        expect(embed.setDescription).not.toHaveBeenCalled();
      });
      
      test('should not add description when empty string', () => {
        const activityWithEmptyDescription = {
          ...mockStravaActivity,
          description: ''
        };
        
        const embed = ActivityEmbedBuilder.createActivityEmbed(activityWithEmptyDescription);
        
        expect(embed.setDescription).not.toHaveBeenCalled();
      });
      
      test('should escape markdown in description', () => {
        const activityWithMarkdownDescription = {
          ...mockStravaActivity,
          description: 'Great run with *emphasis* and _underline_!'
        };
        
        ActivityEmbedBuilder.createActivityEmbed(activityWithMarkdownDescription);
        
        expect(require('../../../src/utils/ActivityFormatter').escapeDiscordMarkdown)
          .toHaveBeenCalledWith(activityWithMarkdownDescription.description);
      });
    });
    
    describe('core activity fields', () => {
      test('should add distance, time, and pace fields', () => {
        const ActivityFormatter = require('../../../src/utils/ActivityFormatter');
        const embed = ActivityEmbedBuilder.createActivityEmbed(mockStravaActivity);
        
        expect(embed.addFields).toHaveBeenCalledWith([
          {
            name: '📏 Distance',
            value: ActivityFormatter.formatDistance(mockStravaActivity.distance),
            inline: true,
          },
          {
            name: '⏱️ Time',
            value: ActivityFormatter.formatTime(mockStravaActivity.moving_time),
            inline: true,
          },
          {
            name: '🏃 Pace',
            value: ActivityFormatter.formatPace(mockStravaActivity.distance, mockStravaActivity.moving_time),
            inline: true,
          }
        ]);
      });
      
      test('should call formatting functions with correct parameters', () => {
        const ActivityFormatter = require('../../../src/utils/ActivityFormatter');
        
        ActivityEmbedBuilder.createActivityEmbed(mockStravaActivity);
        
        expect(ActivityFormatter.formatDistance).toHaveBeenCalledWith(mockStravaActivity.distance);
        expect(ActivityFormatter.formatTime).toHaveBeenCalledWith(mockStravaActivity.moving_time);
        expect(ActivityFormatter.formatPace).toHaveBeenCalledWith(mockStravaActivity.distance, mockStravaActivity.moving_time);
      });
    });
    
    describe('optional activity fields', () => {
      test('should add Grade Adjusted Pace when available', () => {
        const activityWithGAP = { ...mockStravaActivity, gap_pace: '5:30/km' };
        const embed = ActivityEmbedBuilder.createActivityEmbed(activityWithGAP);
        
        expect(embed.addFields).toHaveBeenCalledWith([{
          name: '📈 Grade Adjusted Pace',
          value: '5:30/km',
          inline: true,
        }]);
      });
      
      test('should not add GAP when not available', () => {
        const activityWithoutGAP = { ...mockStravaActivity, gap_pace: null };
        const embed = ActivityEmbedBuilder.createActivityEmbed(activityWithoutGAP);
        
        // Should be called 3 times: core fields (1) + heart rate (1) + elevation (1) = 3
        // No GAP field should be added
        expect(embed.addFields).toHaveBeenCalledTimes(3);
        
        // Verify GAP field is not added
        const addFieldsCalls = embed.addFields.mock.calls;
        const hasGAPField = addFieldsCalls.some(call => 
          call[0].some && call[0].some(field => field.name === '📈 Grade Adjusted Pace')
        );
        expect(hasGAPField).toBe(false);
      });
      
      test('should add heart rate when available', () => {
        const embed = ActivityEmbedBuilder.createActivityEmbed(mockStravaActivity);
        
        expect(embed.addFields).toHaveBeenCalledWith([{
          name: '❤️ Avg Heart Rate',
          value: `${Math.round(mockStravaActivity.average_heartrate)} bpm`,
          inline: true,
        }]);
      });
      
      test('should not add heart rate when null', () => {
        const activityWithoutHR = { ...mockStravaActivity, average_heartrate: null };
        const embed = ActivityEmbedBuilder.createActivityEmbed(activityWithoutHR);
        
        // Count how many times addFields was called
        const addFieldsCalls = embed.addFields.mock.calls;
        const heartRateCalls = addFieldsCalls.some(call => 
          call[0].some && call[0].some(field => field.name === '❤️ Avg Heart Rate')
        );
        
        expect(heartRateCalls).toBe(false);
      });
      
      test('should add elevation gain when significant (> 10m)', () => {
        const embed = ActivityEmbedBuilder.createActivityEmbed(mockStravaActivity);
        
        expect(embed.addFields).toHaveBeenCalledWith([{
          name: '⛰️ Elevation Gain',
          value: `${Math.round(mockStravaActivity.total_elevation_gain)}m`,
          inline: true,
        }]);
      });
      
      test('should not add elevation gain when less than 10m', () => {
        const flatActivity = { ...mockStravaActivity, total_elevation_gain: 5 };
        const embed = ActivityEmbedBuilder.createActivityEmbed(flatActivity);
        
        const addFieldsCalls = embed.addFields.mock.calls;
        const elevationCalls = addFieldsCalls.some(call => 
          call[0].some && call[0].some(field => field.name === '⛰️ Elevation Gain')
        );
        
        expect(elevationCalls).toBe(false);
      });
      
      test('should round heart rate and elevation to nearest integer', () => {
        const activityWithDecimals = {
          ...mockStravaActivity,
          average_heartrate: 164.7,
          total_elevation_gain: 45.9
        };
        
        const embed = ActivityEmbedBuilder.createActivityEmbed(activityWithDecimals);
        
        expect(embed.addFields).toHaveBeenCalledWith([{
          name: '❤️ Avg Heart Rate',
          value: '165 bpm',
          inline: true,
        }]);
        
        expect(embed.addFields).toHaveBeenCalledWith([{
          name: '⛰️ Elevation Gain',
          value: '46m',
          inline: true,
        }]);
      });
    });
    
    describe('map image handling', () => {
      test('should add map image when polyline available', () => {
        const ActivityFormatter = require('../../../src/utils/ActivityFormatter');
        const embed = ActivityEmbedBuilder.createActivityEmbed(mockStravaActivity);
        
        expect(ActivityFormatter.generateStaticMapUrl).toHaveBeenCalledWith(mockStravaActivity.map.summary_polyline);
        expect(embed.setImage).toHaveBeenCalled();
      });
      
      test('should not add map image when no map data', () => {
        const activityWithoutMap = { ...mockStravaActivity, map: null };
        const embed = ActivityEmbedBuilder.createActivityEmbed(activityWithoutMap);
        
        expect(embed.setImage).not.toHaveBeenCalled();
      });
      
      test('should not add map image when no polyline', () => {
        const activityWithoutPolyline = {
          ...mockStravaActivity,
          map: { id: 'test', summary_polyline: null }
        };
        const embed = ActivityEmbedBuilder.createActivityEmbed(activityWithoutPolyline);
        
        expect(embed.setImage).not.toHaveBeenCalled();
      });
      
      test('should not add map image when generateStaticMapUrl returns null', () => {
        const ActivityFormatter = require('../../../src/utils/ActivityFormatter');
        ActivityFormatter.generateStaticMapUrl.mockReturnValueOnce(null);
        
        const embed = ActivityEmbedBuilder.createActivityEmbed(mockStravaActivity);
        
        expect(embed.setImage).not.toHaveBeenCalled();
      });
    });
    
    describe('complete embed integration', () => {
      test('should create complete embed with all available data', () => {
        const completeActivity = {
          ...mockProcessedActivity,
          description: 'Amazing run today!',
          gap_pace: '5:45/km',
          average_heartrate: 168,
          total_elevation_gain: 120
        };
        
        const embed = ActivityEmbedBuilder.createActivityEmbed(completeActivity);
        
        // Verify all methods were called
        expect(embed.setTitle).toHaveBeenCalled();
        expect(embed.setDescription).toHaveBeenCalled();
        expect(embed.setColor).toHaveBeenCalled();
        expect(embed.setAuthor).toHaveBeenCalled();
        expect(embed.setFooter).toHaveBeenCalled();
        expect(embed.setTimestamp).toHaveBeenCalled();
        expect(embed.setURL).toHaveBeenCalled();
        expect(embed.setImage).toHaveBeenCalled();
        expect(embed.addFields).toHaveBeenCalledTimes(4); // core + GAP + HR + elevation
      });
      
      test('should create minimal embed with required data only', () => {
        const minimalActivity = {
          id: 123456789,
          name: 'Simple Run',
          distance: 5000,
          moving_time: 1800,
          type: 'Run',
          start_date: '2024-01-15T08:00:00Z',
          athlete: {
            firstname: 'John',
            lastname: 'Doe',
            profile_medium: 'https://example.com/avatar.jpg'
          },
          // No description, no GAP, no heart rate, no significant elevation, no map
          description: null,
          gap_pace: null,
          average_heartrate: null,
          total_elevation_gain: 5,
          map: null
        };
        
        const embed = ActivityEmbedBuilder.createActivityEmbed(minimalActivity);
        
        expect(embed.setTitle).toHaveBeenCalled();
        expect(embed.setDescription).not.toHaveBeenCalled();
        expect(embed.setImage).not.toHaveBeenCalled();
        expect(embed.addFields).toHaveBeenCalledTimes(1); // only core fields
      });
    });
    
    describe('static class behavior', () => {
      test('should be a static method', () => {
        expect(typeof ActivityEmbedBuilder.createActivityEmbed).toBe('function');
      });
      
      test('should not modify input activity object', () => {
        const originalActivity = { ...mockStravaActivity };
        
        ActivityEmbedBuilder.createActivityEmbed(mockStravaActivity);
        
        expect(mockStravaActivity).toEqual(originalActivity);
      });
      
      test('should handle undefined options parameter', () => {
        expect(() => {
          ActivityEmbedBuilder.createActivityEmbed(mockStravaActivity);
        }).not.toThrow();
      });
      
      test('should handle empty options object', () => {
        expect(() => {
          ActivityEmbedBuilder.createActivityEmbed(mockStravaActivity, {});
        }).not.toThrow();
      });
    });
  });
  
  describe('error handling and edge cases', () => {
    test('should handle activity with missing athlete data gracefully', () => {
      const activityWithMissingData = {
        ...mockStravaActivity,
        athlete: {
          firstname: null,
          lastname: null,
          profile_medium: null
        }
      };
      
      expect(() => {
        ActivityEmbedBuilder.createActivityEmbed(activityWithMissingData);
      }).not.toThrow();
    });
    
    test('should handle zero values correctly', () => {
      const zeroActivity = {
        ...mockStravaActivity,
        distance: 0,
        moving_time: 0,
        total_elevation_gain: 0
      };
      
      expect(() => {
        ActivityEmbedBuilder.createActivityEmbed(zeroActivity);
      }).not.toThrow();
    });
  });
});