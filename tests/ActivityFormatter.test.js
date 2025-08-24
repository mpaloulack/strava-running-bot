const ActivityFormatter = require('../src/utils/ActivityFormatter');

describe('ActivityFormatter', () => {
  describe('formatDistance', () => {
    test('should format distance in meters to kilometers', () => {
      expect(ActivityFormatter.formatDistance(5000)).toBe('5.00 km');
      expect(ActivityFormatter.formatDistance(10500)).toBe('10.50 km');
      expect(ActivityFormatter.formatDistance(1000)).toBe('1.00 km');
    });

    test('should handle zero distance', () => {
      expect(ActivityFormatter.formatDistance(0)).toBe('0.00 km');
    });
  });

  describe('formatTime', () => {
    test('should format time in seconds to readable format', () => {
      expect(ActivityFormatter.formatTime(3661)).toBe('1:01:01'); // 1h 1m 1s
      expect(ActivityFormatter.formatTime(61)).toBe('1:01'); // 1m 1s  
      expect(ActivityFormatter.formatTime(30)).toBe('0:30'); // 30s
    });

    test('should handle zero time', () => {
      expect(ActivityFormatter.formatTime(0)).toBe('0:00');
    });
  });

  describe('formatPace', () => {
    test('should calculate and format pace correctly', () => {
      // 5km in 30 minutes = 6:00/km pace
      const pace = ActivityFormatter.formatPace(5000, 1800); 
      expect(pace).toBe('6:00/km');
    });

    test('should handle zero distance', () => {
      expect(ActivityFormatter.formatPace(0, 1800)).toBe('N/A');
    });
  });

  describe('getActivityColor', () => {
    test('should return correct colors for activity types', () => {
      expect(ActivityFormatter.getActivityColor('Run')).toBe('#FC4C02');
      expect(ActivityFormatter.getActivityColor('Ride')).toBe('#0074D9');
      expect(ActivityFormatter.getActivityColor('Swim')).toBe('#39CCCC');
    });

    test('should return default color for unknown activity type', () => {
      expect(ActivityFormatter.getActivityColor('UnknownActivity')).toBe('#FC4C02');
    });
  });

  describe('escapeDiscordMarkdown', () => {
    test('should escape Discord markdown characters', () => {
      const input = '2*(10*1\'/1) r=2\'30 ~test~ _italic_ `code`';
      const expected = '2\\*(10\\*1\'/1) r=2\'30 \\~test\\~ \\_italic\\_ \\`code\\`';
      expect(ActivityFormatter.escapeDiscordMarkdown(input)).toBe(expected);
    });

    test('should handle null and undefined inputs', () => {
      expect(ActivityFormatter.escapeDiscordMarkdown(null)).toBeNull();
      expect(ActivityFormatter.escapeDiscordMarkdown(undefined)).toBeUndefined();
      expect(ActivityFormatter.escapeDiscordMarkdown('')).toBe('');
    });
  });
});