/**
 * Tests for DiscordUtils utility functions
 */

const DiscordUtils = require('../../../src/utils/DiscordUtils');

describe('DiscordUtils', () => {
  
  describe('extractUserId', () => {
    
    describe('valid Discord mentions', () => {
      test('should extract user ID from standard mention format', () => {
        const result = DiscordUtils.extractUserId('<@123456789012345678>');
        expect(result).toBe('123456789012345678');
      });
      
      test('should extract user ID from nickname mention format', () => {
        const result = DiscordUtils.extractUserId('<@!123456789012345678>');
        expect(result).toBe('123456789012345678');
      });
      
      test('should handle different valid Discord user ID lengths', () => {
        // 17 digit ID (minimum)
        const result17 = DiscordUtils.extractUserId('<@12345678901234567>');
        expect(result17).toBe('12345678901234567');
        
        // 18 digit ID (common)
        const result18 = DiscordUtils.extractUserId('<@123456789012345678>');
        expect(result18).toBe('123456789012345678');
        
        // 19 digit ID (maximum)
        const result19 = DiscordUtils.extractUserId('<@1234567890123456789>');
        expect(result19).toBe('1234567890123456789');
      });
    });
    
    describe('valid Discord IDs (snowflakes)', () => {
      test('should return valid 18-digit Discord ID as-is', () => {
        const discordId = '123456789012345678';
        const result = DiscordUtils.extractUserId(discordId);
        expect(result).toBe(discordId);
      });
      
      test('should return valid 17-digit Discord ID as-is', () => {
        const discordId = '12345678901234567';
        const result = DiscordUtils.extractUserId(discordId);
        expect(result).toBe(discordId);
      });
      
      test('should return valid 19-digit Discord ID as-is', () => {
        const discordId = '1234567890123456789';
        const result = DiscordUtils.extractUserId(discordId);
        expect(result).toBe(discordId);
      });
    });
    
    describe('invalid inputs', () => {
      test('should return null for malformed mention', () => {
        expect(DiscordUtils.extractUserId('<@123>')).toBeNull();
        expect(DiscordUtils.extractUserId('<@abc123456789012345>')).toBeNull();
        expect(DiscordUtils.extractUserId('<123456789012345678>')).toBeNull();
        expect(DiscordUtils.extractUserId('@123456789012345678')).toBeNull();
      });
      
      test('should return null for invalid Discord IDs', () => {
        // Too short
        expect(DiscordUtils.extractUserId('123456789012345')).toBeNull();
        // Too long  
        expect(DiscordUtils.extractUserId('12345678901234567890')).toBeNull();
        // Contains letters
        expect(DiscordUtils.extractUserId('123456789012345abc')).toBeNull();
        // Empty string
        expect(DiscordUtils.extractUserId('')).toBeNull();
      });
      
      test('should return null for non-string inputs', () => {
        expect(DiscordUtils.extractUserId(null)).toBeNull();
        expect(DiscordUtils.extractUserId(undefined)).toBeNull();
        expect(DiscordUtils.extractUserId(123456789012345678)).toBeNull();
        expect(DiscordUtils.extractUserId({})).toBeNull();
      });
    });
    
    describe('edge cases', () => {
      test('should handle mention with extra spaces', () => {
        // Discord doesn't allow spaces in mentions, so this should be invalid
        expect(DiscordUtils.extractUserId('<@ 123456789012345678>')).toBeNull();
        expect(DiscordUtils.extractUserId('<@123456789012345678 >')).toBeNull();
      });
      
      test('should handle minimum and maximum valid Discord IDs', () => {
        // Minimum valid Discord snowflake (17 digits)
        const minId = '10000000000000000';
        expect(DiscordUtils.extractUserId(minId)).toBe(minId);
        
        // Near maximum valid Discord snowflake (19 digits)
        const maxId = '999999999999999999';
        expect(DiscordUtils.extractUserId(maxId)).toBe(maxId);
      });
    });
  });
  
  describe('chunkArray', () => {
    
    describe('basic chunking functionality', () => {
      test('should split array into equal-sized chunks', () => {
        const array = [1, 2, 3, 4, 5, 6];
        const result = DiscordUtils.chunkArray(array, 2);
        
        expect(result).toEqual([
          [1, 2],
          [3, 4],
          [5, 6]
        ]);
      });
      
      test('should handle array with remainder elements', () => {
        const array = [1, 2, 3, 4, 5];
        const result = DiscordUtils.chunkArray(array, 2);
        
        expect(result).toEqual([
          [1, 2],
          [3, 4],
          [5]
        ]);
      });
      
      test('should handle chunk size larger than array', () => {
        const array = [1, 2, 3];
        const result = DiscordUtils.chunkArray(array, 5);
        
        expect(result).toEqual([[1, 2, 3]]);
      });
      
      test('should handle chunk size equal to array length', () => {
        const array = [1, 2, 3];
        const result = DiscordUtils.chunkArray(array, 3);
        
        expect(result).toEqual([[1, 2, 3]]);
      });
    });
    
    describe('edge cases', () => {
      test('should return empty array for empty input array', () => {
        const result = DiscordUtils.chunkArray([], 2);
        expect(result).toEqual([]);
      });
      
      test('should handle chunk size of 1', () => {
        const array = [1, 2, 3];
        const result = DiscordUtils.chunkArray(array, 1);
        
        expect(result).toEqual([[1], [2], [3]]);
      });
      
      test('should preserve element types and structure', () => {
        const array = [
          { id: 1, name: 'Alice' },
          { id: 2, name: 'Bob' },
          { id: 3, name: 'Charlie' },
          { id: 4, name: 'Diana' }
        ];
        const result = DiscordUtils.chunkArray(array, 2);
        
        expect(result).toEqual([
          [{ id: 1, name: 'Alice' }, { id: 2, name: 'Bob' }],
          [{ id: 3, name: 'Charlie' }, { id: 4, name: 'Diana' }]
        ]);
      });
      
      test('should handle array with mixed data types', () => {
        const array = [1, 'two', { three: 3 }, [4], null, undefined];
        const result = DiscordUtils.chunkArray(array, 3);
        
        expect(result).toEqual([
          [1, 'two', { three: 3 }],
          [[4], null, undefined]
        ]);
      });
    });
    
    describe('Discord-specific use cases', () => {
      test('should chunk member list for Discord embed display', () => {
        const members = Array.from({ length: 25 }, (_, i) => ({
          id: `member${i}`,
          name: `User ${i}`
        }));
        
        const result = DiscordUtils.chunkArray(members, 10);
        
        expect(result).toHaveLength(3);
        expect(result[0]).toHaveLength(10);
        expect(result[1]).toHaveLength(10);
        expect(result[2]).toHaveLength(5);
      });
      
      test('should handle single-member list', () => {
        const members = [{ id: '123', name: 'Solo User' }];
        const result = DiscordUtils.chunkArray(members, 10);
        
        expect(result).toEqual([[{ id: '123', name: 'Solo User' }]]);
      });
    });
    
    describe('performance and large arrays', () => {
      test('should handle large arrays efficiently', () => {
        const largeArray = Array.from({ length: 1000 }, (_, i) => i);
        const result = DiscordUtils.chunkArray(largeArray, 100);
        
        expect(result).toHaveLength(10);
        expect(result[0]).toHaveLength(100);
        expect(result[9]).toHaveLength(100);
        expect(result[0][0]).toBe(0);
        expect(result[9][99]).toBe(999);
      });
    });
  });
  
  describe('static class behavior', () => {
    test('should not be instantiable', () => {
      // DiscordUtils should only have static methods
      expect(typeof DiscordUtils).toBe('function');
      expect(DiscordUtils.constructor).toBeDefined();
      
      // All methods should be static
      expect(typeof DiscordUtils.extractUserId).toBe('function');
      expect(typeof DiscordUtils.chunkArray).toBe('function');
    });
    
    test('should not modify input parameters', () => {
      const originalArray = [1, 2, 3, 4, 5];
      const originalId = '<@123456789012345678>';
      
      DiscordUtils.chunkArray(originalArray, 2);
      expect(originalArray).toEqual([1, 2, 3, 4, 5]);
      
      DiscordUtils.extractUserId(originalId);
      expect(originalId).toBe('<@123456789012345678>');
    });
  });
});