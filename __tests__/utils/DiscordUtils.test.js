const DiscordUtils = require('../../src/utils/DiscordUtils');

describe('DiscordUtils', () => {
  describe('extractUserId', () => {
    it('should extract user ID from mention format with @', () => {
      const result = DiscordUtils.extractUserId('<@123456789012345678>');
      expect(result).toBe('123456789012345678');
    });

    it('should extract user ID from mention format with @!', () => {
      const result = DiscordUtils.extractUserId('<@!123456789012345678>');
      expect(result).toBe('123456789012345678');
    });

    it('should return user ID when already in correct format', () => {
      const result = DiscordUtils.extractUserId('123456789012345678');
      expect(result).toBe('123456789012345678');
    });

    it('should handle 17-digit Discord IDs', () => {
      const result = DiscordUtils.extractUserId('12345678901234567');
      expect(result).toBe('12345678901234567');
    });

    it('should handle 19-digit Discord IDs', () => {
      const result = DiscordUtils.extractUserId('1234567890123456789');
      expect(result).toBe('1234567890123456789');
    });

    it('should return null for invalid mention format', () => {
      const result = DiscordUtils.extractUserId('<@invalid>');
      expect(result).toBe(null);
    });

    it('should return null for too short ID', () => {
      const result = DiscordUtils.extractUserId('1234567890123456'); // 16 digits
      expect(result).toBe(null);
    });

    it('should return null for too long ID', () => {
      const result = DiscordUtils.extractUserId('12345678901234567890'); // 20 digits
      expect(result).toBe(null);
    });

    it('should return null for non-numeric ID', () => {
      const result = DiscordUtils.extractUserId('12345678901234567a');
      expect(result).toBe(null);
    });

    it('should return null for empty string', () => {
      const result = DiscordUtils.extractUserId('');
      expect(result).toBe(null);
    });

    it('should return null for null input', () => {
      const result = DiscordUtils.extractUserId(null);
      expect(result).toBe(null);
    });

    it('should return null for undefined input', () => {
      const result = DiscordUtils.extractUserId(undefined);
      expect(result).toBe(null);
    });

    it('should return null for number input', () => {
      const result = DiscordUtils.extractUserId(123456789012345678);
      expect(result).toBe(null);
    });

    it('should return null for object input', () => {
      const result = DiscordUtils.extractUserId({});
      expect(result).toBe(null);
    });

    it('should handle malformed mention without closing bracket', () => {
      const result = DiscordUtils.extractUserId('<@123456789012345678');
      expect(result).toBe(null);
    });

    it('should handle malformed mention without opening bracket', () => {
      const result = DiscordUtils.extractUserId('@123456789012345678>');
      expect(result).toBe(null);
    });
  });

  describe('chunkArray', () => {
    it('should split array into chunks of specified size', () => {
      const array = [1, 2, 3, 4, 5, 6, 7, 8, 9];
      const result = DiscordUtils.chunkArray(array, 3);
      
      expect(result).toEqual([
        [1, 2, 3],
        [4, 5, 6],
        [7, 8, 9]
      ]);
    });

    it('should handle array that doesnt divide evenly', () => {
      const array = [1, 2, 3, 4, 5, 6, 7];
      const result = DiscordUtils.chunkArray(array, 3);
      
      expect(result).toEqual([
        [1, 2, 3],
        [4, 5, 6],
        [7]
      ]);
    });

    it('should handle chunk size larger than array', () => {
      const array = [1, 2, 3];
      const result = DiscordUtils.chunkArray(array, 5);
      
      expect(result).toEqual([
        [1, 2, 3]
      ]);
    });

    it('should handle chunk size of 1', () => {
      const array = [1, 2, 3];
      const result = DiscordUtils.chunkArray(array, 1);
      
      expect(result).toEqual([
        [1],
        [2],
        [3]
      ]);
    });

    it('should handle empty array', () => {
      const array = [];
      const result = DiscordUtils.chunkArray(array, 3);
      
      expect(result).toEqual([]);
    });

    it('should handle chunk size of 0', () => {
      const array = [1, 2, 3];
      const result = DiscordUtils.chunkArray(array, 0);
      
      // With chunk size 0, this would create an infinite loop in the implementation
      // The function should handle this edge case gracefully
      expect(result).toEqual([]);
    });

    it('should handle string array', () => {
      const array = ['a', 'b', 'c', 'd', 'e'];
      const result = DiscordUtils.chunkArray(array, 2);
      
      expect(result).toEqual([
        ['a', 'b'],
        ['c', 'd'],
        ['e']
      ]);
    });

    it('should handle array with mixed types', () => {
      const array = [1, 'two', { three: 3 }, null, undefined];
      const result = DiscordUtils.chunkArray(array, 2);
      
      expect(result).toEqual([
        [1, 'two'],
        [{ three: 3 }, null],
        [undefined]
      ]);
    });

    it('should not modify original array', () => {
      const array = [1, 2, 3, 4, 5];
      const original = [...array];
      
      DiscordUtils.chunkArray(array, 2);
      
      expect(array).toEqual(original);
    });

    it('should handle large array', () => {
      const array = Array.from({ length: 100 }, (_, i) => i);
      const result = DiscordUtils.chunkArray(array, 10);
      
      expect(result.length).toBe(10);
      expect(result[0]).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
      expect(result[9]).toEqual([90, 91, 92, 93, 94, 95, 96, 97, 98, 99]);
    });
  });
});